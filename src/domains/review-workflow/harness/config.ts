import { type BuiltinToolName } from '@purista/harness'
import { REPO_TOOL_IDS } from '../../context-retrieval/index.js'
import { type CrossFileRetrievalConfig } from '../../../shared/contracts/index.js'
import {
  HOLISTIC_MAX_CANDIDATES,
  SECURITY_MAX_CANDIDATES
} from '../pipeline/discovery/holistic-task-review.js'

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
    readonly securityPassEnabled?: boolean
    readonly crossFileRetrieval?: CrossFileRetrievalConfig
  } = {}
): number => {
  const taskCount = Math.max(0, input.taskCount ?? 0)
  const maxConcurrentTasks = effectiveMaxConcurrentTasks(input.maxConcurrentTasks)
  // One holistic discovery call per task, plus one refutation call per emitted
  // candidate (a task can emit up to HOLISTIC_MAX_CANDIDATES), plus a concurrency
  // buffer. Reserving only one refutation call per task starves refutation once
  // discovery raises many candidates, which leaks unrefuted candidates as false
  // positives. When the dedicated security pass is enabled (spec 15), each task
  // issues a SECOND discovery call and can emit up to SECURITY_MAX_CANDIDATES more
  // candidates, so both budgets grow to keep refutation from being starved.
  const discoveryCallsPerTask = input.securityPassEnabled === true ? 2 : 1
  const candidatesPerTask =
    HOLISTIC_MAX_CANDIDATES +
    (input.securityPassEnabled === true ? SECURITY_MAX_CANDIDATES : 0)
  // Spec 16: a tool-enabled discovery call spends up to maxToolCallsPerTask extra
  // steps retrieving cross-file context before it answers, so reserve them per
  // discovery call — under-reserving would cut a task off mid-investigation.
  const crossFileCallsPerDiscoveryCall =
    input.crossFileRetrieval?.enabled === true
      ? input.crossFileRetrieval.maxToolCallsPerTask + CROSS_FILE_STEP_HEADROOM
      : 0
  const holisticCalls =
    taskCount * discoveryCallsPerTask * (1 + crossFileCallsPerDiscoveryCall)
  const refutationCalls = taskCount * candidatesPerTask
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

// Spec 16: when cross-file retrieval is enabled, the holistic discovery agent also
// gets the mediated repository tools and enough steps to spend its tool-call budget
// and still emit findings. The allowance is budget + CROSS_FILE_STEP_HEADROOM, not
// budget + 1: a model that requests one more read after the budget is gone receives
// a recoverable budget error and needs a further step to answer. Too tight a step
// allowance makes the agent loop throw `iterations_exceeded`, which would cost the
// task every finding it had — the opposite of an additive mode.
const CROSS_FILE_STEP_HEADROOM = 3

const crossFileDiscoveryAgentOptions = (
  base: ReturnType<typeof reviewSkillAgentOptions>,
  maxToolCallsPerTask: number
) => ({
  ...base,
  tools: [...REPO_TOOL_IDS],
  maxSteps: Math.max(
    base.maxSteps,
    maxToolCallsPerTask + CROSS_FILE_STEP_HEADROOM
  )
})

export const reviewAgentOptionsForRole = (
  input: {
    readonly role: ReviewAgentRole
    readonly skillIds: readonly string[]
    readonly skillTools?: readonly BuiltinToolName[]
    readonly crossFileRetrieval?: CrossFileRetrievalConfig
  }
) => {
  const base = reviewSkillAgentOptions(input)

  switch (input.role) {
    case 'holistic_review':
      return input.crossFileRetrieval?.enabled === true
        ? crossFileDiscoveryAgentOptions(
            base,
            input.crossFileRetrieval.maxToolCallsPerTask
          )
        : base
    case 'refute_finding':
    case 'propose_candidates':
      return base
  }
}
