// The human-readable face of the REVIEW report.
//
// WHY THIS ONE IS DIFFERENT FROM THE OTHER TWO. `impact check` and `intent check`
// are advisory and cannot fail a pipeline. This report can block a merge, and it
// is the one a reviewer actually reads instead of the diff. That makes its two
// failure modes expensive in opposite directions: a finding a reader cannot check
// gets taken on faith, and a section a reader finds empty gets taken as a
// clearance. Everything below is arranged against those two.
//
// WHAT IT MUST NOT BECOME. A verdict. The quality gate is a threshold comparison
// over what THIS RUN happened to report, so `passed: true` means "nothing found
// crossed a number", never "the change is sound" — and it used to be rendered as
// `Passed: yes`, second from the top, above a set of empty headings. Coverage has
// the same shape: `complete` means every reviewable file was read, not that every
// defect in them was found. Both are now stated as facts about the search.
//
// Pure: it takes a report and returns a string. No filesystem, no clock, no
// configuration.
import type {
  AdmittedFinding,
  EvidenceRecord,
  RefutationResult,
  RejectedFinding,
  ReviewReport
} from '../../shared/contracts/index.js'
import {
  adjustedPrecisionInTwenty,
  inDiffRecallInTen,
  measuredReliability,
  NOTHING_PROVED,
  numberWord
} from './measured-reliability.js'
import {
  inlineCode,
  NO_REFUTATION_VERDICT,
  pluralize,
  renderMeasuredOn,
  renderUsageLines,
  safeText,
  sortAdmittedFindings,
  validateReviewReport
} from './reporting-utils.js'

// Stated once, at the top, because the single most consequential thing a reader
// can get wrong about this document is what its SILENCE means. A reader who skims
// a short findings list and infers "little was wrong" has inverted the artifact:
// the list is what one bounded, diff-scoped search could prove, not an inventory
// of the change's defects.
const WHAT_THIS_IS =
  'This report lists DEFECTS THIS RUN COULD PROVE from the change it was shown. It is a diff-scoped search: attention follows the changed lines, and code the change did not touch is not searched for defects even when it was read in full. Every finding below survived an attempt to refute it and cites the lines it rests on, so it can be checked rather than believed. Nothing here is a certificate that the change is correct, and the absence of a finding is not the absence of a defect.'

// The measured error rates, printed where the reader is rather than left in an
// evaluation report they will never open — the same decision `intent check` made,
// for the same reason: rounding a rate to "usually" lets a reader supply their own
// optimistic figure, and the optimistic figure is the expensive one here.
//
// Every figure in the sentence comes from `measured-reliability.ts`, which is the
// only place in this repository where these numbers are written down and which
// records the ledger entry it transcribes. It is a module rather than a comment
// because THIS FILE IS NOT THE ONLY RENDERER: the pull-request comment prints the
// same rates, and while these numbers lived as prose in each, a re-baseline
// updated this one and left that one quoting a superseded 61.1%.
//
// Two figures the previous version of this text carried are deliberately gone
// rather than updated. The share of reported findings landing inside the diff is
// not derivable from the report's metrics block, so restating it would be
// quoting a number this file cannot check. And the older adjusted-precision
// figure is NOT comparable to the current one: the eval's scoring version moved
// between the two sweeps in a way that changes which findings are credited for
// identical review output, so the pair cannot be read as a trend and no trend is
// stated here.
//
// The mean and its spread are stated rather than a range, because a range
// invites a reader to pick the end that suits them. The spread tripled between
// the two sweeps and the cause is not established, which is itself a reason to
// state it.
//
// The out-of-diff population is not a defect of this stage but its scope
// boundary, and `impact check` is the stage that covers it (20 of 27, 74.1%,
// measured 2026-08-02 on that command's deterministic core), so it is named here
// rather than left as an unexplained hole.
const MEASURED_RELIABILITY = `Measured reliability, so these findings can be weighed rather than trusted. On a ${measuredReliability.corpusCaseCount}-case real-repository corpus with the engine pinned: about **${inDiffRecallInTen} in 10** defects sitting INSIDE the diff were found (in-diff recall mean ${measuredReliability.inDiffRecallPercent}% over ${numberWord(measuredReliability.runCount)} runs, standard deviation ${measuredReliability.inDiffRecallStandardDeviationPp}pp), and **${measuredReliability.outOfDiffRecallFound} of ${measuredReliability.outOfDiffRecallTotal}** defects sitting outside the diff in the very same changed files were found — a measured zero over a full denominator, and by design, since this stage is diff-scoped and \`impact check\` is the stage that covers that population. Of what it does report, roughly **${adjustedPrecisionInTwenty} in 20** stand up under review (adjusted precision mean ${measuredReliability.adjustedPrecisionPercent}%). Two runs over the same commit do not produce the same report.`

const countBy = <T extends string>(
  values: readonly T[]
): Readonly<Record<string, number>> =>
  values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1

    return counts
  }, {})

const countList = (counts: Readonly<Record<string, number>>): string =>
  Object.entries(counts)
    .map(([key, value]) => `${value} ${safeText(key)}`)
    .join(', ')

const renderEvidenceIds = (evidenceIds: readonly string[]): string =>
  evidenceIds.length === 0 ? 'none cited' : evidenceIds.map(safeText).join(', ')

// A location is a place a reader has to open, so it is rendered whole: the end
// line when the finding has one (a nine-line span reported as its first line sends
// the reader to the wrong place), and the side, because an old-side line number
// names a line that no longer exists on the new side.
const renderLocation = (finding: AdmittedFinding): string => {
  const { location } = finding
  const span =
    location.endLine === undefined || location.endLine === location.startLine
      ? `${location.path}:${location.startLine}`
      : `${location.path}:${location.startLine}-${location.endLine}`

  return `${inlineCode(span)} (${safeText(location.side)} side)`
}

// The answer to "why should I believe this?", per finding, in the reader's line of
// sight. Both halves used to exist only as bare ids: `evidenceIds` pointed into a
// list this document never rendered at all, and `refutationId` pointed into a flat
// section at the bottom keyed by CANDIDATE id — a key that appears nowhere else in
// the document, so the join was not one a human could actually perform.
const renderProof = (
  finding: AdmittedFinding,
  evidenceById: ReadonlyMap<string, EvidenceRecord>,
  refutationById: ReadonlyMap<string, RefutationResult>
): readonly string[] => {
  const refutation =
    finding.refutationId === undefined
      ? undefined
      : refutationById.get(finding.refutationId)
  const lines: string[] = []

  lines.push(
    refutation === undefined
      ? // Deliberately NOT the wording used for an unresolved finding below: the
        // two say different things and a reader must be able to tell them apart.
        `- Survived refutation: ${NO_REFUTATION_VERDICT}`
      : `- Survived refutation (${safeText(refutation.verdict)}): ${safeText(refutation.summary)}`
  )

  if (refutation !== undefined) {
    for (const check of refutation.checks) {
      lines.push(
        `  - Check ${safeText(check.kind)}: ${safeText(check.result)} - ${safeText(check.summary)} (evidence: ${renderEvidenceIds(check.evidenceIds)})`
      )
    }
  }

  lines.push('- Evidence this rests on:')

  for (const evidenceId of finding.evidenceIds) {
    const record = evidenceById.get(evidenceId)

    if (record === undefined) {
      // Named rather than dropped. An evidence id with no record in this report
      // is a hole in the audit trail, and a hole a reader cannot see is worse
      // than one they can.
      lines.push(
        `  - ${inlineCode(evidenceId)}: no evidence record for this id is present in this report`
      )
      continue
    }

    const where =
      record.location === undefined
        ? ''
        : ` at ${inlineCode(`${record.location.path}:${record.location.startLine}`)}`

    lines.push(
      `  - ${safeText(record.kind)}${where}: ${safeText(record.summary)}`
    )
  }

  return lines
}

const renderFixProposal = (finding: AdmittedFinding): readonly string[] => {
  const { fixProposal } = finding

  if (fixProposal === undefined) {
    return []
  }

  return [
    `- Suggested fix (never applied automatically): ${safeText(fixProposal.summary)}`,
    `- Fix evidence: ${renderEvidenceIds(fixProposal.evidenceIds)}`,
    ...(fixProposal.edits === undefined || fixProposal.edits.length === 0
      ? []
      : [
          '- Fix edits:',
          ...fixProposal.edits.map((edit) => {
            const description =
              edit.description === undefined
                ? ''
                : ` - ${safeText(edit.description)}`

            return `  - ${inlineCode(`${edit.path}:${edit.startLine}-${edit.endLine}`)}: ${inlineCode(edit.replacement)}${description}`
          })
        ])
  ]
}

const renderActionableFinding = (
  finding: AdmittedFinding,
  input: {
    readonly blocking: ReadonlySet<string>
    readonly evidenceById: ReadonlyMap<string, EvidenceRecord>
    readonly refutationById: ReadonlyMap<string, RefutationResult>
  }
): readonly string[] => [
  `### ${safeText(finding.severity.toUpperCase())}: ${safeText(finding.title)}`,
  '',
  // First bullet, because it is the one that decides whether this finding is why
  // the merge is blocked. It used to be recoverable only by cross-referencing
  // `qualityGate.failingFindingIds` in the JSON.
  ...(input.blocking.has(finding.id)
    ? ['- **This finding is why the quality gate failed.**']
    : []),
  `- Location: ${renderLocation(finding)}`,
  `- Category: ${safeText(finding.category)}`,
  `- ID: ${inlineCode(finding.id)}`,
  ...(finding.baselineStatus === 'existing'
    ? [
        '- Baseline: existing - this defect predates the change and is reported for context.'
      ]
    : [`- Baseline: ${safeText(finding.baselineStatus)}`]),
  ...renderProof(finding, input.evidenceById, input.refutationById),
  ...renderFixProposal(finding),
  '',
  safeText(finding.description),
  ''
]

// Unresolved findings are suspicions the refuter could neither prove nor disprove
// from the context it had — most often because the deciding evidence lives
// somewhere it could not reach. Rendering them as a bare id and title made them
// undecidable for a human too, which is the same as dropping them. They stay out
// of the quality gate and out of inline comments on purpose: surfacing a suspicion
// for a human decision must not block a build or add review noise.
const renderUnresolvedFinding = (
  finding: AdmittedFinding,
  input: {
    readonly evidenceById: ReadonlyMap<string, EvidenceRecord>
    readonly refutationById: ReadonlyMap<string, RefutationResult>
  }
): readonly string[] => {
  const refutation =
    finding.refutationId === undefined
      ? undefined
      : input.refutationById.get(finding.refutationId)

  return [
    `### ${safeText(finding.severity.toUpperCase())}: ${safeText(finding.title)}`,
    '',
    `- Location: ${renderLocation(finding)}`,
    `- Category: ${safeText(finding.category)}`,
    `- ID: ${inlineCode(finding.id)}`,
    `- Proposed by: ${safeText(finding.proposedBy)}`,
    `- Why unresolved: ${
      refutation === undefined
        ? 'no refutation verdict was recorded for this candidate'
        : `${safeText(refutation.verdict)} - ${safeText(refutation.summary)}`
    }`,
    ...(finding.evidenceIds.length === 0
      ? []
      : [
          '- Evidence gathered so far:',
          ...finding.evidenceIds.map((evidenceId) => {
            const record = input.evidenceById.get(evidenceId)

            return record === undefined
              ? `  - ${inlineCode(evidenceId)}: no evidence record for this id is present in this report`
              : `  - ${safeText(record.kind)}: ${safeText(record.summary)}`
          })
        ]),
    '',
    safeText(finding.description),
    ''
  ]
}

// What the gate is, said in the words of what it did. `passed` is a comparison
// against configured thresholds over the findings THIS RUN produced; recall being
// well short of complete, a run that crosses no threshold has established that and
// nothing more.
//
// The rate itself is deliberately NOT restated here. This comment once said "three
// in five" while the paragraph it describes said "seven in ten" — one file quoting
// two recall rates, which is how a reader loses confidence in both. Every figure
// now has exactly one home, `measured-reliability.ts`.
const renderGate = (report: ReviewReport): readonly string[] => {
  const gate = report.qualityGate

  if (gate === undefined) {
    return ['- Quality gate: not evaluated for this run.']
  }

  const thresholds = Object.entries(gate.thresholds)
    .map(([key, value]) => `${safeText(key)} ${safeText(String(value))}`)
    .join(', ')
  const against =
    thresholds.length === 0 ? '' : ` Thresholds applied: ${thresholds}.`

  return gate.passed
    ? [
        `- **Quality gate: no reported finding crossed a configured threshold.**${against} That is a comparison against what this run found, not a judgement about the change.`
      ]
    : [
        `- **Quality gate: FAILED.** ${pluralize(gate.failingFindingIds.length, 'finding crosses', 'findings cross')} a configured threshold.${against}`
      ]
}

// What the search covered, so a reader can discount it. Coverage is deliberately
// worded as "read", not as "reviewed" or "covered": `coverage.status = complete`
// is a statement that every reviewable byte reached a model, and reading it as a
// completeness claim about defects is the same error this whole document is
// arranged against.
const renderScope = (report: ReviewReport): readonly string[] => {
  const { coverage, run } = report

  return [
    '## Scope of this search',
    '',
    `- Run: ${inlineCode(run.runId)} (mode ${safeText(run.mode)}, depth ${safeText(run.depth)})`,
    // Always a line, never dropped, and carrying the provider as well as the
    // model name: every rate and every price this document quotes is a property
    // of one specific model, so a report that cannot say which one has to say
    // THAT rather than leave the reader to assume the measured one.
    `- Model: ${run.model === undefined ? 'not recorded' : inlineCode(`${run.provider ?? 'unknown provider'}/${run.model}`)}`,
    ...(run.baseRef === undefined
      ? []
      : [`- Base: ${inlineCode(run.baseRef)}`]),
    ...(run.headRef === undefined
      ? []
      : [`- Head: ${inlineCode(run.headRef)}`]),
    ...(run.mergeBaseRef === undefined
      ? []
      : [`- Merge base: ${inlineCode(run.mergeBaseRef)}`]),
    `- Files read in full: ${coverage.coveredFileCount} of ${coverage.reviewableFileCount} reviewable (${coverage.coveredBytes.toLocaleString('en-US')} of ${coverage.reviewableBytes.toLocaleString('en-US')} bytes). Coverage status: ${safeText(coverage.status)} — a statement that the source reached a model, not that every defect in it was found.`,
    // The line above counts only files that REACHED review, so on its own it can
    // read "complete" while hundreds never got that far. Stated next to it rather
    // than left to the Skipped Files section further down the page.
    ...(coverage.excludedFileCount === 0
      ? []
      : [
          `- Files excluded before review even began: ${coverage.excludedFileCount}. They are NOT in the counts above. See "Skipped Files" for why.`
        ]),
    ...(report.skippedFiles.length === 0
      ? []
      : [
          `- Files never reviewed at all: ${report.skippedFiles.length}, listed under "Skipped Files" below.`
        ]),
    ''
  ]
}

const renderSummary = (
  report: ReviewReport,
  input: {
    readonly actionable: readonly AdmittedFinding[]
    readonly unresolved: readonly AdmittedFinding[]
  }
): readonly string[] => {
  const severities = countList(
    countBy(input.actionable.map((finding) => finding.severity))
  )
  const categories = countList(
    countBy(input.actionable.map((finding) => finding.category))
  )

  return [
    '## Summary',
    '',
    `- **Findings to act on: ${input.actionable.length}**${severities.length === 0 ? '' : ` (${severities})`}`,
    ...(categories.length === 0 ? [] : [`- By category: ${categories}`]),
    ...renderGate(report),
    `- Unresolved, needing a human decision: ${input.unresolved.length}`,
    `- Candidates proposed and then rejected: ${report.rejectedFindings.length}`,
    ''
  ]
}

// Bounds a reader cannot discount unless they can see them. `run.warnings` used to
// be dropped from this document entirely — a stale baseline or a degraded stage
// was recorded in the JSON and in the pull-request comment, and was invisible in
// the artifact this project tells people to read.
const renderBounds = (report: ReviewReport): readonly string[] => {
  const bounds: string[] = [
    ...report.coverage.incompleteReasons.map(
      (reason) => `Coverage is incomplete: ${safeText(reason)}`
    ),
    ...report.run.warnings.map(safeText)
  ]

  return bounds.length === 0
    ? []
    : ['## Bounds that bound', '', ...bounds.map((bound) => `- ${bound}`), '']
}

const renderRejected = (
  rejected: readonly RejectedFinding[],
  refutationsByCandidate: ReadonlyMap<string, RefutationResult>
): readonly string[] => {
  if (rejected.length === 0) {
    return [
      '## Rejected Candidates (0)',
      '',
      'Nothing was proposed and then thrown out. On a run that also reports no finding, that means discovery proposed nothing — not that everything proposed was sound.',
      ''
    ]
  }

  return [
    `## Rejected Candidates (${rejected.length})`,
    '',
    'Suspicions this run raised and then discarded, with the reason. This is where the volume went if the report reads quieter than the change felt; a rejection can be right or wrong, and the reason is printed so you can tell.',
    '',
    ...rejected.map((entry) => {
      const refutation = refutationsByCandidate.get(entry.candidateId)
      // `message` carries the actual reason — the caller already checks this,
      // the analyzer already reports it — and used to be dropped in favour of
      // the bare enum, which is the one part of a rejection a reader cannot act
      // on.
      const message =
        entry.message.length === 0
          ? refutation === undefined
            ? ''
            : ` - ${safeText(refutation.summary)}`
          : ` - ${safeText(entry.message)}`

      return `- ${inlineCode(entry.candidateId)}: ${safeText(entry.reason)} (${safeText(entry.status)})${message}`
    }),
    ''
  ]
}

// The full refutation ledger. Spec 05 requires Markdown to render candidate
// fields, refutation summaries, refutation evidence, and refutation check evidence
// as cited evidence IDs or `none cited`, so refutation can be audited without
// opening JSON. That requirement is met here and NOT by the per-finding rendering
// above, which is a reading aid over the same records.
const renderRefutations = (
  refutations: readonly RefutationResult[]
): readonly string[] => {
  if (refutations.length === 0) {
    return [
      '## Refutation Results (0)',
      '',
      'No candidate reached refutation in this run.',
      ''
    ]
  }

  return [
    `## Refutation Results (${refutations.length})`,
    '',
    'The complete adjudication ledger, one entry per candidate, so refutation can be audited without opening the JSON. The entries behind admitted findings are repeated on those findings above.',
    '',
    ...refutations.flatMap((refutation) => [
      `- ${inlineCode(refutation.id)}: ${safeText(refutation.verdict)} for ${inlineCode(refutation.candidateId)} - ${safeText(refutation.summary)}`,
      `  - Refutation evidence: ${renderEvidenceIds(refutation.evidenceIds)}`,
      ...refutation.checks.map(
        (check) =>
          `  - Refutation check ${safeText(check.kind)}: ${safeText(check.result)} - ${safeText(check.summary)} evidence: ${renderEvidenceIds(check.evidenceIds)}`
      )
    ]),
    ''
  ]
}

const renderProviderIssues = (report: ReviewReport): readonly string[] =>
  report.providerIssues.length === 0
    ? []
    : [
        `## Provider Issues (${report.providerIssues.length})`,
        '',
        'Model or provider trouble during the run. A recovered issue still means a stage was retried or degraded, which is a reason this search may be thinner than usual.',
        '',
        ...report.providerIssues.map((issue) => {
          const stage = issue.stage === undefined ? 'unknown-stage' : issue.stage
          const recovered =
            issue.recovered === undefined
              ? 'unknown'
              : issue.recovered
                ? 'yes'
                : 'no'
          const message =
            issue.message === undefined ? '' : ` - ${safeText(issue.message)}`

          return `- ${safeText(issue.code)} at ${safeText(stage)} recovered: ${recovered}${message}`
        }),
        ''
      ]

const renderSkippedFiles = (report: ReviewReport): readonly string[] =>
  report.skippedFiles.length === 0
    ? []
    : [
        `## Skipped Files (${report.skippedFiles.length})`,
        '',
        'Part of the change set, never reviewed. Nothing above says anything about these files.',
        '',
        ...report.skippedFiles.map(
          (skipped) =>
            `- ${inlineCode(skipped.path)}: ${safeText(skipped.reason)}${skipped.message === undefined ? '' : ` - ${safeText(skipped.message)}`}`
        ),
        ''
      ]

// Spec 29. A deterministic, free observation, printed near the bottom because a
// reviewer's attention belongs on defects first and this is not one.
//
// THREE THINGS THIS SECTION MUST NOT BECOME, and each is a rule below rather than
// a hope. It must not read as a defect: no severity, no id, no gate, no
// recommendation, and the note says what it is before the list says which files.
// It must not read as "this change is untested": the signal saw only the changed
// files, and the disclosure that an unchanged test may already cover any path here
// is in the same paragraph as the list, not a footnote under it. And it must not
// render empty — this document's own doctrine is that a section a reader finds
// empty gets taken as a clearance, so when nothing is unpaired there is no
// heading at all.
//
// The two unknown counts are printed whenever they are non-zero. They are the
// difference between "no file went unpaired" and "no file could be asked", and a
// reader who cannot see which of those produced a short list has been given a
// confident zero.
const renderTestAdequacy = (report: ReviewReport): readonly string[] => {
  const signal = report.testAdequacy

  if (signal === undefined || signal.unpairedPaths.length === 0) {
    return []
  }

  const unknownCount =
    signal.unknown.unsupportedLanguageFileCount +
    signal.unknown.notAnalysedFileCount

  return [
    `## Changed source files with no test file in this change (${signal.unpairedPaths.length})`,
    '',
    'A free, deterministic observation about the change, and **not a finding**. It carries no severity, counts toward no threshold, and did not affect the quality gate above. It pairs a changed source file with a changed test file by each language\'s own naming and location convention, and it looked at nothing outside the files this change touched.',
    '',
    '**A file listed here may already be covered completely by an existing test that this change had no reason to touch — this signal cannot see that test, and does not claim the file is untested.** Read the list as "no test moved with these files", never as "these files have no tests".',
    '',
    `Of ${pluralize(signal.consideredFileCount, 'changed source file', 'changed source files')} this question could be asked of, ${signal.pairedFileCount} paired with a test file in this change. The change also touched ${pluralize(signal.changedTestFileCount, 'test-side file', 'test-side files')}; a test file pairs by name only when it sits beside the code it exercises, so a change that keeps its tests in a tree of their own pairs nothing here.`,
    ...(unknownCount === 0
      ? []
      : [
          '',
          `${unknownCount} further changed ${unknownCount === 1 ? 'file was' : 'files were'} not asked the question at all: ${signal.unknown.unsupportedLanguageFileCount} in a language this engine does not analyse, ${signal.unknown.notAnalysedFileCount} never read for this run. They are unknown, not untested, and are not listed below.`
        ]),
    '',
    ...signal.unpairedPaths.map((unpairedPath) => `- ${inlineCode(unpairedPath)}`),
    ''
  ]
}

// Spend and tokens, stated on every report rather than left to a JSON field. This
// engine bills a provider per run and the reader is the person paying, so the
// amount belongs beside the findings — the same place the pull-request comment
// already puts it.
//
// Tokens are reported alongside because cost alone cannot be acted on: input
// dominates output by roughly 23:1 here, so a reader deciding whether to narrow
// `paths.include` needs to see WHICH side is large. How each of those three
// figures is written, and what an unmeasured one says instead, is
// `renderUsageLines`: this document and the intent-fulfilment report print the
// same numbers and must not describe a missing one differently.
//
// Duration is this section's own, and stays here: it is timing rather than spend,
// and the other surface has no equivalent.
// What DISCOVERY produced, before refutation and admission decided what survived.
//
// This reached `report.json` and no human surface at all: the markdown reporter
// never read `report.discovery`. It is the section that answers "why is this
// report quiet" -- whether the reviewer proposed little, or proposed plenty and
// the later stages removed it -- and those two have completely different fixes.
// A reader who cannot tell them apart cannot act on either.
//
// Absent when the run recorded none (a provider-errored run), and stated as
// absent rather than rendered as zeros, because "discovery proposed 0" and
// "discovery was never asked" are different facts.
const renderDiscovery = (report: ReviewReport): readonly string[] => {
  const discovery = report.discovery

  if (discovery === undefined) {
    return []
  }

  const { totals } = discovery
  const suppressed =
    totals.suppressedByIdCount +
    totals.suppressedByLocationCount +
    totals.cappedByLimitCount +
    totals.mergedAwayCount

  return [
    '## What Discovery Produced',
    '',
    `The reviewer made ${totals.callCount} discovery call(s) and proposed ${totals.rawFindingCount} finding(s), of which ${totals.candidateCount} became candidates for adjudication.`,
    '',
    `- Dropped before adjudication: ${totals.droppedCount}`,
    `- Suppressed as duplicates or over a cap: ${suppressed} (${totals.suppressedByIdCount} by id, ${totals.suppressedByLocationCount} by location, ${totals.cappedByLimitCount} over the per-call cap, ${totals.mergedAwayCount} merged as the same defect)`,
    `- Packets split because the provider refused the input: ${totals.contextOverflowSplitCount}`,
    '',
    'Read this next to the rejected-candidate count above. A quiet report with a low proposed count is a discovery problem; a quiet report with a high one is an adjudication problem.',
    ''
  ]
}

const renderCost = (report: ReviewReport): readonly string[] => {
  const { run } = report

  return [
    '## Cost And Timing',
    '',
    // The model this cost was paid to is on the scope line above, not repeated
    // here: one statement of run identity, in the section that states it.
    `- Duration: ${run.durationMs.toLocaleString('en-US')} ms`,
    ...renderUsageLines(run),
    ''
  ]
}

const indexById = <T>(
  values: readonly T[],
  key: (value: T) => string
): ReadonlyMap<string, T> => new Map(values.map((value) => [key(value), value]))

export const renderMarkdownReport = (input: unknown): string => {
  const report: ReviewReport = validateReviewReport(input)
  const admittedFindings = sortAdmittedFindings(report.admittedFindings)
  const actionable = admittedFindings.filter(
    (finding) => finding.reporterEligibility !== 'artifact-only'
  )
  const unresolved = admittedFindings.filter(
    (finding) => finding.reporterEligibility === 'artifact-only'
  )
  const evidenceById = indexById(report.evidence, (record) => record.id)
  const refutationById = indexById(
    report.refutationResults,
    (refutation) => refutation.id
  )
  const refutationsByCandidate = indexById(
    report.refutationResults,
    (refutation) => refutation.candidateId
  )
  const blocking = new Set(report.qualityGate?.failingFindingIds ?? [])

  const lines: string[] = [
    '# Review Report',
    '',
    WHAT_THIS_IS,
    '',
    `${MEASURED_RELIABILITY} ${renderMeasuredOn(report.run)}`,
    '',
    ...renderScope(report),
    ...renderSummary(report, { actionable, unresolved }),
    ...renderBounds(report),
    // First section of substance, because it is the reason to open the document.
    `## Actionable Findings (${actionable.length})`,
    ''
  ]

  if (actionable.length === 0) {
    lines.push(NOTHING_PROVED, '')
  } else {
    lines.push(
      'Ordered by severity, then by path and line. Each one survived an attempt to refute it, and the evidence it rests on is printed underneath so you can disagree with it.',
      ''
    )

    for (const finding of actionable) {
      lines.push(
        ...renderActionableFinding(finding, {
          blocking,
          evidenceById,
          refutationById
        })
      )
    }
  }

  if (unresolved.length > 0) {
    lines.push(
      `## Unresolved - Needs Human Decision (${unresolved.length})`,
      '',
      'These candidates were neither proved nor disproved from the available context, most often because the deciding evidence sits outside the files this run could reach. They do not affect the quality gate. Confirm or dismiss each one — skipping this section takes the strict half of a precision-first design without the half that compensates for it.',
      ''
    )

    for (const finding of unresolved) {
      lines.push(...renderUnresolvedFinding(finding, { evidenceById, refutationById }))
    }
  }

  lines.push(
    ...renderRejected(report.rejectedFindings, refutationsByCandidate),
    ...renderDiscovery(report),
    ...renderRefutations(report.refutationResults),
    ...renderProviderIssues(report),
    ...renderSkippedFiles(report),
    ...renderTestAdequacy(report),
    ...renderCost(report)
  )

  return `${lines.join('\n')}\n`
}
