// Unified contracts for external change-intent context ingestion (spec 11).
//
// The core composes providers and a summarizer and depends only on these types,
// so platform-specific integrations stay isolated behind `PlatformAdapter` and a
// new platform is added without touching the core.

export type ContextFragmentKind = 'pull-request' | 'inbox' | 'changed-file'

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

// Platform seam. Adapters (github, then gitlab/bitbucket) implement this in a
// later phase; the platform-neutral type is defined here so the interface is the
// contract, not any one platform's shape.

export type PullRequestComment = {
  readonly author?: string
  readonly body: string
  readonly kind: 'review' | 'issue'
}

export type PullRequestContext = {
  readonly platform: string
  readonly id: string
  readonly title: string
  readonly description: string
  readonly author?: string
  readonly labels: readonly string[]
  readonly comments: readonly PullRequestComment[]
  readonly linkedIssueRefs: readonly string[]
  readonly sourceBranch?: string
  readonly targetBranch?: string
  readonly url?: string
}

export type PlatformAdapter = {
  readonly platform: string
  readPullRequest(input: {
    readonly repositoryRoot: string
    readonly signal?: AbortSignal | undefined
  }): Promise<PullRequestContext | undefined>
}
