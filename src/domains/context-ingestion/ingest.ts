import type { ContextProviderConfig } from '../../shared/contracts/config/config.schema.js'
import type {
  ChangeIntentBrief,
  ContextFragment,
  ContextProvider,
  ContextSummarizer
} from './contracts.js'
import { createInboxProvider } from './inbox-provider.js'
import { createChangedFilesProvider } from './changed-files-provider.js'

export type ProviderGatherMetric = {
  readonly id: string
  readonly type: ContextProviderConfig['type']
  readonly fragmentCount: number
  readonly bytes: number
  readonly failed: boolean
}

export type ContextIngestionResult = {
  readonly brief: ChangeIntentBrief | undefined
  readonly fragmentCount: number
  readonly providerMetrics: readonly ProviderGatherMetric[]
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
  readonly maxBytes: number
  readonly redact: (value: string) => string
  readonly signal?: AbortSignal | undefined
}): Promise<ContextIngestionResult> => {
  const gatherInput = {
    repositoryRoot: input.repositoryRoot,
    changedFiles: input.changedFiles,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  }

  const fragments: ContextFragment[] = []
  const providerMetrics: ProviderGatherMetric[] = []

  for (const config of input.providers) {
    const provider = buildProvider(config)

    try {
      const gathered = await provider.gather(gatherInput)
      const redacted = gathered.map((fragment) =>
        redactFragment(fragment, input.redact)
      )
      fragments.push(...redacted)
      providerMetrics.push({
        id: provider.id,
        type: config.type,
        fragmentCount: redacted.length,
        bytes: redacted.reduce(
          (total, fragment) => total + Buffer.byteLength(fragment.body, 'utf8'),
          0
        ),
        failed: false
      })
    } catch {
      // A provider failure is non-fatal: record it and continue.
      providerMetrics.push({
        id: provider.id,
        type: config.type,
        fragmentCount: 0,
        bytes: 0,
        failed: true
      })
    }
  }

  if (fragments.length === 0) {
    return { brief: undefined, fragmentCount: 0, providerMetrics }
  }

  const brief = await input.summarizer.summarize(fragments, {
    maxBytes: input.maxBytes,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })

  return {
    brief: brief.text.trim().length === 0 ? undefined : brief,
    fragmentCount: fragments.length,
    providerMetrics
  }
}
