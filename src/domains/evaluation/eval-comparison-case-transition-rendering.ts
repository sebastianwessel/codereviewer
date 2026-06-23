import { escapeMarkdownCell } from './eval-report-markdown-formatting.js'
import { caseStatus } from './eval-report-case-labels.js'
import { type EvalReport } from './eval-report-contracts.js'

export const caseStatusById = (
  report: EvalReport
): ReadonlyMap<string, ReturnType<typeof caseStatus>> =>
  new Map(
    report.caseResults.map((caseResult) => [
      caseResult.caseId,
      caseStatus(caseResult)
    ])
  )

const transitionLabel = (
  baseStatus: ReturnType<typeof caseStatus> | undefined,
  headStatus: ReturnType<typeof caseStatus> | undefined
): string => {
  if (baseStatus === undefined) {
    return 'new'
  }

  if (headStatus === undefined) {
    return 'removed'
  }

  if (baseStatus !== 'PASS' && headStatus === 'PASS') {
    return 'fixed'
  }

  if (baseStatus === 'PASS' && headStatus !== 'PASS') {
    return 'regressed'
  }

  return baseStatus === headStatus ? 'unchanged' : 'changed'
}

const formatCaseTransitionRow = (
  input: {
    readonly caseId: string
    readonly baseStatus: ReturnType<typeof caseStatus> | undefined
    readonly headStatus: ReturnType<typeof caseStatus> | undefined
  }
): string =>
  `| ${escapeMarkdownCell(input.caseId)} | ${input.baseStatus ?? '-'} | ${input.headStatus ?? '-'} | ${transitionLabel(
    input.baseStatus,
    input.headStatus
  )} |`

export const appendEvalComparisonCaseTransitions = (
  lines: string[],
  input: {
    readonly caseIds: readonly string[]
    readonly baseStatus: ReadonlyMap<string, ReturnType<typeof caseStatus>>
    readonly headStatus: ReadonlyMap<string, ReturnType<typeof caseStatus>>
  }
): void => {
  lines.push('## Case Transitions')
  lines.push('')
  lines.push('| Case | Base | Head | Change |')
  lines.push('| --- | --- | --- | --- |')

  for (const caseId of input.caseIds) {
    const baseCaseStatus = input.baseStatus.get(caseId)
    const headCaseStatus = input.headStatus.get(caseId)
    lines.push(
      formatCaseTransitionRow({
        caseId,
        baseStatus: baseCaseStatus,
        headStatus: headCaseStatus
      })
    )
  }

  lines.push('')
}
