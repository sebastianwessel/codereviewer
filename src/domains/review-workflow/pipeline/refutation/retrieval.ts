// Spec 05: bounded, mediated cross-file retrieval for the refutation stage.
//
// Refutation is this engine's precision filter, and it adjudicates every candidate
// of one discovery partition in a single call. Without tools it can only decide
// from the packet it was handed, so a candidate whose truth depends on a file
// outside that packet is unprovable by construction — the honest answer is
// `needs-more-evidence`, which is not the same as an answer.
//
// This module gives that call the SAME mediated repository tools discovery has: the
// same `ContextRetriever` gate, eligibility rules, redaction, path containment, and
// ledger. There is no second retrieval path, and this domain touches no filesystem
// API of its own.
//
// UNMEASURED. Nothing here is known to improve precision or recall; it may move
// either in either direction, and the decision rule that settles it is
// pre-registered in `specs/05-review-workflow-and-runtime.md`.

import {
  createBoundedRetrievalTools,
  type ContextRetriever
} from '../../../context-retrieval/index.js'
import { type FindingRefutationRunner } from '../agent-contracts.js'
import { type DebugLogger } from '../debug-logger.js'
import { runWithMediatedRepoTools } from '../mediated-repo-tools.js'

export type RefutationRetrievalOptions = {
  // The refuter's OWN tool-call bound, per adjudication call. It is never shared
  // with, nor drawn from, discovery's per-task budget: the two stages run in
  // separate scopes with separate counters, so enabling one cannot starve the
  // other. The bound they do share is the run-level retrieval budget on the
  // retriever itself (reads, searches, bytes), which is the mediated gate both are
  // required to go through.
  readonly maxToolCallsPerBatch: number
}

/**
 * Wraps a refutation runner so each adjudication call runs inside its own bounded
 * mediated-tool scope.
 *
 * Returns the given runner UNCHANGED when the capability is off or the run has no
 * repository root, so a disabled run issues no tool call and behaves exactly as it
 * did before this capability existed.
 *
 * The scope is entered per CALL, which is what makes the bound meaningful: a batch
 * the packet budget splits in half, and the single retry over a malformed response,
 * are each their own call and each get their own fresh budget rather than
 * inheriting a spent one. That also sets the cost shape — worst case
 * `maxToolCallsPerBatch` tool calls per refutation call, not per task.
 */
export const findingRefutationRunnerWithRetrieval = (
  input: {
    readonly refuteFinding: FindingRefutationRunner
    readonly contextRetriever: ContextRetriever | undefined
    readonly retrieval: RefutationRetrievalOptions | undefined
    readonly logger?: DebugLogger
  }
): FindingRefutationRunner => {
  const { contextRetriever, retrieval } = input

  if (retrieval === undefined || contextRetriever === undefined) {
    return input.refuteFinding
  }

  return async (packet, signal) => {
    const bounded = createBoundedRetrievalTools({
      retriever: contextRetriever,
      maxToolCalls: retrieval.maxToolCallsPerBatch
    })

    try {
      // No `reduceReadBudget`: refutation has no reads-first retry. A call the
      // provider refuses as oversized degrades to a recorded provider issue for
      // that batch — visible, and never a silently smaller re-read.
      return await runWithMediatedRepoTools({ tools: bounded.tools }, () =>
        input.refuteFinding(packet, signal)
      )
    } finally {
      // Logged even when the call failed: a batch that exhausted its budget and
      // then failed is exactly the case worth seeing. No-content, as every
      // retrieval log in this engine is — counts and flags only.
      input.logger?.debug('Refutation cross-file retrieval completed.', {
        candidate_count: packet.candidates.length,
        tool_call_count: bounded.toolCallCount(),
        bytes_read: bounded.bytesRead(),
        budget_exhausted: bounded.budgetExhausted()
      })
    }
  }
}
