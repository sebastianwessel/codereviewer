import type { Logger } from '@purista/harness'
import type { CodeReviewerConfig } from '../../../../shared/contracts/index.js'
import type { SupportSignalSourceFile } from '../../../deterministic-signals/index.js'
import type { NoContentEventRecorder } from '../../../observability/index.js'
import {
  createContextLedgerEntry,
  type ContextLedgerEntry
} from '../../../review-planning/index.js'
import {
  createDigestSummarizer,
  createModelSummarizer,
  runContextIngestion,
  type ContextSummarizer
} from '../../../context-ingestion/index.js'
import {
  combineRunTokenUsage,
  type RunTokenUsage
} from '../../../costs/index.js'
import {
  resolveProviderModelAlias,
  type ProviderImport
} from '../../../provider-resolution/index.js'
import { createRedactor } from '../../../../shared/redaction/redactor.js'
import {
  WorkflowReviewTaskSchema,
  type WorkflowReviewTask
} from '../../pipeline/agent-contracts.js'
import type { ContextAssemblyResult } from './context.js'

export type ChangeIntentContextResult = {
  readonly assembledContext: ContextAssemblyResult
  readonly usage: RunTokenUsage | undefined
}

// Selects the summarizer for the run. `model` is used only when a provider is
// configured and model-backed review is not disabled; otherwise the
// deterministic digest is used. A model summarizer that throws at resolution
// time falls back to the digest so ingestion never fails the review.
const selectSummarizer = async (input: {
  readonly config: CodeReviewerConfig
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly providerImport?: ProviderImport | undefined
  readonly logger: Logger
  readonly onUsage: (usage: RunTokenUsage) => void
  readonly signal?: AbortSignal | undefined
}): Promise<ContextSummarizer> => {
  const requested =
    input.config.contextSources.summary.mode ??
    (input.config.provider !== undefined ? 'model' : 'digest')

  if (
    requested !== 'model' ||
    input.config.provider === undefined ||
    input.config.aiReview.enabled === false
  ) {
    return createDigestSummarizer()
  }

  try {
    const resolved = await resolveProviderModelAlias({
      provider: input.config.provider,
      environment: input.environment,
      logger: input.logger,
      ...(input.providerImport === undefined
        ? {}
        : { importProvider: input.providerImport })
    })

    if (resolved.modelAlias.provider.object === undefined) {
      return createDigestSummarizer()
    }

    return createModelSummarizer({
      modelAlias: resolved.modelAlias,
      onUsage: input.onUsage,
      ...(input.signal === undefined ? {} : { signal: input.signal })
    })
  } catch {
    return createDigestSummarizer()
  }
}

const ledgerDecisionFor = (
  mode: 'model' | 'digest',
  truncated: boolean
): 'summarized' | 'truncated' | 'included' => {
  if (mode === 'model') {
    return 'summarized'
  }

  return truncated ? 'truncated' : 'included'
}

/**
 * Runs external change-intent ingestion (spec 11) and injects the resulting
 * brief into every review task as one context-only `change-intent` document.
 *
 * Disabled or empty ingestion returns the assembled context unchanged, so a run
 * with `contextSources` off is byte-for-byte identical to one without the
 * feature. A provider failure never fails the run.
 */
export const prepareReviewRunnerChangeIntentContext = async (input: {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly assembledContext: ContextAssemblyResult
  readonly sourceFiles: readonly SupportSignalSourceFile[]
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly observability: NoContentEventRecorder
  readonly logger: Logger
  readonly providerImport?: ProviderImport | undefined
  readonly summarizer?: ContextSummarizer
  readonly signal?: AbortSignal | undefined
}): Promise<ChangeIntentContextResult> => {
  const contextSources = input.config.contextSources

  if (!contextSources.enabled || contextSources.providers.length === 0) {
    return { assembledContext: input.assembledContext, usage: undefined }
  }

  let usage: RunTokenUsage | undefined
  const summarizer =
    input.summarizer ??
    (await selectSummarizer({
      config: input.config,
      environment: input.environment,
      logger: input.logger,
      onUsage: (recorded) => {
        usage = combineRunTokenUsage(usage, recorded)
      },
      ...(input.providerImport === undefined
        ? {}
        : { providerImport: input.providerImport }),
      ...(input.signal === undefined ? {} : { signal: input.signal })
    }))

  const step = input.observability.startStep('context_ingestion', {
    providerCount: contextSources.providers.length,
    summaryMode: summarizer.mode
  })
  input.logger.debug('Context ingestion started.', {
    provider_count: contextSources.providers.length
  })

  const redactor = createRedactor()
  const result = await runContextIngestion({
    providers: contextSources.providers,
    repositoryRoot: input.repositoryRoot,
    changedFiles: input.sourceFiles.map((file) => ({
      path: file.path,
      content: file.content
    })),
    summarizer,
    // A model summarization that throws degrades to the deterministic digest.
    ...(summarizer.mode === 'model'
      ? { fallbackSummarizer: createDigestSummarizer() }
      : {}),
    maxBytes: contextSources.summary.maxBytes,
    redact: (value) => redactor.redact(value),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })

  const failedProviders = result.providerMetrics.filter(
    (metric) => metric.failed
  ).length

  if (result.brief === undefined) {
    step.end({
      fragmentCount: result.fragmentCount,
      failedProviders,
      injected: 0
    })
    input.logger.debug('Context ingestion produced no brief.', {
      fragment_count: result.fragmentCount,
      failed_providers: failedProviders
    })
    return { assembledContext: input.assembledContext, usage }
  }

  const brief = result.brief
  const gatheredBytes = result.providerMetrics.reduce(
    (total, metric) => total + metric.bytes,
    0
  )
  const briefBytes = Buffer.byteLength(brief.text, 'utf8')
  const ledgerEntry: ContextLedgerEntry = createContextLedgerEntry({
    kind: 'support-signal-output',
    decision: ledgerDecisionFor(brief.mode, brief.truncated),
    reason: 'task-context-change-intent',
    bytesConsidered: Math.max(gatheredBytes, briefBytes),
    bytesIncluded: briefBytes,
    content: brief.text
  })

  const changeIntentDocument = {
    kind: 'change-intent' as const,
    content: brief.text,
    ledgerEntryId: ledgerEntry.id
  }

  const tasks: readonly WorkflowReviewTask[] = input.assembledContext.tasks.map(
    (task) =>
      WorkflowReviewTaskSchema.parse({
        ...task,
        reviewContext: [...task.reviewContext, changeIntentDocument],
        contextEntryIds: [...task.contextEntryIds, ledgerEntry.id]
      })
  )

  step.end({
    fragmentCount: result.fragmentCount,
    failedProviders,
    injected: tasks.length,
    briefBytes
  })
  input.logger.debug('Context ingestion completed.', {
    fragment_count: result.fragmentCount,
    failed_providers: failedProviders,
    brief_bytes: briefBytes,
    summary_mode: brief.mode
  })

  return {
    assembledContext: {
      ...input.assembledContext,
      tasks,
      contextLedger: [...input.assembledContext.contextLedger, ledgerEntry]
    },
    usage
  }
}
