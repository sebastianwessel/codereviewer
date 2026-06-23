import {
  RejectedFindingSchema,
  type RejectedFinding
} from '../../shared/contracts/index.js'
import {
  type CandidateFinding,
  type ReviewedDiffRange
} from '../admission/index.js'

export const isModelProposedCandidate = (
  candidate: CandidateFinding
): boolean => candidate.proposedBy === 'review-agent'

// Blast-radius admission scope. A change can introduce a defect on the exact
// changed lines OR expose a pre-existing defect elsewhere in the same changed
// file (e.g. a modified caller now reaches inverted logic a few lines away).
// The spec admission contract is "introduced OR exposed by the change", so a
// candidate anywhere in a CHANGED FILE is in scope; only candidates in files
// with no reviewed change are out of scope. Literal hunk-line overlap is still
// used for INLINE-COMMENT eligibility (a separate path in the admission gate),
// so relaxing this admission scope keeps out-of-hunk findings in the report
// without turning them into inline comment noise.
export const candidateWithinReviewedScope = (
  candidate: CandidateFinding,
  ranges: readonly ReviewedDiffRange[] | undefined
): boolean => {
  if (ranges === undefined || ranges.length === 0) {
    return true
  }

  return ranges.some((range) => range.path === candidate.location.path)
}

export const rejectedFindingForOutOfDiffScope = (
  candidate: CandidateFinding
): RejectedFinding =>
  RejectedFindingSchema.parse({
    candidateId: candidate.id,
    status: 'needs-more-evidence',
    reason: 'not-in-scope',
    message:
      'Model candidate is in a file with no reviewed changes and lacks deterministic corroboration.',
    evidenceIds: candidate.evidenceIds
  })
