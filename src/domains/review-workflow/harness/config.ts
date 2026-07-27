import { type BuiltinToolName } from '@purista/harness'
import { REPO_TOOL_IDS } from '../../context-retrieval/index.js'
import {
  HOLISTIC_MAX_CANDIDATES,
  SECURITY_MAX_CANDIDATES
} from '../pipeline/discovery/holistic-task-review.js'
import { type CrossFileRetrievalConfig } from '../../../shared/contracts/index.js'

const defaultMaxConcurrentTasks = 4
const defaultRunTimeoutMs = 0
const defaultMaxChildAgentCalls = 16
const maxChildAgentCallCap = 2048
const readonlySkillTools = ['read', 'list', 'grep'] as const satisfies readonly BuiltinToolName[]
const compactAgentMaxSteps = 1
// Head-room for refutation batches that exceed the provider input budget and split
// into halves. Splitting is bounded and rare, so a small constant is enough.
const refutationBatchSplitAllowance = 3
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
    readonly contextScoutEnabled?: boolean
  } = {}
): number => {
  const taskCount = Math.max(0, input.taskCount ?? 0)
  const maxConcurrentTasks = effectiveMaxConcurrentTasks(input.maxConcurrentTasks)
  // One holistic discovery call per task (two when the dedicated security pass is
  // enabled, spec 15), plus refutation. Refutation adjudicates ALL of a task's
  // candidates in a single batched call, so it costs one call per task rather than
  // one per candidate; a batch that exceeds the input budget splits in half, so a
  // small allowance is added for those splits.
  // Spec 18: the context scout adds one compact call per task when enabled.
  const discoveryCallsPerTask =
    (input.securityPassEnabled === true ? 2 : 1) +
    (input.contextScoutEnabled === true ? 1 : 0)
  const refutationCallsPerTask = 1 + refutationBatchSplitAllowance
  // Spec 05: the semantic finding merge issues at most one call per FILE that
  // carries two or more candidates, and a task's candidates are capped, so
  // halving the cap is the exact ceiling for a task. It is derived from the caps
  // rather than guessed because under-reserving is fatal (the workflow refuses
  // the call) while over-reserving costs nothing: this budget is a ceiling, not
  // a spend, and today's roughly one candidate per file means almost none of it
  // is used.
  const mergeCallsPerTask = Math.floor(
    (HOLISTIC_MAX_CANDIDATES +
      (input.securityPassEnabled === true ? SECURITY_MAX_CANDIDATES : 0)) /
      2
  )
  // Cross-file retrieval (spec 16) needs no reservation here: a mediated tool call
  // is an agent STEP, bounded by the agent's maxSteps, and never counts against the
  // workflow's child-agent call budget (which counts agent invocations).
  const holisticCalls = taskCount * discoveryCallsPerTask
  const refutationCalls = taskCount * refutationCallsPerTask
  const mergeCalls = taskCount * mergeCallsPerTask
  const concurrencyBuffer = maxConcurrentTasks * 2
  const derived =
    holisticCalls + refutationCalls + mergeCalls + concurrencyBuffer

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
  agents: [
    'holistic_review',
    'context_scout',
    'semantic_merge',
    'refute_finding'
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
