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
  adjustedPrecisionInTwenty,
  NOTHING_PROVED,
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
  IntentDigest,
  ReviewDigest,
  Severity
} from './report-digest.js'
import { severityOrder } from './report-digest.js'
import type { StageOutcome } from './stage-outcomes.js'
import { stageDefinitions } from './stage-outcomes.js'

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
const MAX_TITLE = 200
const MAX_DESCRIPTION = 700
const MAX_WHY_SURVIVED = 400

// A finding admission marked `artifact-only` is one refutation could neither
// prove nor disprove (`needs-more-evidence`): a real suspicion, deliberately
// kept as a question for a human rather than dropped. It must never appear
// mixed into the actionable findings list — that read it as a proved defect —
// and must never silently vanish either, which is what happened before this
// field was carried into the digest at all.
const isUnresolvedFinding = (finding: FindingDigest): boolean =>
  finding.reporterEligibility === 'artifact-only'

const actionableFindings = (review: ReviewDigest): readonly FindingDigest[] =>
  review.findings.filter((finding) => !isUnresolvedFinding(finding))

const unresolvedFindings = (review: ReviewDigest): readonly FindingDigest[] =>
  review.findings.filter(isUnresolvedFinding)

// The measured error rates, on the comment itself rather than in an evaluation
// report nobody opens. This is the surface most likely to be the ONLY thing a
// reviewer reads — it sits on the pull request, above the diff — so it is the
// surface where an unstated recall figure does the most damage: a reader who sees
// a short list and no caveat supplies their own, and the one they supply is
// optimistic.
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
// The model is named because a rate is a property of the model that produced it.
const MEASURED_RELIABILITY = `_Diff-scoped search, measured on \`${MEASURED_ON_PROVIDER}/${MEASURED_ON_MODEL}\`. On a ${measuredReliability.corpusCaseCount}-case real-repository corpus it finds about **${inDiffRecallInTen} in 10** defects inside the diff and **${measuredReliability.outOfDiffRecallFound} of ${measuredReliability.outOfDiffRecallTotal}** of those outside it, and about **${adjustedPrecisionInTwenty} in 20** of what it does report holds up. An empty list means this search found nothing, not that there is nothing to find._`

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

const stageTable = (input: SummaryCommentInput): string => {
  const rows = stageDefinitions.map((stage) => {
    const outcome = input.outcomes.find((entry) => entry.id === stage.id)
    const status = outcome === undefined ? 'skipped' : outcome.status
    const label = statusLabels[status] ?? status
    const detail =
      outcome?.message === undefined
        ? stage.contribution
        : `${stage.contribution} — ${outcome.message}`

    return `| ${stage.label} | ${stage.kind} | ${label} | ${sanitizeLine(detail, 240)} |`
  })

  return [
    '| Stage | Role | Result | What it contributes |',
    '| --- | --- | --- | --- |',
    ...rows
  ].join('\n')
}

const findingsSection = (review: ReviewDigest): string => {
  const findings = actionableFindings(review)
  // An empty findings list used to render as no section at all, which left the
  // headline as the only statement about the review and let it be read as a
  // clearance. What the silence means is said out loud instead.
  if (findings.length === 0) {
    return [
      '### Findings (0)',
      '',
      // The one shared sentence. It lived here as a second copy that had already
      // drifted from the reporter's wording; it is imported now so it cannot again.
      NOTHING_PROVED
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
        : [`  ${sanitizeText(finding.description, MAX_DESCRIPTION).replaceAll('\n', ' ')}`]),
      // Why the reader should believe it. Without this the comment asserts a
      // defect and offers nothing to check it against, which is the same as
      // asking to be trusted.
      ...(finding.whySurvived === undefined
        ? []
        : [
            `  _Survived refutation — ${sanitizeLine(finding.whySurvived, MAX_WHY_SURVIVED)}_`
          ])
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

  return [
    `### Findings (${findings.length})`,
    '',
    counts.length === 0 ? '' : `${counts}.`,
    '',
    ...lines,
    ...truncated
  ]
    .filter((line) => line !== '')
    .join('\n')
}

// A finding here is a real suspicion the refuter could neither prove nor
// disprove — most often because the deciding evidence sat outside what this
// run could reach — kept as a question for a human rather than silently
// dropped. It stays out of the quality gate and out of inline comments on
// purpose, and it must stay visibly separate from the findings above: folding
// it into that list would read a "could not decide" as a "confirmed defect",
// and dropping it would make the omission indistinguishable from "nothing
// like this exists". Wording follows `report.md`'s "Unresolved - Needs Human
// Decision" section, shortened for a space-constrained surface.
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
      ...(finding.whySurvived === undefined
        ? []
        : [`  _${sanitizeLine(finding.whySurvived, MAX_WHY_SURVIVED)}_`])
    ].join('\n')
  )
  const truncated =
    ordered.length > shown.length
      ? [
          `\n_${ordered.length - shown.length} further unresolved findings are in the run artifacts._`
        ]
      : []

  return [
    `### Unresolved - Needs Human Decision (${findings.length})`,
    '',
    'Open questions, not verdicts: refutation could neither prove nor disprove these from what this run could reach. They do not affect the quality gate and are not posted as inline comments — confirm or dismiss each one yourself.',
    '',
    ...lines,
    ...truncated
  ]
    .filter((line) => line !== '')
    .join('\n')
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

const impactSection = (impact: ImpactDigest): string | undefined => {
  if (impact.status !== 'completed' || impact.symbols.length === 0) {
    return undefined
  }

  const shown = impact.symbols.slice(0, MAX_LISTED_SYMBOLS)
  const rows = shown.map(
    (symbol) =>
      `| \`${sanitizeLine(symbol.name, 120)}\` | \`${sanitizeLine(symbol.definitionPath, 200)}\` | ${symbol.referenceCount} | ${symbol.testReferenceCount} |`
  )

  return [
    '### Impact',
    '',
    `${impact.changedSymbolCount} changed symbol${impact.changedSymbolCount === 1 ? '' : 's'}, ${impact.referenceCount} production reference${impact.referenceCount === 1 ? '' : 's'} outside the defining file.`,
    '',
    '| Symbol | Defined in | Callers | Test callers |',
    '| --- | --- | --- | --- |',
    ...rows,
    ...(impact.symbols.length > shown.length
      ? ['', `_…and ${impact.symbols.length - shown.length} more in the artifacts._`]
      : [])
  ].join('\n')
}

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
        `- Resolved since baseline: ${count} previously-flagged finding${count === 1 ? '' : 's'} no longer match (baseline stores fingerprints only; no further detail is available).`
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

  return ['<details><summary>Run details</summary>', '', ...rows, '</details>'].join(
    '\n'
  )
}

/**
 * Assemble the sections that fit inside GitHub's comment-body limit.
 *
 * Sections are added in priority order and a section that would overflow is
 * dropped whole rather than cut mid-sentence, because half a finding is worse
 * than a pointer to the artifacts.
 */
const assemble = (marker: string, sections: readonly string[]): string => {
  const separator = '\n\n'
  const overflowNote =
    '_This comment reached GitHub\'s size limit. The remaining detail is in the run artifacts._'
  let body = marker
  let dropped = false

  for (const section of sections) {
    const candidate = `${body}${separator}${section}`

    if (
      candidate.length + separator.length + overflowNote.length >
      MAX_ISSUE_COMMENT_BODY
    ) {
      dropped = true
      continue
    }

    body = candidate
  }

  return dropped ? `${body}${separator}${overflowNote}` : body
}

export const renderSummaryComment = (input: SummaryCommentInput): string => {
  const marker = summaryCommentMarker(input.markerKey)
  const notes = input.notes.map((note) => `> ${sanitizeLine(note, 500)}`)
  // Ordered by what a reviewer must act on, not by what the pipeline did. The
  // findings used to sit below the stage table, so the first thing under the
  // headline was a description of the machinery.
  const sections: readonly (string | undefined)[] = [
    `## ${verdictHeadline(input)}`,
    MEASURED_RELIABILITY,
    notes.length === 0 ? undefined : notes.join('\n>\n'),
    input.review === undefined ? undefined : findingsSection(input.review),
    input.review === undefined ? undefined : unresolvedSection(input.review),
    input.intent === undefined ? undefined : intentSection(input.intent),
    input.impact === undefined ? undefined : impactSection(input.impact),
    stageTable(input),
    detailsSection(input)
  ]

  return assemble(
    marker,
    sections.filter((section): section is string => section !== undefined)
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
