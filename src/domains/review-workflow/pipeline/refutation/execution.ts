import { type EvidenceRecord } from '../../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../../admission/index.js'
import {
  refutationVerdictsByCandidateId,
  type FindingRefutationResult,
  type FindingRefutationRunner,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { isTaskPacketBudgetExceededError } from '../packet-budget.js'
import { findingRefutationBatchInput } from './packet.js'
import { type RefutationProviderErrorStage } from '../admission/provider-error-outcome.js'
import { type ReviewWorkflowInput } from '../contracts.js'

// How one candidate of a batch was resolved. A candidate the model did not
// adjudicate is absent from the verdict map and resolves to `missing-verdict`;
// callers treat that as "no signal", never as an invented verdict.
export type RefutationResolution =
  | { readonly status: 'verdict'; readonly refutation: FindingRefutationResult }
  | {
      readonly status: 'provider-error'
      readonly error: unknown
      readonly stage: RefutationProviderErrorStage
    }
  | { readonly status: 'missing-verdict' }

export type BatchRefutationInput = {
  readonly workflowInput: ReviewWorkflowInput
  readonly tasks: readonly WorkflowReviewTask[]
  readonly candidates: readonly CandidateFinding[]
  readonly allCandidates: readonly CandidateFinding[]
  readonly sharedDigest: string
  readonly reviewEvidence: readonly EvidenceRecord[]
  readonly refuteFinding: FindingRefutationRunner
  readonly signal?: AbortSignal
}

const resolutionForAll = (
  candidates: readonly CandidateFinding[],
  resolution: RefutationResolution
): Map<string, RefutationResolution> =>
  new Map(candidates.map((candidate) => [candidate.id, resolution]))

/**
 * Adjudicates every candidate of one task in a SINGLE refutation call.
 *
 * The per-candidate packet repeated the task's whole review context — the changed
 * file — once per candidate; batching sends it once. When a batch does not fit the
 * provider input budget even after the packet sheds its optional context, the batch
 * is split in half and each half retried, so an oversized task degrades into more
 * calls instead of losing its candidates.
 */
export const executeBatchRefutation = async (
  input: BatchRefutationInput
): Promise<ReadonlyMap<string, RefutationResolution>> => {
  if (input.candidates.length === 0) {
    return new Map()
  }

  const providerError = (
    error: unknown,
    stage: RefutationProviderErrorStage
  ): Map<string, RefutationResolution> =>
    resolutionForAll(input.candidates, {
      status: 'provider-error',
      error,
      stage
    })

  const task = input.tasks.find(
    (candidateTask) => candidateTask.id === input.candidates[0]?.taskId
  )

  let packetInput
  try {
    packetInput = findingRefutationBatchInput({
      workflowInput: input.workflowInput,
      task,
      candidates: input.candidates,
      allCandidates: input.allCandidates,
      sharedDigest: input.sharedDigest,
      reviewEvidence: input.reviewEvidence
    }).input
  } catch (error: unknown) {
    // A single candidate that cannot fit is a genuine packet failure; a larger
    // batch can still be split into halves that do fit.
    if (!isTaskPacketBudgetExceededError(error) || input.candidates.length === 1) {
      return providerError(error, 'refutation-packet')
    }

    const middle = Math.floor(input.candidates.length / 2)
    const halves = await Promise.all([
      executeBatchRefutation({
        ...input,
        candidates: input.candidates.slice(0, middle)
      }),
      executeBatchRefutation({
        ...input,
        candidates: input.candidates.slice(middle)
      })
    ])

    return new Map(halves.flatMap((half) => [...half]))
  }

  let batchResult
  try {
    batchResult = await input.refuteFinding(packetInput, input.signal)
  } catch (error: unknown) {
    return providerError(error, 'refutation-check')
  }

  const verdicts = refutationVerdictsByCandidateId(batchResult)

  return new Map(
    input.candidates.map((candidate) => {
      const refutation = verdicts.get(candidate.id)

      return [
        candidate.id,
        refutation === undefined
          ? ({ status: 'missing-verdict' } as const)
          : ({ status: 'verdict', refutation } as const)
      ]
    })
  )
}
