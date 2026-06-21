import type { ReviewReport } from '../../shared/contracts/index.js'
import {
  safeText,
  sortAdmittedFindings,
  validateReviewReport
} from './reporting-utils.js'

const countBy = <T extends string>(
  values: readonly T[]
): Readonly<Record<string, number>> =>
  values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1

    return counts
  }, {})

const renderCounts = (title: string, counts: Readonly<Record<string, number>>): string =>
  [`## ${title}`, '', ...Object.entries(counts).map(([key, value]) => `- ${safeText(key)}: ${value}`), ''].join('\n')

export const renderMarkdownReport = (input: unknown): string => {
  const report: ReviewReport = validateReviewReport(input)
  const admittedFindings = sortAdmittedFindings(report.admittedFindings)
  const severityCounts = countBy(admittedFindings.map((finding) => finding.severity))
  const categoryCounts = countBy(admittedFindings.map((finding) => finding.category))
  const lines: string[] = [
    '# Review Report',
    '',
    `Run: ${safeText(report.run.runId)}`,
    `Mode: ${safeText(report.run.mode)}`,
    `Depth: ${safeText(report.run.depth)}`,
    `Duration: ${report.run.durationMs} ms`,
    ''
  ]

  if (report.qualityGate !== undefined) {
    lines.push('## Quality Gate', '')
    lines.push(`Passed: ${report.qualityGate.passed ? 'yes' : 'no'}`)
    lines.push(`Failing findings: ${report.qualityGate.failingFindingIds.length}`)
    lines.push('')
  }

  lines.push('## Coverage', '')
  lines.push(`Status: ${safeText(report.coverage.status)}`)
  lines.push(
    `Files: ${report.coverage.coveredFileCount}/${report.coverage.reviewableFileCount}`
  )
  lines.push(
    `Bytes: ${report.coverage.coveredBytes}/${report.coverage.reviewableBytes}`
  )
  if (report.coverage.incompleteReasons.length > 0) {
    lines.push('')
    for (const reason of report.coverage.incompleteReasons) {
      lines.push(`- ${safeText(reason)}`)
    }
  }
  lines.push('')

  lines.push(renderCounts('Severity Counts', severityCounts))
  lines.push(renderCounts('Category Counts', categoryCounts))
  lines.push('## Admitted Findings', '')

  for (const finding of admittedFindings) {
    const fixProposalLines =
      finding.fixProposal === undefined
        ? []
        : [
            `- Suggested fix: ${safeText(finding.fixProposal.summary)}`,
            `- Fix evidence: ${finding.fixProposal.evidenceIds.map(safeText).join(', ')}`,
            ...(finding.fixProposal.edits === undefined ||
            finding.fixProposal.edits.length === 0
              ? []
              : [
                  '- Fix edits:',
                  ...finding.fixProposal.edits.map((edit) => {
                    const description =
                      edit.description === undefined
                        ? ''
                        : ` - ${safeText(edit.description)}`

                    return `  - ${safeText(edit.path)}:${edit.startLine}-${edit.endLine}: ${safeText(edit.replacement)}${description}`
                  })
                ])
          ]

    lines.push(
      `### ${safeText(finding.severity.toUpperCase())}: ${safeText(finding.title)}`,
      '',
      `- ID: ${safeText(finding.id)}`,
      `- Category: ${safeText(finding.category)}`,
      `- Location: ${safeText(finding.location.path)}:${finding.location.startLine}`,
      `- Baseline: ${safeText(finding.baselineStatus)}`,
      ...fixProposalLines,
      '',
      safeText(finding.description),
      ''
    )
  }

  lines.push('## Rejected Candidates', '')

  for (const rejected of report.rejectedFindings) {
    lines.push(
      `- ${safeText(rejected.candidateId)}: ${safeText(rejected.reason)} (${safeText(rejected.status)})`
    )
  }

  lines.push('', '## Skipped Files', '')

  for (const skipped of report.skippedFiles) {
    lines.push(`- ${safeText(skipped.path)}: ${safeText(skipped.reason)}`)
  }

  lines.push('', '## Cost And Timing', '')
  lines.push(`- Duration: ${report.run.durationMs} ms`)

  if (report.run.costUsd !== undefined) {
    lines.push(`- Cost: ${report.run.costUsd}`)
  }

  return `${lines.join('\n')}\n`
}
