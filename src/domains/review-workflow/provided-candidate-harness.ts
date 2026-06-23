import { defineHarness } from '@purista/harness'
import { createStructuredError } from '../../shared/errors/error-normalizer.js'
import { createNoopReviewLogger } from '../observability/index.js'
import {
  ProposedCandidatesSchema,
  TaskReviewInputSchema,
  TaskReviewResultSchema
} from './model-agent-contracts.js'
import {
  ReviewWorkflowInputSchema,
  ReviewWorkflowOutputSchema
} from './workflow-contracts.js'
import { runReviewWorkflowHandler } from './workflow-handler.js'
import {
  effectiveMaxConcurrentTasks,
  harnessDefaults,
  reviewWorkflowDelegation
} from './workflow-harness-config.js'
import { type CreateReviewHarnessOptions } from './harness-options.js'
import { type ReviewHarness } from './workflow-session.js'

const failIfRequested = (
  failBeforeAdmission: CreateReviewHarnessOptions['failBeforeAdmission']
): void => {
  if (failBeforeAdmission === 'provider-timeout') {
    throw createStructuredError({
      code: 'provider_timeout',
      message: 'Provider operation timed out before admission.',
      category: 'provider',
      recoverable: true,
      exitCode: 4,
      details: {
        operation: 'provided_candidate_review_agent'
      }
    })
  }

  if (failBeforeAdmission === 'cancelled') {
    throw createStructuredError({
      code: 'provider_cancelled',
      message: 'Provider operation was cancelled before admission.',
      category: 'provider',
      recoverable: true,
      exitCode: 4,
      details: {
        operation: 'provided_candidate_review_agent'
      }
    })
  }
}

export const createProvidedCandidateReviewHarness = (
  options: CreateReviewHarnessOptions
): ReviewHarness => {
  const skills = options.skills ?? {}
  const logger = options.logger ?? createNoopReviewLogger()
  const maxConcurrentTasks = effectiveMaxConcurrentTasks(
    options.maxConcurrentTasks
  )
  const maxChildAgentCalls = options.maxChildAgentCalls

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
      review_task: agent({
        model: 'reviewer',
        input: TaskReviewInputSchema,
        output: ProposedCandidatesSchema,
        builtinTools: false,
        instructions:
          'Return the admission candidates already provided by the task input.',
        handler: async (ctx) => {
          failIfRequested(options.failBeforeAdmission)

          return {
            candidates: ctx.input.candidates
          }
        }
      })
    }))
    .workflows(({ workflow }) => ({
      review_repository: workflow({
        input: ReviewWorkflowInputSchema,
        output: ReviewWorkflowOutputSchema,
        delegation: reviewWorkflowDelegation(
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
            runTask: async (
              taskInput,
              task,
              signal,
              _contextRetriever,
              _reserveModelInvestigationSlots
            ) => {
              logger.debug('Review task call started.', {
                task_id: task.id,
                task_round: task.round,
                path_count: task.paths.length,
                task_context_count: task.reviewContext.length,
                evidence_count: taskInput.evidence.length,
                candidate_count: taskInput.candidates.length
              })
              const proposed = await ctx.agents.review_task(
                taskInput,
                signal === undefined ? {} : { signal }
              )

              logger.debug('Review task call completed.', {
                task_id: task.id,
                task_round: task.round,
                candidate_count: proposed.candidates.length
              })
              return TaskReviewResultSchema.parse({
                candidates: proposed.candidates
              })
            }
          })
      })
    }))
    .build()
}
