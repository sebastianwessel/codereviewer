import { describe, expect, test } from 'vitest'
import type {
  AdmittedFinding,
  FindingProvenance
} from '../../shared/contracts/index.js'
import type { EvalCase } from './eval-fixture.schema.js'
import {
  matchEvalFindings,
  type EvalSemanticJudge,
  type EvalSemanticJudgeInput
} from './eval-matcher.js'

const configHash =
  '1111111111111111111111111111111111111111111111111111111111111111'

const provenance: FindingProvenance = {
  reviewer: 'scripted-reviewer',
  instructionHashes: [],
  skillHashes: [],
  signalVersions: {},
  configHash
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
  fixProposal: {
    summary: 'Return the computed value from the changed branch.',
    evidenceIds: ['ev_match1'],
    safety: 'manual-review'
  },
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

type RecordingJudge = {
  readonly judge: EvalSemanticJudge
  readonly calls: EvalSemanticJudgeInput[]
}

const recordingJudge = (
  decide: (input: EvalSemanticJudgeInput) => boolean = () => true
): RecordingJudge => {
  const calls: EvalSemanticJudgeInput[] = []

  return {
    calls,
    judge: async (input) => {
      calls.push(input)

      return {
        match: decide(input),
        reason: 'Both summaries describe the same defect.'
      }
    }
  }
}

const throwingJudge: EvalSemanticJudge = async () => {
  throw new Error('judge provider exploded')
}

describe('eval matcher', () => {
  test('accepts a judged match and records the judge rationale', async () => {
    const judge = recordingJudge()
    const result = await matchEvalFindings({
      evalCase,
      admittedFindings: [admittedFinding()],
      judge: judge.judge
    })

    expect(result.matches).toEqual([
      {
        expectedIndex: 0,
        findingId: 'find_match1',
        semanticReason: 'Both summaries describe the same defect.',
        lineOverlaps: true,
        severityMatches: true
      }
    ])
    expect(result.unmatchedExpectedIndexes).toEqual([])
    expect(result.falsePositiveFindingIds).toEqual([])
    // The judge never sees paths, lines, source, or diffs.
    expect(judge.calls).toEqual([
      {
        expectedSummary: 'incorrect return value from changed branch',
        findingTitle: 'Incorrect return value',
        findingDescription:
          'The changed branch can return an incorrect value for callers.'
      }
    ])
  })

  test('records a rejected judge decision as a miss and a false positive', async () => {
    const judge = recordingJudge(() => false)
    const result = await matchEvalFindings({
      evalCase,
      admittedFindings: [admittedFinding()],
      judge: judge.judge
    })

    expect(result.matches).toEqual([])
    expect(result.unmatchedExpectedIndexes).toEqual([0])
    expect(result.falsePositiveFindingIds).toEqual(['find_match1'])
    expect(result.inconclusiveMatches).toEqual([])
    expect(judge.calls).toHaveLength(1)
  })

  test('rejects a wrong path before calling the judge', async () => {
    const judge = recordingJudge()
    const result = await matchEvalFindings({
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
      ],
      judge: judge.judge
    })

    expect(judge.calls).toEqual([])
    expect(result.matches).toEqual([])
    expect(result.unmatchedExpectedIndexes).toEqual([0])
    expect(result.falsePositiveFindingIds).toEqual(['find_wrong_path1'])
  })

  test('rejects out-of-tolerance lines before calling the judge', async () => {
    const judge = recordingJudge()
    const result = await matchEvalFindings({
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
      ],
      judge: judge.judge
    })

    expect(judge.calls).toEqual([])
    expect(result.matches).toEqual([])
    expect(result.unmatchedExpectedIndexes).toEqual([0])
    expect(result.falsePositiveFindingIds).toEqual(['find_line_mismatch1'])
  })

  test('keeps a finding within the three-line tolerance eligible for judging', async () => {
    const judge = recordingJudge()
    const result = await matchEvalFindings({
      evalCase,
      admittedFindings: [
        admittedFinding({
          id: 'find_tolerated_line1',
          location: {
            path: 'src/app.ts',
            startLine: 15,
            side: 'new'
          }
        })
      ],
      judge: judge.judge
    })

    expect(judge.calls).toHaveLength(1)
    expect(result.matches.map((match) => match.findingId)).toEqual([
      'find_tolerated_line1'
    ])
  })

  test('matches semantic-only expectations regardless of path and line', async () => {
    const semanticOnlyCase = {
      ...evalCase,
      sourceProfile: 'benchmark-semantic',
      expectedFindings: [
        {
          category: 'bug',
          severity: 'high',
          semanticSummary: 'descriptor resource is leaked after the read exits',
          matchMode: 'semantic-only'
        }
      ],
      expectedNoFindingZones: []
    } as unknown as EvalCase
    const result = await matchEvalFindings({
      evalCase: semanticOnlyCase,
      admittedFindings: [
        admittedFinding({
          id: 'find_semantic1',
          title: 'File handle stays open',
          description: 'The code never closes the opened stream after reading.',
          location: {
            path: 'src/other.ts',
            startLine: 99,
            side: 'new'
          }
        })
      ],
      judge: recordingJudge().judge
    })

    expect(result.matches).toEqual([
      {
        expectedIndex: 0,
        findingId: 'find_semantic1',
        semanticReason: 'Both summaries describe the same defect.',
        lineOverlaps: false,
        severityMatches: true
      }
    ])
  })

  test('classifies extra same-location findings as duplicates instead of false positives', async () => {
    const result = await matchEvalFindings({
      evalCase,
      admittedFindings: [
        admittedFinding(),
        admittedFinding({
          id: 'find_duplicate1',
          title: 'Return branch repeats wrong value',
          description:
            'The same changed branch is reported again at the same source line.',
          location: {
            path: 'src/app.ts',
            startLine: 11,
            side: 'new'
          },
          fingerprints: [
            {
              algorithm: 'test',
              value: 'duplicate1'
            }
          ]
        })
      ],
      judge: recordingJudge().judge
    })

    expect(result.matches.map((match) => match.findingId)).toEqual([
      'find_match1'
    ])
    expect(result.duplicateFindingIds).toEqual(['find_duplicate1'])
    expect(result.falsePositiveFindingIds).toEqual([])
    expect(result.noFindingZoneFalsePositiveIds).toEqual([])
  })

  test('reports unmatched findings inside a no-finding zone', async () => {
    const result = await matchEvalFindings({
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
      ],
      judge: recordingJudge().judge
    })

    expect(result.matches.map((match) => match.findingId)).toEqual([
      'find_match1'
    ])
    expect(result.falsePositiveFindingIds).toEqual(['find_noise1'])
    expect(result.noFindingZoneFalsePositiveIds).toEqual(['find_noise1'])
  })

  test('assigns pairs deterministically by expected index then finding index', async () => {
    const twoExpectedCase = {
      ...evalCase,
      expectedFindings: [
        {
          category: 'bug',
          severity: 'high',
          semanticSummary: 'first expected defect',
          matchMode: 'semantic-only'
        },
        {
          category: 'bug',
          severity: 'high',
          semanticSummary: 'second expected defect',
          matchMode: 'semantic-only'
        }
      ],
      expectedNoFindingZones: []
    } as unknown as EvalCase
    const admittedFindings = [
      admittedFinding({ id: 'find_a' }),
      admittedFinding({ id: 'find_b' })
    ]
    // An indiscriminate judge accepts every pair, so only the deterministic
    // ordering decides the assignment.
    const first = await matchEvalFindings({
      evalCase: twoExpectedCase,
      admittedFindings,
      judge: recordingJudge().judge
    })
    const second = await matchEvalFindings({
      evalCase: twoExpectedCase,
      admittedFindings,
      judge: recordingJudge().judge
    })

    expect(first.matches.map((match) => [match.expectedIndex, match.findingId])).toEqual([
      [0, 'find_a'],
      [1, 'find_b']
    ])
    expect(second.matches).toEqual(first.matches)
  })

  test('marks a failed judge call inconclusive instead of a miss or false positive', async () => {
    const result = await matchEvalFindings({
      evalCase,
      admittedFindings: [admittedFinding()],
      judge: throwingJudge
    })

    expect(result.matches).toEqual([])
    // Neither a missed expected finding nor a false positive is fabricated.
    expect(result.unmatchedExpectedIndexes).toEqual([])
    expect(result.falsePositiveFindingIds).toEqual([])
    expect(result.duplicateFindingIds).toEqual([])
    expect(result.noFindingZoneFalsePositiveIds).toEqual([])
    expect(result.inconclusiveExpectedIndexes).toEqual([0])
    expect(result.inconclusiveFindingIds).toEqual(['find_match1'])
    expect(result.inconclusiveMatches).toEqual([
      {
        expectedIndex: 0,
        findingId: 'find_match1',
        code: 'provider_error',
        message: expect.any(String)
      }
    ])
    expect(result.judgeProviderIssues).toEqual([
      expect.objectContaining({
        code: 'provider_error',
        stage: 'eval_semantic_judge',
        recovered: false
      })
    ])
  })

  test('keeps a decided expectation out of the inconclusive set', async () => {
    let call = 0
    const result = await matchEvalFindings({
      evalCase,
      admittedFindings: [
        admittedFinding({ id: 'find_first' }),
        admittedFinding({ id: 'find_second' })
      ],
      judge: async () => {
        call += 1
        if (call === 1) {
          throw new Error('judge provider exploded')
        }

        return { match: true, reason: 'Same defect, different wording.' }
      }
    })

    expect(result.matches.map((match) => match.findingId)).toEqual([
      'find_second'
    ])
    // Expectation 0 was decided by the second pair, so it is not inconclusive.
    expect(result.inconclusiveExpectedIndexes).toEqual([])
    // The first finding stayed undecided and must not be a false positive.
    expect(result.inconclusiveFindingIds).toEqual(['find_first'])
    expect(result.falsePositiveFindingIds).toEqual([])
  })

  test('fails loudly when a case with expected findings has no judge', async () => {
    await expect(
      matchEvalFindings({
        evalCase,
        admittedFindings: [admittedFinding()]
      })
    ).rejects.toMatchObject({
      code: 'eval_semantic_judge_missing',
      category: 'config',
      exitCode: 2
    })
  })

  test('scores a case with no expected findings offline', async () => {
    const negativeCase = {
      ...evalCase,
      expectedFindings: []
    } as unknown as EvalCase
    const result = await matchEvalFindings({
      evalCase: negativeCase,
      admittedFindings: [
        admittedFinding({
          id: 'find_noise1',
          location: { path: 'src/app.ts', startLine: 31, side: 'new' }
        })
      ]
    })

    expect(result.matches).toEqual([])
    expect(result.falsePositiveFindingIds).toEqual(['find_noise1'])
    expect(result.noFindingZoneFalsePositiveIds).toEqual(['find_noise1'])
  })
})
