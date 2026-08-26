import { ModelError, ValidationError } from '@purista/harness'
import type { EvidenceRecord } from '../../../../shared/contracts/index.js'
import type { CandidateFinding } from '../../../admission/index.js'
import {
  refutationVerdictsByCandidateId,
  type FindingRefutationResult,
  type FindingRefutationRunner,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import type { DebugLogger } from '../debug-logger.js'
import { isTaskPacketBudgetExceededError } from '../packet-budget.js'
import { findingRefutationBatchInput } from './packet.js'
import type { RefutationProviderErrorStage } from '../admission/provider-error-outcome.js'
import type { ReviewWorkflowInput } from '../contracts.js'

// A refutation call can fail two structurally different ways, and only one of
// them is ours to retry. A hard provider failure - auth, rate limiting, a
// network error, an unavailable provider - already carries its own retry policy
// inside the harness's model layer (see `ModelError`'s `retriable` flag), so
// retrying it again here would silently double an already-handled backoff.
// The failure this DOES retry is a single bad model response that the harness
// marks non-retriable at its own layer because auto-retrying it is the wrong
// default for every caller: either the response failed the harness's own output
// schema check (`ValidationError`, `where: 'agent_output'`), or the provider
// adapter could not parse a structured object out of the response at all
// (`ModelError`, `reason: 'malformed_response'` or `'unstructured_response'`).
// Both are "the model returned garbage this one time," and a fresh call over the
// identical packet routinely produces a valid response - measurement found this
// firing 16 times across 9 cases in 12 archived runs, with one case failing in 6
// of 11 runs, which is the recall this retry recovers.
const isRetriableRefutationOutputFailure = (error: unknown): boolean => {
  if (error instanceof ValidationError) {
    return error.meta?.where === 'agent_output'
  }

  if (error instanceof ModelError) {
    return (
      error.meta?.reason === 'malformed_response' ||
      error.meta?.reason === 'unstructured_response'
    )
  }

  return false
}

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
  readonly reviewEvidence: readonly EvidenceRecord[]
  readonly refuteFinding: FindingRefutationRunner
  readonly signal?: AbortSignal
  readonly logger?: DebugLogger
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
 *
 * The call itself gets ONE retry, but only when it fails with an output-validation
 * or malformed-structured-output failure (see `isRetriableRefutationOutputFailure`);
 * a hard provider error is never retried here, since that already has its own retry
 * policy. This composes with the splitting above rather than multiplying it: a
 * split happens before any call is made (while sizing the packet), so a retry never
 * doubles the split, and a split half that itself fails only gets its own single
 * retry, never a multiple of the parent batch's retries.
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
      reviewEvidence: input.reviewEvidence
    })
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
    if (!isRetriableRefutationOutputFailure(error)) {
      return providerError(error, 'refutation-check')
    }

    // One retry over the identical packet: the failure this recovers is one bad
    // response, not a systemic outage, so a second attempt is where nearly all of
    // the recoverable value is - looping further would spend real cost chasing a
    // task that is genuinely failing rather than one that had a bad roll.
    try {
      batchResult = await input.refuteFinding(packetInput, input.signal)
      input.logger?.debug('Refutation output-validation retry succeeded.', {
        task_id: task?.id,
        candidate_count: input.candidates.length
      })
    } catch (retryError: unknown) {
      input.logger?.debug('Refutation output-validation retry failed.', {
        task_id: task?.id,
        candidate_count: input.candidates.length
      })
      return providerError(retryError, 'refutation-check')
    }
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
