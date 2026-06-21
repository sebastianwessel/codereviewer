import type { AdmittedFinding } from '../../shared/contracts/index.js'
import type {
  EvalCase,
  EvalLineRange,
  ExpectedFinding,
  ExpectedNoFindingZone
} from './eval-fixture.schema.js'

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
  readonly lineOverlaps: boolean
  readonly severityMatches: boolean
}

export type EvalMatcherResult = {
  readonly matches: readonly EvalFindingMatch[]
  readonly unmatchedExpectedIndexes: readonly number[]
  readonly falsePositiveFindingIds: readonly string[]
  readonly noFindingZoneFalsePositiveIds: readonly string[]
}

type CandidatePair = {
  readonly expectedIndex: number
  readonly findingIndex: number
  readonly semanticScore: number
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
  if (expected.path !== finding.location.path) {
    return undefined
  }

  if (!lineRulePasses(expected, finding)) {
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
    lineOverlaps: true,
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

  candidatePairs.sort(
    (left, right) =>
      right.semanticScore - left.semanticScore ||
      left.expectedIndex - right.expectedIndex ||
      left.findingIndex - right.findingIndex
  )

  const matchedExpectedIndexes = new Set<number>()
  const matchedFindingIndexes = new Set<number>()
  const matches: EvalFindingMatch[] = []

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
      lineOverlaps: pair.lineOverlaps,
      severityMatches: pair.severityMatches
    })
  }

  matches.sort((left, right) => left.expectedIndex - right.expectedIndex)

  const unmatchedExpectedIndexes = input.evalCase.expectedFindings
    .map((_expected, expectedIndex) => expectedIndex)
    .filter((expectedIndex) => !matchedExpectedIndexes.has(expectedIndex))

  const falsePositiveFindingIds = input.admittedFindings
    .map((finding, findingIndex) => ({ finding, findingIndex }))
    .filter(({ findingIndex }) => !matchedFindingIndexes.has(findingIndex))
    .map(({ finding }) => finding.id)

  const noFindingZoneFalsePositiveIds = input.admittedFindings
    .map((finding, findingIndex) => ({ finding, findingIndex }))
    .filter(({ findingIndex }) => !matchedFindingIndexes.has(findingIndex))
    .filter(({ finding }) =>
      input.evalCase.expectedNoFindingZones.some((zone) =>
        isInNoFindingZone(zone, finding)
      )
    )
    .map(({ finding }) => finding.id)

  return {
    matches,
    unmatchedExpectedIndexes,
    falsePositiveFindingIds,
    noFindingZoneFalsePositiveIds
  }
}
