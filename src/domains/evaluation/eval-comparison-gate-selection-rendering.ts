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

// Judge agreement difference above which the two runs' quality deltas may
// reflect judge variance rather than review quality.
const MATERIAL_JUDGE_AGREEMENT_DELTA = 0.05

export type EvalJudgeReliabilityStatus = {
  readonly baseTrustworthy: boolean
  readonly headTrustworthy: boolean
  readonly baseAgreement?: number
  readonly headAgreement?: number
  readonly agreementDiffersMaterially: boolean
  readonly warnings: readonly string[]
}

const formatAgreement = (agreement: number | undefined): string =>
  agreement === undefined ? 'not scored' : `${(agreement * 100).toFixed(1)}%`

// The judge is the sole semantic authority, so an untrustworthy or differently
// calibrated judge makes metric deltas unreadable as review-quality signal.
const judgeReliabilityStatus = (
  input: EvalReportPair
): EvalJudgeReliabilityStatus => {
  const baseAgreement = input.base.scoring.judgeAgreement
  const headAgreement = input.head.scoring.judgeAgreement
  const agreementDiffersMaterially =
    baseAgreement !== undefined &&
    headAgreement !== undefined &&
    Math.abs(baseAgreement - headAgreement) > MATERIAL_JUDGE_AGREEMENT_DELTA
  const warnings: string[] = []

  if (
    !input.base.scoring.judgeTrustworthy ||
    !input.head.scoring.judgeTrustworthy
  ) {
    warnings.push(
      'Warning: a compared report marks its semantic judge as untrustworthy; metric deltas may reflect judge error rather than review quality.'
    )
  }

  if (agreementDiffersMaterially) {
    warnings.push(
      `Warning: judge agreement differs materially (${formatAgreement(baseAgreement)} vs ${formatAgreement(headAgreement)}); metric deltas may reflect judge variance rather than review quality.`
    )
  }

  return {
    baseTrustworthy: input.base.scoring.judgeTrustworthy,
    headTrustworthy: input.head.scoring.judgeTrustworthy,
    ...(baseAgreement === undefined ? {} : { baseAgreement }),
    ...(headAgreement === undefined ? {} : { headAgreement }),
    agreementDiffersMaterially,
    warnings
  }
}

export const selectionStatus = (
  input: EvalReportPair
): {
  readonly fixtureSource: 'same' | 'different'
  readonly sliceRoot: 'same' | 'different'
  readonly caseFilters: 'same' | 'different'
  readonly caseSet: 'same' | 'different'
  readonly judgeReliability: EvalJudgeReliabilityStatus
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
    judgeReliability: judgeReliabilityStatus(input),
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
  for (const warning of selection.judgeReliability.warnings) {
    lines.push(warning)
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
      'Judge agreement',
      `${formatAgreement(selection.judgeReliability.baseAgreement)} -> ${formatAgreement(selection.judgeReliability.headAgreement)}`
    )
  )
  lines.push(
    formatEvalComparisonSelectionRow(
      'Judge trustworthy',
      `${selection.judgeReliability.baseTrustworthy ? 'yes' : 'no'} -> ${selection.judgeReliability.headTrustworthy ? 'yes' : 'no'}`
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
