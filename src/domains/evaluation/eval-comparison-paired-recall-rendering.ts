import { appendMarkdownTable, formatPercent } from './eval-report-markdown-formatting.js'
import {
  PAIRED_SIGNIFICANCE_ALPHA,
  type PairedRecallVerdict
} from './eval-paired-recall-verdict.js'

// THE HEADLINE VERDICT, rendered before the run-level metric deltas so it is
// read first. Run-level mean and spread stay in the report as context; they are
// not the decision rule for a recall difference, because an sd estimated from
// three seeds cannot resolve the differences this project actually measures.

const formatPValue = (pValue: number | undefined): string =>
  pValue === undefined ? 'undefined (no discordant expectation)' : pValue.toFixed(4)

const formatSignedPercentagePoints = (value: number): string =>
  `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}pp`

const verdictSentence = (verdict: PairedRecallVerdict): string => {
  if (verdict.status === 'unavailable') {
    return `No paired verdict: ${verdict.reason}.`
  }

  const { comparison } = verdict

  if (verdict.direction === 'unchanged') {
    return `Verdict: no recall difference. Head and base matched exactly the same ${comparison.expectationCount} paired expectations.`
  }

  return verdict.significant
    ? `Verdict: recall ${verdict.direction} and the paired test clears p < ${PAIRED_SIGNIFICANCE_ALPHA} (${comparison.gained.length} gained against ${comparison.lost.length} lost). This is a difference the instrument can see.`
    : `Verdict: recall ${verdict.direction} but the paired test does NOT clear p < ${PAIRED_SIGNIFICANCE_ALPHA} (${comparison.gained.length} gained against ${comparison.lost.length} lost). The difference is not distinguishable from run-to-run variation.`
}

export const appendEvalComparisonPairedRecall = (
  lines: string[],
  verdict: PairedRecallVerdict
): void => {
  lines.push('## Paired Recall Verdict (primary)')
  lines.push('')
  lines.push(
    'Both reports scored the SAME expectations, so recall is adjudicated per expectation (McNemar over the discordant pairs), not by differencing run means. Run-level deltas below are context.'
  )
  lines.push('')
  lines.push(verdictSentence(verdict))
  lines.push('')

  if (verdict.status === 'unavailable') {
    return
  }

  const { comparison } = verdict

  if (comparison.unpairedExpectations.length > 0) {
    lines.push(
      `Warning: ${comparison.unpairedExpectations.length} expectation(s) were scored by only one report and are excluded from the pairing.`
    )
    lines.push('')
  }

  appendMarkdownTable(lines, {
    heading: '### Paired Recall Detail',
    header: '| Measure | Value |',
    alignment: '| --- | ---: |',
    rows: [
      `| Paired expectations | ${comparison.expectationCount} |`,
      `| Base recall (paired) | ${formatPercent(comparison.baseRecall)} |`,
      `| Head recall (paired) | ${formatPercent(comparison.headRecall)} |`,
      `| Delta | ${formatSignedPercentagePoints(comparison.delta)} |`,
      `| Gained (head only) | ${comparison.gained.length} |`,
      `| Lost (base only) | ${comparison.lost.length} |`,
      `| Discordant pairs | ${comparison.discordantCount} |`,
      `| Found by both | ${comparison.alwaysFound} |`,
      `| Missed by both | ${comparison.neverFound} |`,
      `| McNemar p (two-sided) | ${formatPValue(comparison.pValue)} |`,
      `| 95% CI (paired bootstrap) | ${formatSignedPercentagePoints(
        comparison.ci95[0]
      )} to ${formatSignedPercentagePoints(comparison.ci95[1])} |`
    ]
  })
}
