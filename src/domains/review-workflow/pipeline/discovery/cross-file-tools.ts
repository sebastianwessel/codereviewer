// Spec 16: the mediated repository tools exposed to holistic discovery when
// `review.crossFileRetrieval.enabled` is true.
//
// Discovery is the ONLY lane that holds them. Refutation held them briefly under
// `review.refutationRetrieval`; that capability was measured and removed on
// 2026-08-06 (spec 05, *Measured Outcome Of The Withdrawn Refutation Retrieval*),
// and the stage-neutral shape this module grew for it went with it rather than
// staying behind as generality with one caller.
//
// The harness resolves a custom tool's handler from the agent definition, so a
// handler cannot receive per-task parameters directly. Discovery tasks run
// concurrently within ONE workflow session, so a session-keyed registry (the
// per-claim approach in `investigate-claim-agent.ts`, where each claim owns its own
// session) cannot isolate them. The per-task bounded tools are therefore carried in
// an AsyncLocalStorage scope: `runWithCrossFileDiscoveryTools` wraps the agent call
// for one task, and every tool call the model makes inside that call — however deep
// in the harness loop — resolves that task's own bounded tools. Concurrent tasks get
// independent scopes with independent budgets.

import { AsyncLocalStorage } from 'node:async_hooks'
import {
  REPO_TOOL_DESCRIPTIONS,
  RepoGrepToolInputSchema,
  RepoListToolInputSchema,
  RepoReadToolInputSchema,
  RepoToolOutputSchema,
  toRepoToolOutput,
  withDisclosedRetrievalCondition,
  type RetrievalTools
} from '../../../context-retrieval/index.js'

// The scope carries the task's tools AND the ability to shrink what a read returns
// (spec 28). Both are needed at points too deep in the harness loop to reach by
// parameter, which is why they travel together — but they are not scoped alike, and
// the difference matters to anyone reading a run.
//
// The tools ARE per task: `createBoundedRetrievalTools` is called once per discovery
// task, so `maxToolCallsPerTask` is genuinely a per-task allowance.
// `reduceReadBudget` is NOT: it halves `maxBytesPerRead` on the ONE retriever the
// workflow builds for the whole run (`pipeline/handler.ts`), which is the same
// object holding the run-wide `usedReads`/`usedSearches` counters. So a task that
// overflows the provider's context shrinks every other task's reads too, including
// tasks already in flight, and nothing restores it. Whether that should instead be
// per task is a design question about where the retrieval budget binds, not a local
// detail of this scope — the run-wide read and search caps are a deliberate bound
// and cannot be made per task without loosening them.
export type CrossFileDiscoveryScope = {
  readonly tools: RetrievalTools
  readonly reduceReadBudget: () => boolean
  // Whether the task's tool-call allowance has been spent. Per task, like the tools
  // and unlike `reduceReadBudget`, because the allowance it reports on is per task.
  //
  // It travels in the scope for the same reason the other two do: the fact is
  // produced by the bounded tools, and the only place that can state it in a report
  // is the telemetry built at the end of the task — too deep in the harness loop to
  // reach by parameter. Reading it is what turns "the reviewer ran out of lookups"
  // from a debug line into a recorded property of the run.
  readonly budgetExhausted: () => boolean
}

const crossFileToolScope = new AsyncLocalStorage<CrossFileDiscoveryScope>()

// Runs `operation` with `scope`'s tools bound as the active cross-file tools for
// the current async scope (one discovery task).
export const runWithCrossFileDiscoveryTools = <T>(
  scope: CrossFileDiscoveryScope,
  operation: () => Promise<T>
): Promise<T> => crossFileToolScope.run(scope, operation)

/**
 * Halve the active task's per-read allowance, reporting whether it could.
 *
 * Returns false outside a cross-file scope — a call with no tools has no reads to
 * shrink, so an oversized context there is about the packet and belongs to task
 * splitting instead.
 */
export const reduceActiveReadBudget = (): boolean =>
  crossFileToolScope.getStore()?.reduceReadBudget() ?? false

/**
 * Whether the active task has spent its cross-file tool-call allowance.
 *
 * `undefined` OUTSIDE a scope, never `false`: a task with no retrieval tools has no
 * allowance to exhaust, and answering `false` would report "the reviewer had
 * lookups left" about a reviewer that had none. The caller records the distinction
 * rather than flattening it.
 */
export const activeCrossFileBudgetExhausted = (): boolean | undefined =>
  crossFileToolScope.getStore()?.budgetExhausted()

/**
 * Whether the caller is inside a task's cross-file discovery scope.
 *
 * The scope is what makes the task's tool-call budget and read allowance SHARED
 * mutable state: every call made inside it draws on the same
 * `maxToolCallsPerTask` and the same `reduceReadBudget`. A caller that wants to
 * issue two of this task's model calls concurrently has to know that, because
 * concurrency would turn the split of one budget between them into a race — the
 * total is unchanged, its allocation is not. Outside a scope there is no such
 * state and nothing to race.
 */
export const hasActiveCrossFileDiscoveryScope = (): boolean =>
  crossFileToolScope.getStore() !== undefined

const activeCrossFileTools = (): RetrievalTools => {
  const scope = crossFileToolScope.getStore()

  if (scope === undefined) {
    // Only reachable if the model called a tool outside a task scope, which would
    // mean the tools were attached without the scope wrapper. Failing loudly keeps
    // an unbounded, unattributed repository read from ever executing.
    throw new TypeError(
      'No active cross-file discovery tools are registered for this task.'
    )
  }

  return scope.tools
}

// The custom tool definitions for the review harness. Identical in contract to the
// investigation agent's tools (same ids, schemas, descriptions, and output shaping,
// from the shared repo-tool contract) so a model sees one consistent tool surface
// across lanes. Every call is mediated by the context retriever: eligibility gate,
// redaction, byte/match caps, and path containment.
// Spec 28: forwards the line range the model asked for, omitting absent bounds
// entirely rather than passing `undefined` (the project runs
// `exactOptionalPropertyTypes`, so the two are not interchangeable).
const readInputFrom = (rawInput: unknown): {
  readonly path: string
  readonly startLine?: number
  readonly endLine?: number
} => {
  const parsed = RepoReadToolInputSchema.parse(rawInput)

  return {
    path: parsed.path,
    ...(parsed.startLine === undefined ? {} : { startLine: parsed.startLine }),
    ...(parsed.endLine === undefined ? {} : { endLine: parsed.endLine })
  }
}

// Every refusal the model is MEANT to reason about — the task's tool-call bound,
// an ineligible path, a path that is not there, and either retriever budget running
// out — is disclosed as content it reads, in one shape, by the shared
// `withDisclosedRetrievalCondition` (see `context-retrieval/condition-disclosure.ts`
// for why a thrown error never reaches the model as itself).
//
// Everything else propagates: a containment violation, an unreadable path, a tool
// called with no active scope, a schema failure. A genuine engine fault stays a
// fault instead of becoming a tool result the model reasons from, and a containment
// breach in particular is a security invariant that must never soften into one.
export const crossFileDiscoveryToolDefinitions = {
  repo_read: {
    description: REPO_TOOL_DESCRIPTIONS.read,
    input: RepoReadToolInputSchema,
    output: RepoToolOutputSchema,
    handler: async (_ctx: unknown, rawInput: unknown) =>
      withDisclosedRetrievalCondition('repo_read', async () =>
        toRepoToolOutput(
          await activeCrossFileTools().read(readInputFrom(rawInput)),
          true
        )
      )
  },
  repo_list: {
    description: REPO_TOOL_DESCRIPTIONS.list,
    input: RepoListToolInputSchema,
    output: RepoToolOutputSchema,
    handler: async (_ctx: unknown, rawInput: unknown) =>
      withDisclosedRetrievalCondition('repo_list', async () =>
        toRepoToolOutput(
          await activeCrossFileTools().list({
            path: RepoListToolInputSchema.parse(rawInput).path
          }),
          false
        )
      )
  },
  repo_grep: {
    description: REPO_TOOL_DESCRIPTIONS.grep,
    input: RepoGrepToolInputSchema,
    output: RepoToolOutputSchema,
    handler: async (_ctx: unknown, rawInput: unknown) =>
      withDisclosedRetrievalCondition('repo_grep', async () => {
        const toolInput = RepoGrepToolInputSchema.parse(rawInput)

        return toRepoToolOutput(
          await activeCrossFileTools().grep({
            query: toolInput.query,
            ...(toolInput.paths === undefined ? {} : { paths: toolInput.paths })
          }),
          false
        )
      })
  }
} as const
