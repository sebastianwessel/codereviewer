import {
  appendMarkdownTable,
  formatEvalGateOutcome,
  formatListValue,
  formatPercent,
  UNKNOWN_VALUE
} from '../eval-report-markdown-formatting.js'
import { type EvalComparisonReport } from '../../report/eval-comparison-view.js'

// Nothing in this module defaults an absent value. A report that never recorded
// its selection or its judge reliability says so through `UNKNOWN_VALUE`; it
// does not report an empty selection or a trustworthy judge.

type EvalReportPair = {
  readonly base: EvalComparisonReport
  readonly head: EvalComparisonReport
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

const listSelectionStatus = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): 'same' | 'different' | 'unknown' =>
  left === undefined || right === undefined
    ? 'unknown'
    : arraysEqual(left, right)
      ? 'same'
      : 'different'

// Judge agreement difference above which the two runs' quality deltas may
// reflect judge variance rather than review quality.
const MATERIAL_JUDGE_AGREEMENT_DELTA = 0.05

export type EvalJudgeReliabilityStatus = {
  readonly baseTrustworthy: boolean | undefined
  readonly headTrustworthy: boolean | undefined
  readonly baseAgreement?: number
  readonly headAgreement?: number
  readonly warnings: readonly string[]
}

const formatAgreement = (agreement: number | undefined): string =>
  agreement === undefined ? 'not scored' : formatPercent(agreement)

const formatTrustworthy = (trustworthy: boolean | undefined): string =>
  trustworthy === undefined ? UNKNOWN_VALUE : trustworthy ? 'yes' : 'no'

// The judge is the sole semantic authority, so an untrustworthy or differently
// calibrated judge makes metric deltas unreadable as review-quality signal.
const judgeReliabilityStatus = (
  input: EvalReportPair
): EvalJudgeReliabilityStatus => {
  const baseAgreement = input.base.scoring?.judgeAgreement
  const headAgreement = input.head.scoring?.judgeAgreement
  const agreementDiffersMaterially =
    baseAgreement !== undefined &&
    headAgreement !== undefined &&
    Math.abs(baseAgreement - headAgreement) > MATERIAL_JUDGE_AGREEMENT_DELTA
  const warnings: string[] = []

  if (
    input.base.scoring?.judgeTrustworthy === false ||
    input.head.scoring?.judgeTrustworthy === false
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
    baseTrustworthy: input.base.scoring?.judgeTrustworthy,
    headTrustworthy: input.head.scoring?.judgeTrustworthy,
    ...(baseAgreement === undefined ? {} : { baseAgreement }),
    ...(headAgreement === undefined ? {} : { headAgreement }),
    warnings
  }
}

export const selectionStatus = (
  input: EvalReportPair
): {
  readonly fixtureSource: 'same' | 'different'
  readonly sliceRoot: 'same' | 'different'
  readonly caseFilters: 'same' | 'different' | 'unknown'
  readonly caseSet: 'same' | 'different' | 'unknown'
  readonly judgeReliability: EvalJudgeReliabilityStatus
  readonly baseOnlyCaseIds: readonly string[]
  readonly headOnlyCaseIds: readonly string[]
} => {
  const baseCaseIds = input.base.selection?.selectedCaseIds ?? []
  const headCaseIds = input.head.selection?.selectedCaseIds ?? []
  const headCaseIdSet = new Set(headCaseIds)
  const baseCaseIdSet = new Set(baseCaseIds)

  return {
    fixtureSource: scalarSelectionStatus(
      input.base.selection?.fixtureSource,
      input.head.selection?.fixtureSource
    ),
    sliceRoot: scalarSelectionStatus(
      input.base.selection?.sliceRoot,
      input.head.selection?.sliceRoot
    ),
    caseFilters: listSelectionStatus(
      input.base.selection?.caseFilters,
      input.head.selection?.caseFilters
    ),
    caseSet: listSelectionStatus(
      input.base.selection?.selectedCaseIds,
      input.head.selection?.selectedCaseIds
    ),
    judgeReliability: judgeReliabilityStatus(input),
    baseOnlyCaseIds: baseCaseIds.filter((caseId) => !headCaseIdSet.has(caseId)),
    headOnlyCaseIds: headCaseIds.filter((caseId) => !baseCaseIdSet.has(caseId))
  }
}

type EvalComparisonSelectionStatus = ReturnType<typeof selectionStatus>

// The gate verdict as the report recorded it. A report written before the gate
// gained a third outcome recorded only a boolean, and that boolean IS its
// verdict -- reading it is not a default, it is the value that is there. A
// report that recorded neither renders unknown, like every other unread field.
const formatGateResult = (
  gate: EvalComparisonReport['regressionGate']
): string => {
  if (gate?.outcome !== undefined) {
    return formatEvalGateOutcome(gate.outcome)
  }

  if (gate?.passed !== undefined) {
    return gate.passed ? 'PASS' : 'FAIL'
  }

  return UNKNOWN_VALUE
}

const formatEvalComparisonGateRow = (
  label: string,
  report: EvalComparisonReport
): string =>
  `| ${label} | ${formatGateResult(report.regressionGate)} | ${report.fixtureCount ?? UNKNOWN_VALUE} | ${report.generatedAt ?? UNKNOWN_VALUE} |`

export const appendEvalComparisonGate = (
  lines: string[],
  input: EvalReportPair
): void => {
  appendMarkdownTable(lines, {
    heading: '## Gate',
    header: '| Report | Gate | Fixtures | Generated |',
    alignment: '| --- | --- | ---: | --- |',
    rows: [
      formatEvalComparisonGateRow('Base', input.base),
      formatEvalComparisonGateRow('Head', input.head)
    ]
  })
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

  // Not knowing whether the two runs scored the same cases is not the same as
  // knowing they did. An unrecorded selection cannot establish that the
  // aggregates below are same-dataset comparable, so it warns rather than
  // passing silently.
  if (selection.caseSet === 'unknown') {
    lines.push(
      'Warning: a compared report did not record its selected case set; whether the aggregate metric deltas are same-dataset comparable cannot be established.'
    )
    lines.push('')
  }
  for (const warning of selection.judgeReliability.warnings) {
    lines.push(warning)
    lines.push('')
  }
  appendMarkdownTable(lines, {
    header: '| Field | Status |',
    alignment: '| --- | --- |',
    rows: [
      formatEvalComparisonSelectionRow(
        'Fixture source',
        selection.fixtureSource
      ),
      formatEvalComparisonSelectionRow('Slice root', selection.sliceRoot),
      formatEvalComparisonSelectionRow('Case filters', selection.caseFilters),
      formatEvalComparisonSelectionRow('Case set', selection.caseSet),
      formatEvalComparisonSelectionRow(
        'Judge agreement',
        `${formatAgreement(selection.judgeReliability.baseAgreement)} -> ${formatAgreement(selection.judgeReliability.headAgreement)}`
      ),
      formatEvalComparisonSelectionRow(
        'Judge trustworthy',
        `${formatTrustworthy(selection.judgeReliability.baseTrustworthy)} -> ${formatTrustworthy(selection.judgeReliability.headTrustworthy)}`
      ),
      formatEvalComparisonSelectionRow(
        'Base-only cases',
        formatListValue(selection.baseOnlyCaseIds)
      ),
      formatEvalComparisonSelectionRow(
        'Head-only cases',
        formatListValue(selection.headOnlyCaseIds)
      )
    ]
  })
}
