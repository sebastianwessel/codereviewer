import { describe, expect, test } from 'vitest'
import type {
  AdmittedFinding,
  EvidenceRecord,
  FindingProvenance
} from '../../shared/contracts/index.js'
import type { EvalCase } from './eval-fixture.schema.js'
import {
  matchEvalFindings,
  matchEvalFindingsWithSemanticJudge
} from './eval-matcher.js'

const configHash =
  '1111111111111111111111111111111111111111111111111111111111111111'

const provenance: FindingProvenance = {
  reviewer: 'scripted-reviewer',
  instructionHashes: [],
  skillHashes: [],
  analyzerVersions: {},
  configHash
}

const evidence: EvidenceRecord = {
  id: 'ev_match1',
  kind: 'diff',
  summary: 'Branch returns an incorrect value.',
  source: 'scripted-fixture',
  redactionApplied: true
}

const evalCase: EvalCase = {
  id: 'case-match',
  language: 'typescript',
  repositoryFixture: 'fixtures/typescript/simple',
  changedFiles: ['src/app.ts'],
  expectedFindings: [
    {
      category: 'bug',
      severity: 'high',
      path: 'src/app.ts',
      lineRange: [10, 12],
      semanticSummary: 'incorrect return value from changed branch'
    }
  ],
  expectedNoFindingZones: [
    {
      path: 'src/app.ts',
      lineRange: [30, 40],
      reason: 'Formatting-only area must not produce review comments.'
    }
  ],
  tags: ['unit']
}

const admittedFinding = (
  overrides: Partial<AdmittedFinding> = {}
): AdmittedFinding => ({
  id: 'find_match1',
  taskId: 'task_match1',
  category: 'bug',
  severity: 'high',
  title: 'Incorrect return value',
  description: 'The changed branch can return an incorrect value for callers.',
  location: {
    path: 'src/app.ts',
    startLine: 11,
    side: 'new'
  },
  evidenceIds: ['ev_match1'],
  proposedBy: 'scripted-reviewer',
  suggestedFix: 'Return the computed value from the changed branch.',
  admissionStatus: 'admitted',
  admittedAt: '2026-06-20T00:00:00.000Z',
  admissionEvidenceIds: ['ev_match1'],
  reporterEligibility: 'inline',
  provenance,
  baselineStatus: 'new',
  fingerprints: [
    {
      algorithm: 'test',
      value: 'match1'
    }
  ],
  ...overrides
})

describe('eval matcher', () => {
  test('matches findings deterministically by path, nearby line, and semantic tokens', () => {
    const result = matchEvalFindings({
      evalCase,
      admittedFindings: [
        admittedFinding({
          id: 'find_noise1',
          title: 'Unrelated style note',
          description: 'This comment is outside the expected finding.',
          location: {
            path: 'src/app.ts',
            startLine: 31,
            side: 'new'
          }
        }),
        admittedFinding()
      ]
    })

    expect(result.matches).toEqual([
      {
        expectedIndex: 0,
        findingId: 'find_match1',
        semanticScore: 0.833333,
        lineOverlaps: true,
        severityMatches: true
      }
    ])
    expect(result.unmatchedExpectedIndexes).toEqual([])
    expect(result.falsePositiveFindingIds).toEqual(['find_noise1'])
    expect(result.noFindingZoneFalsePositiveIds).toEqual(['find_noise1'])
  })

  test('keeps line mismatches unmatched and reports the admitted finding as noise', () => {
    const result = matchEvalFindings({
      evalCase,
      admittedFindings: [
        admittedFinding({
          id: 'find_line_mismatch1',
          location: {
            path: 'src/app.ts',
            startLine: 50,
            side: 'new'
          }
        })
      ]
    })

    expect(result.matches).toHaveLength(0)
    expect(result.unmatchedExpectedIndexes).toEqual([0])
    expect(result.falsePositiveFindingIds).toEqual(['find_line_mismatch1'])
  })

  test('does not match findings on semantic text alone', () => {
    const result = matchEvalFindings({
      evalCase,
      admittedFindings: [
        admittedFinding({
          id: 'find_wrong_path1',
          location: {
            path: 'src/other.ts',
            startLine: 11,
            side: 'new'
          }
        })
      ]
    })

    expect(result.matches).toHaveLength(0)
    expect(result.unmatchedExpectedIndexes).toEqual([0])
    expect(result.falsePositiveFindingIds).toEqual(['find_wrong_path1'])
  })

  test('matches benchmark semantic-only expectations without path or line metadata', () => {
    const result = matchEvalFindings({
      evalCase: {
        ...evalCase,
        sourceProfile: 'benchmark-semantic',
        expectedFindings: [
          {
            category: 'bug',
            severity: 'high',
            semanticSummary: 'incorrect return value from changed branch',
            matchMode: 'semantic-only'
          }
        ]
      } as unknown as EvalCase,
      admittedFindings: [
        admittedFinding({
          id: 'find_semantic1',
          location: {
            path: 'src/other.ts',
            startLine: 99,
            side: 'new'
          }
        })
      ]
    })

    expect(result.matches).toEqual([
      {
        expectedIndex: 0,
        findingId: 'find_semantic1',
        semanticScore: 0.833333,
        lineOverlaps: false,
        severityMatches: true
      }
    ])
    expect(result.unmatchedExpectedIndexes).toEqual([])
    expect(result.falsePositiveFindingIds).toEqual([])
  })

  test('uses an explicit semantic judge for benchmark paraphrases that deterministic tokens miss', async () => {
    const semanticOnlyCase = {
      ...evalCase,
      sourceProfile: 'benchmark-semantic',
      expectedFindings: [
        {
          category: 'bug',
          severity: 'high',
          semanticSummary:
            'descriptor resource is leaked after the read path exits',
          matchMode: 'semantic-only'
        }
      ]
    } as unknown as EvalCase
    const finding = admittedFinding({
      id: 'find_paraphrase1',
      title: 'File handle stays open',
      description: 'The code never closes the opened stream after reading.',
      location: {
        path: 'src/other.ts',
        startLine: 99,
        side: 'new'
      }
    })

    expect(
      matchEvalFindings({
        evalCase: semanticOnlyCase,
        admittedFindings: [finding]
      }).matches
    ).toEqual([])

    const judged = await matchEvalFindingsWithSemanticJudge({
      evalCase: semanticOnlyCase,
      admittedFindings: [finding],
      judge: async () => ({
        match: true,
        confidence: 0.91
      })
    })

    expect(judged.matches).toEqual([
      {
        expectedIndex: 0,
        findingId: 'find_paraphrase1',
        semanticScore: 0.91,
        lineOverlaps: false,
        severityMatches: true
      }
    ])
    expect(judged.unmatchedExpectedIndexes).toEqual([])
    expect(judged.falsePositiveFindingIds).toEqual([])
  })

  test('never invokes the judge for path-line expectations', async () => {
    const lineCase = {
      ...evalCase,
      expectedFindings: [
        {
          category: 'bug',
          severity: 'high',
          path: 'src/app.ts',
          lineRange: [10, 10],
          semanticSummary: 'null check missing on order',
          matchMode: 'path-line'
        },
        {
          category: 'bug',
          severity: 'high',
          path: 'src/app.ts',
          lineRange: [500, 500],
          semanticSummary: 'unrelated paraphrase the judge would accept',
          matchMode: 'path-line'
        }
      ]
    } as unknown as EvalCase
    const finding = admittedFinding({
      id: 'find_line1',
      title: 'Null check missing',
      description: 'order may be null',
      location: { path: 'src/app.ts', startLine: 10, side: 'new' }
    })
    let judgeCalls = 0

    const judged = await matchEvalFindingsWithSemanticJudge({
      evalCase: lineCase,
      admittedFindings: [finding],
      judge: async () => {
        judgeCalls += 1
        return { match: true, confidence: 0.99 }
      }
    })

    // expected[0] matches deterministically; expected[1] is path-line and must
    // stay unmatched rather than be rescued by the judge.
    expect(judgeCalls).toBe(0)
    expect(judged.matches.map((match) => match.expectedIndex)).toEqual([0])
    expect(judged.unmatchedExpectedIndexes).toEqual([1])
  })
})
