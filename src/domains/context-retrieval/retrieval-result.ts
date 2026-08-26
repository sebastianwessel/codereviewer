// What a mediated retrieval call hands back, and the recorder that builds it.
//
// These types live here rather than in `context-retriever.ts` so the grep engine
// can consume them without importing the factory that composes it — the two
// would otherwise import each other, which `src/import-cycles.test.ts` refuses
// (and rightly: a type-only cycle today is a value cycle after one edit).
// `context-retriever.ts` re-exports the two public names, so no caller moved.
import type { EvidenceRecord } from '../../shared/contracts/index.js'
import type { ContextLedgerEntry } from '../review-planning/index.js'

// One matched line, with the text that matched. Returning the text is what makes
// a search result usable on its own: previously a caller received `path:line`
// only and had to spend a second mediated read per hit to see what it had found.
export type ContextRetrievalMatch = {
  readonly path: string
  readonly line: number
  readonly text: string
}

export type ContextRetrievalResult = {
  readonly tool: 'read' | 'list' | 'grep'
  readonly path?: string
  readonly queryHash?: string
  readonly summary: string
  readonly content: string
  // The file line `content` begins at, present only for a `read` that was
  // narrowed to a range (spec 28). Without it the content is just bytes, and the
  // only thing that could number them is 1 — which contradicts the summary this
  // same result carries ("Lines 20-23 of 30") and, worse, contradicts the
  // absolute `path:line` coordinates `grep` hands back, which is where a ranged
  // read's bounds came from in the first place.
  readonly startLine?: number
  // Structured matches, present only for `grep`. Additive: `content` keeps its
  // historical `path:line` shape so every existing caller and every model-facing
  // tool output is byte-identical.
  readonly matches?: readonly ContextRetrievalMatch[]
  readonly ledgerEntry: ContextLedgerEntry
  readonly evidence: EvidenceRecord
}

/** Everything one retrieval call must state about what it served. */
export type RetrievalResultRecord = {
  readonly tool: ContextRetrievalResult['tool']
  readonly reason: string
  readonly path?: string
  readonly taskId?: string
  readonly content: string
  readonly bytesConsidered: number
  readonly bytesIncluded: number
  readonly summary: string
  readonly queryHash?: string
  readonly redactionApplied?: boolean
  // The file line `content` starts at, when it is not the top of the file.
  readonly startLine?: number
}

/**
 * Records one retrieval call in the context ledger and returns its result.
 *
 * Passed to the grep engine as a dependency rather than reimplemented there:
 * every mediated call must be ledgered and evidenced the same way, and a second
 * recorder is a second answer to what the reviewer was shown.
 */
export type RecordRetrievalResult = (
  record: RetrievalResultRecord
) => ContextRetrievalResult
