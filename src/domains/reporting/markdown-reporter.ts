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

const renderEvidenceIds = (evidenceIds: readonly string[]): string =>
  evidenceIds.length === 0
    ? 'none cited'
    : evidenceIds.map(safeText).join(', ')

export const renderMarkdownReport = (input: unknown): string => {
  const report: ReviewReport = validateReviewReport(input)
  const admittedFindings = sortAdmittedFindings(report.admittedFindings)
  const actionableFindings = admittedFindings.filter(
    (finding) => finding.reporterEligibility !== 'artifact-only'
  )
  const artifactOnlyFindings = admittedFindings.filter(
    (finding) => finding.reporterEligibility === 'artifact-only'
  )
  const severityCounts = countBy(actionableFindings.map((finding) => finding.severity))
  const categoryCounts = countBy(actionableFindings.map((finding) => finding.category))
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

  lines.push(renderCounts('Actionable Severity Counts', severityCounts))
  lines.push(renderCounts('Actionable Category Counts', categoryCounts))
  lines.push('## Actionable Findings', '')

  for (const finding of actionableFindings) {
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

  // Unresolved findings are suspicions the refuter could neither prove nor
  // disprove from the context it had — most often because the evidence lives
  // somewhere it could not reach. Rendering them as a bare id and title made them
  // undecidable for a human too, which is the same as dropping them. They are
  // reported with the location, the description, and the reason they stayed
  // unresolved so a reviewer can confirm or dismiss each one. They deliberately
  // stay out of the quality gate and out of inline comments: surfacing a suspicion
  // for a human decision must not block a build or add review noise.
  if (artifactOnlyFindings.length > 0) {
    lines.push(
      '## Unresolved - Needs Human Decision',
      '',
      'These candidates were neither proved nor disproved from the available context.',
      'They do not affect the quality gate. Confirm or dismiss each one.',
      ''
    )

    for (const finding of artifactOnlyFindings) {
      const refutation =
        finding.refutationId === undefined
          ? undefined
          : report.refutationResults.find(
              (result) => result.id === finding.refutationId
            )

      lines.push(
        `### ${safeText(finding.severity.toUpperCase())}: ${safeText(finding.title)}`,
        '',
        `- ID: ${safeText(finding.id)}`,
        `- Category: ${safeText(finding.category)}`,
        `- Location: ${safeText(finding.location.path)}:${finding.location.startLine}`,
        `- Proposed by: ${safeText(finding.proposedBy)}`,
        `- Why unresolved: ${
          refutation === undefined
            ? 'no refutation verdict was recorded for this candidate'
            : `${safeText(refutation.verdict)} - ${safeText(refutation.summary)}`
        }`,
        '',
        safeText(finding.description),
        ''
      )
    }
  }

  lines.push('## Rejected Candidates', '')

  for (const rejected of report.rejectedFindings) {
    lines.push(
      `- ${safeText(rejected.candidateId)}: ${safeText(rejected.reason)} (${safeText(rejected.status)})`
    )
  }

  lines.push('', '## Refutation Results', '')

  for (const refutation of report.refutationResults) {
    lines.push(
      `- ${safeText(refutation.id)}: ${safeText(refutation.verdict)} for ${safeText(refutation.candidateId)} - ${safeText(refutation.summary)}`
    )
    lines.push(`  - Refutation evidence: ${renderEvidenceIds(refutation.evidenceIds)}`)
    for (const check of refutation.checks) {
      lines.push(
        `  - Refutation check ${safeText(check.kind)}: ${safeText(check.result)} - ${safeText(check.summary)} evidence: ${renderEvidenceIds(check.evidenceIds)}`
      )
    }
  }

  lines.push('', '## Provider Issues', '')

  for (const issue of report.providerIssues) {
    const stage = issue.stage === undefined ? 'unknown-stage' : issue.stage
    const recovered =
      issue.recovered === undefined ? 'unknown' : issue.recovered ? 'yes' : 'no'
    const message = issue.message === undefined ? '' : ` - ${safeText(issue.message)}`

    lines.push(
      `- ${safeText(issue.code)} at ${safeText(stage)} recovered: ${recovered}${message}`
    )
  }

  lines.push('', '## Skipped Files', '')

  for (const skipped of report.skippedFiles) {
    lines.push(`- ${safeText(skipped.path)}: ${safeText(skipped.reason)}`)
  }

  lines.push('', '## Cost And Timing', '')
  lines.push(`- Duration: ${report.run.durationMs} ms`)

  // Spend and tokens, stated on every report rather than left to a JSON field.
  // This engine bills a provider per run and the reader is the person paying, so
  // the amount belongs beside the findings — the same place the PR comment already
  // puts it. `costUsd` was previously printed as a bare number (`Cost: 2.2276`),
  // which reads as a count of something rather than as money.
  //
  // Tokens are reported alongside because cost alone cannot be acted on: input
  // dominates output by roughly 23:1 here, so a reader deciding whether to narrow
  // `paths.include` needs to see WHICH side is large. `cachedInputTokens` is a
  // SUBSET of `inputTokens`, never an addition, and is shown because a warm cache
  // can change spend severalfold with no change to the review itself — a run that
  // looks cheap next to yesterday's may differ only in cache warmth.
  if (report.run.costUsd !== undefined) {
    lines.push(`- Cost: $${report.run.costUsd.toFixed(4)}`)
  } else {
    // Never silently omitted: a missing cost means tokens or prices were
    // unavailable, and a reader must be able to tell that from "this was free".
    lines.push('- Cost: unavailable (token counts or model prices were missing)')
  }

  if (report.run.inputTokens !== undefined) {
    const cached =
      report.run.cachedInputTokens === undefined
        ? ''
        : ` (${report.run.cachedInputTokens.toLocaleString('en-US')} cached)`

    lines.push(
      `- Input tokens: ${report.run.inputTokens.toLocaleString('en-US')}${cached}`
    )
  }

  if (report.run.outputTokens !== undefined) {
    lines.push(
      `- Output tokens: ${report.run.outputTokens.toLocaleString('en-US')}`
    )
  }

  return `${lines.join('\n')}\n`
}
