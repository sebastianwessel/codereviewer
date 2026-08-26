// Unified contracts for external change-intent context ingestion (spec 11).
//
// The core composes providers and a summarizer and depends only on these types.
// A new context source is a new `ContextProvider`; a new PR/MR platform is a new
// provider added without touching the core. The platform-adapter contract is
// defined with its implementation in a later phase.

export type ContextFragmentKind = 'inbox' | 'changed-file'

/** The normalized unit every provider emits. */
export type ContextFragment = {
  /** Stable, human-readable origin label, e.g. `inbox:jira/PROJ-123`. */
  readonly origin: string
  readonly kind: ContextFragmentKind
  readonly title?: string
  readonly body: string
  /**
   * True when `body` is the BEGINNING of the source rather than the whole of it,
   * because the provider cut it at its per-file byte cap.
   *
   * Everything downstream measures the body it receives, and a cut body is by
   * construction small enough to fit every later budget — so every later
   * `truncated` flag reads `false` and the summarized brief asserts it saw the
   * intent whole. That is a denied loss, not merely an undisclosed one. The
   * provider is the only place that ever sees both sizes, so the fact has to
   * travel with the fragment.
   *
   * Absent means the body is whole; a producer that cuts MUST set it.
   */
  readonly truncated?: boolean
  readonly metadata: Readonly<Record<string, string>>
}

/** The summarized output injected as the change-intent context document. */
export type ChangeIntentBrief = {
  readonly text: string
  readonly origins: readonly string[]
  /**
   * True when anything between the sources and `text` was cut: a fragment the
   * provider had already truncated at its per-file cap, a fragment that did not
   * fit the summarizer's input budget, or the brief itself cut at `maxBytes`.
   */
  readonly truncated: boolean
  /**
   * True when the SUMMARY CAP — `contextSources.summary.maxBytes` — is what did the
   * cutting: a section trimmed to fit it, or a later fragment dropped because
   * nothing was left to fit into.
   *
   * Separate from `truncated`, which is deliberately the union of every cause
   * above, because the causes have different remedies and only one of them was
   * reportable. A body the provider had already cut at its own per-file cap is
   * disclosed as a run warning naming `maxFileBytes`; the summarizer's own cap had
   * no warning at all, so a brief that lost four of its five sources to a 4 000-byte
   * default reached the reviewer looking exactly like a complete one. Warning on
   * the union instead would name the wrong cap on every run where only the provider
   * cut, which is the shape that teaches a reader to ignore the warning.
   *
   * Absent means the cap did not bind; a summarizer that cuts at it MUST set it.
   */
  readonly cutBySummaryCap?: boolean
  readonly mode: 'model' | 'digest'
}

export type ContextGatherInput = {
  readonly repositoryRoot: string
  /** Files changed in the reviewed diff, with content, for within-repo providers. */
  readonly changedFiles: readonly { readonly path: string; readonly content: string }[]
  readonly signal?: AbortSignal | undefined
}

/** What one provider emitted, together with what it had to leave behind. */
export type ContextGatherOutput = {
  readonly fragments: readonly ContextFragment[]
  /**
   * How many sources the provider MATCHED, counted before its own `maxFiles`
   * cap was applied.
   *
   * The cap is a plain slice, so a provider that matched two hundred files and
   * one that matched twenty emit the same twenty fragments. Without a pre-cap
   * count nothing downstream can tell those runs apart, and the review reads a
   * tenth of the stated intent while every metric says the source was consumed.
   */
  readonly matchedCount: number
}

export type ContextProvider = {
  readonly id: string
  gather(input: ContextGatherInput): Promise<ContextGatherOutput>
}

export type SummarizeInput = {
  readonly maxBytes: number
  readonly signal?: AbortSignal | undefined
}

export type ContextSummarizer = {
  readonly mode: 'model' | 'digest'
  summarize(
    fragments: readonly ContextFragment[],
    input: SummarizeInput
  ): Promise<ChangeIntentBrief>
}
