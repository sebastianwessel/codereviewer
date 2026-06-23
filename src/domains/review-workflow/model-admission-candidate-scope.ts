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

export const candidateOverlapsReviewedDiffRanges = (
  candidate: CandidateFinding,
  ranges: readonly ReviewedDiffRange[] | undefined
): boolean => {
  if (ranges === undefined || ranges.length === 0) {
    return true
  }

  const candidateRange = {
    startLine: candidate.location.startLine,
    endLine: candidate.location.endLine ?? candidate.location.startLine
  }

  return ranges
    .filter((range) => range.path === candidate.location.path)
    .some(
      (range) =>
        candidateRange.startLine <= range.endLine &&
        range.startLine <= candidateRange.endLine
    )
}

export const rejectedFindingForOutOfDiffScope = (
  candidate: CandidateFinding
): RejectedFinding =>
  RejectedFindingSchema.parse({
    candidateId: candidate.id,
    status: 'needs-more-evidence',
    reason: 'not-in-scope',
    message:
      'Model candidate is outside the reviewed diff ranges and lacks deterministic corroboration.',
    evidenceIds: candidate.evidenceIds
  })
