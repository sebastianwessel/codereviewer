import { type BuiltinToolName } from '@purista/harness'

const defaultMaxConcurrentTasks = 4
const defaultRunTimeoutMs = 0
const defaultMaxChildAgentCalls = 16
const maxChildAgentCallCap = 2048
const readonlySkillTools = ['read', 'list', 'grep'] as const satisfies readonly BuiltinToolName[]
const compactAgentMaxSteps = 1
const contextHeavyAgentMaxSteps = 4

export type ReviewAgentRole =
  | 'plan_review_intents'
  | 'review_task'
  | 'investigate_suspicion'
  | 'aggregate_findings'
  | 'sweep_sibling_suspicions'
  | 'refute_finding'
  | 'judge_finding'

export const effectiveMaxConcurrentTasks = (
  maxConcurrentTasks: number | undefined
): number => maxConcurrentTasks ?? defaultMaxConcurrentTasks

export const maxChildAgentCallsForReview = (
  input: {
    readonly taskCount?: number
    readonly maxConcurrentTasks?: number
    readonly maxInvestigationsPerRun?: number
    readonly maxInvestigationRounds?: number
    readonly judgeFindings?: boolean
    readonly intentPlanning?: 'deterministic' | 'model'
  } = {}
): number => {
  const taskCount = Math.max(0, input.taskCount ?? 0)
  const maxConcurrentTasks = effectiveMaxConcurrentTasks(input.maxConcurrentTasks)
  const maxInvestigationsPerRun = Math.max(
    0,
    input.maxInvestigationsPerRun ?? 0
  )
  const maxInvestigationRounds = Math.max(1, input.maxInvestigationRounds ?? 1)
  const plannerCalls =
    input.intentPlanning === 'model' && taskCount > 1 ? 1 : 0
  const reviewTaskCalls = taskCount
  const investigationCalls = maxInvestigationsPerRun * maxInvestigationRounds
  const proofLoopRefutationCalls = maxInvestigationsPerRun
  const siblingSweepCalls = input.judgeFindings === true ? taskCount : 0
  const criticCalls =
    input.judgeFindings === true ? maxInvestigationsPerRun + 1 : 0
  const concurrencyBuffer = maxConcurrentTasks * 2
  const derived =
    plannerCalls +
    reviewTaskCalls +
    investigationCalls +
    proofLoopRefutationCalls +
    siblingSweepCalls +
    criticCalls +
    concurrencyBuffer

  return Math.min(
    maxChildAgentCallCap,
    Math.max(defaultMaxChildAgentCalls, derived)
  )
}

export const harnessDefaults = (
  options: {
    readonly runTimeoutMs?: number
  },
  maxConcurrentTasks: number
) => ({
  runTimeoutMs: options.runTimeoutMs ?? defaultRunTimeoutMs,
  delegation: {
    maxParallelChildAgentCalls: maxConcurrentTasks
  }
})

export const reviewWorkflowDelegation = (
  maxConcurrentTasks: number,
  maxChildAgentCalls = maxChildAgentCallsForReview({ maxConcurrentTasks })
) => ({
  agents: ['review_task'] as const,
  modelAliases: ['reviewer'] as const,
  maxChildAgentCalls,
  maxParallelChildAgentCalls: maxConcurrentTasks
})

export const modelReviewWorkflowDelegation = (
  maxConcurrentTasks: number,
  maxChildAgentCalls = maxChildAgentCallsForReview({ maxConcurrentTasks })
) => ({
  agents: [
    'plan_review_intents',
    'review_task',
    'investigate_suspicion',
    'aggregate_findings',
    'sweep_sibling_suspicions',
    'refute_finding',
    'judge_finding'
  ] as const,
  modelAliases: ['reviewer'] as const,
  maxChildAgentCalls,
  maxParallelChildAgentCalls: maxConcurrentTasks
})

export const reviewSkillAgentOptions = (
  input: {
    readonly skillIds: readonly string[]
    readonly skillTools?: readonly BuiltinToolName[]
  }
) =>
  input.skillIds.length === 0
    ? {
        builtinTools: false as const,
        maxSteps: compactAgentMaxSteps
      }
    : {
        builtinTools: input.skillTools ?? readonlySkillTools,
        skills: input.skillIds,
        maxSteps: contextHeavyAgentMaxSteps
      }

export const reviewAgentOptionsForRole = (
  input: {
    readonly role: ReviewAgentRole
    readonly skillIds: readonly string[]
    readonly skillTools?: readonly BuiltinToolName[]
  }
) => {
  switch (input.role) {
    case 'review_task':
    case 'investigate_suspicion':
    case 'refute_finding':
    case 'judge_finding':
      return reviewSkillAgentOptions(input)
    case 'plan_review_intents':
    case 'aggregate_findings':
    case 'sweep_sibling_suspicions':
      return {
        builtinTools: false as const,
        maxSteps: compactAgentMaxSteps
      }
  }
}
