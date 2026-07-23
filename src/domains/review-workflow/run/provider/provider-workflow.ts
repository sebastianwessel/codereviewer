import type { Logger, SkillsConfig } from '@purista/harness'
import type { CodeReviewerConfig } from '../../../../shared/contracts/index.js'
import {
  createProviderUsageRecorder,
  type RunTokenUsage
} from '../../../costs/index.js'
import type { NoContentEventRecorder } from '../../../observability/index.js'
import {
  resolveProviderModelAlias,
  type ProviderImport
} from '../../../provider-resolution/index.js'
import {
  createModelBackedReviewHarness,
  runModelBackedReviewWorkflow,
  type ReviewWorkflowInput,
  type ReviewWorkflowOutput
} from '../../harness/workflow.js'
import { maxChildAgentCallsForReview } from '../../harness/config.js'

const reviewWorkflowSessionId = 'review'

export const runProviderWorkflow = async (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly config: CodeReviewerConfig
    readonly environment: Readonly<Record<string, string | undefined>>
    readonly providerImport?: ProviderImport
    readonly skillDefinitions: SkillsConfig
    readonly skillIds: readonly string[]
    readonly logger?: Logger
    readonly observability?: NoContentEventRecorder
    readonly signal?: AbortSignal
    readonly onTaskEvent?: (
      event: ReviewWorkflowOutput['taskEvents'][number]
    ) => void
  }
): Promise<
  | {
      readonly output: Awaited<ReturnType<typeof runModelBackedReviewWorkflow>>
      readonly usage: RunTokenUsage
    }
  | undefined
> => {
  if (input.config.provider === undefined || input.config.aiReview.enabled === false) {
    return undefined
  }

  const providerStep = input.observability?.startStep('provider_workflow', {
    providerId: input.config.provider.id,
    modelName: input.config.provider.model,
    taskCount: input.workflowInput.tasks?.length ?? 0
  })
  input.logger?.debug('Resolving model provider.', {
    provider_id: input.config.provider.id,
    model: input.config.provider.model
  })
  const provider = await resolveProviderModelAlias({
    provider: input.config.provider,
    environment: input.environment,
    ...(input.logger === undefined ? {} : { logger: input.logger }),
    ...(input.providerImport === undefined
      ? {}
      : { importProvider: input.providerImport })
  })
  input.logger?.debug('Model provider resolved.', {
    provider_id: provider.providerId,
    adapter_package: provider.providerPackage,
    model: input.config.provider.model
  })
  const usageRecorder = createProviderUsageRecorder(provider.modelAlias)
  input.logger?.debug('Review harness creation started.', {
    task_count: input.workflowInput.tasks?.length ?? 0,
    max_concurrent_tasks: input.config.review.maxConcurrentTasks,
    run_timeout_configured: input.config.review.runTimeoutMs !== undefined
  })
  const maxChildAgentCalls = maxChildAgentCallsForReview({
    taskCount:
      input.workflowInput.tasks?.length ?? input.workflowInput.reviewedPaths.length,
    maxConcurrentTasks: input.config.review.maxConcurrentTasks
  })
  const harness = createModelBackedReviewHarness({
    modelAlias: usageRecorder.modelAlias,
    skills: input.skillDefinitions,
    skillIds: input.skillIds,
    skillTools: input.config.skills.allowTools,
    maxConcurrentTasks: input.config.review.maxConcurrentTasks,
    maxChildAgentCalls,
    ...(input.config.review.runTimeoutMs === undefined
      ? {}
      : { runTimeoutMs: input.config.review.runTimeoutMs }),
    ...(input.logger === undefined ? {} : { logger: input.logger }),
    ...(input.onTaskEvent === undefined
      ? {}
      : { onTaskEvent: input.onTaskEvent })
  })
  input.logger?.debug('Review harness creation completed.', {
    task_count: input.workflowInput.tasks?.length ?? 0
  })

  try {
    input.logger?.debug('Model-backed review workflow invocation started.', {
      session_id: reviewWorkflowSessionId,
      task_count: input.workflowInput.tasks?.length ?? 0,
      reviewed_path_count: input.workflowInput.reviewedPaths.length
    })
    const output = await runModelBackedReviewWorkflow({
      harness,
      sessionId: reviewWorkflowSessionId,
      input: input.workflowInput,
      ...(input.signal === undefined ? {} : { signal: input.signal })
    })
    const usage = usageRecorder.usage()

    input.logger?.debug('Model-backed review workflow completed.', {
      task_count: input.workflowInput.tasks?.length ?? 0,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens
    })
    providerStep?.end({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens
    })
    input.logger?.debug('Provider workflow step completed.', {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens
    })

    return {
      output,
      usage
    }
  } finally {
    input.logger?.debug('Review harness shutdown started.')
    await harness.shutdown()
    input.logger?.debug('Review harness shutdown completed.')
  }
}
