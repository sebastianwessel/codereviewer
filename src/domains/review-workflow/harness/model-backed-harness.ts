import { defineHarness } from '@purista/harness'
import { createNoopReviewLogger } from '../../observability/index.js'
import {
  holisticReviewerInstructionsFor,
  modelFindingRefuterInstructions,
  modelSemanticMergeInstructions
} from '../pipeline/agent-instructions.js'
import {
  createBoundedRetrievalTools,
  type ContextRetriever
} from '../../context-retrieval/index.js'
import {
  crossFileDiscoveryToolDefinitions,
  runWithCrossFileDiscoveryTools
} from '../pipeline/discovery/cross-file-tools.js'
import {
  FindingRefutationBatchInputSchema,
  HolisticReviewInputSchema,
  ModelFindingRefutationBatchResultSchema,
  ModelHolisticReviewResultSchema,
  ModelSemanticMergeResultSchema,
  SemanticMergeInputSchema
} from '../pipeline/agent-contracts.js'
import {
  ReviewWorkflowInputSchema,
  ReviewWorkflowOutputSchema
} from '../pipeline/contracts.js'
import { runRefutationProviderCall } from './provider-call-adapters.js'
import { runModelBackedHolisticTaskReview } from '../pipeline/discovery/holistic-task-review.js'
import {
  type ModelBackedReviewHarness,
  type ReviewHarness
} from './session.js'
import { runReviewWorkflowHandler } from '../pipeline/handler.js'
import {
  effectiveMaxConcurrentTasks,
  harnessDefaults,
  modelReviewWorkflowDelegation,
  reviewAgentOptionsForRole
} from './config.js'
import { type CreateReviewHarnessOptions } from './options.js'

export const createModelBackedReviewHarness = (
  options: CreateReviewHarnessOptions
): ModelBackedReviewHarness => {
  const skills = options.skills ?? {}
  const logger = options.logger ?? createNoopReviewLogger()
  const maxConcurrentTasks = effectiveMaxConcurrentTasks(
    options.maxConcurrentTasks
  )
  const maxChildAgentCalls = options.maxChildAgentCalls
  const skillIds = options.skillIds ?? Object.keys(skills)
  // Spec 16: cross-file retrieval is off unless configured on. When off, no tool is
  // registered, the discovery agent gets no tool list, and its instructions are the
  // unchanged single-shot prompt.
  const crossFileRetrieval = options.crossFileRetrieval
  const crossFileEnabled = crossFileRetrieval?.enabled === true

  // Binds one task's bounded repository tools for the duration of its discovery
  // call, so every tool call the model makes resolves that task's own budget (see
  // `cross-file-tools.ts`). With the mode disabled, or when the workflow has no
  // retriever (no repository root), the discovery call runs unwrapped and no tool
  // is reachable.
  const runDiscoveryTask = async <T>(
    contextRetriever: ContextRetriever | undefined,
    runTask: () => Promise<T>
  ): Promise<T> => {
    if (!crossFileEnabled || contextRetriever === undefined) {
      return runTask()
    }

    const bounded = createBoundedRetrievalTools({
      retriever: contextRetriever,
      maxToolCalls: crossFileRetrieval.maxToolCallsPerTask
    })

    const result = await runWithCrossFileDiscoveryTools(
      bounded.tools,
      // Spec 28: nothing caps a read in advance, so an overflow is discovered by
      // hitting the provider's real limit. This is what makes the retry smaller.
      contextRetriever.reduceReadBudget,
      runTask
    )

    logger.debug('Cross-file discovery retrieval completed.', {
      tool_call_count: bounded.toolCallCount(),
      bytes_read: bounded.bytesRead(),
      budget_exhausted: bounded.budgetExhausted()
    })

    return result
  }
  const agentOptionsForRole = (
    role: Parameters<typeof reviewAgentOptionsForRole>[0]['role']
  ) =>
    reviewAgentOptionsForRole({
      role,
      skillIds,
      ...(options.skillTools === undefined
        ? {}
        : { skillTools: options.skillTools }),
      ...(crossFileRetrieval === undefined ? {} : { crossFileRetrieval })
    })

  return defineHarness({ name: 'codereviewer-review' })
    .logger(logger)
    .defaults(harnessDefaults(options, maxConcurrentTasks))
    .telemetry({ contentCaptureMode: 'NO_CONTENT' })
    .models({
      reviewer: options.modelAlias
    })
    .tools(crossFileEnabled ? crossFileDiscoveryToolDefinitions : {})
    .skills(skills)
    .agents(({ agent }) => ({
      holistic_review: agent({
        model: 'reviewer',
        input: HolisticReviewInputSchema,
        output: ModelHolisticReviewResultSchema,
        ...agentOptionsForRole('holistic_review'),
        instructions: holisticReviewerInstructionsFor({
          crossFileRetrievalEnabled: crossFileEnabled
        })
      }),
      // Spec 05: the semantic finding merge. Compact and tool-free — one step,
      // no tools — and deliberately its OWN agent rather than extra duties on
      // the refuter: requiring unrelated judgements in one call is a measured
      // cause of degraded refutation, which is the stage this engine's precision
      // depends on.
      semantic_merge: agent({
        model: 'reviewer',
        input: SemanticMergeInputSchema,
        output: ModelSemanticMergeResultSchema,
        builtinTools: false,
        maxSteps: 1,
        instructions: modelSemanticMergeInstructions
      }),
      refute_finding: agent({
        model: 'reviewer',
        input: FindingRefutationBatchInputSchema,
        output: ModelFindingRefutationBatchResultSchema,
        ...agentOptionsForRole('refute_finding'),
        instructions: modelFindingRefuterInstructions
      })
    }))
    .workflows(({ workflow }) => ({
      review_repository: workflow({
        input: ReviewWorkflowInputSchema,
        output: ReviewWorkflowOutputSchema,
        delegation: modelReviewWorkflowDelegation(
          maxConcurrentTasks,
          maxChildAgentCalls
        ),
        handler: (ctx) =>
          runReviewWorkflowHandler({
            input: ctx.input,
            signal: ctx.signal,
            logger,
            maxConcurrentTasks,
            ...(options.onTaskEvent === undefined
              ? {}
              : { onTaskEvent: options.onTaskEvent }),
            runTask: async (taskInput, task, signal, contextRetriever) =>
              runDiscoveryTask(contextRetriever, () =>
                runModelBackedHolisticTaskReview({
                  workflowInput: ctx.input,
                  taskInput,
                  task,
                  runners: {
                    // None of these calls forwards prior conversation: the harness
                    // default is `historyWindow: 0` (see `harnessDefaults`), so a
                    // call never opens holding the output of a call that finished
                    // before it (spec 05, Conversation History).
                    holisticReview: (holisticInput, holisticSignal) =>
                      ctx.agents.holistic_review(
                        holisticInput,
                        holisticSignal === undefined
                          ? {}
                          : { signal: holisticSignal }
                      ),
                    semanticMerge: (mergeInput, mergeSignal) =>
                      ctx.agents.semantic_merge(
                        mergeInput,
                        mergeSignal === undefined ? {} : { signal: mergeSignal }
                      )
                  },
                  logger,
                  ...(signal === undefined ? {} : { signal })
                })
              ),
            refuteFinding: async (refutationInput, signal) => {
              return runRefutationProviderCall({
                refutationInput,
                refuteFinding: (input, refutationSignal) =>
                  ctx.agents.refute_finding(
                    input,
                    refutationSignal === undefined
                      ? {}
                      : { signal: refutationSignal }
                  ),
                logger,
                ...(signal === undefined ? {} : { signal })
              })
            }
          })
      })
    }))
    .build() as ReviewHarness
}
