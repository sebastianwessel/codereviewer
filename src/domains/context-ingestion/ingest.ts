import type { ContextProviderConfig } from '../../shared/contracts/config/config.schema.js'
import type {
  ChangeIntentBrief,
  ContextFragment,
  ContextProvider,
  ContextSummarizer
} from './contracts.js'
import { normalizeError } from '../../shared/errors/error-normalizer.js'
import { createInboxProvider } from './inbox-provider.js'
import { createChangedFilesProvider } from './changed-files-provider.js'

export type ProviderGatherMetric = {
  readonly id: string
  readonly type: ContextProviderConfig['type']
  // The two counts below exist because every other number here is measured
  // AFTER the provider's bounds were applied, and a bound that has already been
  // applied leaves no trace in what it produced. `fragmentCount` alone cannot
  // distinguish a provider that matched twenty files from one that matched two
  // hundred and kept twenty, and `bytes` alone cannot distinguish a whole file
  // from its first 64 000 bytes. Both losses were unreportable; both are now
  // counted and warned about.
  /** Sources matched before the provider's `maxFiles` cap. */
  readonly matchedCount: number
  readonly fragmentCount: number
  /** Emitted fragments whose body the provider cut at its `maxFileBytes` cap. */
  readonly truncatedFragmentCount: number
  readonly bytes: number
  readonly failed: boolean
  /**
   * Wall-clock time this provider spent, measured around its construction and its
   * gather.
   *
   * Measured here because this loop is the only place that sees a provider start
   * and stop. Spec 11 requires a per-provider duration in the run's no-content
   * events; the recorder that emits them is handed the number rather than timing
   * the reporting call that carries it.
   */
  readonly durationMs: number
}

export type ContextGatherResult = {
  // Every gathered fragment, already redacted. Exposed because spec 23 requires
  // obligations to be extracted from the redacted FRAGMENTS rather than from the
  // summarized brief: the brief is a paraphrase, and a citation into a paraphrase
  // does not identify where in the stated intent an obligation came from.
  readonly fragments: readonly ContextFragment[]
  readonly providerMetrics: readonly ProviderGatherMetric[]
}

export type ContextIngestionResult = {
  readonly brief: ChangeIntentBrief | undefined
  readonly fragmentCount: number
  readonly providerMetrics: readonly ProviderGatherMetric[]
  // Set when the primary summarizer threw and the deterministic digest was used
  // instead. Reported, never fatal: spec 11 requires a failed summarization not to
  // fail the review, but silence is a different thing from resilience. A
  // detached-method-call bug once made the model summarizer throw on every real
  // provider adapter, so every run used the digest and shipped the raw external
  // text into the prompt; nothing in the run said so, and that is why it survived.
  // The caller renders this beside the resolution-time reason, so a degraded run
  // is distinguishable from one that chose the digest deliberately.
  readonly summarizerFallbackReason?: string
}

const buildProvider = (config: ContextProviderConfig): ContextProvider =>
  config.type === 'inbox'
    ? createInboxProvider(config)
    : createChangedFilesProvider(config)

const redactFragment = (
  fragment: ContextFragment,
  redact: (value: string) => string
): ContextFragment => ({
  ...fragment,
  ...(fragment.title === undefined ? {} : { title: redact(fragment.title) }),
  body: redact(fragment.body)
})

export type ContextGatherOptions = {
  readonly providers: readonly ContextProviderConfig[]
  readonly repositoryRoot: string
  readonly changedFiles: readonly {
    readonly path: string
    readonly content: string
  }[]
  readonly redact: (value: string) => string
  readonly signal?: AbortSignal | undefined
}

/**
 * Runs the configured providers and redacts every gathered fragment.
 *
 * This is the single gathering path for spec 11's change-intent context. It is
 * exported so a consumer that needs the fragments themselves — spec 23's
 * intent-fulfilment review, which must cite a line of the stated intent — reuses
 * it instead of standing up a second ingestion path with its own provider
 * composition and its own redaction.
 *
 * A provider that throws is recorded as failed and skipped: a source failure
 * never fails the caller.
 */
export const gatherContextFragments = async (
  input: ContextGatherOptions
): Promise<ContextGatherResult> => {
  const gatherInput = {
    repositoryRoot: input.repositoryRoot,
    changedFiles: input.changedFiles,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  }

  const fragments: ContextFragment[] = []
  const providerMetrics: ProviderGatherMetric[] = []

  for (const config of input.providers) {
    // CONSTRUCTION IS INSIDE THE TRY. It used to sit outside it, so a provider that
    // threw while being built took the whole ingestion down with it — breaking the
    // contract three lines of doc comment above ("a source failure never fails the
    // caller") for the one failure mode the caller can do least about.
    let providerId: string = config.type
    const startedAt = Date.now()

    try {
      const provider = buildProvider(config)
      providerId = provider.id

      const gathered = await provider.gather(gatherInput)
      const redacted = gathered.fragments.map((fragment) =>
        redactFragment(fragment, input.redact)
      )
      fragments.push(...redacted)
      providerMetrics.push({
        id: provider.id,
        type: config.type,
        matchedCount: gathered.matchedCount,
        fragmentCount: redacted.length,
        truncatedFragmentCount: redacted.filter(
          (fragment) => fragment.truncated === true
        ).length,
        bytes: redacted.reduce(
          (total, fragment) => total + Buffer.byteLength(fragment.body, 'utf8'),
          0
        ),
        failed: false,
        durationMs: Math.max(0, Date.now() - startedAt)
      })
    } catch {
      // A provider failure is non-fatal: record it and continue. `providerId` falls
      // back to the configured type when the failure happened before the provider
      // existed to name itself.
      providerMetrics.push({
        id: providerId,
        type: config.type,
        matchedCount: 0,
        fragmentCount: 0,
        truncatedFragmentCount: 0,
        bytes: 0,
        failed: true,
        durationMs: Math.max(0, Date.now() - startedAt)
      })
    }
  }

  return { fragments, providerMetrics }
}

/**
 * Runs the configured providers, redacts every gathered fragment, and summarizes
 * the result into a single change-intent brief. A provider that throws is
 * recorded as failed and skipped — a source failure never fails the review. When
 * no fragment is gathered the brief is undefined and the caller injects nothing.
 */
export const runContextIngestion = async (input: {
  readonly providers: readonly ContextProviderConfig[]
  readonly repositoryRoot: string
  readonly changedFiles: readonly {
    readonly path: string
    readonly content: string
  }[]
  readonly summarizer: ContextSummarizer
  // Used when the primary summarizer throws, so a failed model summarization
  // degrades to the deterministic digest instead of failing the review.
  readonly fallbackSummarizer?: ContextSummarizer
  readonly maxBytes: number
  readonly redact: (value: string) => string
  readonly signal?: AbortSignal | undefined
}): Promise<ContextIngestionResult> => {
  const { fragments, providerMetrics } = await gatherContextFragments({
    providers: input.providers,
    repositoryRoot: input.repositoryRoot,
    changedFiles: input.changedFiles,
    redact: input.redact,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })

  if (fragments.length === 0) {
    return { brief: undefined, fragmentCount: 0, providerMetrics }
  }

  const summarizeInput = {
    maxBytes: input.maxBytes,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  }
  let summarizerFallbackReason: string | undefined

  const brief = await input.summarizer
    .summarize(fragments, summarizeInput)
    .catch(async (error: unknown) => {
      if (input.fallbackSummarizer === undefined) {
        throw error
      }

      // Classified through the shared normalizer so the reported text matches how
      // every other provider failure in this codebase reads.
      const normalized = normalizeError(error, {
        source: 'provider',
        operation: 'change-intent-summarizer'
      })

      summarizerFallbackReason = `${normalized.code}: ${normalized.message}`

      return input.fallbackSummarizer.summarize(fragments, summarizeInput)
    })

  return {
    brief: brief.text.trim().length === 0 ? undefined : brief,
    fragmentCount: fragments.length,
    providerMetrics,
    ...(summarizerFallbackReason === undefined
      ? {}
      : { summarizerFallbackReason })
  }
}
