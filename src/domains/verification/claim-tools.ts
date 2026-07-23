// Per-claim bounded tool surface for the `verify_claim` agent (spec 12). The
// agent's only tools are the mediated `read`/`list`/`grep` from the
// context-retrieval domain, reused as-is. This wrapper adds the deterministic
// per-claim loop bound that CODE (never the model) enforces: the total number of
// tool calls across all three tools is capped, and the wrapper records how much
// was read and which evidence the agent cited so the verdict cites exactly what
// it read. Byte/match caps and eligibility are enforced by the underlying
// retriever and surface to the model as recoverable, actionable errors.

import {
  type ContextRetrievalResult,
  type ContextRetriever
} from '../context-retrieval/index.js'

// Thrown when a claim's tool-call budget (`verification.maxToolCallsPerClaim`) is
// exhausted. Distinct from the retriever's recoverable per-call budget errors so
// the flow runner can end the claim as `uncertain` with a bound reason rather
// than letting the loop continue.
export class ClaimToolCallBudgetExceededError extends Error {
  constructor(maxToolCalls: number) {
    super(
      `Verification tool-call budget exceeded: at most ${maxToolCalls} tool calls are allowed per claim.`
    )
    this.name = 'ClaimToolCallBudgetExceededError'
  }
}

export const isClaimToolCallBudgetExceededError = (
  error: unknown
): error is ClaimToolCallBudgetExceededError =>
  error instanceof ClaimToolCallBudgetExceededError

export type VerificationClaimTools = {
  read(input: { readonly path: string }): Promise<ContextRetrievalResult>
  list(input: { readonly path: string }): Promise<ContextRetrievalResult>
  grep(input: {
    readonly query: string
    readonly paths?: readonly string[]
  }): Promise<ContextRetrievalResult>
}

export type BoundedClaimTools = {
  readonly tools: VerificationClaimTools
  readonly toolCallCount: () => number
  readonly bytesRead: () => number
  readonly citedEvidenceIds: () => readonly string[]
  // True once any tool call was rejected because the per-claim tool-call budget
  // was exhausted. The flow runner treats this as CODE (not the model) hitting a
  // bound and forces an `uncertain` verdict even if the agent, after receiving
  // the recoverable budget error, still returned a conclusive verdict.
  readonly budgetExhausted: () => boolean
}

export const createBoundedClaimTools = (input: {
  readonly retriever: ContextRetriever
  readonly maxToolCalls: number
}): BoundedClaimTools => {
  let toolCalls = 0
  let bytesRead = 0
  let budgetExhausted = false
  const evidenceIds: string[] = []

  const runToolCall = async (
    invoke: () => Promise<ContextRetrievalResult>
  ): Promise<ContextRetrievalResult> => {
    if (toolCalls >= input.maxToolCalls) {
      budgetExhausted = true
      throw new ClaimToolCallBudgetExceededError(input.maxToolCalls)
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
