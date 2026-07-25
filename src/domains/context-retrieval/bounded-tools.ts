// Bounded tool surface over the mediated context retriever. Shared by every
// model lane that is allowed to inspect the repository: the `investigate_claim`
// agent (spec 12, bounded per claim) and tool-enabled holistic discovery
// (spec 16, bounded per task). The wrapper adds the deterministic loop bound that
// CODE (never the model) enforces: the total number of tool calls across all three
// tools is capped, and it records how much was read and which evidence was cited so
// a lane can attribute exactly what it inspected. Byte/match caps and eligibility
// are enforced by the underlying retriever and surface to the model as recoverable,
// actionable errors.

import type { ContextRetrievalResult, ContextRetriever } from './index.js'

// Thrown when a scope's tool-call budget is exhausted (a claim's
// `verification.maxToolCallsPerClaim`, or a task's
// `review.crossFileRetrieval.maxToolCallsPerTask`). Distinct from the retriever's
// recoverable per-call budget errors so a caller can end the scope with a bound
// reason rather than letting the loop continue.
export class ToolCallBudgetExceededError extends Error {
  constructor(maxToolCalls: number) {
    super(
      `Repository tool-call budget exceeded: at most ${maxToolCalls} tool calls are allowed in this scope.`
    )
    this.name = 'ToolCallBudgetExceededError'
  }
}

export const isToolCallBudgetExceededError = (
  error: unknown
): error is ToolCallBudgetExceededError =>
  error instanceof ToolCallBudgetExceededError

export type RetrievalTools = {
  read(input: { readonly path: string }): Promise<ContextRetrievalResult>
  list(input: { readonly path: string }): Promise<ContextRetrievalResult>
  grep(input: {
    readonly query: string
    readonly paths?: readonly string[]
  }): Promise<ContextRetrievalResult>
}

export type BoundedRetrievalTools = {
  readonly tools: RetrievalTools
  readonly toolCallCount: () => number
  readonly bytesRead: () => number
  readonly citedEvidenceIds: () => readonly string[]
  // True once any tool call was rejected because the scope's tool-call budget was
  // exhausted. A caller treats this as CODE (not the model) hitting a bound — the
  // verification flow forces an `uncertain` verdict even if the agent, after
  // receiving the recoverable budget error, still returned a conclusive verdict.
  readonly budgetExhausted: () => boolean
}

export const createBoundedRetrievalTools = (input: {
  readonly retriever: ContextRetriever
  readonly maxToolCalls: number
}): BoundedRetrievalTools => {
  let toolCalls = 0
  let bytesRead = 0
  let budgetExhausted = false
  const evidenceIds: string[] = []

  const runToolCall = async (
    invoke: () => Promise<ContextRetrievalResult>
  ): Promise<ContextRetrievalResult> => {
    if (toolCalls >= input.maxToolCalls) {
      budgetExhausted = true
      throw new ToolCallBudgetExceededError(input.maxToolCalls)
    }
    toolCalls += 1
    const result = await invoke()
    bytesRead += Buffer.byteLength(result.content)
    evidenceIds.push(result.evidence.id)

    return result
  }

  return {
    tools: {
      read: (readInput) =>
        runToolCall(() =>
          input.retriever.readRepositoryFile({ path: readInput.path })
        ),
      list: (listInput) =>
        runToolCall(() =>
          input.retriever.listRepositoryDirectory({ path: listInput.path })
        ),
      grep: (grepInput) =>
        runToolCall(() =>
          input.retriever.grepRepository({
            query: grepInput.query,
            ...(grepInput.paths === undefined ? {} : { paths: grepInput.paths })
          })
        )
    },
    toolCallCount: () => toolCalls,
    bytesRead: () => bytesRead,
    citedEvidenceIds: () => [...evidenceIds],
    budgetExhausted: () => budgetExhausted
  }
}
