// The single pull-request comment this integration maintains.
//
// IT IS ONE COMMENT, EDITED IN PLACE. A pull request that is pushed to ten times
// must end with one current comment, not ten stale ones, so the body opens with
// a hidden marker and a later run finds that marker and edits the comment it is
// on. The marker is the identity: nothing else about the body is stable, and
// matching on a heading or on the author alone would collide with any other
// tool.
//
// The marker is written FIRST, before any content, for two reasons. Truncation
// works from the end, so an over-long body can never lose its own identity; and
// untrusted text later in the body cannot forge a marker because `sanitizeText`
// escapes every `<`.
import {
  isActionableFinding,
  isArtifactOnlyFinding
} from '../../src/shared/contracts/index.js'
import {
  adjustedPrecisionInTwenty,
  NO_MODEL_SEARCH,
  NOTHING_PROVED,
  NOTHING_SEARCHED,
  inDiffRecallInTen,
  measuredReliability,
  MEASURED_ON_MODEL,
  MEASURED_ON_PROVIDER
} from '../../src/domains/reporting/measured-reliability.js'
import {
  MAX_ISSUE_COMMENT_BODY,
  sanitizeLine,
  sanitizeText
} from './sanitize.js'
import type {
  FindingDigest,
  ImpactDigest,
  ImpactFindingDigest,
  ImpactRelianceDigest,
  IntentDigest,
  ReportableCompatibilityClass,
  ReviewDigest,
  Severity
} from './report-digest.js'
import { severityOrder } from './report-digest.js'
import type { StageOutcome } from './stage-outcomes.js'
import { reviewStageDefinition } from './stage-outcomes.js'
import type { ReviewConversationOutcome } from './review-conversation.js'

const MARKER_PREFIX = 'codereviewer:review-summary'

// Bounded so a key cannot smuggle markup into the marker it is interpolated
// into. A key is an operator choice (one comment per workflow, e.g. `default`
// and `nightly`), not user input, but the marker is the integration's identity
// and validating it costs nothing.
const validKey = /^[A-Za-z0-9._-]{1,64}$/u

export const summaryCommentMarker = (key: string): string => {
  if (!validKey.test(key)) {
    throw new TypeError(
      `Comment key must match ${String(validKey)}, received "${key}".`
    )
  }

  return `<!-- ${MARKER_PREFIX}:${key} -->`
}

export type SummaryCommentInput = {
  readonly markerKey: string
  readonly outcomes: readonly StageOutcome[]
  readonly review?: ReviewDigest
  readonly intent?: IntentDigest
  readonly impact?: ImpactDigest
  readonly headSha: string
  /** Link back to the workflow run holding the full artifacts. */
  readonly runUrl?: string
  /** Number of inline review comments posted, when inline posting ran. */
  readonly inlineCommentCount?: number
  /**
   * Findings this pull request's own inline comments carry from earlier pushes
   * that this run did not report again.
   *
   * Read from the comments already on the pull request, so it needs no stored
   * state and survives a re-run on a fresh checkout. `undefined` — never 0 —
   * when the comparison could not be made at all (no API, inline posting off):
   * a computed zero is a fact, an uncomputed one is not.
   */
  readonly noLongerReportedCount?: number
  /**
   * Spec 30: present only on a run triggered by a reply that nominated at least
   * one finding for re-adjudication. This run's own verdict on each one — held,
   * no longer reported, or still undecided — so a reader can see that a second
   * look happened without opening the run artifacts.
   */
  readonly reviewConversation?: readonly ReviewConversationOutcome[]
  /**
   * Operational notes: a fork that could not be reviewed, inline comments that
   * could not be posted, a stage that was skipped. Rendered verbatim (after
   * sanitizing) because each one explains why the reader is seeing less than
   * they expected.
   */
  readonly notes: readonly string[]
}

const MAX_LISTED_FINDINGS = 50
const MAX_LISTED_UNRESOLVED = 20
const MAX_LISTED_OBLIGATIONS = 20
const MAX_LISTED_SYMBOLS = 15
// The adjudicated layer is bounded far below the reference table it sits over,
// and deliberately: it is the short list by construction (spec 22 measures the
// untriaged reference list near 90% irrelevant), so a long one is a signal to
// open the artifact rather than something to paste onto a pull request.
const MAX_LISTED_IMPACT_FINDINGS = 10
const MAX_LISTED_RELIANCES = 5
// The producer caps both `contractElement` and `consequence` at 300 characters,
// so this is a bound on this surface, not a second truncation policy.
const MAX_CONTRACT_STATEMENT = 300
const MAX_TITLE = 200
const MAX_DESCRIPTION = 700
const MAX_WHY_SURVIVED = 400

// A finding admission marked `artifact-only` is one refutation could neither
// prove nor disprove (`needs-more-evidence`): a real suspicion, deliberately
// kept as a question for a human rather than dropped. It must never appear
// mixed into the actionable findings list — that read it as a proved defect —
// and must never silently vanish either, which is what happened before this
// field was carried into the digest at all.
//
// The split is the engine's own predicate, not a copy of it: the two lists this
// comment publishes have to hold exactly what the quality gate and the report
// artifacts hold, and a locally spelled-out `!== 'artifact-only'` is a second
// definition that a value added to the vocabulary can silently divide.
const actionableFindings = (review: ReviewDigest): readonly FindingDigest[] =>
  review.findings.filter(isActionableFinding)

// Whether this comment may say anything about a model search. Only an explicit
// `not-performed` withholds the rates: a report that does not carry the field has
// not claimed a search ran, and reading its silence as the claim would strip a
// genuinely searched run of the numbers a reviewer needs to weigh it.
const performedNoModelSearch = (input: SummaryCommentInput): boolean =>
  input.review?.modelSearch === 'not-performed'

// NO REVIEW REPORT AT ALL, which is a larger case than the field above and was
// not covered by it. A fork pull request and a run whose provider credentials are
// missing both reach this renderer with `review: undefined` (`pipeline.ts`), so
// the predicate keyed on the report's own field is false — and the comment
// published the measured recall and precision of a diff-scoped model search
// under the headline "Code review did not run". The reader was handed the
// accuracy of a search that did not happen, which is the exact claim
// `modelSearch` was added to refuse.
//
// The rates are WITHHELD rather than replaced. `NO_MODEL_SEARCH` names
// `aiReview.enabled: false` as the cause, which is true for the field above and
// false here, and this renderer may not invent a third sentence for a cause it
// does not know: `pipeline.ts` already attached the note that says what happened
// (a fork, a missing secret), and that note is on this comment. Withholding a
// false claim must not withhold the true one, and it does not.
//
// The reliability HEADING goes with the rates for the reason stated where it is
// rendered: a reader who expands only that block must not find a heading standing
// over silence.
const hasNoSearchToDescribe = (input: SummaryCommentInput): boolean =>
  input.review === undefined

const unresolvedFindings = (review: ReviewDigest): readonly FindingDigest[] =>
  review.findings.filter(isArtifactOnlyFinding)

// `report-digest.ts` composes `whySurvived` as `<verdict>: <summary>`, and the
// verdict is the refuter's closed vocabulary — `needs-more-evidence:` in front of
// a sentence that already says what evidence was missing tells a reviewer
// nothing they cannot read for themselves. Stripped only where the sentence is
// shown OUTSIDE the collapsed block; `refutationSection` keeps the label, because
// there the engine's own words are the point.
const withoutVerdictLabel = (whySurvived: string): string =>
  whySurvived.replace(/^[a-z][a-z-]*: /u, '')

// The measured error rates, on the pull request itself rather than in an
// evaluation report nobody opens — but inside the collapsed block, not above the
// findings. A reviewer opening this comment came for what to fix; the engine's
// error bars are the answer to a question they ask second, if at all.
//
// THE SAME MEASUREMENT `report.md` PRINTS, from the same place: every figure below
// is derived from `src/domains/reporting/measured-reliability.ts`, which names the
// ledger entry it transcribes. No rate is written down here.
//
// That is the whole point. This comment used to restate the rates in prose and
// carry a summary of them in a comment above; a re-baseline updated `report.md`
// and left both copies here quoting a superseded sweep, and the summary above was
// a blend of two sweeps matching neither. Two surfaces, one set of numbers.
//
// The model is named because a rate is a property of the model that produced it,
// and this sentence is the reason the rule exists: it once sat here quoting a
// superseded sweep with its own test pinning it in place. Moving it down the
// comment must never mean loosening that — the numbers and the model they were
// measured on travel together, wherever they are rendered.
const MEASURED_RELIABILITY = `_Diff-scoped search, measured on \`${MEASURED_ON_PROVIDER}/${MEASURED_ON_MODEL}\`. On a ${measuredReliability.corpusCaseCount}-case real-repository corpus it finds about **${inDiffRecallInTen} in 10** defects inside the diff and **${measuredReliability.outOfDiffRecallFound} of ${measuredReliability.outOfDiffRecallTotal}** of those outside it, and about **${adjustedPrecisionInTwenty} in 20** of what it does report holds up. An empty list means this search found nothing, not that there is nothing to find._`

// The one thing about confidence a reader gets without expanding anything.
//
// It carries NO rate, deliberately. A published rate has to name the model it was
// measured on to mean anything, and that sentence is too long to open a comment a
// human reads in ten seconds — so the numbers, with their model, sit in the
// collapsed block and this line says the part that changes behaviour: a finding
// is a lead to check, and a short list is not a clearance. It names where the
// numbers went, so nothing here is hidden, only moved.
const CONFIDENCE_NOTE = `_An automated review. It misses real defects, and some of what it reports will not hold up — read each finding as something to check, and an empty list as "this search found nothing", not "there is nothing to find". The measured rates, and the model they were measured on, are under "How this review was produced" below._`

// Shared by every surface that reports a finding dropping out between runs
// (`noLongerReportedSection`, `detailsSection`'s baseline line, and
// `reviewConversationSection` below): none of them can tell a genuine repair
// from a finding this run simply did not reproduce, and this is the one place
// that sentence is written down.
const NOT_SAME_AS_FIXED_EXPLANATION = `this search finds roughly ${inDiffRecallInTen} in 10 in-diff defects and does not repeat itself exactly, so a finding can drop out without the code changing`

const statusLabels: Readonly<Record<string, string>> = {
  passed: 'ok',
  'gate-failed': 'blocked',
  failed: 'error',
  skipped: 'skipped'
}

// The headline is the one line a reader is guaranteed to see, so it may only
// state what the run DID. "No findings" and "quality gate passed" both read as a
// clearance of the change — the first says nothing was found and lets the reader
// hear that nothing is there, and the second promotes a threshold comparison to a
// verdict. Both are replaced by a count of what this search reported.
const verdictHeadline = (input: SummaryCommentInput): string => {
  const review = input.outcomes.find((outcome) => outcome.id === 'review')

  if (review === undefined || review.status === 'skipped') {
    return 'Code review did not run'
  }

  if (review.status === 'failed') {
    return 'Code review could not complete'
  }

  // The same rule one step further: with the model-backed review switched off,
  // "this search reported nothing" is true of a search that never happened, and
  // on the one line every reader sees that reads as a clearance. What the run did
  // is that it did not look.
  if (performedNoModelSearch(input)) {
    return 'Code review: no model search ran'
  }

  // Unresolved (`artifact-only`) findings are open questions, not verdicts, so
  // they are not counted here — they get their own section and their own
  // framing further down, not a number folded into "findings to read".
  const findingCount =
    input.review === undefined ? 0 : actionableFindings(input.review).length
  const reported =
    findingCount === 0
      ? 'this search reported nothing'
      : `${findingCount} finding${findingCount === 1 ? '' : 's'} to read`

  return review.status === 'gate-failed'
    ? `Code review: quality gate failed, ${reported}`
    : `Code review: no threshold crossed, ${reported}`
}

// Why the reader is seeing less than a review, said in a sentence at the top.
//
// The stage table carries the same message, but it lives in the collapsed block
// now, and a run that could not complete is exactly the case where the reason is
// the most useful thing in the comment — a reader must not have to expand
// anything to learn that nothing was reviewed.
//
// Suppressed when the caller supplied operational notes, because those explain
// the same interruption at more length (a fork pull request, a missing provider);
// printing both reads as two separate problems.
const stageProblemNote = (input: SummaryCommentInput): string | undefined => {
  if (input.notes.length > 0) {
    return undefined
  }

  const outcome = input.outcomes.find(
    (entry) => entry.id === reviewStageDefinition.id
  )

  if (
    outcome === undefined ||
    outcome.message === undefined ||
    (outcome.status !== 'failed' && outcome.status !== 'skipped')
  ) {
    return undefined
  }

  const lead =
    outcome.status === 'skipped'
      ? 'The review did not run'
      : 'The review could not complete'

  return `> ${lead}: ${sanitizeLine(outcome.message, 300)}`
}

// One row, because one process runs. The advisory lanes report through their own
// sections above rather than as stages here: they run INSIDE the review now, and
// a table row claiming they were separately executed would describe a pipeline
// shape that no longer exists.
//
// Rendered inside the collapsed block: it describes the machinery, which is not
// what a reviewer opened the comment for.
const stageTable = (input: SummaryCommentInput): string => {
  const stage = reviewStageDefinition
  const outcome = input.outcomes.find((entry) => entry.id === stage.id)
  const status = outcome === undefined ? 'skipped' : outcome.status
  const label = statusLabels[status] ?? status
  const detail =
    outcome?.message === undefined
      ? stage.contribution
      : `${stage.contribution} — ${outcome.message}`

  return [
    '| Stage | Role | Result | What it contributes |',
    '| --- | --- | --- | --- |',
    `| ${stage.label} | ${stage.kind} | ${label} | ${sanitizeLine(detail, 240)} |`
  ].join('\n')
}

const findingsSection = (review: ReviewDigest): string => {
  const findings = actionableFindings(review)
  // A run that searched nothing gets the sentence for that, not the one whose
  // reassurance rests on a measured miss rate.
  const emptyListMeans =
    review.modelSearch === 'not-performed' ? NOTHING_SEARCHED : NOTHING_PROVED
  // An empty findings list used to render as no section at all, which left the
  // headline as the only statement about the review and let it be read as a
  // clearance. What the silence means is said out loud instead.
  if (findings.length === 0) {
    return [
      '### Findings (0)',
      '',
      // The one shared sentence. It lived here as a second copy that had already
      // drifted from the reporter's wording; it is imported now so it cannot again.
      emptyListMeans
    ].join('\n')
  }

  const ordered = [...findings].sort(
    (left, right) =>
      severityOrder.indexOf(left.severity) - severityOrder.indexOf(right.severity)
  )
  const shown = ordered.slice(0, MAX_LISTED_FINDINGS)
  const blocking = new Set(review.failingFindingIds)
  const lines = shown.map((finding) => {
    const marker = blocking.has(finding.id) ? ' **(blocks the gate)**' : ''
    const baseline =
      finding.baselineStatus === 'existing' ? ' _(pre-existing)_' : ''

    return [
      `- **${finding.severity}** · ${sanitizeLine(finding.category, 40)} · \`${sanitizeLine(finding.path, 200)}:${finding.startLine}\`${marker}${baseline}`,
      `  ${sanitizeLine(finding.title, MAX_TITLE)}`,
      ...(finding.description.length === 0
        ? []
        : [`  ${sanitizeText(finding.description, MAX_DESCRIPTION).replaceAll('\n', ' ')}`])
      // What refutation could not do against this finding used to be quoted here,
      // in the refuter's vocabulary ("Survived refutation — proved: …"). It is
      // still rendered, in `refutationSection` inside the collapsed block: a
      // reviewer must be able to check the claim, but the sentence that lets them
      // is written in the engine's terms and belongs where engine output belongs.
    ].join('\n')
  })
  const counts = severityOrder
    .filter((severity: Severity) => review.severityCounts[severity] > 0)
    .map((severity) => `${review.severityCounts[severity]} ${severity}`)
    .join(', ')
  const truncated =
    ordered.length > shown.length
      ? [
          `\n_${ordered.length - shown.length} further findings are in the run artifacts._`
        ]
      : []

  // The blank lines are structural, not decoration: a heading, a paragraph and a
  // list run together render as one blob on a strict CommonMark renderer. The
  // severity counts are dropped WITH their blank line when there are none, rather
  // than by filtering empty strings out of the whole section — that filter took
  // every separator with it.
  return [
    `### Findings (${findings.length})`,
    '',
    ...(counts.length === 0 ? [] : [`${counts}.`, '']),
    ...lines,
    ...truncated
  ].join('\n')
}

// A finding here is a real suspicion the refuter could neither prove nor
// disprove — most often because the deciding evidence sat outside what this
// run could reach — kept as a question for a human rather than silently
// dropped. It stays out of the quality gate and out of inline comments on
// purpose, and it must stay visibly separate from the findings above: folding
// it into that list would read a "could not decide" as a "confirmed defect",
// and dropping it would make the omission indistinguishable from "nothing
// like this exists".
//
// HEADED "Worth a look", not `report.md`'s "Unresolved - Needs Human Decision",
// and the divergence is deliberate: this surface is read by someone deciding
// whether to spend two minutes, and the heading is the whole invitation. The
// framing underneath it — open questions, not verdicts — is what carries the
// meaning, and it is unchanged.
const unresolvedSection = (review: ReviewDigest): string | undefined => {
  const findings = unresolvedFindings(review)

  if (findings.length === 0) {
    return undefined
  }

  const ordered = [...findings].sort(
    (left, right) =>
      severityOrder.indexOf(left.severity) - severityOrder.indexOf(right.severity)
  )
  const shown = ordered.slice(0, MAX_LISTED_UNRESOLVED)
  const lines = shown.map((finding) =>
    [
      `- **${finding.severity}** · ${sanitizeLine(finding.category, 40)} · \`${sanitizeLine(finding.path, 200)}:${finding.startLine}\``,
      `  ${sanitizeLine(finding.title, MAX_TITLE)}`,
      // What stopped this from being settled is the useful half of the line, so
      // it is kept — without the verdict label in front of it, which names an
      // engine state rather than telling the reader anything.
      ...(finding.whySurvived === undefined
        ? []
        : [
            `  _${sanitizeLine(withoutVerdictLabel(finding.whySurvived), MAX_WHY_SURVIVED)}_`
          ])
    ].join('\n')
  )
  const truncated =
    ordered.length > shown.length
      ? [
          `\n_${ordered.length - shown.length} further open questions are in the run artifacts._`
        ]
      : []

  return [
    `### Worth a look (${findings.length})`,
    '',
    'Open questions, not verdicts: this review could not settle these from what it could see. They do not affect the quality gate and are not posted as inline comments — confirm or dismiss each one yourself.',
    '',
    ...lines,
    ...truncated
  ].join('\n')
}

const intentSection = (intent: IntentDigest): string | undefined => {
  if (intent.status === 'disabled') {
    return undefined
  }

  if (intent.status !== 'completed') {
    const explanation: Readonly<Record<string, string>> = {
      'no-intent':
        'The pull-request description stated no intent to check the change against.',
      'unusable-intent':
        'The pull-request description was read, but no checkable obligation could be extracted from it.',
      'provider-unavailable':
        'No model was available to read the stated intent.'
    }

    return [
      '### Intent',
      '',
      explanation[intent.status] ?? `Status: ${sanitizeLine(intent.status, 80)}.`
    ].join('\n')
  }

  const shown = intent.unevidenced.slice(0, MAX_LISTED_OBLIGATIONS)
  const list = shown.map(
    (obligation) =>
      `- ${sanitizeLine(obligation.statement, 300)} _(${sanitizeLine(obligation.status, 40)})_`
  )

  return [
    '### Intent',
    '',
    `${intent.obligationCount} obligation${intent.obligationCount === 1 ? '' : 's'} read from the description: ${intent.evidencedCount} evidenced by the change, ${intent.notEvidencedCount} not${
      intent.notContradictedCount === 0
        ? ''
        : `, ${intent.notContradictedCount} asking that something not be done, which this change does not do`
    }.`,
    '',
    // NOT "every obligation is evidenced". An obligation asking that something not
    // be done is kept by changing nothing and produces no citation, so it is absent
    // from this list without a line behind it. The sentence says what the empty list
    // means and nothing more.
    ...(list.length === 0
      ? ['No obligation read from the description is left unevidenced by this change.']
      : [
          'Nothing in this change evidences these. That is a statement about the diff, not a claim that the work is undone — partial work is normal, and an obligation satisfied elsewhere leaves no trace here.',
          '',
          ...list,
          ...(intent.unevidenced.length > shown.length
            ? [`- _…and ${intent.unevidenced.length - shown.length} more._`]
            : [])
        ]),
    ...(intent.explanation === undefined
      ? []
      : ['', sanitizeText(intent.explanation, 1200)])
  ].join('\n')
}

// THE COMPATIBILITY CLASS IS A MECHANISM, NOT A RATING, and spec 22 chose that
// axis over spec 05's severity precisely so it could not be read as one. A bare
// `may-break` in front of a reviewer is a rating, so the label is written out and
// the mechanism behind it is stated once, for the classes actually present.
//
// The wording is this surface's own rather than a copy of `impact-markdown.ts`'s
// — the artifact writes for someone who opened a report, this writes for someone
// scanning a pull request — but the three MEANINGS may not diverge, which is why
// the record is keyed by the producer's own vocabulary rather than by a string.
const compatibilityClassLabel: Readonly<
  Record<ReportableCompatibilityClass, string>
> = {
  'breaks-on-build': 'breaks on build',
  'breaks-at-runtime': 'breaks at runtime',
  'may-break': 'may break'
}

const compatibilityClassMechanism: Readonly<
  Record<ReportableCompatibilityClass, string>
> = {
  'breaks-on-build': 'the name the file uses is gone',
  'breaks-at-runtime':
    'the name still resolves and nothing at build time sees it, so what moved is behaviour the file was shown to use',
  'may-break': 'the mechanism is known and the outcome is not, so someone has to look'
}

// Named in the order a reviewer should work through them, so the glossary reads
// the same way whichever subset of classes this change produced.
const compatibilityClassOrder: readonly ReportableCompatibilityClass[] = [
  'breaks-on-build',
  'breaks-at-runtime',
  'may-break'
]

// WHICH TIER ANSWERED, on the sentence it answered. A finding can mix the two —
// a file can reference both a removed symbol (settled in code) and a modified one
// (settled by a model call) — so it is stated per line rather than per file, and
// it is stated for BOTH values rather than only for the model. Marking only the
// model judgements would make silence mean "settled in code", and a reader has no
// way to tell that silence from a renderer that forgot.
//
// Keyed on the producer's vocabulary, like the classes above, so a third tier
// would fail to compile here rather than render as a bare engine token.
const adjudicatedByLabel: Readonly<
  Record<ImpactRelianceDigest['adjudicatedBy'], string>
> = {
  deterministic: 'settled in code',
  model: 'judged by a model'
}

const impactFindingLines = (
  finding: ImpactFindingDigest
): readonly string[] => {
  const shown = finding.reliances.slice(0, MAX_LISTED_RELIANCES)
  const testNote =
    finding.destination === 'test'
      ? ' _(a test — it breaks in CI, not in production)_'
      : ''

  return [
    `- **${compatibilityClassLabel[finding.compatibilityClass]}** · \`${sanitizeLine(finding.path, 200)}\`${testNote}`,
    ...shown.map(
      (reliance) =>
        `  line ${reliance.line}: relies on ${sanitizeLine(reliance.contractElement, MAX_CONTRACT_STATEMENT)} — ${sanitizeLine(reliance.consequence, MAX_CONTRACT_STATEMENT)} _(${adjudicatedByLabel[reliance.adjudicatedBy]})_`
    ),
    ...(finding.reliances.length > shown.length
      ? [
          `  _…and ${finding.reliances.length - shown.length} further use${finding.reliances.length - shown.length === 1 ? '' : 's'} of a changed symbol in this file._`
        ]
      : [])
  ]
}

// What qualifies the adjudicated list, whether or not it is empty.
//
// Every one of these says the same kind of thing: the triage above is narrower
// than it looks. They are rendered with the list rather than in the collapsed
// block, because a partial triage read as a complete one is exactly the mistake
// this layer exists to prevent, and it has to be prevented where the list is.
const adjudicationCaveats = (impact: ImpactDigest): readonly string[] => {
  const caveats: string[] = []

  if (impact.adjudicationStatus === 'no-model') {
    caveats.push(
      'No model was available for the part code could not settle on its own, so this covers only what the deterministic tier could decide.'
    )
  } else if (impact.checkedPairCount > 0 && impact.adjudicationCallCount === 0) {
    // A run that spent no call is not a run whose judge said no. Without this
    // sentence a reader credits a model with an answer code reached for free.
    caveats.push(
      'No model call was spent on this change: everything above was settled in code.'
    )
  }

  if (impact.unadjudicatedPairCount > 0) {
    caveats.push(
      `${impact.unadjudicatedPairCount} use${impact.unadjudicatedPairCount === 1 ? ' of a changed symbol was' : 's of a changed symbol were'} left unadjudicated and assert nothing either way — absence from this list is not a statement that a dependent is unaffected.`
    )
  }

  if (impact.failedAdjudicationCallCount > 0) {
    caveats.push(
      `${impact.failedAdjudicationCallCount} adjudication call${impact.failedAdjudicationCallCount === 1 ? '' : 's'} did not complete.`
    )
  }

  if (impact.adjudicationCallsTruncated) {
    caveats.push(
      'The adjudication call cap was reached, so this triage stops short of the whole reference list.'
    )
  }

  return caveats
}

// THE ADJUDICATED LAYER, in the pull-request comment.
//
// It reached no reader here until 2026-08-16: the digest read neither
// `impactFindings` nor `adjudicationStatus`, so an operator who switched
// `changeImpact.adjudication.enabled` on paid for model calls that decided which
// dependents actually break, and the human on the pull request saw only the
// deterministic reference table. Nothing failed, because the reference table is a
// section that renders either way — the same shape of silence that once left the
// whole Impact section empty for months.
//
// AN EMPTY LIST IS NOT AN ABSENT ONE, and this block's first job is to keep those
// apart. `adjudicationStatus` is the field that tells them apart, so it is what
// this reads first: with adjudication off there is nothing to say and the comment
// renders exactly what it has always rendered, byte for byte.
const adjudicationBlock = (impact: ImpactDigest): readonly string[] => {
  if (impact.adjudicationStatus === 'disabled') {
    return []
  }

  const caveats = adjudicationCaveats(impact)
  const heading = `**Shown to rely on this change (${impact.findings.length})**`

  if (impact.findings.length === 0) {
    // Which kind of empty. "Checked and found nothing" is a result; "nothing was
    // checked" is an absence; and neither may be allowed to read as "adjudication
    // did not run", which is what this comment said by saying nothing at all.
    const emptyMeans =
      impact.checkedPairCount === 0
        ? 'Nothing was triaged: no use of a changed symbol reached an adjudicator, so nothing below has been checked against what this change altered.'
        : `${impact.checkedPairCount} use${impact.checkedPairCount === 1 ? '' : 's'} of a changed symbol ${impact.checkedPairCount === 1 ? 'was' : 'were'} checked against what changed, and none was shown to rely on it. That is an answer, not an empty section — the reference list below is still untriaged and still yours to judge.`

    return [heading, '', emptyMeans, ...caveats.flatMap((caveat) => ['', caveat])]
  }

  const shown = impact.findings.slice(0, MAX_LISTED_IMPACT_FINDINGS)
  const presentClasses = compatibilityClassOrder.filter((compatibilityClass) =>
    shown.some((finding) => finding.compatibilityClass === compatibilityClass)
  )

  return [
    heading,
    '',
    // Evidence, not verdict. Spec 22: the useful output is "two callers rely on
    // the return value you changed; here they are" — never "you broke it". The
    // unmeasured note travels with the list for the same reason the review's
    // measured rates travel with its findings: a reader who only ever sees this
    // comment must not be handed a more confident artifact than one who opens the
    // report.
    'Each entry is a judgement about a file, not a mention of a name: something these files use has moved under them. Breaking a dependent is frequently deliberate, so whether it matters is your call. This layer is unmeasured — no accuracy number exists for it.',
    '',
    `_Labels are mechanisms, not ratings: ${presentClasses
      .map(
        (compatibilityClass) =>
          `**${compatibilityClassLabel[compatibilityClass]}** — ${compatibilityClassMechanism[compatibilityClass]}`
      )
      .join('; ')}._`,
    '',
    ...shown.flatMap((finding) => impactFindingLines(finding)),
    ...(impact.findings.length > shown.length
      ? [
          '',
          `_…and ${impact.findings.length - shown.length} more in the artifacts._`
        ]
      : []),
    ...caveats.flatMap((caveat) => ['', caveat])
  ]
}

// The Impact section: the adjudicated judgements first, then the untriaged
// reference table they were drawn from.
//
// THE TWO LISTS ARE NOT ONE LIST. The table says "this file mentions a name this
// change touched" — the floor and the falsifier spec 22 measures the capability
// against, and near 90% irrelevant by construction. The block above it says "this
// file was shown to rely on the part that moved". Blurring them would hand a
// reviewer a reference count dressed as a finding, so the two carry separate
// headings whenever both are present. With adjudication off — the default — there
// is only ever one list, and it renders with no heading at all, exactly as before.
const impactSection = (impact: ImpactDigest): string | undefined => {
  if (impact.status !== 'completed') {
    return undefined
  }

  // Nothing referenced and nothing adjudicated is a change that reaches nothing,
  // and this section has always been silent about it — an empty table under a
  // heading is not a statement. The findings check is not redundant with the
  // symbol check: a finding whose symbol is missing from the symbol table would
  // otherwise be dropped here without a trace, and a finding that vanishes
  // silently is the defect this whole section is being fixed for.
  if (impact.symbols.length === 0 && impact.findings.length === 0) {
    return undefined
  }

  const adjudicated = adjudicationBlock(impact)
  const shown = impact.symbols.slice(0, MAX_LISTED_SYMBOLS)
  const rows = shown.map(
    (symbol) =>
      `| \`${sanitizeLine(symbol.name, 120)}\` | \`${sanitizeLine(symbol.definitionPath, 200)}\` | ${symbol.referenceCount} | ${symbol.testReferenceCount} |`
  )
  const referenceList =
    shown.length === 0
      ? []
      : [
          // The heading appears only when there is an adjudicated list to tell
          // this one apart from. Alone, it would be a label on the only thing in
          // the section — and it would change every comment on the default path.
          ...(adjudicated.length === 0
            ? []
            : ['**Everything this change reaches, untriaged**', '']),
          `${impact.changedSymbolCount} changed symbol${impact.changedSymbolCount === 1 ? '' : 's'}, ${impact.referenceCount} production reference${impact.referenceCount === 1 ? '' : 's'} outside the defining file.`,
          '',
          // "Reference sites", not "Callers". Spec 22 states that a column
          // heading is an assertion bound by the same rule as a warning — it may
          // not assert a relation the traversal did not resolve — and recorded
          // this exact heading as violating it, rather than softening the
          // requirement to fit the renderer. References are matched as TEXT, not
          // resolved as bindings: an aliased import lists the import line and not
          // the call sites, and roughly a third of reference sites measured on
          // this repository were prose or fixture data containing the identifier.
          // The counts are right for what they count; "Callers" named something
          // else to every reader who never opens the artifact.
          '| Symbol | Defined in | Reference sites | Test reference sites |',
          '| --- | --- | --- | --- |',
          ...rows,
          ...(impact.symbols.length > shown.length
            ? [
                '',
                `_…and ${impact.symbols.length - shown.length} more in the artifacts._`
              ]
            : [])
        ]

  return [
    '### Impact',
    '',
    ...adjudicated,
    ...(adjudicated.length === 0 || referenceList.length === 0 ? [] : ['']),
    ...referenceList
  ].join('\n')
}

// Spec 30 requirement 3/4: state each nominated finding's outcome as its own
// statement, never as a silent edit of the original comment. The wording per
// status:
//
//   - `held` says so PLAINLY, in the exact words requirement 4 gives as the
//     useful, honest answer;
//   - `undecided` mirrors `unresolvedSection`'s framing — an open question, not
//     a verdict, because refutation could still neither prove nor disprove it;
//   - `no-longer-reported` follows the SAME rule as `noLongerReportedSection`
//     below, on purpose: this comparison cannot separate a genuine withdrawal
//     from a finding this run simply did not reproduce, so it never says
//     "withdrawn", "resolved" or "fixed".
const reviewConversationLine = (outcome: ReviewConversationOutcome): string => {
  const fingerprint = `\`${sanitizeLine(outcome.fingerprint, 120)}\``
  const location =
    outcome.finding === undefined
      ? undefined
      : `\`${sanitizeLine(outcome.finding.path, 200)}:${outcome.finding.startLine}\` — ${sanitizeLine(outcome.finding.title, MAX_TITLE)}`
  const named = location === undefined ? fingerprint : `${fingerprint} (${location})`

  if (outcome.status === 'held') {
    return `- ${named}: **held.** Re-checked against the same evidence; it still holds.`
  }

  if (outcome.status === 'undecided') {
    return `- ${named}: **still undecided.** Re-checked; refutation could still neither prove nor disprove it — an open question, not a verdict.`
  }

  return `- ${fingerprint}: **no longer reported** by this run. That is not the same as fixed: ${NOT_SAME_AS_FIXED_EXPLANATION}.`
}

const reviewConversationSection = (
  outcomes: readonly ReviewConversationOutcome[]
): string | undefined => {
  if (outcomes.length === 0) {
    return undefined
  }

  return [
    `### Review conversation (${outcomes.length})`,
    '',
    'A reply nominated the finding(s) below for a second look. Re-adjudication reruns the same review from scratch against the current code — it is not told a human replied, and it never sees what was said.',
    '',
    ...outcomes.map(reviewConversationLine)
  ].join('\n')
}

// Wording follows the same rule as the baseline count: this cannot separate a
// repair from a miss, so it never says "fixed". A reader who wants to know whether
// a defect is gone has to look, and the sentence says so.
const noLongerReportedSection = (
  input: SummaryCommentInput
): string | undefined => {
  const count = input.noLongerReportedCount

  if (count === undefined || count === 0) {
    return undefined
  }

  return [
    `### No longer reported (${count})`,
    '',
    `${count} finding${count === 1 ? '' : 's'} commented on an earlier push ${count === 1 ? 'was' : 'were'} not reported again by this run. That is not the same as fixed: ${NOT_SAME_AS_FIXED_EXPLANATION}. The earlier comments are still on this pull request.`
  ].join('\n')
}

// What refutation tried against each reported finding, in the refuter's own
// words.
//
// It is EVIDENCE, and it must not be dropped: without it the comment asserts a
// defect and offers nothing to check it against, which is the same as asking to
// be trusted. But it is written in the engine's vocabulary — "Survived refutation
// — proved: …" is a sentence no human reviewer writes — so it lives here, one
// expand away from the finding it belongs to, keyed by the location the finding
// was listed under so the two can be matched by eye.
//
// Unresolved findings are excluded: their reason is already rendered beside them
// under "Worth a look", where it is the point rather than a footnote.
const refutationSection = (review: ReviewDigest): readonly string[] => {
  const lines = actionableFindings(review)
    .filter((finding) => finding.whySurvived !== undefined)
    .slice(0, MAX_LISTED_FINDINGS)
    .map(
      (finding) =>
        `- \`${sanitizeLine(finding.path, 200)}:${finding.startLine}\` — Survived refutation — ${sanitizeLine(finding.whySurvived as string, MAX_WHY_SURVIVED)}`
    )

  return lines.length === 0
    ? []
    : ['**What was checked against each finding**', '', ...lines, '']
}

// Everything the run did rather than found: the machinery, the measurement and
// the bookkeeping, in one collapsed block.
//
// COLLAPSED IS THE PRODUCT DECISION. None of this is removed — a reader who wants
// the stage result, the error rates or the refuter's reasoning is one click away
// from all three — but none of it competes with the findings for the attention of
// a reader who came to review a change.
const detailsSection = (input: SummaryCommentInput): string => {
  const rows: string[] = [
    `- Head commit: \`${sanitizeLine(input.headSha, 64)}\``
  ]

  if (input.review !== undefined) {
    rows.push(`- Run id: \`${sanitizeLine(input.review.runId, 120)}\``)
    rows.push(`- Coverage: ${sanitizeLine(input.review.coverageStatus, 40)}`)

    // The precision story: a short findings list is credible only if the reader
    // can see that discovery examined more than it kept. One line, pointing at
    // the run artifact for the reasons rather than dumping them into the PR.
    const examinedCount =
      input.review.findings.length + input.review.rejectedFindingCount
    const mergedNote =
      input.review.mergedAwayCount === undefined
        ? ''
        : `, ${input.review.mergedAwayCount} merged as duplicates before that`

    rows.push(
      `- Candidates: ${examinedCount} examined, ${input.review.findings.length} admitted, ${input.review.rejectedFindingCount} rejected${mergedNote} — reasons for each are in the run artifacts.`
    )

    // Baseline entries store fingerprints only, by design, so a count is
    // genuinely everything this can say — never which defect it was. Rendered
    // only when the run actually computed it: absence must not read as zero.
    if (input.review.resolvedBaselineEntryCount !== undefined) {
      const count = input.review.resolvedBaselineEntryCount

      rows.push(
        `- No longer reported: ${count} previously-flagged finding${count === 1 ? '' : 's'} did not come back this run. That is not the same as fixed — ${NOT_SAME_AS_FIXED_EXPLANATION}. The baseline stores fingerprints only, so no further detail is available.`
      )
    }

    if (input.review.skippedFileCount > 0) {
      rows.push(`- Skipped files: ${input.review.skippedFileCount}`)
    }

    if (input.review.costUsd !== undefined) {
      rows.push(`- Cost: $${input.review.costUsd.toFixed(4)}`)
    }

    for (const warning of input.review.warnings.slice(0, 10)) {
      rows.push(`- Warning: ${sanitizeLine(warning, 300)}`)
    }

    for (const issue of input.review.providerIssues.slice(0, 10)) {
      rows.push(`- Provider issue: ${sanitizeLine(issue, 300)}`)
    }
  }

  if (input.inlineCommentCount !== undefined) {
    rows.push(`- Inline comments posted: ${input.inlineCommentCount}`)
  }

  if (input.runUrl !== undefined) {
    rows.push(`- [Full artifacts](${sanitizeLine(input.runUrl, 400)})`)
  }

  return [
    '<details><summary>How this review was produced</summary>',
    '',
    // The measured rates, still naming the provider and model they were measured
    // on. Placement moved; the guarantee did not.
    //
    // A run that performed no model search gets the statement of that fact in
    // their place, not a shortened version of them: these rates are a property of
    // a model search, and there was none to be a property of. It is the same
    // sentence the top of the comment carries, and the repetition is deliberate —
    // each one replaces a different claim (there, that a search found nothing;
    // here, how often that search finds a defect), and a reader who expands only
    // this block must not find the reliability heading standing over silence.
    // Both lines go together when there is no report at all: the block exists to
    // characterise a search, and there was none to characterise.
    ...(hasNoSearchToDescribe(input)
      ? []
      : [
          '**How reliable this is**',
          '',
          performedNoModelSearch(input) ? NO_MODEL_SEARCH : MEASURED_RELIABILITY,
          ''
        ]),
    ...(input.review === undefined ? [] : refutationSection(input.review)),
    '**Pipeline**',
    '',
    stageTable(input),
    '',
    '**Run details**',
    '',
    ...rows,
    '',
    '</details>'
  ].join('\n')
}

type CommentSection = {
  readonly text: string
  /**
   * Which sections survive when the body would overflow: lower is kept first.
   * Sections at the same rank are kept in reading order.
   */
  readonly keepRank: number
}

/** A section that renders to nothing stays absent rather than becoming empty. */
const section = (
  text: string | undefined,
  keepRank: number
): CommentSection | undefined =>
  text === undefined ? undefined : { text, keepRank }

/**
 * Assemble the sections that fit inside GitHub's comment-body limit.
 *
 * A section that would overflow is dropped WHOLE rather than cut mid-sentence,
 * because half a finding is worse than a pointer to the artifacts.
 *
 * Reading order and drop order are two different orders, which is why the rank
 * exists. Intent and impact are read BEFORE the findings and dropped AFTER them:
 * a 60 000-character findings list would otherwise be pushed out by the summary
 * of what the change was for, leaving the half a reviewer cannot act on.
 */
const assemble = (
  marker: string,
  sections: readonly CommentSection[]
): string => {
  const separator = '\n\n'
  const overflowNote =
    '_This comment reached GitHub\'s size limit. The remaining detail is in the run artifacts._'
  const byRank = sections
    .map((section, index) => ({ section, index }))
    // Stable, so equal ranks keep reading order.
    .sort((left, right) => left.section.keepRank - right.section.keepRank)
  const kept = new Set<number>()
  // Room for the overflow note is reserved unconditionally, so admitting a
  // section can never be the thing that leaves no room to say one was dropped.
  let length = marker.length + separator.length + overflowNote.length

  for (const { section, index } of byRank) {
    const candidate = length + separator.length + section.text.length

    if (candidate > MAX_ISSUE_COMMENT_BODY) {
      continue
    }

    kept.add(index)
    length = candidate
  }

  const body = [
    marker,
    ...sections
      .filter((_section, index) => kept.has(index))
      .map((section) => section.text)
  ].join(separator)

  return kept.size === sections.length
    ? body
    : `${body}${separator}${overflowNote}`
}

export const renderSummaryComment = (input: SummaryCommentInput): string => {
  const marker = summaryCommentMarker(input.markerKey)
  const notes = input.notes.map((note) => `> ${sanitizeLine(note, 500)}`)
  // THE READING ORDER IS THE PRODUCT, and it is the order a human reviewer works
  // in: what happened, what the change was for and whether it got there, what it
  // might affect, what is wrong with it, and last what is only maybe wrong with
  // it. Everything describing the engine that produced all this — the stage
  // table, the measured rates, the refuter's reasoning, the run bookkeeping —
  // sits in one collapsed block at the end, because a reviewer reads this comment
  // to review a change, not to audit a pipeline.
  //
  // A review conversation is answered before any of it: it is present only on a
  // run someone triggered by asking for a second look, and their question is
  // owed an answer before the standing sections repeat themselves.
  //
  // The keep ranks are what survives an over-long body, and they are NOT this
  // order: the verdict and why the reader is seeing it (0-1), then the answers to
  // a direct question and the findings (2), the open questions (3), the summary
  // of the change (4-5), and the machinery last (6).
  const sections: readonly (CommentSection | undefined)[] = [
    { text: `## ${verdictHeadline(input)}`, keepRank: 0 },
    // The caveat above the fold, or — when nothing searched the change — the
    // statement that replaces it. `CONFIDENCE_NOTE` describes an automated review
    // that misses defects and points at the rates below; both halves of that
    // sentence are about a search this run did not perform.
    // Omitted outright when there is no report: `CONFIDENCE_NOTE` describes an
    // automated review that misses defects and points at the rates below, and
    // both halves are about a search this run did not perform. The pipeline's own
    // note, two entries down, is what says why.
    hasNoSearchToDescribe(input)
      ? undefined
      : {
          text: performedNoModelSearch(input) ? NO_MODEL_SEARCH : CONFIDENCE_NOTE,
          keepRank: 1
        },
    section(stageProblemNote(input), 1),
    notes.length === 0
      ? undefined
      : { text: notes.join('\n>\n'), keepRank: 1 },
    section(
      input.reviewConversation === undefined
        ? undefined
        : reviewConversationSection(input.reviewConversation),
      2
    ),
    section(
      input.intent === undefined ? undefined : intentSection(input.intent),
      4
    ),
    section(
      input.impact === undefined ? undefined : impactSection(input.impact),
      4
    ),
    section(
      input.review === undefined ? undefined : findingsSection(input.review),
      2
    ),
    section(
      input.review === undefined ? undefined : unresolvedSection(input.review),
      3
    ),
    section(noLongerReportedSection(input), 5),
    { text: detailsSection(input), keepRank: 6 }
  ]

  return assemble(
    marker,
    sections.filter(
      (entry): entry is CommentSection => entry !== undefined
    )
  )
}

export type IssueComment = {
  readonly id: number
  readonly body?: string | null
  readonly user?: { readonly login?: string; readonly type?: string } | null
}

/**
 * The comment a previous run of this workflow created, or `undefined` when there
 * is none to edit.
 *
 * The author filter is a safety property, not a nicety. `pull-requests: write`
 * can edit anybody's comment, so matching on the marker alone would let a user
 * who pastes the marker into their own comment have it silently overwritten by
 * the next run. Candidates are therefore restricted to the acting identity when
 * one is known, and to bot authors otherwise.
 *
 * The OLDEST match wins, so two runs racing to create the comment converge on
 * the same one instead of alternating.
 */
export const selectSummaryComment = (
  comments: readonly IssueComment[],
  marker: string,
  expectedAuthorLogin?: string
): IssueComment | undefined =>
  comments
    .filter((comment) => (comment.body ?? '').includes(marker))
    .filter((comment) =>
      expectedAuthorLogin === undefined
        ? comment.user?.type === 'Bot'
        : comment.user?.login?.toLowerCase() ===
          expectedAuthorLogin.toLowerCase()
    )
    .sort((left, right) => left.id - right.id)[0]
