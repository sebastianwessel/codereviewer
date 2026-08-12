// The rendered intent-fulfilment evaluation summary.
//
// The document is arranged around spec 23's ordering rather than around the
// scorer's data structures: the false-satisfied claims come first because that is
// the metric the decision rule is stated on, recall comes second because a
// capability that misses obligations is merely incomplete, and everything that
// makes those two unreadable comes before both.
//
// Three rendering rules are load-bearing rather than cosmetic:
//
//  - a not-measured cell says WHY and never prints a percentage. `0.0%` here means
//    the run looked and got it wrong, never that nothing was counted.
//  - the false-satisfied rate is printed with its denominator NAMED, because the
//    denominator is not the one spec 23 defines and a bare percentage would be
//    quoted as if it were.
//  - the two arms are printed in separate tables with no total between them.

import {
  appendMarkdownBulletSection,
  appendMarkdownTable,
  escapeMarkdownCell,
  formatInteger,
  formatPercent
} from '../rendering/eval-report-markdown-formatting.js'
import type { IntentEvalReport } from './intent-eval-report.js'
import type { IntentArmMetrics, IntentRate } from './intent-eval-scoring.js'

const formatRate = (value: IntentRate): string =>
  value.status === 'not-measured'
    ? `not measured (${escapeMarkdownCell(value.reason)})`
    : `${formatPercent(value.rate)} (${formatInteger(value.matched)}/${formatInteger(value.total)})`

const armLabels: readonly (readonly ['prewritten' | 'posthoc', string])[] = [
  [
    'prewritten',
    'Pre-written — the intent is a specification section that existed before the change'
  ],
  [
    'posthoc',
    'Post-hoc control — the same diffs judged against their own commit message'
  ]
]

const appendArm = (
  lines: string[],
  input: { readonly heading: string; readonly arm: IntentArmMetrics }
): void => {
  lines.push(input.heading)
  lines.push('')

  if (input.arm.scoredCaseCount === 0) {
    lines.push(
      'No case in this arm was scored, so every figure below would be over an empty denominator and none is printed.'
    )
    lines.push('')

    return
  }

  appendMarkdownTable(lines, {
    heading: '',
    header: '| metric | value |',
    alignment: '| --- | --- |',
    rows: [
      `| cases scored | ${formatInteger(input.arm.scoredCaseCount)} |`,
      `| enumerated outstanding obligations | ${formatInteger(input.arm.expectationCount)} |`,
      `| **false-satisfied claims** | **${formatInteger(input.arm.falseSatisfied.claimCount)}** (via evidenced ${formatInteger(input.arm.falseSatisfied.viaEvidenced)}, via not-contradicted ${formatInteger(input.arm.falseSatisfied.viaNotContradicted)}) |`,
      `| ...as a share of the outstanding obligations the run REACHED | ${formatRate(input.arm.falseSatisfied.rateOverReached)} |`,
      `| ...as spec 23 defines the rate | ${formatRate(input.arm.falseSatisfied.rateOverAllSatisfiedClaims)} |`,
      `| outstanding recall (left on the list a human reads) | ${formatRate(input.arm.outstandingRecall)} |`,
      `| obligations reported | ${formatInteger(input.arm.obligationCount)} |`,
      `| ...anchored to an answer-key clause, and therefore scored | ${formatInteger(input.arm.anchoredObligationCount)} |`,
      `| ...unanchored, and therefore UNSCORED | ${formatInteger(input.arm.unanchoredObligationCount)} |`,
      `| not-contradicted verdicts | ${formatInteger(input.arm.notContradictedCount)} of ${formatInteger(input.arm.obligationCount)} reported |`,
      `| ...clearing an obligation this corpus calls outstanding | ${formatInteger(input.arm.notContradictedClearingOutstandingCount)} |`,
      `| obligations a human read in these excerpts | ${formatInteger(input.arm.humanObligationCount)} |`
    ]
  })
}

export const renderIntentEvalSummary = (report: IntentEvalReport): string => {
  const lines: string[] = []

  lines.push('# Intent-fulfilment evaluation')
  lines.push('')
  lines.push(
    `Dataset \`${escapeMarkdownCell(report.datasetId)}\`, engine \`${escapeMarkdownCell(report.engine.commit)}\`, metrics \`${escapeMarkdownCell(report.metricsVersion)}\`, generated ${escapeMarkdownCell(report.generatedAt)}.`
  )
  lines.push(
    `Model: ${
      report.provenance.modelName === undefined
        ? '**unrecorded** — a rate is a property of a model, and one that cannot name its model may not be published'
        : `\`${escapeMarkdownCell(report.provenance.providerId ?? 'unknown')}/${escapeMarkdownCell(report.provenance.modelName)}\``
    }.`
  )
  lines.push('')
  lines.push(
    '**What this measures, and in which order.** Spec 23 fixes its decision rule before any measurement: *ship only if the false-satisfied rate is low. A capability that misses unaddressed obligations is merely incomplete; one that wrongly certifies them is harmful, and no amount of recall compensates.* So the claim count leads every table below, and a wrong `not-contradicted` is counted in it on the same footing as a wrong `evidenced` — the pre-registration says so in as many words.'
  )
  lines.push('')

  appendMarkdownTable(lines, {
    heading: '## Coverage',
    header: '| | cases | outstanding obligations |',
    alignment: '| --- | ---: | ---: |',
    rows: [
      `| selected | ${formatInteger(report.coverage.totalCaseCount)} | ${formatInteger(report.coverage.totalExpectationCount)} |`,
      `| scored | ${formatInteger(report.coverage.scoredCaseCount)} | ${formatInteger(report.coverage.scoredExpectationCount)} |`,
      `| refused (the engine declined — an input limit bound) | ${formatInteger(report.coverage.refusedCaseCount)} | - |`,
      `| unmeasured (not hydrated, stale, or the run broke) | ${formatInteger(report.coverage.unmeasuredCaseCount)} | - |`
    ]
  })

  lines.push(
    'A refused case is **not** a case with zero obligations. Spec 23 requires every input limit to refuse rather than truncate, so exit 4 is the engine answering correctly; counting it as a scored zero would drag every rate down while looking like a result.'
  )
  lines.push('')

  for (const [arm, label] of armLabels) {
    appendArm(lines, { heading: `## ${label}`, arm: report.arms[arm] })
  }

  lines.push(
    '**The two arms are never pooled and there is no total between them.** A commit message is written after the work, so obligations read out of one are addressed by construction; a specification section approved before the implementation existed is the question this corpus was built to ask.'
  )
  lines.push('')

  const falseSatisfiedRows = report.caseResults.flatMap((result) =>
    result.status === 'scored'
      ? result.expectations.filter(
          (expectation) => expectation.outcome === 'false-satisfied'
        )
      : []
  )

  appendMarkdownTable(lines, {
    heading: '## Every false-satisfied claim, named',
    header: '| case | arm | obligation the corpus calls outstanding | cleared by |',
    alignment: '| --- | --- | --- | --- |',
    rows:
      falseSatisfiedRows.length === 0
        ? [
            '| - | - | *No enumerated outstanding obligation was reported off the list.* | - |'
          ]
        : falseSatisfiedRows.map(
            (expectation) =>
              `| ${escapeMarkdownCell(expectation.caseId)} | ${expectation.arm} | ${escapeMarkdownCell(expectation.statement)} | ${escapeMarkdownCell(expectation.clearedBy.join(', '))} |`
          )
  })

  lines.push(
    'These are listed individually rather than counted, because the count is the number the capability is judged on and a reader has to be able to check each one against the diff.'
  )
  lines.push('')

  appendMarkdownTable(lines, {
    heading: '## Per case',
    header: '| case | arm | status | obligations | anchored | outstanding: reported / cleared / missed |',
    alignment: '| --- | --- | --- | ---: | ---: | --- |',
    rows: report.caseResults.map((result) => {
      if (result.status === 'refused') {
        return `| ${escapeMarkdownCell(result.caseId)} | ${result.arm} | refused (${escapeMarkdownCell(result.code)}) | - | - | ${formatInteger(result.expectationCount)} expected, none scored |`
      }

      if (result.status === 'unmeasured') {
        return `| ${escapeMarkdownCell(result.caseId)} | ${result.arm} | unmeasured: ${escapeMarkdownCell(result.reason)} | - | - | ${formatInteger(result.expectationCount)} expected, none scored |`
      }

      const counts = {
        'reported-outstanding': 0,
        'false-satisfied': 0,
        'not-reported': 0
      }

      for (const expectation of result.expectations) {
        counts[expectation.outcome] += 1
      }

      return `| ${escapeMarkdownCell(result.caseId)} | ${result.arm} | scored | ${formatInteger(result.obligationCount)} | ${formatInteger(result.anchoredObligationCount)} | ${formatInteger(counts['reported-outstanding'])} / ${formatInteger(counts['false-satisfied'])} / ${formatInteger(counts['not-reported'])} |`
    })
  })

  appendMarkdownBulletSection(lines, {
    heading: '## Warnings',
    rows: report.warnings.map((warning) => `- ${escapeMarkdownCell(warning)}`)
  })

  lines.push('## What this cannot tell you')
  lines.push('')
  lines.push(
    "- **The false-satisfied RATE as spec 23 defines it.** Its denominator is every obligation reported `evidenced` or `not-contradicted`, and this corpus holds a truth only for the obligations a human enumerated as outstanding. The claim COUNT is exactly spec 23's numerator; the share printed beside it has a different denominator and is labelled with it."
  )
  lines.push(
    '- **Obligation-extraction fidelity.** Spec 23 asks whether the extracted obligations match what a human reads in the intent. Answering that means comparing statements by hand, once per run, against a non-deterministic obligation set. The human obligation count is printed beside the reported count so the two are visible; the comparison is not made here and no figure pretends to it.'
  )
  lines.push(
    '- **Whether an unanchored obligation is right or wrong.** The answer key enumerates what a human found outstanding, not a truth for every clause. An obligation citing a clause no expectation anchors is unscored, and the count of those is printed beside every rate for exactly that reason.'
  )
  lines.push(
    '- **Anything, from one run.** Extraction is non-deterministic and a case configured at its obligation limit refuses in one round and scores in the next, which moves the denominator between rounds on its own.'
  )
  lines.push('')

  return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd()}\n`
}
