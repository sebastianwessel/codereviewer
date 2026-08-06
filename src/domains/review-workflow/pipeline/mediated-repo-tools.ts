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
  isToolCallBudgetExceededError,
  REPO_TOOL_DESCRIPTIONS,
  RepoGrepToolInputSchema,
  RepoListToolInputSchema,
  RepoReadToolInputSchema,
  RepoToolOutputSchema,
  toRepoToolOutput,
  type RepoToolOutput,
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

// The scope's tool-call bound, disclosed as CONTENT the model reads.
//
// A thrown error does not reach the model as itself: the harness normalizes any
// non-harness failure to `ToolError("Tool execution failed.")` and drops the
// message, so a model that spent its budget was told only that something broke. A
// bound that produces an unexplained failure is the same defect shape as a
// truncation the model is never told about — the model fills the gap with a
// plausible assumption, and here the plausible assumption is that the code it meant
// to check is not there.
//
// So the bound answers in the model's own channel and says what it means. It is
// still CODE that refused the call: nothing was read, the scope's exhaustion flag
// is already set, and no further call in this scope will succeed.
const budgetExceededOutput = (toolId: string): RepoToolOutput => ({
  summary: `${toolId} was refused: this call's repository tool-call budget is exhausted.`,
  content: `[TOOL-CALL BUDGET EXHAUSTED: ${toolId} did NOT run and returned no repository content. You have no lookups left in this call. This is a limit of this engine, not a fact about the code: it is not evidence that anything is absent, correct, or safe. Decide from what you have already read, and say that a check you could not complete is unresolved.]`
})

// Only the scope's own tool-call bound is disclosed this way, because it is the one
// failure that is expected, deliberate, and not a defect. Everything else — an
// ineligible path, a missing file, a containment violation, a tool called with no
// active scope — propagates, so a genuine engine fault stays a fault instead of
// becoming a tool result the model reasons from.
const withDisclosedBudgetBound = async (
  toolId: string,
  invoke: () => Promise<RepoToolOutput>
): Promise<RepoToolOutput> => {
  try {
    return await invoke()
  } catch (error: unknown) {
    if (isToolCallBudgetExceededError(error)) {
      return budgetExceededOutput(toolId)
    }

    throw error
  }
}

export const mediatedRepoToolDefinitions = {
  repo_read: {
    description: REPO_TOOL_DESCRIPTIONS.read,
    input: RepoReadToolInputSchema,
    output: RepoToolOutputSchema,
    handler: async (_ctx: unknown, rawInput: unknown) =>
      withDisclosedBudgetBound('repo_read', async () =>
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
      withDisclosedBudgetBound('repo_list', async () =>
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
      withDisclosedBudgetBound('repo_grep', async () => {
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
