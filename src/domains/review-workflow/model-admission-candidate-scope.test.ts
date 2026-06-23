import { describe, expect, test } from 'vitest'
import { type CandidateFinding } from '../admission/index.js'
import {
  candidateOverlapsReviewedDiffRanges,
  isModelProposedCandidate,
  rejectedFindingForOutOfDiffScope
} from './model-admission-candidate-scope.js'

const candidate = (
  input: {
    readonly id?: string
    readonly proposedBy?: CandidateFinding['proposedBy']
    readonly path?: string
    readonly startLine?: number
    readonly endLine?: number
    readonly evidenceIds?: string[]
  } = {}
): CandidateFinding => ({
  id: input.id ?? 'cand_model1',
  taskId: 'task_admission',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch can lose data',
  description: 'The model claims the changed branch can lose data.',
  location: {
    path: input.path ?? 'src/admission.ts',
    startLine: input.startLine ?? 12,
    ...(input.endLine === undefined ? {} : { endLine: input.endLine }),
    side: 'new'
  },
  evidenceIds: input.evidenceIds ?? ['ev_support1'],
  proposedBy: input.proposedBy ?? 'review-agent'
})

describe('model admission candidate scope', () => {
  test('classifies model-origin candidates', () => {
    expect(isModelProposedCandidate(candidate())).toBe(true)
    expect(
      isModelProposedCandidate(
        candidate({ proposedBy: 'typescript-support-signal' })
      )
    ).toBe(false)
  })

  test('allows absent reviewed ranges and inclusive same-path overlaps', () => {
    expect(candidateOverlapsReviewedDiffRanges(candidate(), undefined)).toBe(true)
    expect(candidateOverlapsReviewedDiffRanges(candidate(), [])).toBe(true)
    expect(
      candidateOverlapsReviewedDiffRanges(candidate({ startLine: 10 }), [
        { path: 'src/admission.ts', startLine: 10, endLine: 12 }
      ])
    ).toBe(true)
    expect(
      candidateOverlapsReviewedDiffRanges(candidate({ startLine: 12 }), [
        { path: 'src/admission.ts', startLine: 10, endLine: 12 }
      ])
    ).toBe(true)
  })

  test('rejects path mismatches and non-overlapping line ranges', () => {
    expect(
      candidateOverlapsReviewedDiffRanges(candidate({ path: 'src/other.ts' }), [
        { path: 'src/admission.ts', startLine: 1, endLine: 30 }
      ])
    ).toBe(false)
    expect(
      candidateOverlapsReviewedDiffRanges(
        candidate({ startLine: 31, endLine: 34 }),
        [{ path: 'src/admission.ts', startLine: 1, endLine: 30 }]
      )
    ).toBe(false)
  })

  test('creates out-of-scope rejected findings with candidate evidence', () => {
    expect(rejectedFindingForOutOfDiffScope(candidate())).toEqual({
      candidateId: 'cand_model1',
      status: 'needs-more-evidence',
      reason: 'not-in-scope',
      message:
        'Model candidate is outside the reviewed diff ranges and lacks deterministic corroboration.',
      evidenceIds: ['ev_support1']
    })
  })
})
