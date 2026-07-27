import type { AdmittedFinding } from '../../shared/contracts/index.js'
import {
  createStructuredError,
  normalizeError,
  type StructuredError
} from '../../shared/errors/error-normalizer.js'
import {
  resolveExpectedFindingMatchMode,
  type EvalCase,
  type EvalLineRange,
  type ExpectedFinding,
  type ExpectedNoFindingZone
} from './eval-fixture.schema.js'

export type EvalJudgeProviderIssue = {
  readonly code: string
  readonly stage: string
  readonly recovered: false
  readonly message?: string
}

// Line gate tolerance. Deterministic, exact, and applied before any judge call.
// Exported so the eval runner can apply the SAME tolerance when it derives the
// diagnostic `linePlacementRate` (spec 06 item 0.3) from the raw produced
// location this module now records on every match; a second, silently
// diverging tolerance constant would make the two line metrics disagree for no
// reason a reader could see.
export const LINE_TOLERANCE = 3

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
  // DIAGNOSTIC ONLY (spec 06 item 0.3), recorded for EVERY matched pair
  // regardless of match mode. `lineOverlaps` above is the strict scoring
  // signal and only ever fires for `path-line`; it must stay that way. These
  // two fields exist so the eval runner can additionally compute
  // `linePlacementRate` -- a looser, non-gating observation over every match
  // whose expectation happens to declare a `lineRange`, which is how line
  // placement becomes measurable on `path-semantic` expectations (the entire
  // primary corpus) for the first time. Never used to decide a match and never
  // fed into `lineAccuracy` or the regression gate.
  readonly producedPath: string
  readonly producedStartLine: number
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

// Exported for the same reason as `LINE_TOLERANCE`: the eval runner reuses this
// exact overlap rule to score the diagnostic `linePlacementRate`, rather than
// re-deriving a second overlap definition that could quietly drift from this
// one.
export const rangesOverlap = (
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

// Deterministic gates. Exact, reproducible, and always evaluated before the
// judge is called, so the judge can never move a finding to another file or
// line.
const gatesPass = (
  expected: ExpectedFinding,
  finding: AdmittedFinding
): boolean => {
  const matchMode = resolveExpectedFindingMatchMode(expected)

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

// Zero tolerance is deliberate and NOT the fix for a finding that restates a
// matched defect at a nearby-but-non-overlapping line (e.g. a matched finding at
// line 592 and a restatement at 593): a precision audit found that shape common
// enough to visibly inflate adjustedPrecision, and the instinctive fix is to
// widen this tolerance. That is a blunter instrument than it looks. This check is
// purely textual (same path, overlapping line range) with no view of WHAT either
// finding says, so widening it would just as readily merge two genuinely
// different defects that happen to sit a few lines apart (two independent
// nil-dereferences on consecutive lines are not the same bug) as it would catch a
// real restatement -- and it would do so silently, discarding a true positive
// with no signal that anything was lost. Whether two findings describe the SAME
// underlying defect is a semantic question, not a line-distance one, so it
// belongs to a judge that can read both descriptions: see
// `EvalAlreadyCountedFinding` and `restatesAlreadyCounted` in
// eval-plausibility-judge.ts, which now asks exactly that question for every
// unmatched finding this raw, zero-tolerance check does not catch.
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
  readonly producedPath: string
  readonly producedStartLine: number
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

// The judge verdict for one expectation/finding pair. `inconclusive` is kept as
// a distinct outcome because a failed judge call is not a rejection: it must
// never become an edge, and it must never be re-asked either.
type PairVerdict =
  | { readonly kind: 'accepted'; readonly reason: string }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'inconclusive' }

const pairKey = (expectedIndex: number, findingIndex: number): string =>
  `${expectedIndex}:${findingIndex}`

// Assignment used to be greedy: expectations were walked in ascending order and
// the first judge-accepted finding claimed the expectation for good. That is not
// merely suboptimal, it is biased in the same direction as the phenomenon this
// matcher exists to measure. The open question about this reviewer is whether it
// reports roughly one defect per file and misses later expectations; a greedy
// matcher manufactures exactly that signal, because a loose accept for an early
// expectation can consume the only finding a later expectation could have
// matched, and the later expectation is then scored as a miss the reviewer never
// committed. Measuring a one-finding-per-file hypothesis with an instrument that
// invents extra later-expectation misses would confound the result, so the
// assignment is a maximum-cardinality bipartite matching instead: no expectation
// is scored as a miss while a pairing exists that would have matched it.
//
// The algorithm is Kuhn's augmenting-path search over a graph that is tiny here
// (typically one to three expectations against one or two findings), so no
// dependency and no flow machinery is warranted.
//
// Determinism and tie-breaking. Several maximum pairings can exist; the one
// chosen is fixed by two rules that are applied in ascending index order:
//   1. Expectations are served in ascending expected index.
//   2. An expectation always prefers the lowest admitted finding index still
//      available to it, including when it is displaced and re-seated.
// A finding is only taken from its current owner when that owner can be re-seated
// elsewhere, so an expectation never loses a match it already holds. Identical
// inputs and a deterministic judge therefore always yield the identical pairing,
// and one admitted finding still matches at most one expected finding.
//
// Judge calls are paid provider calls, so every pair is judged at most once: the
// deterministic `gatesPass` filter runs first and cheaply excludes pairs the
// judge must never see, and every verdict is cached by pair. The worst case is
// therefore unchanged from the greedy pass — one judge call per gate-passing
// pair — while the common case where the greedy seeding is already optimal costs
// exactly what greedy cost.
const runJudgePass = async (
  input: {
    readonly evalCase: EvalCase
    readonly admittedFindings: readonly AdmittedFinding[]
    readonly judge: EvalSemanticJudge | undefined
  }
): Promise<JudgePassResult> => {
  const inconclusivePairs: InconclusivePair[] = []
  const judgeProviderIssues: EvalJudgeProviderIssue[] = []
  const verdicts = new Map<string, PairVerdict>()
  const expectedFindings = input.evalCase.expectedFindings

  // Candidate edges the judge is allowed to see at all, ascending by finding
  // index. Computed once from the deterministic gates, so the augmenting search
  // can never widen the judge's reach.
  const candidateFindingIndexes = expectedFindings.map((expected) =>
    input.admittedFindings.flatMap((finding, findingIndex) =>
      gatesPass(expected, finding) ? [findingIndex] : []
    )
  )

  const verdictFor = async (
    expectedIndex: number,
    findingIndex: number
  ): Promise<PairVerdict> => {
    const key = pairKey(expectedIndex, findingIndex)
    const cached = verdicts.get(key)
    if (cached !== undefined) {
      return cached
    }

    if (input.judge === undefined) {
      throw missingSemanticJudgeError(input.evalCase.id)
    }

    const expected = expectedFindings[expectedIndex]!
    const finding = input.admittedFindings[findingIndex]!

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
      const verdict: PairVerdict = { kind: 'inconclusive' }
      verdicts.set(key, verdict)

      return verdict
    }

    const verdict: PairVerdict = judged.match
      ? { kind: 'accepted', reason: judged.reason }
      : { kind: 'rejected' }
    verdicts.set(key, verdict)

    return verdict
  }

  const isAccepted = async (
    expectedIndex: number,
    findingIndex: number
  ): Promise<boolean> => (await verdictFor(expectedIndex, findingIndex)).kind === 'accepted'

  // Owner of each admitted finding, indexed by finding index.
  const ownerExpectedIndexes = new Map<number, number>()

  // Seed with a pass that only takes free findings. It costs no more judge calls
  // than the old greedy pass and reaches the same pairing whenever greedy was
  // already optimal, which keeps the common case cheap and stable.
  for (const expectedIndex of expectedFindings.keys()) {
    for (const findingIndex of candidateFindingIndexes[expectedIndex]!) {
      if (ownerExpectedIndexes.has(findingIndex)) {
        continue
      }

      if (await isAccepted(expectedIndex, findingIndex)) {
        ownerExpectedIndexes.set(findingIndex, expectedIndex)
        break
      }
    }
  }

  // Kuhn's augmenting step for one expectation. `visitedFindingIndexes` keeps a
  // single search from revisiting a finding, which both terminates the recursion
  // and bounds it to the candidate edges.
  const tryAssign = async (
    expectedIndex: number,
    visitedFindingIndexes: Set<number>
  ): Promise<boolean> => {
    for (const findingIndex of candidateFindingIndexes[expectedIndex]!) {
      if (visitedFindingIndexes.has(findingIndex)) {
        continue
      }

      if (!(await isAccepted(expectedIndex, findingIndex))) {
        continue
      }

      visitedFindingIndexes.add(findingIndex)
      const currentOwner = ownerExpectedIndexes.get(findingIndex)

      if (
        currentOwner === undefined ||
        (await tryAssign(currentOwner, visitedFindingIndexes))
      ) {
        ownerExpectedIndexes.set(findingIndex, expectedIndex)

        return true
      }
    }

    return false
  }

  const seededExpectedIndexes = new Set(ownerExpectedIndexes.values())
  for (const expectedIndex of expectedFindings.keys()) {
    if (!seededExpectedIndexes.has(expectedIndex)) {
      await tryAssign(expectedIndex, new Set<number>())
    }
  }

  const assignedMatches: AssignedMatch[] = [...ownerExpectedIndexes.entries()]
    .map(([findingIndex, expectedIndex]) => {
      const expected = expectedFindings[expectedIndex]!
      const finding = input.admittedFindings[findingIndex]!
      const verdict = verdicts.get(pairKey(expectedIndex, findingIndex))

      return {
        expectedIndex,
        findingIndex,
        // Every assigned pair was accepted by the judge, so its cached rationale
        // is always present; the fallback only keeps the type honest.
        semanticReason: verdict?.kind === 'accepted' ? verdict.reason : '',
        lineOverlaps:
          resolveExpectedFindingMatchMode(expected) === 'path-line'
            ? lineRulePasses(expected, finding)
            : false,
        severityMatches: expected.severity === finding.severity,
        producedPath: finding.location.path,
        producedStartLine: finding.location.startLine
      }
    })
    .sort((left, right) => left.expectedIndex - right.expectedIndex)

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
      severityMatches: match.severityMatches,
      producedPath: match.producedPath,
      producedStartLine: match.producedStartLine
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
