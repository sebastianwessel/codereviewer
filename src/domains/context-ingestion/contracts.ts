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
  readonly metadata: Readonly<Record<string, string>>
}

/** The summarized output injected as the change-intent context document. */
export type ChangeIntentBrief = {
  readonly text: string
  readonly origins: readonly string[]
  readonly truncated: boolean
  readonly mode: 'model' | 'digest'
}

export type ContextGatherInput = {
  readonly repositoryRoot: string
  /** Files changed in the reviewed diff, with content, for within-repo providers. */
  readonly changedFiles: readonly { readonly path: string; readonly content: string }[]
  readonly signal?: AbortSignal | undefined
}

export type ContextProvider = {
  readonly id: string
  gather(input: ContextGatherInput): Promise<readonly ContextFragment[]>
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
