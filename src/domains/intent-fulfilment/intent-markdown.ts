// The human-readable face of the intent-fulfilment MAPPING report.
//
// WHY THIS EXISTS. `intent check` printed JSON to stdout and nothing else, so its
// output lived outside the workflow a reviewer uses — the same gap spec 22 recorded
// for `impact check` and the same answer: an artifact beside `report.md` in the run
// directory.
//
// WHY IT MATTERS MORE HERE THAN FOR IMPACT. This capability's dominant measured
// error is not a wrong answer, it is a MISREAD one. On the 2026-08-01 realistic
// corpus, 54 of the lane's 83 false positives were obligations the judgement had
// reported correctly — nothing among the changed lines evidenced them — which a
// reader took as a claim that the work was undone. The engine renamed its statuses
// to `evidenced`/`not-evidenced` for exactly that reason. A rendering is where that
// distinction is either preserved or thrown away, so every heading below says what
// the SEARCH found and never what the author did or failed to do.
//
// WHAT IT MUST NOT BECOME. Spec 23: the output "MUST NOT certify completion", and
// "no part of the output may be phrased so a reader could take it that way". So
// there is no severity here, no pass/fail, no score, no "complete" and no
// "incomplete" — and the evidenced section is deliberately NOT a congratulation. An
// empty not-evidenced list renders as "this run found nothing it could not evidence",
// never as "the change covers its intent".
//
// Pure: it takes a report and returns a string. No filesystem, no clock, no
// configuration. The CLI decides where the string goes.

import { safeRedactedText, safeText } from '../reporting/index.js'
import type {
  ChangeCitation,
  IntentFulfilmentReport,
  Obligation
} from './intent-fulfilment-report.js'

// Stated once, at the top, because it is the single sentence that decides whether
// the document is read correctly. A reader who skims the headings and supplies the
// missing word themselves supplies "undone", which is the error this capability was
// re-vocabularised to prevent.
const WHAT_THIS_IS =
  'This report maps the STATED INTENT of a change onto the lines the change touched. It says what those lines do and do not SHOW. It is not a completeness check: an obligation with no evidence here may be finished elsewhere, deliberately deferred, or genuinely missing, and only a human reading it can tell which. Nothing here is a finding, nothing carries a severity, and this command cannot fail a pipeline.'

// The measured error rates, printed where the reader is rather than left in an
// evaluation report they will never open.
//
// Spec 23's governing risk is that OMISSION gets read as COVERAGE — a reader who
// takes "evidenced" as "done" stops checking, which is the expensive direction.
// Stating the two rates that bound that risk is the only honest way to let someone
// calibrate how much weight to put on a row.
//
// From a pre-registered round over 28 cases run twice against one pinned engine
// (`d29aa99`), scored against hand labels frozen and digested before the first
// call: about 1 in 29 rows called evidenced is genuinely outstanding at head, and
// about 1 in 10 genuinely-outstanding obligations never reaches this list at all.
// The first figure is why a row here is not a certificate; the second is why the
// list's silence is not a clearance.
//
// Deliberately qualitative in the prose and exact in the numbers. Rounding "3.5%"
// to "rarely" would let a reader supply their own optimistic figure, which is the
// failure this paragraph exists to prevent.
const MEASURED_RELIABILITY =
  'Measured reliability, so these rows can be weighed rather than trusted: about **1 in 29** obligations this stage calls evidenced is in fact still outstanding at head, and about **1 in 10** genuinely outstanding obligations never appear on this list at all. Those rates come from a pre-registered round over 28 real changes, each run twice against one pinned engine. They are why this report is read alongside the diff and never in place of it.'

// The sentence a reader most needs when the outstanding list is empty, and the one
// most easily replaced by a congratulation. Spec 23 forbids certifying completion,
// so an empty list is reported as a fact about the search.
const NOTHING_UNEVIDENCED =
  'Every obligation read out of the stated intent was matched to lines in this change. That is a statement about this search, not a certificate: obligations the extraction never proposed are not on this list, and an obligation can be evidenced by lines that do less than it asks.'

// A cited line is source, and source is full of characters Markdown would otherwise
// eat. Escaping each one leaves a reader reading backslashes instead of code, so it
// goes in a code span whose delimiter grows past the longest backtick run in the
// text — CommonMark's own answer to a code span containing backticks, so no input
// can break out of the span.
const inlineCode = (value: string): string => {
  const text = safeRedactedText(value)

  if (text.length === 0) {
    return '(blank)'
  }

  const longestBacktickRun = [...text.matchAll(/`+/gu)].reduce(
    (longest, match) => Math.max(longest, match[0].length),
    0
  )
  const delimiter = '`'.repeat(longestBacktickRun + 1)
  const padding = text.startsWith('`') || text.endsWith('`') ? ' ' : ''

  return `${delimiter}${padding}${text}${padding}${delimiter}`
}

const pluralize = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`

// The side is rendered, never dropped. Spec 23's 2026-07-30 amendment makes it a
// MUST: a removed line is numbered on the PRE-change side, so without the side a
// reader cannot tell "this deleted line 42" from "this added line 42", and those are
// two different lines.
const renderEvidence = (citation: ChangeCitation): string =>
  `  - ${inlineCode(`${citation.path}:${citation.line}`)} (${safeText(citation.side)}) ${inlineCode(citation.text)}`

// Where in the stated intent this obligation was read from. Spec 23: "An obligation
// the reviewer inferred rather than read is not an obligation." The citation is on
// every entry, whatever its status, so a reader can always go back to the sentence
// the tool thinks it is holding the change to — and disagree with it.
const renderSource = (obligation: Obligation): string =>
  `  - Read from ${inlineCode(`${obligation.source.origin}:${obligation.source.line}`)}: ${inlineCode(obligation.source.text)}`

const renderObligation = (obligation: Obligation): readonly string[] => [
  `- **${safeText(obligation.statement)}**`,
  renderSource(obligation),
  ...(obligation.status === 'evidenced'
    ? obligation.evidence.map(renderEvidence)
    : []),
  ''
]

const renderObligationSection = (
  input: {
    readonly heading: string
    readonly note: string
    readonly obligations: readonly Obligation[]
  }
): readonly string[] =>
  input.obligations.length === 0
    ? []
    : [
        `## ${input.heading} (${input.obligations.length})`,
        '',
        input.note,
        '',
        ...input.obligations.flatMap(renderObligation)
      ]

// Changed files no obligation's evidence cites. Spec 23: "Extra scope is reported
// neutrally. A change doing more than the ticket asked is a normal and often
// desirable event, not a defect." So there is nowhere here to record a severity, a
// verdict, or a question — and the note says the harmless reading out loud, because
// a bare list under a heading reads as an accusation.
const renderExtraScope = (
  report: IntentFulfilmentReport
): readonly string[] =>
  report.extraScope.length === 0
    ? []
    : [
        `## Changed files no obligation cites (${report.extraScope.length})`,
        '',
        'Work this change contains that the stated intent does not describe. That is normal and frequently deliberate — refactoring, tests, and incidental fixes all land here — and it is listed so the mapping is complete, not because it is a problem.',
        '',
        ...report.extraScope.map(
          (entry) =>
            `- ${inlineCode(entry.path)} (${pluralize(entry.changedLineCount, 'changed line', 'changed lines')})`
        ),
        ''
      ]

// The prose summary, written by a separate model call over an already-frozen
// mapping. Rendered UNDER the mapping rather than above it: the mapping is the
// output and the prose is a convenience over it, and a summary printed first would
// be the thing a skimming reader takes away.
const renderExplanation = (
  report: IntentFulfilmentReport
): readonly string[] =>
  report.explanation === undefined
    ? []
    : [
        '## Summary in prose',
        '',
        'Written by a separate model call that read the mapping above after it was decided and could not change it. Where the two disagree, the mapping is the record.',
        '',
        safeText(report.explanation),
        ''
      ]

const renderScope = (report: IntentFulfilmentReport): readonly string[] => [
  `- Status: ${safeText(report.status)}`,
  `- Generated: ${safeText(report.generatedAt)}`,
  `- Base: ${inlineCode(report.scope.baseRef)}`,
  `- Head: ${inlineCode(report.scope.headRef)}`,
  ...(report.scope.mergeBaseRef === undefined
    ? []
    : [`- Merge base: ${inlineCode(report.scope.mergeBaseRef)}`]),
  `- Changed files: ${report.scope.changedFileCount}`,
  `- Changed lines the judgement could cite: ${report.scope.changedLineCount}`,
  `- Stated intent read from: ${report.scope.intentOrigins.length === 0 ? 'nothing' : report.scope.intentOrigins.map((origin) => inlineCode(origin)).join(', ')}`,
  ''
]

// The headline number, and the reason the capability is shaped the way it is:
// `notEvidencedCount` is `not-evidenced` plus `undetermined`, and an `evidenced`
// obligation is never on it. It is named here as what the SEARCH did not find, so
// the count and its meaning cannot drift apart on the page a reader quotes from.
const renderSummary = (report: IntentFulfilmentReport): readonly string[] => {
  const { summary } = report

  return [
    '## Summary',
    '',
    `- Obligations read out of the stated intent: ${summary.obligationCount}`,
    `- **Not evidenced by this change: ${summary.notEvidencedCount}** (${summary.notEvidencedStatusCount} with nothing found, ${summary.undeterminedCount} undecidable)`,
    `- Evidenced by this change: ${summary.evidencedCount}`,
    `- Changed files no obligation cites: ${summary.extraScopeFileCount}`,
    ...(summary.uncitedObligationCount === 0
      ? []
      : [
          `- Proposed obligations discarded because their citation resolved to no line of the stated intent: ${summary.uncitedObligationCount}`
        ]),
    ...(summary.unverifiedEvidenceClaimCount === 0
      ? []
      : [
          `- Claims of evidence citing lines this change did not touch, recorded as undecidable: ${summary.unverifiedEvidenceClaimCount}`
        ]),
    ''
  ]
}

// Bounds a reader cannot discount unless they can see them. The intent limits refuse
// the run rather than truncating it, so `obligationsTruncated` is always false and is
// not rendered; the two below are the bounds that can still bind silently.
const renderBounds = (report: IntentFulfilmentReport): readonly string[] => {
  const bounds: string[] = []

  if (report.scope.changedLinesTruncated) {
    bounds.push(
      'The changed lines were cut to fit `intentFulfilment.maxChangeLines`, so the judgement was not shown the whole change. An obligation below may be evidenced by a line it never saw.'
    )
  }

  if (report.scope.intentTruncated) {
    bounds.push(
      'The stated intent was cut to fit `intentFulfilment.maxIntentBytes`, so obligations stated after the cut were never read.'
    )
  }

  return bounds.length === 0
    ? []
    : ['## Bounds that bound', '', ...bounds.map((bound) => `- ${bound}`), '']
}

const renderUsage = (report: IntentFulfilmentReport): readonly string[] => {
  const { usage } = report

  if (usage === undefined) {
    return []
  }

  const cached =
    usage.cachedInputTokens === undefined
      ? ''
      : ` (${usage.cachedInputTokens.toLocaleString('en-US')} cached)`

  return [
    '## Cost',
    '',
    // Omitted rather than zeroed when pricing could not be determined, so a run
    // whose price is unknown does not read as a free one.
    ...(usage.costUsd === undefined
      ? []
      : [`- Cost: $${usage.costUsd.toFixed(4)}`]),
    `- Input tokens: ${usage.inputTokens.toLocaleString('en-US')}${cached}`,
    `- Output tokens: ${usage.outputTokens.toLocaleString('en-US')}`,
    ''
  ]
}

const renderWarnings = (report: IntentFulfilmentReport): readonly string[] =>
  report.warnings.length === 0
    ? []
    : [
        '## Warnings',
        '',
        ...report.warnings.map((warning) => `- ${safeText(warning)}`),
        ''
      ]

// The four outcomes that map nothing. Each is a statement a reader needs, and an
// empty document would read as a missing report rather than as an answer — spec 23
// requires absent or unusable intent to be reported PLAINLY.
const NO_MAPPING_REASON: Readonly<Record<string, string>> = {
  disabled:
    'Intent-fulfilment review is disabled, so nothing was read and nothing was mapped. This is not a report that the change matches its intent.',
  'no-intent':
    'No stated intent was found for this change, so there was nothing to map it against. Most changes have thin descriptions and this is the ordinary case, not an error. Configure `contextSources` to point at the pull-request description, ticket or commit body you want the change held to.',
  'unusable-intent':
    'Stated intent was found, but no checkable obligation could be read out of it. That is a fact about the text, not about the change.',
  'provider-unavailable':
    'Stated intent was found, but no model was available to read it, so nothing was mapped. See the warnings above.'
}

/**
 * The intent-fulfilment mapping as Markdown.
 *
 * Renders every status the schema admits, including the four that carry no
 * obligations at all.
 */
export const renderIntentFulfilmentMarkdown = (
  report: IntentFulfilmentReport
): string => {
  const lines: string[] = [
    '# Intent Fulfilment Report',
    '',
    WHAT_THIS_IS,
    '',
    MEASURED_RELIABILITY,
    '',
    ...renderScope(report),
    ...renderSummary(report),
    ...renderBounds(report),
    ...renderWarnings(report)
  ]

  const reason = NO_MAPPING_REASON[report.status]

  if (reason !== undefined) {
    lines.push('## Nothing was mapped', '', reason, '')

    return `${lines.join('\n')}\n`
  }

  const byStatus = (status: Obligation['status']): readonly Obligation[] =>
    report.obligations.filter((obligation) => obligation.status === status)

  const notEvidenced = byStatus('not-evidenced')
  const undetermined = byStatus('undetermined')

  if (notEvidenced.length === 0 && undetermined.length === 0) {
    lines.push('## Not evidenced by this change (0)', '', NOTHING_UNEVIDENCED, '')
  }

  lines.push(
    // First, because it is the reason to open the document. The heading names the
    // search, not the author: these are obligations the changed lines do not show,
    // which is not the same as obligations nobody has met.
    ...renderObligationSection({
      heading: 'Not evidenced by this change',
      note: 'Nothing among the changed lines does what these obligations ask. That is an ordinary and expected answer — a change need not do everything its stated intent describes, and an obligation an earlier change already satisfied leaves no evidence in this one. Each entry cites the line of the stated intent it was read from, so you can judge whether it belongs here at all.',
      obligations: notEvidenced
    }),
    ...renderObligationSection({
      heading: 'Could not be decided',
      note: 'The lines the judgement was shown did not let it answer either way. This is a real answer rather than a failure, and these are counted with the not-evidenced obligations above: an obligation the run could not settle belongs on the list a human reads, not suppressed from it.',
      obligations: undetermined
    }),
    ...renderObligationSection({
      heading: 'Evidenced by this change',
      note: 'Changed lines were found that do what these obligations ask, and every one of them is cited below by path, line and side. "Evidenced" means those lines were found — not that the obligation is fully or correctly met. The citations are there so you can check that yourself.',
      obligations: byStatus('evidenced')
    }),
    ...renderExtraScope(report),
    ...renderExplanation(report),
    ...renderUsage(report)
  )

  return `${lines.join('\n')}\n`
}
