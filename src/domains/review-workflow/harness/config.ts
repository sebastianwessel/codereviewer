import type { BuiltinToolName } from '@purista/harness'
import { REPO_TOOL_IDS } from '../../context-retrieval/index.js'
import { MAX_PATHS_PER_REVIEW_TASK } from '../../review-planning/index.js'
import {
  HOLISTIC_MAX_CANDIDATES,
  SECURITY_MAX_CANDIDATES
} from '../pipeline/discovery/holistic-task-review.js'
import { MAX_REACTIVE_SPLIT_DEPTH } from '../pipeline/discovery/reactive-split.js'
import type { CrossFileRetrievalConfig } from '../../../shared/contracts/index.js'

const defaultMaxConcurrentTasks = 4
const defaultRunTimeoutMs = 0
const defaultMaxChildAgentCalls = 16
// A runaway guard on an absurd `taskCount`, not a ration — the same shape as
// `MAX_REACTIVE_SPLIT_DEPTH`. It moved with the reactive-split factor below: at
// 2048 it covered roughly 185 tasks when a task cost about 11 calls, and leaving
// it there once one discovery call could cost 127 would have clamped every review
// above eight tasks with the security pass on, converting the reservation this
// budget exists to make back into the under-reservation it exists to prevent.
// 32768 covers roughly the same review size it always did (about 240 tasks, or
// 120 with the security pass).
const maxChildAgentCallCap = 32_768
const readonlySkillTools = ['read', 'list', 'grep'] as const satisfies readonly BuiltinToolName[]
const compactAgentMaxSteps = 1
// Head-room for refutation batches that exceed the provider input budget and split
// into halves. Splitting is bounded and rare, so a small constant is enough.
const refutationBatchSplitAllowance = 3
// What ONE discovery call can cost when the provider refuses its packet (spec 26).
//
// A reactive split does not retry the call — it spends it and issues two more. The
// harness charges the child-agent budget before dispatch, so the refused call is
// already paid for, and each half can be refused in turn until
// MAX_REACTIVE_SPLIT_DEPTH stops the recursion. The worst case is therefore a full
// binary tree of that depth: 2^(depth+1) - 1 calls.
//
// That tree is not a theoretical shape. It is what a model whose context is small
// enough to refuse every half produces, and that is exactly the run that must reach
// spec 26's loud, attributable "cannot be split further" failure rather than dying
// first on a generic child-agent budget error that names the wrong cause.
//
// Derived from the depth constant, never restated: this is the same rule the split
// guard enforces, and a second copy of it would drift toward under-reserving.
const reactiveSplitCallsPerDiscoveryCall =
  2 ** (MAX_REACTIVE_SPLIT_DEPTH + 1) - 1
const contextHeavyAgentMaxSteps = 4

// The agents that share the skill/tool option builder below. `semantic_merge` is
// deliberately absent: it is defined with its own fixed, tool-free options.
type ReviewAgentRole = 'holistic_review' | 'refute_finding'

export const effectiveMaxConcurrentTasks = (
  maxConcurrentTasks: number | undefined
): number => maxConcurrentTasks ?? defaultMaxConcurrentTasks

export const maxChildAgentCallsForReview = (
  input: {
    readonly taskCount?: number
    readonly maxConcurrentTasks?: number
    readonly securityPassEnabled?: boolean
    readonly maxFilesPerDiscoveryCall?: number
  } = {}
): number => {
  const taskCount = Math.max(0, input.taskCount ?? 0)
  const maxConcurrentTasks = effectiveMaxConcurrentTasks(input.maxConcurrentTasks)
  // Spec 27 partitions a task's files across several discovery calls, so a task no
  // longer costs one discovery call — it costs one PER PARTITION, and the security
  // pass the same again. Refutation groups by task id, and each partition is its own
  // task id, so a task's candidates are adjudicated in one batch per partition too.
  //
  // This must track partitioning rather than be re-guessed: under-reserving is fatal
  // (the workflow refuses the call) while over-reserving costs nothing, because this
  // is a ceiling and not a spend.
  const partitionsPerTask =
    input.maxFilesPerDiscoveryCall === undefined
      ? 1
      : Math.ceil(MAX_PATHS_PER_REVIEW_TASK / input.maxFilesPerDiscoveryCall)
  // Spec 26 multiplies DISCOVERY only. A split's halves are their own model calls,
  // but their findings are collected against the partition whose call was issued
  // (see `collectDiscoveryPass`), so a split task still carries one task id, one
  // batched refutation, and one per-call candidate cap — the two terms below are
  // untouched by it.
  const discoveryCallsPerTask =
    partitionsPerTask *
    (1 + (input.securityPassEnabled === true ? 1 : 0)) *
    reactiveSplitCallsPerDiscoveryCall
  const refutationCallsPerTask =
    partitionsPerTask * (1 + refutationBatchSplitAllowance)
  // Spec 05: the semantic finding merge issues at most one call per FILE that
  // carries two or more candidates, and a task's candidates are capped, so
  // halving the cap is the exact ceiling for a task. It is derived from the caps
  // rather than guessed because under-reserving is fatal (the workflow refuses
  // the call) while over-reserving costs nothing: this budget is a ceiling, not
  // a spend, and today's roughly one candidate per file means almost none of it
  // is used.
  // The candidate caps are per DISCOVERY CALL, so a partitioned task's ceiling
  // scales with the number of partitions.
  const mergeCallsPerTask = Math.floor(
    (partitionsPerTask *
      (HOLISTIC_MAX_CANDIDATES +
        (input.securityPassEnabled === true ? SECURITY_MAX_CANDIDATES : 0))) /
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

// Spec 05, Conversation History: no agent call in this harness carries prior
// conversation.
//
// The whole review runs in ONE session, and the harness appends every completed
// agent call's output to that session as an `assistant` message. Without this
// default, each call is handed the JSON output of every call that finished before
// it — across tasks AND across stages — attributed to the model itself. The
// refuter would open its call appearing to have already asserted the very
// candidates it must adjudicate, and holding its own verdicts for other tasks,
// which contradicts its instruction to judge each candidate strictly on its own
// merits. The semantic merge would likewise see discovery's raw findings, which
// its prompt does not contemplate.
//
// It lives in the DEFAULTS rather than on each invocation deliberately. Every
// agent here is single-shot over a self-contained packet; none reads `history`,
// and none of their prompts refers to a prior turn. Making blindness the default
// means an agent added later inherits it, and an agent that genuinely needs
// history must say so at its own invocation (per-call `historyWindow` wins over
// this), where the reason is visible in review.
//
// This CHANGES MEASURED BEHAVIOUR. Every recall and precision figure this project
// has recorded was produced by history-carrying refutation and merge
// calls. Whether it helped or hurt is unknown and unmeasured; it is removed
// because it contradicts what those stages are specified to do, not because it
// was shown to be harmful.
const noForwardedConversationHistory = 0

export const harnessDefaults = (maxConcurrentTasks: number) => ({
  // No run-level deadline, ever. A whole-run timeout is a limit this project would
  // impose on itself, and firing it destroys work that was progressing. A single
  // network call that could hang forever is bounded by `provider.timeoutMs`; a
  // transient failure is retried under `provider.maxRetries`; anything unrecoverable
  // fails loudly with a classified error.
  runTimeoutMs: defaultRunTimeoutMs,
  historyWindow: noForwardedConversationHistory,
  delegation: {
    maxParallelChildAgentCalls: maxConcurrentTasks
  }
})

export const modelReviewWorkflowDelegation = (
  maxConcurrentTasks: number,
  maxChildAgentCalls = maxChildAgentCallsForReview({ maxConcurrentTasks })
) => ({
  agents: ['holistic_review', 'semantic_merge', 'refute_finding'] as const,
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

// Only DISCOVERY reads a retrieval switch. Refutation is tool-free: the capability
// that gave it the mediated tools was measured and removed on 2026-08-06 (spec 05,
// *Measured Outcome Of The Withdrawn Refutation Retrieval*), so the refuter is
// configured exactly as it was before that capability existed.
export const reviewAgentOptionsForRole = (
  input: {
    readonly role: ReviewAgentRole
    readonly skillIds: readonly string[]
    readonly skillTools?: readonly BuiltinToolName[]
    readonly crossFileRetrieval?: CrossFileRetrievalConfig
  }
) => {
  const base = reviewSkillAgentOptions(input)

  return input.role === 'holistic_review' &&
    input.crossFileRetrieval?.enabled === true
    ? crossFileDiscoveryAgentOptions(
        base,
        input.crossFileRetrieval.maxToolCallsPerTask
      )
    : base
}
