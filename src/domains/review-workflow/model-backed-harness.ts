import { defineHarness } from '@purista/harness'
import { createNoopReviewLogger } from '../observability/index.js'
import {
  modelFindingAggregateInstructions,
  modelFindingInvestigatorInstructions,
  modelFindingJudgeInstructions,
  modelFindingRefuterInstructions,
  modelHolisticReviewerInstructions,
  modelIntentPlannerInstructions,
  modelReviewerInstructions,
  modelSiblingSweepInstructions
} from './model-agent-instructions.js'
import {
  FindingAggregateReviewInputSchema,
  FindingInvestigationInputSchema,
  FindingJudgeInputSchema,
  FindingRefutationInputSchema,
  IntentPlanningInputSchema,
  ModelFindingAggregateResultSchema,
  ModelFindingInvestigationResultSchema,
  ModelFindingJudgeResultSchema,
  ModelFindingRefutationResultSchema,
  ModelHolisticReviewResultSchema,
  ModelReviewIntentPlanSchema,
  ModelTaskSuggestionsSchema,
  SiblingSweepInputSchema,
  TaskReviewInputSchema
} from './model-agent-contracts.js'
import {
  ReviewWorkflowInputSchema,
  ReviewWorkflowOutputSchema
} from './workflow-contracts.js'
import {
  runAggregateProofReviewProviderCall,
  runIntentPlanningProviderCall,
  runJudgeProviderCall,
  runRefutationProviderCall
} from './model-provider-call-adapters.js'
import { runModelBackedTaskReview } from './model-task-review.js'
import { runModelBackedHolisticTaskReview } from './model-holistic-task-review.js'
import { tasksForWorkflowInput } from './workflow-task-planning.js'
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
      plan_review_intents: agent({
        model: 'reviewer',
        input: IntentPlanningInputSchema,
        output: ModelReviewIntentPlanSchema,
        ...agentOptionsForRole('plan_review_intents'),
        instructions: modelIntentPlannerInstructions
      }),
      review_task: agent({
        model: 'reviewer',
        input: TaskReviewInputSchema,
        output: ModelTaskSuggestionsSchema,
        ...agentOptionsForRole('review_task'),
        instructions: modelReviewerInstructions
      }),
      holistic_review: agent({
        model: 'reviewer',
        input: TaskReviewInputSchema,
        output: ModelHolisticReviewResultSchema,
        ...agentOptionsForRole('review_task'),
        instructions: modelHolisticReviewerInstructions
      }),
      investigate_suspicion: agent({
        model: 'reviewer',
        input: FindingInvestigationInputSchema,
        output: ModelFindingInvestigationResultSchema,
        ...agentOptionsForRole('investigate_suspicion'),
        instructions: modelFindingInvestigatorInstructions
      }),
      aggregate_findings: agent({
        model: 'reviewer',
        input: FindingAggregateReviewInputSchema,
        output: ModelFindingAggregateResultSchema,
        ...agentOptionsForRole('aggregate_findings'),
        instructions: modelFindingAggregateInstructions
      }),
      sweep_sibling_suspicions: agent({
        model: 'reviewer',
        input: SiblingSweepInputSchema,
        output: ModelTaskSuggestionsSchema,
        ...agentOptionsForRole('sweep_sibling_suspicions'),
        instructions: modelSiblingSweepInstructions
      }),
      refute_finding: agent({
        model: 'reviewer',
        input: FindingRefutationInputSchema,
        output: ModelFindingRefutationResultSchema,
        ...agentOptionsForRole('refute_finding'),
        instructions: modelFindingRefuterInstructions
      }),
      judge_finding: agent({
        model: 'reviewer',
        input: FindingJudgeInputSchema,
        output: ModelFindingJudgeResultSchema,
        ...agentOptionsForRole('judge_finding'),
        instructions: modelFindingJudgeInstructions
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
            planReviewIntents: async (planningInput, signal) => {
              return runIntentPlanningProviderCall({
                planningInput,
                tasks: tasksForWorkflowInput(ctx.input),
                planReviewIntents: (input, planningSignal) =>
                  ctx.agents.plan_review_intents(
                    input,
                    planningSignal === undefined
                      ? {}
                      : { signal: planningSignal }
                  ),
                logger,
                ...(signal === undefined ? {} : { signal })
              })
            },
            runTask: async (
              taskInput,
              task,
              signal,
              contextRetriever,
              reserveModelInvestigationSlots
            ) =>
              ctx.input.discoveryMode === 'holistic'
                ? runModelBackedHolisticTaskReview({
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
                  })
                : runModelBackedTaskReview({
                workflowInput: ctx.input,
                taskInput,
                task,
                contextRetriever,
                reserveModelInvestigationSlots,
                runners: {
                  reviewTask: (reviewInput, reviewSignal) =>
                    ctx.agents.review_task(
                      reviewInput,
                      reviewSignal === undefined ? {} : { signal: reviewSignal }
                    ),
                  investigateSuspicion: (investigationInput, investigationSignal) =>
                    ctx.agents.investigate_suspicion(
                      investigationInput,
                      investigationSignal === undefined
                        ? {}
                        : { signal: investigationSignal }
                    ),
                  sweepSiblingSuspicions: (siblingSweepInput, sweepSignal) =>
                    ctx.agents.sweep_sibling_suspicions(
                      siblingSweepInput,
                      sweepSignal === undefined ? {} : { signal: sweepSignal }
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
            },
            aggregateFindingProofs: async (aggregateInput, signal) => {
              return runAggregateProofReviewProviderCall({
                aggregateInput,
                aggregateFindingProofs: (input, aggregateSignal) =>
                  ctx.agents.aggregate_findings(
                    input,
                    aggregateSignal === undefined
                      ? {}
                      : { signal: aggregateSignal }
                  ),
                logger,
                ...(signal === undefined ? {} : { signal })
              })
            },
            judgeFinding: async (judgeInput, signal) => {
              return runJudgeProviderCall({
                judgeInput,
                judgeFinding: (input, judgeSignal) =>
                  ctx.agents.judge_finding(
                    input,
                    judgeSignal === undefined ? {} : { signal: judgeSignal }
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
