import { escapeMarkdownCell } from './eval-report-markdown-formatting.js'
import { caseStatus } from './eval-report-case-labels.js'
import {
  type EvalComparisonCase,
  type EvalComparisonReport
} from './eval-comparison-view.js'

// A case whose report did not record the inputs the status is derived from is
// `UNKNOWN`, never PASS. Deriving a pass from absent failure lists is exactly
// how a missing field turns into a reassuring result.
export type EvalComparisonCaseStatus = ReturnType<typeof caseStatus> | 'UNKNOWN'

const comparisonCaseStatus = (
  caseResult: EvalComparisonCase
): EvalComparisonCaseStatus =>
  caseResult.providerErrored === undefined ||
  caseResult.parseValid === undefined ||
  caseResult.unmatchedExpectedIndexes === undefined ||
  caseResult.falsePositiveFindingIds === undefined ||
  caseResult.noFindingZoneFalsePositiveIds === undefined
    ? 'UNKNOWN'
    : caseStatus({
        providerErrored: caseResult.providerErrored,
        parseValid: caseResult.parseValid,
        unmatchedExpectedIndexes: caseResult.unmatchedExpectedIndexes,
        falsePositiveFindingIds: caseResult.falsePositiveFindingIds,
        noFindingZoneFalsePositiveIds: caseResult.noFindingZoneFalsePositiveIds
      })

export const caseStatusById = (
  report: EvalComparisonReport
): ReadonlyMap<string, EvalComparisonCaseStatus> =>
  new Map(
    (report.caseResults ?? []).map((caseResult) => [
      caseResult.caseId,
      comparisonCaseStatus(caseResult)
    ])
  )

const transitionLabel = (
  baseStatus: EvalComparisonCaseStatus | undefined,
  headStatus: EvalComparisonCaseStatus | undefined
): string => {
  if (baseStatus === 'UNKNOWN' || headStatus === 'UNKNOWN') {
    return 'unknown (not recorded)'
  }

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
    readonly baseStatus: EvalComparisonCaseStatus | undefined
    readonly headStatus: EvalComparisonCaseStatus | undefined
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
    readonly baseStatus: ReadonlyMap<string, EvalComparisonCaseStatus>
    readonly headStatus: ReadonlyMap<string, EvalComparisonCaseStatus>
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
