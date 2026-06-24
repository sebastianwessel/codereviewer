import { type BuiltinToolName } from '@purista/harness'
import { HOLISTIC_DISCOVERY_PASSES } from '../pipeline/discovery/holistic-task-review.js'

const defaultMaxConcurrentTasks = 4
const defaultRunTimeoutMs = 0
const defaultMaxChildAgentCalls = 16
const maxChildAgentCallCap = 2048
const readonlySkillTools = ['read', 'list', 'grep'] as const satisfies readonly BuiltinToolName[]
const compactAgentMaxSteps = 1
const contextHeavyAgentMaxSteps = 4

export type ReviewAgentRole =
  | 'holistic_review'
  | 'refute_finding'
  | 'propose_candidates'

export const effectiveMaxConcurrentTasks = (
  maxConcurrentTasks: number | undefined
): number => maxConcurrentTasks ?? defaultMaxConcurrentTasks

export const maxChildAgentCallsForReview = (
  input: {
    readonly taskCount?: number
    readonly maxConcurrentTasks?: number
  } = {}
): number => {
  const taskCount = Math.max(0, input.taskCount ?? 0)
  const maxConcurrentTasks = effectiveMaxConcurrentTasks(input.maxConcurrentTasks)
  // HOLISTIC_DISCOVERY_PASSES holistic discovery calls per task (serial
  // diverse-lens passes), plus one refutation call per emitted candidate
  // (bounded downstream), plus a concurrency buffer.
  const holisticCalls = taskCount * HOLISTIC_DISCOVERY_PASSES
  const refutationCalls = taskCount
  const concurrencyBuffer = maxConcurrentTasks * 2
  const derived = holisticCalls + refutationCalls + concurrencyBuffer

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
  agents: ['propose_candidates'] as const,
  modelAliases: ['reviewer'] as const,
  maxChildAgentCalls,
  maxParallelChildAgentCalls: maxConcurrentTasks
})

export const modelReviewWorkflowDelegation = (
  maxConcurrentTasks: number,
  maxChildAgentCalls = maxChildAgentCallsForReview({ maxConcurrentTasks })
) => ({
  agents: ['holistic_review', 'refute_finding'] as const,
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
    case 'holistic_review':
    case 'refute_finding':
    case 'propose_candidates':
      return reviewSkillAgentOptions(input)
  }
}
