import {
  SecurityContextDepthSchema,
  SecurityMechanismSchema
} from '../../corpus/eval-fixture.schema.js'
import { appendMarkdownTable, formatPercent } from '../eval-report-markdown-formatting.js'
import type { EvalReport } from '../../report/eval-report-contracts.js'

// Security by mechanism / context depth (spec 15).
//
// A row is rendered only for a mechanism with expected findings, so a mechanism
// nothing expects is ABSENT rather than reported as 0% over an empty
// denominator — a row that reads as a measured failure when nothing was
// measured. Matched/expected travels with every rate for the same reason.
//
// Adjusted precision is rendered where it is bounded and `n/a` where it is not,
// and the note below the table says which case a reader is looking at. It is not
// silently omitted: the whole point of attributing admitted findings to
// mechanisms was to make the missing denominator visible.
// A security recall cell. Null means the corpus expected nothing of this mechanism
// or depth, and it renders as `n/a` — the same word the adjusted-precision column
// beside it already uses for its own null.
//
// Both tables skip a row whose `expected` is 0, so today this cannot receive a
// null: `rateOrNull` returns a number exactly when the denominator is non-empty.
// The previous `?? 0` was therefore unreachable rather than wrong — and that is
// the reason to remove it. It silently turns "not measured" into a measured 0 the
// moment either invariant moves, which is precisely the defect these rates were
// made nullable to end.
const formatSecurityRecall = (rate: number | null | undefined): string =>
  rate === null || rate === undefined ? 'n/a' : formatPercent(rate)

export const appendEvalSummarySecurityByMechanism = (
  lines: string[],
  report: EvalReport
): void => {
  const attribution = report.metrics.securityMechanismAttributionCounts
  const rows = SecurityMechanismSchema.options.flatMap((mechanism) => {
    const counts = report.metrics.securityMechanismCounts[mechanism]
    if (counts === undefined || counts.expected === 0) {
      return []
    }

    const findingCounts =
      report.metrics.securityFindingMechanismCounts[mechanism]
    const adjustedPrecision =
      report.metrics.securityAdjustedPrecisionByMechanism[mechanism]

    return [
      `| ${mechanism} | ${formatSecurityRecall(report.metrics.securityRecallByMechanism[mechanism])} | ${counts.matched}/${counts.expected} | ${
        adjustedPrecision === null || adjustedPrecision === undefined
          ? 'n/a'
          : formatPercent(adjustedPrecision)
      } | ${findingCounts?.matched ?? 0}/${
        (findingCounts?.matched ?? 0) + (findingCounts?.genuineFalsePositive ?? 0)
      } |`
    ]
  })

  if (rows.length === 0) {
    return
  }

  appendMarkdownTable(lines, {
    heading: '## Security by Mechanism',
    header:
      '| Mechanism | Recall | Matched/Expected | Adjusted precision | Matched/Precision denominator |',
    alignment: '| --- | ---: | ---: | ---: | ---: |',
    rows
  })

  lines.push(
    attribution.unknown > 0
      ? `Adjusted precision is \`n/a\` for every mechanism: ${attribution.unknown} genuine security false positive(s) in this run could not be attributed to one. An unattributed false positive could belong to any mechanism, so it bounds all of them, and publishing the ratio without it would report a precision no evidence supports. Mechanism labels came from ${attribution.expectation} matched expectation(s) and ${attribution.cwe} CWE-tagged finding(s).`
      : `Mechanism labels came from ${attribution.expectation} matched expectation(s) and ${attribution.cwe} CWE-tagged finding(s); no genuine security false positive was left unattributed.`,
    ''
  )
}

export const appendEvalSummarySecurityByContextDepth = (
  lines: string[],
  report: EvalReport
): void => {
  appendMarkdownTable(lines, {
    heading: '## Security by Context Depth',
    header: '| Context depth | Recall | Matched/Expected |',
    alignment: '| --- | ---: | ---: |',
    rows: SecurityContextDepthSchema.options.flatMap((depth) => {
      const counts = report.metrics.securityContextDepthCounts[depth]
      if (counts === undefined || counts.expected === 0) {
        return []
      }

      return [
        `| ${depth} | ${formatSecurityRecall(report.metrics.securityRecallByContextDepth[depth])} | ${counts.matched}/${counts.expected} |`
      ]
    })
  })
}
