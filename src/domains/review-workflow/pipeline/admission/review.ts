import type { EvidenceRecord } from '../../../../shared/contracts/index.js'
import type { CandidateFinding } from '../../../admission/index.js'
import type {
  FindingRefutationRunner,
  WorkflowReviewTask
} from '../agent-contracts.js'
import { reviewCandidateForAdmission } from './candidate-review.js'
import { noRefuterAdmissionOutcome } from './preflight-outcome.js'
import { mapWithBoundedConcurrencyInOrder } from '../ordered-bounded-map.js'
import type { DebugLogger } from '../debug-logger.js'
import {
  executeBatchRefutation,
  type RefutationResolution
} from '../refutation/execution.js'
import {
  candidateWithinReviewedScope,
  isModelProposedCandidate
} from './candidate-scope.js'
import {
  mergeAdmissionCandidateOutcomes,
  type AdmissionCandidateOutcome
} from './outcome.js'
import type { ReviewWorkflowInput } from '../contracts.js'

// Only a model-proposed candidate inside the reviewed scope costs a refutation
// call. Support-signal candidates and out-of-scope candidates are decided by
// deterministic preflight rules, so they are never sent to the model.
const candidateNeedsRefutation = (
  candidate: CandidateFinding,
  workflowInput: ReviewWorkflowInput
): boolean =>
  isModelProposedCandidate(candidate) &&
  candidateWithinReviewedScope(candidate, workflowInput.reviewedDiffRanges)

// Group the refutable candidates by the task that raised them. Every candidate in a
// group shares one review context, which is exactly what makes a single batched call
// correct — and what makes the per-candidate packet so wasteful.
const candidatesByTask = (
  candidates: readonly CandidateFinding[]
): readonly (readonly CandidateFinding[])[] => {
  const groups = new Map<string, CandidateFinding[]>()

  for (const candidate of candidates) {
    const group = groups.get(candidate.taskId)

    if (group === undefined) {
      groups.set(candidate.taskId, [candidate])
      continue
    }

    group.push(candidate)
  }

  return [...groups.values()]
}

export const prepareCandidatesForAdmission = async (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly tasks: readonly WorkflowReviewTask[]
    readonly candidates: readonly CandidateFinding[]
    readonly reviewEvidence?: readonly EvidenceRecord[]
    readonly refuteFinding?: FindingRefutationRunner
    readonly signal?: AbortSignal
    readonly logger?: DebugLogger
  }
): Promise<AdmissionCandidateOutcome> => {
  if (input.refuteFinding === undefined) {
    return noRefuterAdmissionOutcome({
      candidates: input.candidates,
      workflowEvidence: input.workflowInput.evidence
    })
  }
  const refuteFinding = input.refuteFinding
  const reviewEvidence = input.reviewEvidence ?? input.workflowInput.evidence

  const refutationGroups = candidatesByTask(
    input.candidates.filter((candidate) =>
      candidateNeedsRefutation(candidate, input.workflowInput)
    )
  )

  // One refutation call per task, run with the same bounded concurrency the review
  // uses for its tasks.
  const groupResolutions = await mapWithBoundedConcurrencyInOrder({
    items: refutationGroups,
    concurrency: input.workflowInput.maxConcurrentTasks ?? 1,
    mapItem: (candidates) =>
      executeBatchRefutation({
        workflowInput: input.workflowInput,
        tasks: input.tasks,
        candidates,
        allCandidates: input.candidates,
        reviewEvidence,
        refuteFinding,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(input.logger === undefined ? {} : { logger: input.logger })
      })
  })

  const resolutionsByCandidateId = new Map<string, RefutationResolution>(
    groupResolutions.flatMap((resolutions) => [...resolutions])
  )

  const outcomes = input.candidates.map((candidate) =>
    reviewCandidateForAdmission({
      workflowInput: input.workflowInput,
      candidate,
      resolution: resolutionsByCandidateId.get(candidate.id) ?? {
        status: 'missing-verdict'
      }
    })
  )

  return mergeAdmissionCandidateOutcomes({
    workflowEvidence: input.workflowInput.evidence,
    outcomes
  })
}
