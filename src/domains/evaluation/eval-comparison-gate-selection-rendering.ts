import { formatListValue } from './eval-report-markdown-formatting.js'
import { type EvalReport } from './eval-report-contracts.js'

type EvalReportPair = {
  readonly base: EvalReport
  readonly head: EvalReport
}

const arraysEqual = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const scalarSelectionStatus = (
  left: string | undefined,
  right: string | undefined
): 'same' | 'different' => (left ?? '') === (right ?? '') ? 'same' : 'different'

export const selectionStatus = (
  input: EvalReportPair
): {
  readonly fixtureSource: 'same' | 'different'
  readonly sliceRoot: 'same' | 'different'
  readonly caseFilters: 'same' | 'different'
  readonly caseSet: 'same' | 'different'
  readonly semanticMatcher: 'same' | 'different'
  readonly baseOnlyCaseIds: readonly string[]
  readonly headOnlyCaseIds: readonly string[]
} => {
  const baseCaseIds = input.base.selection.selectedCaseIds
  const headCaseIds = input.head.selection.selectedCaseIds
  const headCaseIdSet = new Set(headCaseIds)
  const baseCaseIdSet = new Set(baseCaseIds)

  return {
    fixtureSource: scalarSelectionStatus(
      input.base.selection.fixtureSource,
      input.head.selection.fixtureSource
    ),
    sliceRoot: scalarSelectionStatus(
      input.base.selection.sliceRoot,
      input.head.selection.sliceRoot
    ),
    caseFilters: arraysEqual(
      input.base.selection.caseFilters,
      input.head.selection.caseFilters
    )
      ? 'same'
      : 'different',
    caseSet: arraysEqual(baseCaseIds, headCaseIds) ? 'same' : 'different',
    semanticMatcher: scalarSelectionStatus(
      input.base.scoring.semanticMatcher,
      input.head.scoring.semanticMatcher
    ),
    baseOnlyCaseIds: baseCaseIds.filter((caseId) => !headCaseIdSet.has(caseId)),
    headOnlyCaseIds: headCaseIds.filter((caseId) => !baseCaseIdSet.has(caseId))
  }
}

type EvalComparisonSelectionStatus = ReturnType<typeof selectionStatus>

const formatEvalComparisonGateRow = (
  label: string,
  report: EvalReport
): string =>
  `| ${label} | ${report.regressionGate.passed ? 'PASS' : 'FAIL'} | ${report.fixtureCount} | ${report.generatedAt} |`

export const appendEvalComparisonGate = (
  lines: string[],
  input: EvalReportPair
): void => {
  lines.push('## Gate')
  lines.push('')
  lines.push('| Report | Gate | Fixtures | Generated |')
  lines.push('| --- | --- | ---: | --- |')
  lines.push(formatEvalComparisonGateRow('Base', input.base))
  lines.push(formatEvalComparisonGateRow('Head', input.head))
  lines.push('')
}

const formatEvalComparisonSelectionRow = (
  field: string,
  value: string
): string => `| ${field} | ${value} |`

export const appendEvalComparisonSelection = (
  lines: string[],
  selection: EvalComparisonSelectionStatus
): void => {
  lines.push('## Selection')
  lines.push('')
  if (selection.caseSet === 'different') {
    lines.push(
      'Warning: selected case sets differ; aggregate metric deltas are not same-dataset comparable.'
    )
    lines.push('')
  }
  if (selection.semanticMatcher === 'different') {
    lines.push(
      'Warning: semantic matcher modes differ; aggregate metric deltas are not scoring-mode comparable.'
    )
    lines.push('')
  }
  lines.push('| Field | Status |')
  lines.push('| --- | --- |')
  lines.push(
    formatEvalComparisonSelectionRow('Fixture source', selection.fixtureSource)
  )
  lines.push(formatEvalComparisonSelectionRow('Slice root', selection.sliceRoot))
  lines.push(
    formatEvalComparisonSelectionRow('Case filters', selection.caseFilters)
  )
  lines.push(formatEvalComparisonSelectionRow('Case set', selection.caseSet))
  lines.push(
    formatEvalComparisonSelectionRow(
      'Semantic matcher',
      selection.semanticMatcher
    )
  )
  lines.push(
    formatEvalComparisonSelectionRow(
      'Base-only cases',
      formatListValue(selection.baseOnlyCaseIds)
    )
  )
  lines.push(
    formatEvalComparisonSelectionRow(
      'Head-only cases',
      formatListValue(selection.headOnlyCaseIds)
    )
  )
  lines.push('')
}
