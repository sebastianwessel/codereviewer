import type { AdmittedFinding } from '../../shared/contracts/index.js'
import {
  createStructuredError,
  normalizeError,
  type StructuredError
} from '../../shared/errors/error-normalizer.js'
import type {
  EvalCase,
  EvalLineRange,
  ExpectedFinding,
  ExpectedNoFindingZone
} from './eval-fixture.schema.js'

export type EvalJudgeProviderIssue = {
  readonly code: string
  readonly stage: string
  readonly recovered: false
  readonly message?: string
}

// Line gate tolerance. Deterministic, exact, and applied before any judge call.
const LINE_TOLERANCE = 3

export const EVAL_SEMANTIC_JUDGE_STAGE = 'eval_semantic_judge'

export type EvalFindingMatch = {
  readonly expectedIndex: number
  readonly findingId: string
  // Report-safe rationale from the semantic judge that accepted the match.
  // Every match is a judge decision, so this is always present. There is no
  // numeric similarity score: an invented number is not evidence.
  readonly semanticReason: string
  readonly lineOverlaps: boolean
  readonly severityMatches: boolean
}

// A pair the judge could not decide because the judge call failed after the
// configured provider retries. It is neither a match nor a non-match, and is
// excluded from the recall and precision denominators.
export type EvalInconclusiveMatch = {
  readonly expectedIndex: number
  readonly findingId: string
  readonly code: string
  readonly message?: string
}

export type EvalMatcherResult = {
  readonly matches: readonly EvalFindingMatch[]
  // Expected findings proven unmatched: every candidate pair was gated out or
  // rejected by the judge. Inconclusive expectations are NOT listed here.
  readonly unmatchedExpectedIndexes: readonly number[]
  // Expected findings whose verdict is unknown because a judge call failed.
  readonly inconclusiveExpectedIndexes: readonly number[]
  // Admitted findings whose verdict is unknown because a judge call failed.
  // They are neither false positives nor duplicates.
  readonly inconclusiveFindingIds: readonly string[]
  readonly inconclusiveMatches: readonly EvalInconclusiveMatch[]
  readonly duplicateFindingIds: readonly string[]
  readonly falsePositiveFindingIds: readonly string[]
  readonly noFindingZoneFalsePositiveIds: readonly string[]
  // Provider issues raised by the semantic judge, so a judge failure stays
  // visible as provider instability instead of silently changing scores.
  readonly judgeProviderIssues?: readonly EvalJudgeProviderIssue[]
}

// The judge sees report-safe summaries only. Source text, diffs, prompts, tool
// output, paths, and line numbers are structurally excluded from its input.
export type EvalSemanticJudgeInput = {
  readonly expectedSummary: string
  readonly findingTitle: string
  readonly findingDescription: string
}

export type EvalSemanticJudgeResult = {
  readonly match: boolean
  readonly reason: string
}

export type EvalSemanticJudge = (
  input: EvalSemanticJudgeInput
) => Promise<EvalSemanticJudgeResult>

// A case with expected findings needs the judge. Failing loudly is required:
// falling back to a heuristic would silently produce fabricated scores.
export const missingSemanticJudgeError = (caseId: string): StructuredError =>
  createStructuredError({
    code: 'eval_semantic_judge_missing',
    message: `Eval case "${caseId}" declares expected findings but no semantic judge is available. Configure a provider; the matcher never falls back to a heuristic.`,
    category: 'config',
    recoverable: true,
    exitCode: 2,
    details: { case_id: caseId }
  })

const findingLineRange = (
  finding: AdmittedFinding
): EvalLineRange => [
  finding.location.startLine,
  finding.location.endLine ?? finding.location.startLine
]

const rangesOverlap = (
  left: EvalLineRange,
  right: EvalLineRange,
  tolerance: number
): boolean => {
  const [leftStart, leftEnd] = left
  const [rightStart, rightEnd] = right

  return leftStart <= rightEnd + tolerance && rightStart <= leftEnd + tolerance
}

const lineRulePasses = (
  expected: ExpectedFinding,
  finding: AdmittedFinding
): boolean =>
  expected.lineRange === undefined
    ? true
    : rangesOverlap(expected.lineRange, findingLineRange(finding), LINE_TOLERANCE)

const matchModeFor = (
  expected: ExpectedFinding
): 'path-line' | 'path-semantic' | 'semantic-only' =>
  expected.matchMode ??
  (expected.path === undefined
    ? 'semantic-only'
    : expected.lineRange === undefined
      ? 'path-semantic'
      : 'path-line')

// Deterministic gates. Exact, reproducible, and always evaluated before the
// judge is called, so the judge can never move a finding to another file or
// line.
const gatesPass = (
  expected: ExpectedFinding,
  finding: AdmittedFinding
): boolean => {
  const matchMode = matchModeFor(expected)

  if (matchMode !== 'semantic-only' && expected.path !== finding.location.path) {
    return false
  }

  return matchMode !== 'path-line' || lineRulePasses(expected, finding)
}

const isInNoFindingZone = (
  zone: ExpectedNoFindingZone,
  finding: AdmittedFinding
): boolean => {
  if (zone.path !== finding.location.path) {
    return false
  }

  if (zone.lineRange === undefined) {
    return true
  }

  return rangesOverlap(zone.lineRange, findingLineRange(finding), 0)
}

const isDuplicateOfMatchedFinding = (
  finding: AdmittedFinding,
  matchedFindings: readonly AdmittedFinding[]
): boolean =>
  matchedFindings.some(
    (matchedFinding) =>
      finding.location.path === matchedFinding.location.path &&
      rangesOverlap(findingLineRange(finding), findingLineRange(matchedFinding), 0)
  )

type AssignedMatch = {
  readonly expectedIndex: number
  readonly findingIndex: number
  readonly semanticReason: string
  readonly lineOverlaps: boolean
  readonly severityMatches: boolean
}

type InconclusivePair = {
  readonly expectedIndex: number
  readonly findingIndex: number
  readonly code: string
  readonly message?: string
}

type JudgePassResult = {
  readonly assignedMatches: readonly AssignedMatch[]
  readonly inconclusivePairs: readonly InconclusivePair[]
  readonly judgeProviderIssues: readonly EvalJudgeProviderIssue[]
}

// Assignment order is fully deterministic: expected findings ascending, then
// admitted findings ascending. The first judge-accepted finding wins the
// expectation and is removed from the pool, so one admitted finding matches at
// most one expected finding and repeated runs over the same inputs assign the
// same pairs.
const runJudgePass = async (
  input: {
    readonly evalCase: EvalCase
    readonly admittedFindings: readonly AdmittedFinding[]
    readonly judge: EvalSemanticJudge | undefined
  }
): Promise<JudgePassResult> => {
  const assignedMatches: AssignedMatch[] = []
  const inconclusivePairs: InconclusivePair[] = []
  const judgeProviderIssues: EvalJudgeProviderIssue[] = []
  const claimedFindingIndexes = new Set<number>()

  for (const [expectedIndex, expected] of input.evalCase.expectedFindings.entries()) {
    for (const [findingIndex, finding] of input.admittedFindings.entries()) {
      if (claimedFindingIndexes.has(findingIndex)) {
        continue
      }

      if (!gatesPass(expected, finding)) {
        continue
      }

      if (input.judge === undefined) {
        throw missingSemanticJudgeError(input.evalCase.id)
      }

      let judged: EvalSemanticJudgeResult
      try {
        judged = await input.judge({
          expectedSummary: expected.semanticSummary,
          findingTitle: finding.title,
          findingDescription: finding.description
        })
      } catch (error) {
        const normalized = normalizeError(error, {
          source: 'provider',
          operation: EVAL_SEMANTIC_JUDGE_STAGE
        })
        judgeProviderIssues.push({
          code: normalized.code,
          stage: EVAL_SEMANTIC_JUDGE_STAGE,
          recovered: false,
          message: normalized.message
        })
        inconclusivePairs.push({
          expectedIndex,
          findingIndex,
          code: normalized.code,
          message: normalized.message
        })

        continue
      }

      if (!judged.match) {
        continue
      }

      claimedFindingIndexes.add(findingIndex)
      assignedMatches.push({
        expectedIndex,
        findingIndex,
        semanticReason: judged.reason,
        lineOverlaps:
          matchModeFor(expected) === 'path-line'
            ? lineRulePasses(expected, finding)
            : false,
        severityMatches: expected.severity === finding.severity
      })

      break
    }
  }

  return { assignedMatches, inconclusivePairs, judgeProviderIssues }
}

export const matchEvalFindings = async (
  input: {
    readonly evalCase: EvalCase
    readonly admittedFindings: readonly AdmittedFinding[]
    // Optional only because a case without expected findings needs no judge.
    // A case with expected findings and gate-passing candidates fails loudly.
    readonly judge?: EvalSemanticJudge
  }
): Promise<EvalMatcherResult> => {
  const pass = await runJudgePass({
    evalCase: input.evalCase,
    admittedFindings: input.admittedFindings,
    judge: input.judge
  })
  const matchedExpectedIndexes = new Set(
    pass.assignedMatches.map((match) => match.expectedIndex)
  )
  const matchedFindingIndexes = new Set(
    pass.assignedMatches.map((match) => match.findingIndex)
  )
  const matches = pass.assignedMatches
    .map((match) => ({
      expectedIndex: match.expectedIndex,
      findingId: input.admittedFindings[match.findingIndex]!.id,
      semanticReason: match.semanticReason,
      lineOverlaps: match.lineOverlaps,
      severityMatches: match.severityMatches
    }))
    .sort((left, right) => left.expectedIndex - right.expectedIndex)

  // An inconclusive pair only clouds an expectation or finding that stayed
  // unmatched. Once either side is matched, its verdict is known.
  const inconclusiveExpectedIndexes = [
    ...new Set(
      pass.inconclusivePairs
        .map((pair) => pair.expectedIndex)
        .filter((expectedIndex) => !matchedExpectedIndexes.has(expectedIndex))
    )
  ].sort((left, right) => left - right)
  const inconclusiveFindingIndexes = new Set(
    pass.inconclusivePairs
      .map((pair) => pair.findingIndex)
      .filter((findingIndex) => !matchedFindingIndexes.has(findingIndex))
  )
  const inconclusiveMatches = pass.inconclusivePairs.map((pair) => ({
    expectedIndex: pair.expectedIndex,
    findingId: input.admittedFindings[pair.findingIndex]!.id,
    code: pair.code,
    ...(pair.message === undefined ? {} : { message: pair.message })
  }))

  const unmatchedExpectedIndexes = input.evalCase.expectedFindings
    .map((_expected, expectedIndex) => expectedIndex)
    .filter(
      (expectedIndex) =>
        !matchedExpectedIndexes.has(expectedIndex) &&
        !inconclusiveExpectedIndexes.includes(expectedIndex)
    )
  const matchedFindings = [...matchedFindingIndexes]
    .map((findingIndex) => input.admittedFindings[findingIndex])
    .filter((finding): finding is AdmittedFinding => finding !== undefined)
  const undecidedFindings = input.admittedFindings
    .map((finding, findingIndex) => ({ finding, findingIndex }))
    .filter(
      ({ findingIndex }) =>
        !matchedFindingIndexes.has(findingIndex) &&
        !inconclusiveFindingIndexes.has(findingIndex)
    )

  const duplicateFindingIds = undecidedFindings
    .filter(({ finding }) => isDuplicateOfMatchedFinding(finding, matchedFindings))
    .map(({ finding }) => finding.id)
  const falsePositiveFindingIds = undecidedFindings
    .filter(({ finding }) => !isDuplicateOfMatchedFinding(finding, matchedFindings))
    .map(({ finding }) => finding.id)
  const noFindingZoneFalsePositiveIds = undecidedFindings
    .filter(({ finding }) => !duplicateFindingIds.includes(finding.id))
    .filter(({ finding }) =>
      input.evalCase.expectedNoFindingZones.some((zone) =>
        isInNoFindingZone(zone, finding)
      )
    )
    .map(({ finding }) => finding.id)

  const result: EvalMatcherResult = {
    matches,
    unmatchedExpectedIndexes,
    inconclusiveExpectedIndexes,
    inconclusiveFindingIds: [...inconclusiveFindingIndexes]
      .sort((left, right) => left - right)
      .map((findingIndex) => input.admittedFindings[findingIndex]!.id),
    inconclusiveMatches,
    duplicateFindingIds,
    falsePositiveFindingIds,
    noFindingZoneFalsePositiveIds
  }

  return pass.judgeProviderIssues.length === 0
    ? result
    : { ...result, judgeProviderIssues: pass.judgeProviderIssues }
}
