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
