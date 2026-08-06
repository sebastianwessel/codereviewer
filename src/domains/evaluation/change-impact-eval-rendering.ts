// The rendered change-impact evaluation summary.
//
// Every table here answers one of the three questions spec 22 §Evaluation asks,
// and the document is arranged so none of them can be read without the other two:
// the deterministic reference list is the baseline the capability must beat, the
// adjudicated list is what the capability actually says, and the difference is
// what adjudication bought.
//
// Two rendering rules are load-bearing rather than cosmetic:
//
//  - a not-measured cell says WHY, and never prints a percentage. `0.0%` in this
//    document means the engine looked and missed.
//  - precision prints as a pair of bounds with the upper one stated as not
//    measurable on this corpus, so a lower bound can never be quoted as "the"
//    precision.

import {
  appendMarkdownBulletSection,
  appendMarkdownTable,
  escapeMarkdownCell,
  formatInteger,
  formatPercent
} from './eval-report-markdown-formatting.js'
import type { PrecisionBracketBound } from './eval-precision-bracket.js'
import type { ChangeImpactEvalReport } from './change-impact-eval-report.js'
import type {
  ChangeImpactAdjudicationDeltaGroup,
  ChangeImpactArmMetrics,
  ChangeImpactRecall
} from './change-impact-scoring.js'

const reachabilityLabels: readonly (readonly [
  keyof ChangeImpactArmMetrics['byReachability'],
  string
])[] = [
  ['caller-of-changed-symbol', 'caller of changed symbol'],
  ['callee-of-changed-code', 'callee of changed code'],
  ['attribute-owner', 'attribute owner'],
  ['whole-repo-search', 'whole-repo search']
]

const formatRecall = (recall: ChangeImpactRecall): string => {
  const suffix =
    recall.unmeasuredExpectedCount === 0
      ? ''
      : ` [+${formatInteger(recall.unmeasuredExpectedCount)} not measured]`

  if (recall.measured.status === 'not-measured') {
    return `not measured (${escapeMarkdownCell(recall.measured.reason)})`
  }

  return `${formatPercent(recall.measured.rate)} (${formatInteger(
    recall.measured.matched
  )}/${formatInteger(recall.measured.total)})${suffix}`
}

// The upper bound's absence has a corpus-specific reason here, not the diff
// reviewer's "no plausibility judge ran": no judge could fix it, because the
// answer key is not an enumeration of every affected file.
const formatBound = (bound: PrecisionBracketBound): string => {
  switch (bound.status) {
    case 'known':
      return formatPercent(bound.value)
    case 'not-measured':
      return 'not measurable on this corpus (the answer key lists the dependents upstream repaired, not every affected file)'
    default:
      return 'unknown (nothing predicted)'
  }
}

const formatPrecision = (arm: ChangeImpactArmMetrics): string =>
  `lower bound ${formatBound(arm.precision.lower)}; upper bound ${formatBound(
    arm.precision.upper
  )}`

const armRecallRows = (arm: ChangeImpactArmMetrics): readonly string[] => [
  ...reachabilityLabels.map(
    ([key, label]) =>
      `| ${label} | ${formatRecall(arm.byReachability[key])} |`
  ),
  `| **directly reachable (the promote-to-default population)** | ${formatRecall(
    arm.directlyReachable
  )} |`,
  `| **whole-repo search** | ${formatRecall(arm.wholeRepoSearch)} |`
]

const armSplitRows = (arm: ChangeImpactArmMetrics): readonly string[] => [
  `| dev (contaminated: the model has very likely seen the change and its fix) | ${formatRecall(
    arm.bySplit.dev
  )} |`,
  `| held-out | ${formatRecall(arm.bySplit['held-out'])} |`
]

const appendArm = (
  lines: string[],
  input: {
    readonly heading: string
    readonly preamble: readonly string[]
    readonly arm: ChangeImpactArmMetrics
  }
): void => {
  lines.push(input.heading)
  lines.push('')

  for (const paragraph of input.preamble) {
    lines.push(paragraph)
    lines.push('')
  }

  appendMarkdownTable(lines, {
    header: '| reachability class | recall |',
    alignment: '| --- | --- |',
    rows: armRecallRows(input.arm)
  })
  appendMarkdownTable(lines, {
    header: '| contamination split | recall |',
    alignment: '| --- | --- |',
    rows: armSplitRows(input.arm)
  })
  appendMarkdownTable(lines, {
    header: '| prediction volume | value |',
    alignment: '| --- | ---: |',
    rows: [
      `| destination files predicted | ${formatInteger(
        input.arm.predictedFileCount
      )} |`,
      `| of those, proven dependents | ${formatInteger(
        input.arm.matchedPredictedFileCount
      )} |`,
      `| precision | ${escapeMarkdownCell(formatPrecision(input.arm))} |`
    ]
  })
}

// A case's model-call count, in words when it is zero. `0` in a numeric column is
// too easy to read past, and it is the value that decides whether the rest of the
// row is about a model at all.
const caseCallCell = (
  result: Extract<
    ChangeImpactEvalReport['caseResults'][number],
    { readonly status: 'scored' }
  >
): string =>
  result.adjudicationCallCount === 0
    ? '**none — judge never ran**'
    : formatInteger(result.adjudicationCallCount)

// One tier's share of arm 3. A group with no cases prints a sentence, never a
// table of zeros: "no case did this" and "cases did this and removed nothing" are
// different facts, and a zero table reads as the second.
const appendDeltaGroup = (
  lines: string[],
  input: {
    readonly heading: string
    readonly preamble: string
    readonly emptyStatement: string
    readonly group: ChangeImpactAdjudicationDeltaGroup
  }
): void => {
  lines.push(input.heading)
  lines.push('')

  if (input.group.caseCount === 0) {
    lines.push(input.emptyStatement)
    lines.push('')

    return
  }

  lines.push(input.preamble)
  lines.push('')
  appendMarkdownTable(lines, {
    header: '| field | count |',
    alignment: '| --- | ---: |',
    rows: [
      `| fully adjudicated cases | ${formatInteger(input.group.caseCount)} |`,
      `| model calls spent on them | ${formatInteger(input.group.modelCallCount)} |`,
      `| reference destination files | ${formatInteger(input.group.referenceFileCount)} |`,
      `| adjudicated destination files | ${formatInteger(input.group.adjudicatedFileCount)} |`,
      `| removed | ${formatInteger(input.group.removedFileCount)} |`,
      `| — removals PROVEN wrong (a corpus dependent was dropped) | ${formatInteger(input.group.removedProvenDependentCount)} |`,
      `| — removals of unknown correctness | ${formatInteger(input.group.removedUnknownCorrectnessCount)} |`,
      `| proven dependents retained | ${formatInteger(input.group.retainedProvenDependentCount)} |`,
      `| reported but never located (must be 0) | ${formatInteger(input.group.addedNotInReferenceListCount)} |`,
      `| cases | ${escapeMarkdownCell(input.group.caseIds.join(', '))} |`
    ]
  })
}

export const renderChangeImpactEvalSummary = (
  report: ChangeImpactEvalReport
): string => {
  const lines: string[] = []
  const model =
    report.provenance.providerId === undefined ||
    report.provenance.modelName === undefined
      ? 'no provider configured'
      : `${report.provenance.providerId}/${report.provenance.modelName}`

  lines.push('# Change-impact dependents — evaluation')
  lines.push('')
  lines.push(
    `Dataset \`${escapeMarkdownCell(report.datasetId)}\`, generated ${escapeMarkdownCell(report.generatedAt)}.`
  )
  lines.push('')
  lines.push(
    'Spec 22 §Evaluation. The scoring unit is the destination FILE. **Nothing below is pooled across reachability class or contamination split, and there is deliberately no blended recall figure.** A single run decides nothing.'
  )
  lines.push('')

  appendMarkdownTable(lines, {
    heading: '## Provenance',
    header: '| field | value |',
    alignment: '| --- | --- |',
    rows: [
      `| model | ${escapeMarkdownCell(model)} |`,
      `| engine commit | ${escapeMarkdownCell(report.engine.commit)} |`,
      `| engine working tree | ${
        report.engine.workingTreeClean === undefined
          ? 'unknown'
          : report.engine.workingTreeClean
            ? 'clean'
            : 'DIRTY — these numbers were produced by uncommitted code'
      } |`,
      `| adjudication requested | ${report.engine.adjudicationRequested ? 'yes' : 'no'} |`,
      `| metrics version | ${escapeMarkdownCell(report.metricsVersion)} |`,
      `| answer-key digest | \`${escapeMarkdownCell(report.provenance.answerKeyDigest.slice(0, 12))}\` |`,
      `| config hash | \`${escapeMarkdownCell(report.provenance.configHash.slice(0, 12))}\` |`,
      `| manifest | \`${escapeMarkdownCell(report.selection.manifestPath)}\` |`,
      `| case root | \`${escapeMarkdownCell(report.selection.caseRoot)}\` |`
    ]
  })

  appendMarkdownTable(lines, {
    heading: '## Coverage',
    header: '| field | count |',
    alignment: '| --- | ---: |',
    rows: [
      `| cases selected | ${formatInteger(report.coverage.totalCaseCount)} |`,
      `| cases scored | ${formatInteger(report.coverage.scoredCaseCount)} |`,
      `| cases unmeasured | ${formatInteger(report.coverage.unmeasuredCaseCount)} |`,
      `| — not hydrated | ${formatInteger(report.coverage.unmeasuredByReason['not-hydrated'])} |`,
      `| — stale checkout | ${formatInteger(report.coverage.unmeasuredByReason['stale-checkout'])} |`,
      `| — engine error | ${formatInteger(report.coverage.unmeasuredByReason['engine-error'])} |`,
      `| — capability disabled | ${formatInteger(report.coverage.unmeasuredByReason['capability-disabled'])} |`,
      `| cases with an adjudicated answer | ${formatInteger(report.coverage.adjudicationMeasuredCaseCount)} |`,
      `| — of those, fully adjudicated | ${formatInteger(report.coverage.adjudicationExhaustiveCaseCount)} |`,
      `| pairs no adjudicator settled | ${formatInteger(report.coverage.unadjudicatedPairCount)} |`,
      `| cases bound by the adjudication call cap | ${formatInteger(report.coverage.adjudicationCallsTruncatedCaseCount)} |`,
      // DID THE JUDGE RUN. Every row below answers that, and it is in the
      // coverage table rather than beside a rate because it decides whether any
      // adjudication figure in this document is about a model at all.
      `| **model calls spent** | ${formatInteger(report.coverage.adjudicationCallCount)} |`,
      `| — adjudicated cases in which the model was NEVER called | ${formatInteger(report.coverage.noAdjudicationCallCaseCount)} |`,
      `| — verdict \`relies\` | ${formatInteger(report.coverage.modelVerdictCounts.relies)} |`,
      `| — verdict \`does-not-rely\` | ${formatInteger(report.coverage.modelVerdictCounts['does-not-rely'])} |`,
      `| — verdict \`undetermined\` | ${formatInteger(report.coverage.modelVerdictCounts.undetermined)} |`,
      `| pairs the deterministic tier settled with no call | ${formatInteger(report.coverage.deterministicNoImpactPairCount)} |`,
      `| expected dependents (corpus) | ${formatInteger(report.coverage.totalExpectedCount)} |`,
      `| expected dependents scored | ${formatInteger(report.coverage.scoredExpectedCount)} |`
    ]
  })

  appendArm(lines, {
    heading: '## Arm 1 — deterministic reference list',
    preamble: [
      'Every destination file dependent discovery enumerates, with no adjudication. **This is the baseline the capability must beat**: spec 22 removes the capability if it "cannot beat naming the changed symbols and letting the human grep".'
    ],
    arm: report.arms.reference
  })

  appendArm(lines, {
    heading: '## Arm 2 — after adjudication',
    preamble: [
      'The files adjudication actually reports. Spec 22 records that adjudication is EXPECTED to reduce recall relative to the reference list, and that this is the intended trade — "a run that loses no recall has almost certainly adjudicated nothing".',
      ...(report.coverage.noAdjudicationCallCaseCount === 0
        ? []
        : [
            `**${formatInteger(report.coverage.noAdjudicationCallCaseCount)} of ${formatInteger(report.coverage.adjudicationMeasuredCaseCount)} adjudicated case(s) spent NO model call.** For those cases this arm is the deterministic tier's output alone, and nothing about them may be read as the judge's behaviour.`
          ]),
      ...(report.coverage.unadjudicatedPairCount === 0
        ? []
        : [
            `**${formatInteger(report.coverage.unadjudicatedPairCount)} pair(s) were never adjudicated** — a failed call, an undecided answer, or the \`changeImpact.adjudication.maxCalls\` cap. In those cases a dependent that is not reported is counted as UNDETERMINED rather than as a miss, because absence from the finding list is not a statement that a dependent is unaffected.`
          ])
    ],
    arm: report.arms.adjudicated
  })

  lines.push('## Arm 3 — what adjudication removed, by tier')
  lines.push('')

  if (report.adjudicationDelta.status === 'not-measured') {
    lines.push(
      `Not measured: ${escapeMarkdownCell(report.adjudicationDelta.reason)}`
    )
    lines.push('')
  } else {
    const delta = report.adjudicationDelta

    lines.push(
      '**Adjudication is two tiers, and this arm is split between them because pooling them once produced a result that was read backwards.** Spec 22 records it: a run reported as "15 reference files in, 0 out, 3 provably wrong removals" had called the model ZERO times — every removal was the deterministic tier settling an empty contract delta in code. There is no combined total below, on purpose.'
    )
    lines.push('')
    appendDeltaGroup(lines, {
      heading: '### Deterministic tier only — the model was never called',
      preamble:
        'Fully adjudicated cases that spent NO model call. Every removal below was made in code, and **nothing here is evidence about the judge** — not a rejection, not a false rejection, not a precision figure for the model tier. These cases are labelled rather than dropped: their removals are real, and the corpus can still prove some of them wrong.',
      emptyStatement:
        'No fully adjudicated case ran without calling the model, so there is no deterministic-only delta to read.',
      group: delta.deterministicTierOnly
    })
    appendDeltaGroup(lines, {
      heading: '### Model involved — at least one call was spent',
      preamble:
        'Fully adjudicated cases in which the model was called at least once. Their removals are a MIXTURE of both tiers: the report is file-granular and a file can be settled by either tier, so no attribution finer than the case is available and none is invented here.',
      emptyStatement:
        '**No fully adjudicated case spent a single model call.** The adjudicated arm above therefore says nothing about the model tier, and no figure in this document may be quoted as one.',
      group: delta.modelInvolved
    })
    lines.push(
      '**There is no "correct removals" count, and there cannot be one.** A removal is provably wrong when it drops a dependent upstream had to repair. A removal of a file absent from the answer key might have been noise or might have been a dependent nobody listed — this corpus cannot tell, so it is never credited.'
    )
    lines.push('')
  }

  lines.push('## Decision-rule denominator')
  lines.push('')
  lines.push(
    `Of the proven dependents the reference list itself contains, how many survive adjudication: **${escapeMarkdownCell(
      formatRecall(report.adjudicatedRecallWithinReferenceList)
    )}**. Spec 22's pre-registered rule reads recall against this denominator, because adjudication cannot report a file discovery never found.`
  )
  lines.push('')

  appendMarkdownTable(lines, {
    heading: '## Per case',
    header: '| case | split | status | model calls | reference files | adjudicated files | expected found (ref / adj) |',
    alignment: '| --- | --- | --- | --- | ---: | ---: | --- |',
    rows: report.caseResults.map((result) => {
      if (result.status === 'unmeasured') {
        return `| ${escapeMarkdownCell(result.caseId)} | ${result.split} | unmeasured: ${escapeMarkdownCell(result.reason)} | - | - | - | ${formatInteger(result.expectedImpactCount)} expected, none scored |`
      }

      const inReference = result.expectations.filter(
        (expectation) => expectation.inReferenceList
      ).length
      const adjudicatedFound = result.adjudicationMeasured
        ? `${formatInteger(result.expectations.filter((expectation) => expectation.inAdjudicatedList === true).length)}/${formatInteger(result.expectations.length)}`
        : 'not measured'

      return `| ${escapeMarkdownCell(result.caseId)} | ${result.split} | scored (${escapeMarkdownCell(result.adjudicationStatus)}) | ${caseCallCell(result)} | ${formatInteger(result.referenceFileCount)} | ${
        result.adjudicatedFileCount === undefined
          ? 'not measured'
          : formatInteger(result.adjudicatedFileCount)
      } | ${formatInteger(inReference)}/${formatInteger(result.expectations.length)} / ${adjudicatedFound} |`
    })
  })

  appendMarkdownBulletSection(lines, {
    heading: '## Warnings',
    rows: report.warnings.map((warning) => `- ${escapeMarkdownCell(warning)}`)
  })

  lines.push('## What this cannot tell you')
  lines.push('')
  lines.push(
    '- **Precision.** Eleven proven dependents across ten changes is not an enumeration of everything each change broke, so a predicted file absent from the answer key is not thereby wrong. Only the lower bound is computable.'
  )
  lines.push(
    '- **`breaks-on-build`.** Every accepted case is `breaks-at-runtime`; the corpus contains no build-breaking case to score.'
  )
  lines.push(
    '- **Anything, on its own.** Spec 22 binds that a single run decides nothing, and eleven dependents make that bind harder, not softer.'
  )
  lines.push('')

  return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd()}\n`
}
