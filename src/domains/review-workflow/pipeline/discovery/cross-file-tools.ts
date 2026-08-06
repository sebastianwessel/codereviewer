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
// (spec 28), because both belong to the same task and both are needed at points too
// deep in the harness loop to reach by parameter.
export type CrossFileDiscoveryScope = {
  readonly tools: RetrievalTools
  readonly reduceReadBudget: () => boolean
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
