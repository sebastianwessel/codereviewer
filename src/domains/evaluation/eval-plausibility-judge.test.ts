import { describe, expect, test } from 'vitest'
import type { AdmittedFinding, FindingProvenance } from '../../shared/contracts/index.js'
import { parseEvalCases, type EvalCase } from './eval-fixture.schema.js'
import {
  EVAL_PLAUSIBILITY_SOURCE_BYTE_CAP,
  judgeUnmatchedFindingsPlausibility,
  prepareEvalPlausibilitySource,
  type EvalPlausibilityJudge,
  type EvalPlausibilityJudgeInput
} from './eval-plausibility-judge.js'

const hash =
  '2222222222222222222222222222222222222222222222222222222222222222'

const provenance: FindingProvenance = {
  reviewer: 'scripted-reviewer',
  instructionHashes: [],
  skillHashes: [],
  signalVersions: {},
  configHash: hash
}

const finding = (overrides: Partial<AdmittedFinding> = {}): AdmittedFinding => ({
  id: 'find_plaus1',
  taskId: 'task_plaus1',
  category: 'bug',
  severity: 'high',
  title: 'Unmatched finding',
  description: 'An admitted finding that matched no expected finding.',
  location: { path: 'src/app.ts', startLine: 7, side: 'new' },
  evidenceIds: ['ev_plaus1'],
  proposedBy: 'scripted-reviewer',
  fixProposal: {
    summary: 'Fix it.',
    evidenceIds: ['ev_plaus1'],
    safety: 'manual-review'
  },
  admissionStatus: 'admitted',
  admittedAt: '2026-06-20T00:00:00.000Z',
  admissionEvidenceIds: ['ev_plaus1'],
  reporterEligibility: 'inline',
  provenance,
  baselineStatus: 'new',
  fingerprints: [{ algorithm: 'test', value: 'plaus1' }],
  ...overrides
})

const evalCase: EvalCase = parseEvalCases([
  {
    id: 'plausibility-case',
    language: 'typescript',
    repositoryFixture: 'fixtures/typescript/positive',
    changedFiles: ['src/app.ts'],
    expectedFindings: [],
    expectedNoFindingZones: [],
    tags: ['plausibility']
  }
])[0]!

const alwaysReader = async (): Promise<string> => 'const value = compute()\n'

describe('prepareEvalPlausibilitySource', () => {
  test('redacts secrets in the new-side source before it reaches the judge', () => {
    const prepared = prepareEvalPlausibilitySource(
      'const key = "sk-abcdefghijklmnop0123456789"\n'
    )

    expect(prepared).not.toContain('sk-abcdefghijklmnop0123456789')
    expect(prepared).toContain('[REDACTED]')
  })

  test('bounds oversized source to the byte cap without splitting code points', () => {
    const huge = 'a'.repeat(EVAL_PLAUSIBILITY_SOURCE_BYTE_CAP + 5000)
    const prepared = prepareEvalPlausibilitySource(huge)

    expect(Buffer.byteLength(prepared, 'utf8')).toBeLessThanOrEqual(
      EVAL_PLAUSIBILITY_SOURCE_BYTE_CAP
    )
  })

  test('leaves small clean source unchanged', () => {
    const source = 'export const add = (a: number, b: number) => a + b\n'

    expect(prepareEvalPlausibilitySource(source)).toBe(source)
  })
})

describe('judgeUnmatchedFindingsPlausibility', () => {
  test('returns an empty result when no plausibility judge is available', async () => {
    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [finding()],
      matchedFindings: [],
      judge: undefined,
      readFileContent: alwaysReader
    })

    expect(result).toEqual({
      outcomes: [],
      unlistedRealFindingIds: [],
      failClosedFindingIds: [],
      providerIssues: []
    })
  })

  test('returns an empty result when no source reader is available', async () => {
    const judge: EvalPlausibilityJudge = async () => ({
      plausible: true,
      reason: 'genuine'
    })
    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [finding()],
      matchedFindings: [],
      judge,
      readFileContent: undefined
    })

    expect(result.outcomes).toEqual([])
  })

  test('credits a finding the judge deems genuine as an unlisted real defect', async () => {
    const seen: EvalPlausibilityJudgeInput[] = []
    const judge: EvalPlausibilityJudge = async (input) => {
      seen.push(input)

      return { plausible: true, reason: 'The bug is present in the shown code.' }
    }
    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [finding()],
      matchedFindings: [],
      judge,
      readFileContent: alwaysReader
    })

    expect(result.unlistedRealFindingIds).toEqual(['find_plaus1'])
    expect(result.failClosedFindingIds).toEqual([])
    expect(result.providerIssues).toEqual([])
    expect(result.outcomes[0]).toMatchObject({
      findingId: 'find_plaus1',
      plausible: true,
      judged: true
    })
    // The judge saw the redacted/bounded file content, not an empty window.
    expect(seen[0]?.fileContent).toContain('compute()')
  })

  test('leaves a finding the judge deems spurious as a genuine false positive', async () => {
    const judge: EvalPlausibilityJudge = async () => ({
      plausible: false,
      reason: 'The finding misreads the code.'
    })
    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [finding()],
      matchedFindings: [],
      judge,
      readFileContent: alwaysReader
    })

    expect(result.unlistedRealFindingIds).toEqual([])
    expect(result.failClosedFindingIds).toEqual([])
    expect(result.outcomes[0]).toMatchObject({ plausible: false, judged: true })
  })

  test('fails closed when the judge call throws after retries', async () => {
    const judge: EvalPlausibilityJudge = async () => {
      throw new Error('plausibility provider exploded')
    }
    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [finding()],
      matchedFindings: [],
      judge,
      readFileContent: alwaysReader
    })

    // Never credited as real; stays a genuine false positive and is surfaced.
    expect(result.unlistedRealFindingIds).toEqual([])
    expect(result.failClosedFindingIds).toEqual(['find_plaus1'])
    expect(result.providerIssues[0]).toMatchObject({
      stage: 'eval_plausibility_judge',
      recovered: false
    })
    expect(result.outcomes[0]).toMatchObject({ plausible: false, judged: false })
  })

  test('fails closed when the finding source cannot be read', async () => {
    const judge: EvalPlausibilityJudge = async () => ({
      plausible: true,
      reason: 'would say genuine'
    })
    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [finding()],
      matchedFindings: [],
      judge,
      readFileContent: async () => undefined
    })

    expect(result.unlistedRealFindingIds).toEqual([])
    expect(result.failClosedFindingIds).toEqual(['find_plaus1'])
    expect(result.providerIssues[0]).toMatchObject({
      code: 'plausibility_source_unavailable',
      stage: 'eval_plausibility_judge'
    })
  })
})

// Reproduces the traefik shape from the precision audit: a nil-dereference finding
// matched at kubernetes_http.go:592, and the SAME defect restated by the reviewer
// three more times at :593. Before this fix, each restatement was judged alone
// (never shown the matched finding), so all three were individually confirmed
// "plausible" and separately credited as unlisted-real defects -- turning one real
// bug into four counted defects and pinning adjustedPrecision at 100% while raw
// precision collapsed. This test fails against the pre-fix matcher/judge because
// `judgeUnmatchedFindingsPlausibility` had no `matchedFindings` parameter at all
// and credited every plausible finding, restatement or not.
describe('judgeUnmatchedFindingsPlausibility restatement collapsing', () => {
  const nilDerefTitle = 'Nil pointer dereference on cfg after failed load'
  const nilDerefDescription =
    'cfg is dereferenced without checking the error returned by loadConfig, ' +
    'so a missing config file causes a nil pointer dereference.'

  const matchedNilDeref = finding({
    id: 'find_matched_592',
    location: { path: 'src/kubernetes_http.go', startLine: 592, side: 'new' },
    title: nilDerefTitle,
    description: nilDerefDescription
  })

  const restatementAt593 = (id: string): AdmittedFinding =>
    finding({
      id,
      location: { path: 'src/kubernetes_http.go', startLine: 593, side: 'new' },
      title: nilDerefTitle,
      description: nilDerefDescription
    })

  // Models a judge that correctly implements the new contract: it recognizes a
  // restatement only when the finding under review names the SAME defect as one
  // it was shown as already counted, and never invents sameness on its own.
  const restatementAwareJudge: EvalPlausibilityJudge = async (input) => {
    const alreadyCounted = input.alreadyCountedFindings ?? []
    const isSameDefect = alreadyCounted.some(
      (counted) => counted.title === input.findingTitle
    )

    return {
      plausible: true,
      reason: isSameDefect
        ? 'Same defect already credited at a nearby line in this file; not a further defect.'
        : 'A genuine defect the fixture never listed.',
      restatesAlreadyCounted: isSameDefect
    }
  }

  test('does not credit a restatement of an already-matched finding as unlisted-real', async () => {
    const restatements = ['find_restate_a', 'find_restate_b', 'find_restate_c'].map(
      restatementAt593
    )

    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: restatements,
      matchedFindings: [matchedNilDeref],
      judge: restatementAwareJudge,
      readFileContent: alwaysReader
    })

    // The defect is already counted once (as a match). Restating it three more
    // times at an adjacent line must not manufacture three additional real
    // defects: adjustedPrecision would otherwise absorb pure verbosity.
    expect(result.unlistedRealFindingIds).toEqual([])
    expect(result.outcomes.every((outcome) => outcome.plausible)).toBe(true)
    expect(
      result.outcomes.every((outcome) => outcome.restatesAlreadyCounted)
    ).toBe(true)
  })

  test('collapses repeated restatements of a defect the fixture never listed at all', async () => {
    // None of these three match an expected finding, so the FIRST occurrence is
    // the one genuine credit; the second and third restate it and must not add
    // further credit, exactly as if the fixture HAD listed the defect and these
    // were restatements of a matched finding.
    const first = restatementAt593('find_first')
    const second = finding({
      id: 'find_second',
      location: { path: 'src/kubernetes_http.go', startLine: 594, side: 'new' },
      title: nilDerefTitle,
      description: nilDerefDescription
    })
    const third = finding({
      id: 'find_third',
      location: { path: 'src/kubernetes_http.go', startLine: 595, side: 'new' },
      title: nilDerefTitle,
      description: nilDerefDescription
    })

    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [first, second, third],
      matchedFindings: [],
      judge: restatementAwareJudge,
      readFileContent: alwaysReader
    })

    expect(result.unlistedRealFindingIds).toEqual(['find_first'])
  })
})
