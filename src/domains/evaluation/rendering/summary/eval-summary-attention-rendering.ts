import type { z } from 'zod'
import {
  resolveExpectedFindingMatchMode,
  type EvalCase
} from '../../corpus/eval-fixture.schema.js'
import { expectedLocationLabel } from '../eval-report-expected-finding-labels.js'
import { caseStatus, humanActionableWarnings, providerIssueLabel } from '../eval-report-case-labels.js'
import type { EvalCaseReportSchema, EvalReport } from '../../report/eval-report-contracts.js'
import { expectedLabelForMatch, findCase } from './eval-summary-case-rendering.js'

const attentionCasesForSummary = (
  report: EvalReport
): readonly z.infer<typeof EvalCaseReportSchema>[] =>
  report.caseResults.filter(
    (caseResult) =>
      caseStatus(caseResult) !== 'PASS' ||
      caseResult.inconclusiveMatches.length > 0 ||
      caseResult.artifactOnlyMatchedFindings.length > 0 ||
      caseResult.artifactOnlyFalsePositiveFindingIds.length > 0 ||
      caseResult.unlistedRealFindingIds.length > 0 ||
      caseResult.refutationResults.length > 0 ||
      caseResult.providerIssues.length > 0
  )

const appendAttentionBulletSection = (
  lines: string[],
  input: {
    readonly heading: string
    readonly rows: readonly string[]
  }
): void => {
  if (input.rows.length === 0) {
    return
  }

  lines.push(input.heading)
  lines.push(...input.rows)
}

type EvalSummaryAttentionFinding = z.infer<
  typeof EvalCaseReportSchema
>['producedFindings'][number]

const formatAttentionFindingBullet = (
  finding: EvalSummaryAttentionFinding
): string =>
  `- ${finding.findingId} ${finding.severity} ${finding.category} ${finding.path}:${finding.line} - ${finding.title}`

// Resolve a classification's ID list against the case's one finding array. An ID
// with no entry is skipped rather than rendered as a placeholder: the arrays are
// written together in `eval-case-assembly`, so a dangling ID means a malformed
// report, and inventing a row for it would hide that.
const attentionFindingRows = (
  caseResult: z.infer<typeof EvalCaseReportSchema>,
  findingIds: readonly string[]
): readonly string[] => {
  const summaryById = new Map(
    caseResult.producedFindings.map((finding) => [finding.findingId, finding])
  )

  return findingIds.flatMap((findingId) => {
    const finding = summaryById.get(findingId)

    return finding === undefined ? [] : [formatAttentionFindingBullet(finding)]
  })
}

type EvalSummaryAttentionMatch = {
  readonly findingId: string
  readonly expectedIndex: number
  readonly semanticReason: string
}

const formatAttentionMatchedFindingBullet = (
  caseResult: z.infer<typeof EvalCaseReportSchema>,
  match: EvalSummaryAttentionMatch
): string =>
  `- ${match.findingId} matched ${expectedLabelForMatch(caseResult, match.expectedIndex)} - ${match.semanticReason}`

type EvalSummaryInconclusiveMatch = {
  readonly findingId: string
  readonly expectedIndex: number
  readonly code: string
}

// Inconclusive pairs are neither misses nor false positives. They are rendered
// separately so a reader never mistakes a failed judge call for review quality.
const formatAttentionInconclusiveBullet = (
  caseResult: z.infer<typeof EvalCaseReportSchema>,
  inconclusive: EvalSummaryInconclusiveMatch
): string =>
  `- ${inconclusive.findingId} vs ${expectedLabelForMatch(caseResult, inconclusive.expectedIndex)} undecided (${inconclusive.code}); excluded from recall and precision`

type EvalSummaryExpectedFinding = EvalCase['expectedFindings'][number]

const formatAttentionMissedExpectedBullet = (
  expectedIndex: number,
  expected: EvalSummaryExpectedFinding
): string =>
  `- #${expectedIndex} ${expected.severity} ${expected.category} ${expectedLocationLabel(expected)} [${resolveExpectedFindingMatchMode(expected)}] - ${expected.semanticSummary}`

const attentionMissedExpectedRows = (
  caseResult: z.infer<typeof EvalCaseReportSchema>,
  evalCase: EvalCase | undefined
): readonly string[] => {
  if (evalCase === undefined) {
    return []
  }

  const rows: string[] = []
  for (const expectedIndex of caseResult.unmatchedExpectedIndexes) {
    const expected = evalCase.expectedFindings[expectedIndex]
    if (expected === undefined) {
      continue
    }

    rows.push(formatAttentionMissedExpectedBullet(expectedIndex, expected))
  }

  return rows
}

type EvalSummaryRefutationResult = {
  readonly id: string
  readonly candidateId: string
  readonly verdict: string
}

const formatAttentionRefutationBullet = (
  refutation: EvalSummaryRefutationResult
): string =>
  `- ${refutation.id} candidate ${refutation.candidateId} verdict ${refutation.verdict}`

export const appendEvalSummaryAttentionNeeded = (
  lines: string[],
  input: {
    readonly cases: readonly EvalCase[]
    readonly report: EvalReport
  }
): void => {
  const attentionCases = attentionCasesForSummary(input.report)

  if (attentionCases.length === 0) {
    return
  }

  lines.push('## Attention Needed')
  lines.push('')
  for (const caseResult of attentionCases) {
    const evalCase = findCase(input.cases, caseResult.caseId)
    lines.push(`### ${caseResult.caseId}`)
    lines.push('')

    appendAttentionBulletSection(lines, {
      heading: 'Missed expected findings:',
      rows: attentionMissedExpectedRows(caseResult, evalCase)
    })

    appendAttentionBulletSection(lines, {
      heading: 'Inconclusive judge decisions:',
      rows: caseResult.inconclusiveMatches.map((inconclusive) =>
        formatAttentionInconclusiveBullet(caseResult, inconclusive)
      )
    })

    appendAttentionBulletSection(lines, {
      heading: 'Artifact-only matched findings:',
      rows: caseResult.artifactOnlyMatchedFindings.map((match) =>
        formatAttentionMatchedFindingBullet(caseResult, match)
      )
    })

    appendAttentionBulletSection(lines, {
      heading: 'Artifact-only findings:',
      rows: attentionFindingRows(
        caseResult,
        caseResult.artifactOnlyFalsePositiveFindingIds
      )
    })

    appendAttentionBulletSection(lines, {
      heading: 'False positive findings:',
      rows: attentionFindingRows(caseResult, caseResult.falsePositiveFindingIds)
    })

    // Real-but-unlisted defects: unmatched findings the plausibility judge
    // credited as genuine. They do not count against adjusted precision.
    appendAttentionBulletSection(lines, {
      heading: 'Real but unlisted findings (credited by plausibility judge):',
      rows: attentionFindingRows(caseResult, caseResult.unlistedRealFindingIds)
    })

    appendAttentionBulletSection(lines, {
      heading: 'Duplicate findings:',
      rows: attentionFindingRows(caseResult, caseResult.duplicateFindingIds)
    })

    if (caseResult.noFindingZoneFalsePositiveIds.length > 0) {
      lines.push(
        `No-finding-zone hit IDs: ${caseResult.noFindingZoneFalsePositiveIds.join(', ')}`
      )
    }

    appendAttentionBulletSection(lines, {
      heading: 'Refutation results:',
      rows: caseResult.refutationResults.map(formatAttentionRefutationBullet)
    })

    if (caseResult.providerIssues.length > 0) {
      lines.push(`Provider issues: ${providerIssueLabel(caseResult)}`)
    }

    const warnings = humanActionableWarnings(caseResult.warnings)
    if (warnings.length > 0) {
      lines.push(`Warnings: ${warnings.join(', ')}`)
    }

    lines.push('')
  }
}
