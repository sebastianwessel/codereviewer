import type { Logger } from '@purista/harness'
import type { CodeReviewerConfig } from '../../shared/contracts/index.js'
import {
  createNoContentEventRecorder,
  createNoopReviewLogger,
  type NoContentEventRecorder
} from '../observability/index.js'

export type ReviewRunnerRunObservabilityState = {
  readonly observability: NoContentEventRecorder
  readonly logger: Logger
}

export const prepareReviewRunnerRunObservability = (input: {
  readonly runId: string
  readonly configHash: string
  readonly config: CodeReviewerConfig
  readonly observability?: NoContentEventRecorder
  readonly logger?: Logger
}): ReviewRunnerRunObservabilityState => {
  const observability = input.observability ?? createNoContentEventRecorder()
  const logger = (input.logger ?? createNoopReviewLogger()).child({
    run_id: input.runId
  })

  observability.startRun({
    runId: input.runId,
    mode: input.config.review.mode,
    depth: input.config.review.depth,
    configHash: input.configHash,
    ...(input.config.provider === undefined
      ? {}
      : {
          providerId: input.config.provider.id,
          modelName: input.config.provider.model
        })
  })
  logger.info('Review run started.', {
    mode: input.config.review.mode,
    depth: input.config.review.depth,
    provider_configured: input.config.provider !== undefined
  })

  return { observability, logger }
}
