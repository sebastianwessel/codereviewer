import { appendMarkdownTable, formatPercent } from './eval-report-markdown-formatting.js'
import {
  BLENDED_POPULATION,
  PAIRED_SIGNIFICANCE_ALPHA,
  SCOPE_DIVERGENT_POPULATION,
  SCOPE_NOT_RECORDED_POPULATION,
  type PairedArmSummary,
  type PairedPopulationVerdict,
  type PairedRecallVerdict
} from './eval-paired-recall-verdict.js'
import { PAIRED_SIGNIFICANCE_TEST } from './eval-significance.js'

// THE HEADLINE VERDICT, rendered before the run-level metric deltas so it is
// read first. Run-level mean and spread stay in the report as context; they are
// not the decision rule for a recall difference, because an sd estimated from
// three seeds cannot resolve the differences this project actually measures.
//
// Every population is rendered with its own counts, its own test and its own
// interpretation, and the test is named and its assumptions stated in the output
// so a reader can CHECK the verdict rather than trust it.

const formatSignedPercentagePoints = (value: number): string =>
  `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}pp`

const populationHeading = (population: PairedPopulationVerdict): string => {
  if (population.id === BLENDED_POPULATION) {
    return 'Blended (every population at once)'
  }

  if (population.id === SCOPE_NOT_RECORDED_POPULATION) {
    return 'Diff scope not recorded'
  }

  if (population.id === SCOPE_DIVERGENT_POPULATION) {
    return 'Diff scope recorded differently by the two arms'
  }

  return population.headline ? `${population.id} (headline)` : population.id
}

const populationPreamble = (
  population: PairedPopulationVerdict
): string | undefined => {
  if (population.id === BLENDED_POPULATION) {
    return 'NOT the verdict. This pools populations whose behaviour differs structurally, so it moves with the fixture set’s population mix as much as with reviewer quality. It is reported for continuity with older figures and must not be read as a result on its own.'
  }

  if (population.id === SCOPE_NOT_RECORDED_POPULATION) {
    return 'Neither arm recorded a diff scope for these expectations, so they cannot be placed in either population. They are adjudicated on their own rather than folded into one, which would attribute them to a population nobody measured them in.'
  }

  if (population.id === SCOPE_DIVERGENT_POPULATION) {
    return 'The two arms recorded DIFFERENT diff scopes for these expectations. Diff scope is a property of the expectation, so this means the arms were derived against different diffs; these expectations are adjudicated separately and their result is not evidence about either population.'
  }

  return undefined
}

const verdictSentence = (population: PairedPopulationVerdict): string => {
  const { comparison } = population

  if (population.finding === 'no-expectations') {
    return 'No verdict: this population holds no paired expectation, so there is nothing to adjudicate. This is not a null result.'
  }

  if (population.finding === 'hard-zero-in-both-arms') {
    return `No verdict: all ${comparison.expectationCount} paired expectations were missed by every run in BOTH arms. This population is a hard zero on both sides, so it holds no discordant pair, no test is defined over it, and it cannot dilute any other population’s verdict.`
  }

  if (population.finding === 'no-discordant-pairs') {
    return `No verdict: head and base agreed on all ${comparison.expectationCount} paired expectations. With no discordant pair the test is undefined, which is not the same as a measured absence of difference.`
  }

  const counts = `${comparison.gained.length} gained against ${comparison.lost.length} lost, p = ${comparison.pValue?.toFixed(4) ?? 'undefined'}`

  return population.significant
    ? `Verdict: recall ${population.direction} and the paired test clears p < ${PAIRED_SIGNIFICANCE_ALPHA} (${counts}). This is a difference the instrument can see.`
    : `Verdict: recall ${population.direction} but the paired test does NOT clear p < ${PAIRED_SIGNIFICANCE_ALPHA} (${counts}). The difference is not distinguishable from run-to-run variation.`
}

const formatPValue = (population: PairedPopulationVerdict): string => {
  const { pValue, pValueMethod } = population.comparison

  return pValue === undefined || pValueMethod === undefined
    ? 'undefined (no discordant expectation)'
    : `${pValue.toFixed(4)} (${pValueMethod})`
}

const armSummaryLine = (label: string, arm: PairedArmSummary): string =>
  `${label} arm: ${arm.runCount} ${arm.runCount === 1 ? 'run' : 'runs'} — ${arm.runLabels.join(', ')}`

const appendPopulation = (
  lines: string[],
  population: PairedPopulationVerdict
): void => {
  lines.push(`### ${populationHeading(population)}`)
  lines.push('')

  const preamble = populationPreamble(population)

  if (preamble !== undefined) {
    lines.push(preamble)
    lines.push('')
  }

  lines.push(verdictSentence(population))
  lines.push('')

  const { comparison } = population

  if (comparison.unpairedExpectations.length > 0) {
    lines.push(
      `Warning: ${comparison.unpairedExpectations.length} expectation(s) in this population were scored by only one arm and are excluded from the pairing.`
    )
    lines.push('')
  }

  if (comparison.expectationCount === 0) {
    return
  }

  appendMarkdownTable(lines, {
    header: '| Measure | Value |',
    alignment: '| --- | ---: |',
    rows: [
      `| Paired expectations | ${comparison.expectationCount} |`,
      `| Base recall (paired) | ${formatPercent(comparison.baseRecall)} |`,
      `| Head recall (paired) | ${formatPercent(comparison.headRecall)} |`,
      `| Delta | ${formatSignedPercentagePoints(comparison.delta)} |`,
      `| Gained (head only) | ${comparison.gained.length} |`,
      `| Lost (base only) | ${comparison.lost.length} |`,
      `| Unchanged | ${comparison.concordant} |`,
      `| Discordant pairs | ${comparison.discordantCount} |`,
      `| Found by every run in both arms | ${comparison.alwaysFound} |`,
      `| Missed by every run in both arms | ${comparison.neverFound} |`,
      `| p (two-sided) | ${formatPValue(population)} |`,
      `| 95% CI (paired bootstrap) | ${formatSignedPercentagePoints(
        comparison.ci95[0]
      )} to ${formatSignedPercentagePoints(comparison.ci95[1])} |`
    ]
  })
}

// Stated in the rendered output, not only in the source, because a verdict a
// reader cannot check is a verdict they have to trust.
const METHOD_LINES: readonly string[] = [
  `Test: ${PAIRED_SIGNIFICANCE_TEST} over the discordant expectations (McNemar’s exact test). Assumptions, stated so they can be checked:`,
  '',
  '1. The unit is ONE expectation (`caseId#expectedIndex`), counted once per arm, so the observations are independent. An arm of several runs contributes the fraction of its runs that matched the expectation — never one observation per run pair, which would count the same expectation repeatedly.',
  '2. Under the null a discordant expectation is equally likely to have been gained as lost, so the discordant count is Binomial(n, 0.5). The p is exact, not a normal approximation, because the discordant counts on this corpus are small enough for the two to disagree across the threshold.',
  '3. Concordant expectations carry no information about the difference and are excluded by the test’s construction, not discarded by choice. They are still reported below.',
  '4. Populations are adjudicated SEPARATELY by diff scope. The corpus holds populations with structurally different behaviour, and a blended figure reports their mix as much as it reports the reviewer.',
  '5. The 95% interval is a seeded paired bootstrap over expectations within the population; it describes which expectations are in the corpus, not how many runs were spent.'
]

export const appendEvalComparisonPairedRecall = (
  lines: string[],
  verdict: PairedRecallVerdict
): void => {
  lines.push('## Paired Recall Verdict (primary)')
  lines.push('')

  if (verdict.status === 'unavailable') {
    lines.push(`No paired verdict: ${verdict.reason}.`)
    lines.push('')
    return
  }

  lines.push(armSummaryLine('Base', verdict.base))
  lines.push(armSummaryLine('Head', verdict.head))
  lines.push('')
  lines.push(...METHOD_LINES)
  lines.push('')

  for (const population of verdict.populations) {
    appendPopulation(lines, population)
  }

  appendPopulation(lines, verdict.blended)
}
