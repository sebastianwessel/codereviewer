import { normalizeError } from '../../../shared/errors/error-normalizer.js'
import {
  ReviewTaskExecutionError,
  isReviewTaskExecutionError
} from '../pipeline/task-queue.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput,
  type ReviewWorkflowInputDraft,
  type ReviewWorkflowOutput
} from '../pipeline/contracts.js'

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

export const runModelBackedReviewWorkflow = async (
  options: {
    readonly harness: ReviewHarness
    readonly sessionId: string
    readonly input: ReviewWorkflowInputDraft
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
    // A task-execution failure already carries the task events and partial results
    // the caller reports; normalizing it would erase them.
    if (isReviewTaskExecutionError(error)) {
      throw error
    }

    throw normalizeError(error, {
      source: 'provider',
      operation: 'run_model_backed_review_workflow'
    })
  }
}

export { ReviewTaskExecutionError, isReviewTaskExecutionError }
