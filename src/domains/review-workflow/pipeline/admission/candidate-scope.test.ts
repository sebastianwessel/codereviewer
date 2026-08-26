import { describe, expect, test } from 'vitest'
import type { CandidateFinding } from '../../../admission/index.js'
import { reviewedDiffRangesForDiffMaps } from '../../run/context/context.js'
import {
  candidateWithinReviewedScope,
  isModelProposedCandidate,
  rejectedFindingForOutOfDiffScope
} from './candidate-scope.js'

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

  test('allows absent reviewed ranges and any candidate in a changed file', () => {
    expect(candidateWithinReviewedScope(candidate(), undefined)).toBe(true)
    expect(candidateWithinReviewedScope(candidate(), [])).toBe(true)
    // In a changed file but outside the changed lines: still in scope, because
    // the change can expose a pre-existing defect a few lines away.
    expect(
      candidateWithinReviewedScope(candidate({ startLine: 12 }), [
        { path: 'src/admission.ts', startLine: 10, endLine: 12 }
      ])
    ).toBe(true)
    expect(
      candidateWithinReviewedScope(candidate({ startLine: 31, endLine: 34 }), [
        { path: 'src/admission.ts', startLine: 1, endLine: 30 }
      ])
    ).toBe(true)
  })

  test('rejects candidates in files with no reviewed change', () => {
    expect(
      candidateWithinReviewedScope(candidate({ path: 'src/other.ts' }), [
        { path: 'src/admission.ts', startLine: 1, endLine: 30 }
      ])
    ).toBe(false)
  })

  // The regression this whole pair of modules exists to prevent, driven through the
  // real range derivation rather than a hand-written range list: the bug was that
  // the two disagreed about what a pure-deletion hunk contributes.
  //
  // Mixed change: file A only DELETES lines, file B adds some. Before the fix, A
  // produced no range at all, the list was non-empty because of B, and so every
  // candidate in A — including one at the deletion site, which is exactly where
  // "this change broke its callers" lives — was rejected as out-of-diff scope.
  test('keeps a candidate in a pure-deletion file in scope when another file has additions', () => {
    const ranges = reviewedDiffRangesForDiffMaps([
      {
        path: 'src/deleted-only.ts',
        changeKind: 'modified',
        hunks: [
          { oldStartLine: 10, oldLineCount: 4, newStartLine: 9, newLineCount: 0 }
        ]
      },
      {
        path: 'src/added.ts',
        changeKind: 'modified',
        hunks: [
          { oldStartLine: 2, oldLineCount: 0, newStartLine: 3, newLineCount: 2 }
        ]
      }
    ])

    expect(ranges.map((range) => range.path)).toEqual([
      'src/deleted-only.ts',
      'src/added.ts'
    ])
    expect(
      candidateWithinReviewedScope(
        candidate({ path: 'src/deleted-only.ts', startLine: 9 }),
        ranges
      )
    ).toBe(true)
    // Elsewhere in the same pure-deletion file, too: admission scope is the file,
    // not the removal point.
    expect(
      candidateWithinReviewedScope(
        candidate({ path: 'src/deleted-only.ts', startLine: 42 }),
        ranges
      )
    ).toBe(true)
    // Unchanged files are still out of scope; the fix must not widen that.
    expect(
      candidateWithinReviewedScope(
        candidate({ path: 'src/untouched.ts', startLine: 9 }),
        ranges
      )
    ).toBe(false)
  })

  test('creates out-of-scope rejected findings with candidate evidence', () => {
    expect(rejectedFindingForOutOfDiffScope(candidate())).toEqual({
      candidateId: 'cand_model1',
      status: 'needs-more-evidence',
      reason: 'not-in-scope',
      message:
        'Model candidate is in a file with no reviewed changes and lacks deterministic corroboration.',
      evidenceIds: ['ev_support1'],
      severity: 'high'
    })
  })
})
