import { normalizeError } from '../../shared/errors/error-normalizer.js'
import {
  ReviewTaskExecutionError,
  isReviewTaskExecutionError
} from './workflow-task-queue.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput,
  type ReviewWorkflowInputDraft,
  type ReviewWorkflowOutput
} from './workflow-contracts.js'

type ReviewWorkflowSession = {
  readonly workflows: {
    readonly review_repository: {
      prompt: (
        input: ReviewWorkflowInput,
        options?: { readonly signal?: AbortSignal }
      ) => Promise<ReviewWorkflowOutput>
    }
  }
  close: () => Promise<void>
}

export type ReviewHarness = {
  getSession: (sessionId: string) => Promise<ReviewWorkflowSession>
  shutdown: () => Promise<unknown>
}

export type ModelBackedReviewHarness = ReviewHarness

export const runReviewWorkflowSession = async (
  options: {
    readonly harness: ReviewHarness | ModelBackedReviewHarness
    readonly sessionId: string
    readonly input: ReviewWorkflowInputDraft
    readonly operation: string
    readonly signal?: AbortSignal
  }
): Promise<ReviewWorkflowOutput> => {
  try {
    const session = await options.harness.getSession(options.sessionId)

    try {
      const input = ReviewWorkflowInputSchema.parse(options.input)
      const invokeOptions =
        options.signal === undefined ? {} : { signal: options.signal }

      return await session.workflows.review_repository.prompt(
        input,
        invokeOptions
      )
    } finally {
      await session.close()
    }
  } catch (error) {
    if (isReviewTaskExecutionError(error)) {
      throw error
    }

    throw normalizeError(error, {
      source: 'provider',
      operation: options.operation
    })
  }
}

export const runModelBackedReviewWorkflow = (
  options: {
    readonly harness: ModelBackedReviewHarness
    readonly sessionId: string
    readonly input: ReviewWorkflowInputDraft
    readonly signal?: AbortSignal
  }
): Promise<ReviewWorkflowOutput> =>
  runReviewWorkflowSession({
    ...options,
    operation: 'run_model_backed_review_workflow'
  })

export { ReviewTaskExecutionError, isReviewTaskExecutionError }
