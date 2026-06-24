import { defineHarness } from '@purista/harness'
import { createNoopReviewLogger } from '../observability/index.js'
import {
  modelFindingRefuterInstructions,
  modelHolisticReviewerInstructions
} from './model-agent-instructions.js'
import {
  FindingRefutationInputSchema,
  HolisticReviewInputSchema,
  ModelFindingRefutationResultSchema,
  ModelHolisticReviewResultSchema
} from './model-agent-contracts.js'
import {
  ReviewWorkflowInputSchema,
  ReviewWorkflowOutputSchema
} from './workflow-contracts.js'
import { runRefutationProviderCall } from './model-provider-call-adapters.js'
import { runModelBackedHolisticTaskReview } from './model-holistic-task-review.js'
import {
  type ModelBackedReviewHarness,
  type ReviewHarness
} from './workflow-session.js'
import { runReviewWorkflowHandler } from './workflow-handler.js'
import {
  effectiveMaxConcurrentTasks,
  harnessDefaults,
  modelReviewWorkflowDelegation,
  reviewAgentOptionsForRole
} from './workflow-harness-config.js'
import { type CreateReviewHarnessOptions } from './harness-options.js'

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
  const agentOptionsForRole = (
    role: Parameters<typeof reviewAgentOptionsForRole>[0]['role']
  ) =>
    reviewAgentOptionsForRole({
      role,
      skillIds,
      ...(options.skillTools === undefined
        ? {}
        : { skillTools: options.skillTools })
    })

  return defineHarness({ name: 'codereviewer-review' })
    .logger(logger)
    .defaults(harnessDefaults(options, maxConcurrentTasks))
    .telemetry({ contentCaptureMode: 'NO_CONTENT' })
    .models({
      reviewer: options.modelAlias
    })
    .tools({})
    .skills(skills)
    .agents(({ agent }) => ({
      holistic_review: agent({
        model: 'reviewer',
        input: HolisticReviewInputSchema,
        output: ModelHolisticReviewResultSchema,
        ...agentOptionsForRole('holistic_review'),
        instructions: modelHolisticReviewerInstructions
      }),
      refute_finding: agent({
        model: 'reviewer',
        input: FindingRefutationInputSchema,
        output: ModelFindingRefutationResultSchema,
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
            runTask: async (taskInput, task, signal) =>
              runModelBackedHolisticTaskReview({
                workflowInput: ctx.input,
                taskInput,
                task,
                runners: {
                  holisticReview: (holisticInput, holisticSignal) =>
                    ctx.agents.holistic_review(
                      holisticInput,
                      holisticSignal === undefined
                        ? {}
                        : { signal: holisticSignal }
                    )
                },
                logger,
                ...(signal === undefined ? {} : { signal })
              }),
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
