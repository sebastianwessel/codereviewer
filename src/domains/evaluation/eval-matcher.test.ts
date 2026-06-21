import { describe, expect, test } from 'vitest'
import type {
  AdmittedFinding,
  EvidenceRecord,
  FindingProvenance
} from '../../shared/contracts/index.js'
import type { EvalCase } from './eval-fixture.schema.js'
import { matchEvalFindings } from './eval-matcher.js'

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
})
