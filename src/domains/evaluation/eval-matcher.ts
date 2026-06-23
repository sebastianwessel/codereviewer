import type { AdmittedFinding } from '../../shared/contracts/index.js'
import { normalizeError } from '../../shared/errors/error-normalizer.js'
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

const MINIMUM_SEMANTIC_SCORE = 0.35
const LINE_TOLERANCE = 3

const stopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'be',
  'by',
  'can',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with'
])

export type EvalFindingMatch = {
  readonly expectedIndex: number
  readonly findingId: string
  readonly semanticScore: number
  readonly semanticReason?: string
  readonly lineOverlaps: boolean
  readonly severityMatches: boolean
}

export type EvalMatcherResult = {
  readonly matches: readonly EvalFindingMatch[]
  readonly unmatchedExpectedIndexes: readonly number[]
  readonly duplicateFindingIds: readonly string[]
  readonly falsePositiveFindingIds: readonly string[]
  readonly noFindingZoneFalsePositiveIds: readonly string[]
  // Provider issues raised by the semantic judge. A judge provider error is
  // recorded here and the affected pair is left unmatched, so one judge failure
  // never rejects the whole eval run.
  readonly judgeProviderIssues?: readonly EvalJudgeProviderIssue[]
}

export type EvalSemanticJudgeInput = {
  readonly expected: ExpectedFinding
  readonly finding: AdmittedFinding
}

export type EvalSemanticJudgeResult = {
  readonly match: boolean
  readonly reason: string
}

export type EvalSemanticJudge = (
  input: EvalSemanticJudgeInput
) => Promise<EvalSemanticJudgeResult>

type CandidatePair = {
  readonly expectedIndex: number
  readonly findingIndex: number
  readonly semanticScore: number
  readonly semanticReason?: string
  readonly lineOverlaps: boolean
  readonly severityMatches: boolean
}

const roundScore = (value: number): number => Math.round(value * 1_000_000) / 1_000_000

const tokenize = (value: string): ReadonlySet<string> => {
  const tokens = value
    .toLowerCase()
    .match(/[a-z0-9]+/gu)

  if (tokens === null) {
    return new Set()
  }

  return new Set(tokens.filter((token) => !stopWords.has(token)))
}

const jaccardSimilarity = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): number => {
  if (left.size === 0 && right.size === 0) {
    return 1
  }

  if (left.size === 0 || right.size === 0) {
    return 0
  }

  let intersectionCount = 0
  for (const token of left) {
    if (right.has(token)) {
      intersectionCount += 1
    }
  }

  const unionCount = new Set([...left, ...right]).size

  return unionCount === 0 ? 0 : intersectionCount / unionCount
}

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

const semanticScoreFor = (
  expected: ExpectedFinding,
  finding: AdmittedFinding
): number =>
  roundScore(
    jaccardSimilarity(
      tokenize(expected.semanticSummary),
      tokenize(`${finding.title} ${finding.description}`)
    )
  )

const pairFor = (
  expected: ExpectedFinding,
  finding: AdmittedFinding,
  expectedIndex: number,
  findingIndex: number
): CandidatePair | undefined => {
  const matchMode = matchModeFor(expected)

  if (
    matchMode !== 'semantic-only' &&
    expected.path !== finding.location.path
  ) {
    return undefined
  }

  if (matchMode === 'path-line' && !lineRulePasses(expected, finding)) {
    return undefined
  }

  const semanticScore = semanticScoreFor(expected, finding)

  if (semanticScore < MINIMUM_SEMANTIC_SCORE) {
    return undefined
  }

  return {
    expectedIndex,
    findingIndex,
    semanticScore,
    lineOverlaps:
      matchMode === 'path-line' ? lineRulePasses(expected, finding) : false,
    severityMatches: expected.severity === finding.severity
  }
}

const pairForJudgedMatch = async (
  expected: ExpectedFinding,
  finding: AdmittedFinding,
  expectedIndex: number,
  findingIndex: number,
  judge: EvalSemanticJudge,
  // A judge provider error is reported here and the pair is left unmatched,
  // rather than rejecting the whole report via Promise.all.
  onJudgeError: (issue: EvalJudgeProviderIssue) => void
): Promise<CandidatePair | undefined> => {
  const matchMode = matchModeFor(expected)

  if (
    matchMode !== 'semantic-only' &&
    expected.path !== finding.location.path
  ) {
    return undefined
  }

  if (matchMode === 'path-line' && !lineRulePasses(expected, finding)) {
    return undefined
  }

  let judged: EvalSemanticJudgeResult
  try {
    judged = await judge({ expected, finding })
  } catch (error) {
    const normalized = normalizeError(error, {
      source: 'provider',
      operation: 'eval_semantic_judge'
    })
    onJudgeError({
      code: 'provider_error',
      stage: 'eval_semantic_judge',
      recovered: false,
      message: normalized.message
    })

    return undefined
  }

  if (!judged.match) {
    return undefined
  }

  return {
    expectedIndex,
    findingIndex,
    semanticScore: 1,
    semanticReason: judged.reason,
    lineOverlaps:
      matchMode === 'path-line' ? lineRulePasses(expected, finding) : false,
    severityMatches: expected.severity === finding.severity
  }
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

const buildMatchResult = (
  input: {
    readonly evalCase: EvalCase
    readonly admittedFindings: readonly AdmittedFinding[]
    readonly candidatePairs: readonly CandidatePair[]
    // Matches already assigned by an earlier pass (e.g. deterministic matching
    // before the semantic judge). Their expected/finding indexes are reserved.
    readonly seededMatches?: readonly EvalFindingMatch[]
    readonly reservedExpectedIndexes?: ReadonlySet<number>
    readonly reservedFindingIndexes?: ReadonlySet<number>
  }
): EvalMatcherResult => {
  const matchedExpectedIndexes = new Set<number>(input.reservedExpectedIndexes)
  const matchedFindingIndexes = new Set<number>(input.reservedFindingIndexes)
  const matches: EvalFindingMatch[] = [...(input.seededMatches ?? [])]
  const candidatePairs = [...input.candidatePairs].sort(
    (left, right) =>
      right.semanticScore - left.semanticScore ||
      left.expectedIndex - right.expectedIndex ||
      left.findingIndex - right.findingIndex
  )

  for (const pair of candidatePairs) {
    if (
      matchedExpectedIndexes.has(pair.expectedIndex) ||
      matchedFindingIndexes.has(pair.findingIndex)
    ) {
      continue
    }

    const finding = input.admittedFindings[pair.findingIndex]
    if (finding === undefined) {
      continue
    }

    matchedExpectedIndexes.add(pair.expectedIndex)
    matchedFindingIndexes.add(pair.findingIndex)
    matches.push({
      expectedIndex: pair.expectedIndex,
      findingId: finding.id,
      semanticScore: pair.semanticScore,
      ...(pair.semanticReason === undefined
        ? {}
        : { semanticReason: pair.semanticReason }),
      lineOverlaps: pair.lineOverlaps,
      severityMatches: pair.severityMatches
    })
  }

  matches.sort((left, right) => left.expectedIndex - right.expectedIndex)

  const unmatchedExpectedIndexes = input.evalCase.expectedFindings
    .map((_expected, expectedIndex) => expectedIndex)
    .filter((expectedIndex) => !matchedExpectedIndexes.has(expectedIndex))
  const matchedFindings = [...matchedFindingIndexes]
    .map((findingIndex) => input.admittedFindings[findingIndex])
    .filter((finding): finding is AdmittedFinding => finding !== undefined)

  const falsePositiveFindingIds = input.admittedFindings
    .map((finding, findingIndex) => ({ finding, findingIndex }))
    .filter(({ findingIndex }) => !matchedFindingIndexes.has(findingIndex))
    .filter(
      ({ finding }) =>
        !isDuplicateOfMatchedFinding(finding, matchedFindings)
    )
    .map(({ finding }) => finding.id)

  const duplicateFindingIds = input.admittedFindings
    .map((finding, findingIndex) => ({ finding, findingIndex }))
    .filter(({ findingIndex }) => !matchedFindingIndexes.has(findingIndex))
    .filter(({ finding }) =>
      isDuplicateOfMatchedFinding(finding, matchedFindings)
    )
    .map(({ finding }) => finding.id)

  const noFindingZoneFalsePositiveIds = input.admittedFindings
    .map((finding, findingIndex) => ({ finding, findingIndex }))
    .filter(({ findingIndex }) => !matchedFindingIndexes.has(findingIndex))
    .filter(({ finding }) => !duplicateFindingIds.includes(finding.id))
    .filter(({ finding }) =>
      input.evalCase.expectedNoFindingZones.some((zone) =>
        isInNoFindingZone(zone, finding)
      )
    )
    .map(({ finding }) => finding.id)

  return {
    matches,
    unmatchedExpectedIndexes,
    duplicateFindingIds,
    falsePositiveFindingIds,
    noFindingZoneFalsePositiveIds
  }
}

export const matchEvalFindings = (
  input: {
    readonly evalCase: EvalCase
    readonly admittedFindings: readonly AdmittedFinding[]
  }
): EvalMatcherResult => {
  const candidatePairs: CandidatePair[] = []

  input.evalCase.expectedFindings.forEach((expected, expectedIndex) => {
    input.admittedFindings.forEach((finding, findingIndex) => {
      const pair = pairFor(expected, finding, expectedIndex, findingIndex)

      if (pair !== undefined) {
        candidatePairs.push(pair)
      }
    })
  })

  return buildMatchResult({
    evalCase: input.evalCase,
    admittedFindings: input.admittedFindings,
    candidatePairs
  })
}

export const matchEvalFindingsWithSemanticJudge = async (
  input: {
    readonly evalCase: EvalCase
    readonly admittedFindings: readonly AdmittedFinding[]
    readonly judge: EvalSemanticJudge
  }
): Promise<EvalMatcherResult> => {
  // Deterministic matching runs first. The LLM judge only resolves expected
  // findings the deterministic matcher left unmatched. Path and line gates still
  // run before judging, so the judge can resolve wording variance without moving
  // a finding to another file or line. Deterministic matches always win.
  const deterministic = matchEvalFindings({
    evalCase: input.evalCase,
    admittedFindings: input.admittedFindings
  })
  const findingIndexById = new Map(
    input.admittedFindings.map((finding, index) => [finding.id, index])
  )
  const reservedExpectedIndexes = new Set(
    deterministic.matches.map((match) => match.expectedIndex)
  )
  const reservedFindingIndexes = new Set(
    deterministic.matches
      .map((match) => findingIndexById.get(match.findingId))
      .filter((index): index is number => index !== undefined)
  )

  const judgeProviderIssues: EvalJudgeProviderIssue[] = []
  const recordJudgeError = (issue: EvalJudgeProviderIssue): void => {
    judgeProviderIssues.push(issue)
  }

  const judgedPairs = (
    await Promise.all(
      input.evalCase.expectedFindings.flatMap((expected, expectedIndex) => {
        if (reservedExpectedIndexes.has(expectedIndex)) {
          return []
        }

        return input.admittedFindings.map((finding, findingIndex) =>
          reservedFindingIndexes.has(findingIndex)
            ? Promise.resolve(undefined)
            : pairForJudgedMatch(
                expected,
                finding,
                expectedIndex,
                findingIndex,
                input.judge,
                recordJudgeError
              )
        )
      })
    )
  ).filter((pair): pair is CandidatePair => pair !== undefined)

  const result = buildMatchResult({
    evalCase: input.evalCase,
    admittedFindings: input.admittedFindings,
    candidatePairs: judgedPairs,
    seededMatches: deterministic.matches,
    reservedExpectedIndexes,
    reservedFindingIndexes
  })

  return judgeProviderIssues.length === 0
    ? result
    : { ...result, judgeProviderIssues }
}
