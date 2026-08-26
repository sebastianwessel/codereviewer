import { allDiffScopes } from '../../scoring/eval-diff-scope.js'
import { appendMarkdownTable, formatPercent } from '../eval-report-markdown-formatting.js'
import type { EvalReport } from '../../report/eval-report-contracts.js'
import { formatDiffScopeRecall } from './eval-summary-headline-metrics-rendering.js'

const tierDisplayOrder = [
  'runtime-critical',
  'security',
  'logic',
  'nit'
] as const

export const appendEvalSummaryRecallByTier = (
  lines: string[],
  report: EvalReport
): void => {
  appendMarkdownTable(lines, {
    heading: '## Recall by Tier',
    header: '| Tier | Recall |',
    alignment: '| --- | ---: |',
    rows: tierDisplayOrder.map(
      (tier) => `| ${tier} | ${formatPercent(report.metrics.recallByTier[tier])} |`
    )
  })
}

// Recall by diff scope (spec 17). Every scope with expectations is rendered,
// including `undetermined`: an expectation the hunk-span rule could not place is
// a hole in the classification, and hiding it would let a report look complete
// while part of its answer key sat outside both populations.
export const appendEvalSummaryRecallByDiffScope = (
  lines: string[],
  report: EvalReport
): void => {
  appendMarkdownTable(lines, {
    heading: '## Recall by Diff Scope',
    header: '| Diff scope | Recall | Matched/Expected |',
    alignment: '| --- | ---: | ---: |',
    rows: allDiffScopes.flatMap((scope) => {
      const counts = report.metrics.diffScopeCounts[scope]
      if (counts === undefined || counts.expected === 0) {
        return []
      }

      return [
        `| ${scope} | ${formatDiffScopeRecall(report.metrics, scope)} | ${counts.matched}/${counts.expected} |`
      ]
    })
  })
}
