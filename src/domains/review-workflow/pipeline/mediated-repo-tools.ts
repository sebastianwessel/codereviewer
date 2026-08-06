// The mediated repository tools exposed to the review lanes that are allowed to
// inspect code they were not handed: holistic discovery (spec 16, bounded per task)
// and refutation (spec 05, bounded per batch).
//
// ONE tool definition set, deliberately. The harness resolves a custom tool's
// handler from a single registry keyed by tool id, so a second definition of
// `repo_read` for a second lane is not possible — and would not be wanted: a model
// should see the same tool surface, the same schemas, and the same output shaping
// whichever lane it is running in.
//
// The harness also resolves a handler from the agent definition, so a handler cannot
// receive per-scope parameters directly. Discovery tasks run concurrently within ONE
// workflow session, and so do refutation batches, so a session-keyed registry (the
// per-claim approach in `investigate-claim-agent.ts`, where each claim owns its own
// session) cannot isolate them. The per-scope bounded tools are therefore carried in
// an AsyncLocalStorage scope: `runWithMediatedRepoTools` wraps the agent call for one
// task or one batch, and every tool call the model makes inside that call — however
// deep in the harness loop — resolves that scope's own bounded tools. Concurrent
// scopes get independent budgets, which is what keeps one lane from spending
// another's.

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
} from '../../context-retrieval/index.js'

export type MediatedRepoToolScope = {
  readonly tools: RetrievalTools
  // Shrinks what a read returns (spec 28), for a lane that retries a call the
  // provider refused as oversized. Optional because only discovery has that retry:
  // a refutation batch that overflows degrades to a recorded provider issue for
  // that batch, which is visible, rather than to a smaller re-read.
  readonly reduceReadBudget?: () => boolean
}

const mediatedRepoToolScope = new AsyncLocalStorage<MediatedRepoToolScope>()

// Runs `operation` with `scope`'s tools bound as the active mediated repository
// tools for the current async scope (one discovery task, or one refutation batch).
export const runWithMediatedRepoTools = <T>(
  scope: MediatedRepoToolScope,
  operation: () => Promise<T>
): Promise<T> => mediatedRepoToolScope.run(scope, operation)

/**
 * Halve the active scope's per-read allowance, reporting whether it could.
 *
 * Returns false outside a scope, and inside a scope that declared no reduction —
 * a call with no tools has no reads to shrink, so an oversized context there is
 * about the packet and belongs to task splitting instead.
 */
export const reduceActiveReadBudget = (): boolean =>
  mediatedRepoToolScope.getStore()?.reduceReadBudget?.() ?? false

const activeMediatedRepoTools = (): RetrievalTools => {
  const scope = mediatedRepoToolScope.getStore()

  if (scope === undefined) {
    // Only reachable if the model called a tool outside a scope, which would mean
    // the tools were attached without the scope wrapper. Failing loudly keeps an
    // unbounded, unattributed repository read from ever executing.
    throw new TypeError(
      'No active mediated repository tools are registered for this call.'
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

// Every refusal the model is MEANT to reason about — the scope's tool-call bound,
// an ineligible path, a path that is not there, and either retriever budget running
// out — is disclosed as content it reads, in one shape, by the shared
// `withDisclosedRetrievalCondition` (see `context-retrieval/condition-disclosure.ts`
// for why a thrown error never reaches the model as itself).
//
// Everything else propagates: a containment violation, an unreadable path, a tool
// called with no active scope, a schema failure. A genuine engine fault stays a
// fault instead of becoming a tool result the model reasons from, and a containment
// breach in particular is a security invariant that must never soften into one.
export const mediatedRepoToolDefinitions = {
  repo_read: {
    description: REPO_TOOL_DESCRIPTIONS.read,
    input: RepoReadToolInputSchema,
    output: RepoToolOutputSchema,
    handler: async (_ctx: unknown, rawInput: unknown) =>
      withDisclosedRetrievalCondition('repo_read', async () =>
        toRepoToolOutput(
          await activeMediatedRepoTools().read(readInputFrom(rawInput)),
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
          await activeMediatedRepoTools().list({
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
          await activeMediatedRepoTools().grep({
            query: toolInput.query,
            ...(toolInput.paths === undefined ? {} : { paths: toolInput.paths })
          }),
          false
        )
      })
  }
} as const
