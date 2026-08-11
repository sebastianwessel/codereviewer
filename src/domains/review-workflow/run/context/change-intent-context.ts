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
  type ContextIngestionResult,
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
import { normalizeError } from '../../../../shared/errors/error-normalizer.js'
import {
  WorkflowReviewTaskSchema,
  type WorkflowReviewTask
} from '../../pipeline/agent-contracts.js'
import type { ContextAssemblyResult } from './context.js'

export type ChangeIntentContextResult = {
  readonly assembledContext: ContextAssemblyResult
  readonly usage: RunTokenUsage | undefined
  // Non-fatal warnings surfaced in the run report, e.g. a context provider that
  // failed and was skipped, so degradation is visible rather than silent.
  readonly warnings: readonly string[]
}

// Spec 11: "A provider that produces nothing -- missing payload, unreachable
// host, empty inbox, no matching changed files, timeout -- emits a warning and
// the review continues without it."
//
// Only a THROWING provider used to warn. A provider that returned no fragments
// was indistinguishable from one that was never configured: a mistyped inbox
// directory resolves to nothing, yields `[]`, is recorded `failed: false`, and
// the review runs with no change-intent context and says so nowhere. The user
// configured a source and was never told it contributed nothing.
//
// THREE cases, worded apart because each calls for a different action -- and
// because since 2026-08-11 the providers are ON BY DEFAULT, so the third one is
// what an ordinary repository sees on an ordinary run and must not read like a
// fault the reader is expected to fix:
//
//   failed          -- the provider errored. Something is broken.
//   matched nothing -- it ran and found no source at all: no inbox directory, or
//                      no changed file matching its globs. For a defaulted
//                      provider set that is simply "this change has no written
//                      intent", which is the common case and not a mistake. The
//                      pointer is still named, because a MISTYPED directory
//                      produces exactly this shape and the reader needs to be
//                      able to tell.
//   matched, gave 0 -- it found sources and none of them yielded usable text
//                      (empty bodies, frontmatter only). That is genuinely odd
//                      and stays worded as such.
const warningsForUnusedProviders = (
  providerMetrics: ContextIngestionResult['providerMetrics']
): readonly string[] =>
  providerMetrics
    .filter((metric) => metric.failed || metric.fragmentCount === 0)
    .map((metric) => {
      if (metric.failed) {
        return `External change-intent provider "${metric.id}" failed and was skipped.`
      }

      return metric.matchedCount === 0
        ? `External change-intent provider "${metric.id}" found no change-intent source, so the review ran without one. This is the ordinary result when a change has no written intent; if you expected content, check where the provider points.`
        : `External change-intent provider "${metric.id}" matched ${metric.matchedCount} sources but none carried usable text, so the review ran without them. Check that those sources have a body below their frontmatter.`
    })

// The other half of the same principle, for a provider that produced SOMETHING.
//
// Both bounds a provider applies are invisible in what it hands back: `maxFiles`
// drops whole files before anyone counts them, and `maxFileBytes` cuts a body so
// that every later measurement finds a body that fits. A run that read twenty of
// two hundred tickets, each cut at 64 000 bytes, reported exactly the same
// numbers as one that read the change intent whole. That is a plausible,
// incomplete answer with nothing marking it as incomplete.
//
// Reported as two warnings rather than one because the remedies differ: too many
// sources is `maxFiles`, sources too long is `maxFileBytes`.
const warningsForBoundedProviders = (
  providerMetrics: ContextIngestionResult['providerMetrics']
): readonly string[] =>
  providerMetrics.flatMap((metric) => {
    const withheld = metric.matchedCount - metric.fragmentCount

    return [
      ...(withheld > 0
        ? [
            `External change-intent provider "${metric.id}" matched ${metric.matchedCount} files but contributed ${metric.fragmentCount}; ${withheld} were dropped and their content is not in the review. Raise its maxFiles cap or point the provider at fewer files.`
          ]
        : []),
      ...(metric.truncatedFragmentCount > 0
        ? [
            `External change-intent provider "${metric.id}" cut ${metric.truncatedFragmentCount} of ${metric.fragmentCount} files at its maxFileBytes cap; the review sees the beginning of each, not the whole. Raise maxFileBytes if the intent is stated further down.`
          ]
        : [])
    ]
  })

// Why the run fell back to the deterministic digest instead of the requested
// model summarizer. Absent (not just "false") whenever the digest was the
// deliberate choice -- `summary.mode: 'digest'`, no provider configured, or AI
// review disabled -- so a real degradation is never confused with a setting the
// user chose on purpose.
type SummarizerUnavailableReason =
  // The resolved provider alias carried no callable model object. Nothing threw,
  // so without this the run silently ran the digest and nobody could tell a
  // misconfigured provider from "digest was requested".
  | { readonly kind: 'no-callable-model' }
  // Resolving the provider (missing package, bad credential, network failure,
  // ...) threw. `code`/`message` come from the same normalizer the fix lane and
  // provider-recovery paths use, so this failure is classified the same way.
  | { readonly kind: 'resolution-failed'; readonly code: string; readonly message: string }
  // The operator EXPLICITLY asked for a model summary and a provider is configured,
  // but model-backed review is switched off, so the digest ran instead. Its siblings
  // above are genuine failures; this one is a configuration conflict — and it was
  // the one silent case, because it shared an early return with the two paths where
  // the digest IS the deliberate choice.
  | { readonly kind: 'ai-review-disabled' }

type SummarizerSelection = {
  readonly summarizer: ContextSummarizer
  readonly modelSummarizerUnavailableReason?: SummarizerUnavailableReason
}

// Selects the summarizer for the run. `model` is used only when a provider is
// configured and model-backed review is not disabled; otherwise the
// deterministic digest is used deliberately, and no reason is reported. A model
// summarizer that cannot be used -- whether it throws at resolution time or
// simply resolves to no callable model -- degrades to the digest so ingestion
// never fails the review, but now carries WHY, so a user who configured a model
// summarizer and silently got the digest instead can find out.
const selectSummarizer = async (input: {
  readonly config: CodeReviewerConfig
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly providerImport?: ProviderImport | undefined
  readonly logger: Logger
  readonly onUsage: (usage: RunTokenUsage) => void
  readonly signal?: AbortSignal | undefined
}): Promise<SummarizerSelection> => {
  const requested =
    input.config.contextSources.summary.mode ??
    (input.config.provider !== undefined ? 'model' : 'digest')

  if (requested !== 'model' || input.config.provider === undefined) {
    // The digest was the deliberate choice: it was asked for, or there is no
    // provider to summarize with. Reporting a degradation here would cry wolf.
    return { summarizer: createDigestSummarizer() }
  }

  if (!input.config.aiReview.enabled) {
    // Asked for a model summary, provider present, model review off. The operator
    // gets the digest and is told why, rather than silently receiving something
    // other than what was configured.
    return {
      summarizer: createDigestSummarizer(),
      modelSummarizerUnavailableReason: { kind: 'ai-review-disabled' }
    }
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
      input.logger.warn(
        'Change-intent model summarizer resolved no callable model; falling back to the deterministic digest.'
      )

      return {
        summarizer: createDigestSummarizer(),
        modelSummarizerUnavailableReason: { kind: 'no-callable-model' }
      }
    }

    return {
      summarizer: createModelSummarizer({
        modelAlias: resolved.modelAlias,
        onUsage: input.onUsage,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      })
    }
  } catch (error) {
    // Bind and classify the error instead of swallowing it: a missing optional
    // package, a bad credential, and a network failure are all "the model
    // summarizer could not be resolved", but they are not the same problem, and
    // a user debugging an empty change-intent brief needs the distinction.
    const normalized = normalizeError(error, {
      source: 'provider',
      operation: 'change-intent-summarizer'
    })

    input.logger.warn(
      'Change-intent model summarizer resolution failed; falling back to the deterministic digest.',
      { code: normalized.code }
    )

    return {
      summarizer: createDigestSummarizer(),
      modelSummarizerUnavailableReason: {
        kind: 'resolution-failed',
        code: normalized.code,
        message: normalized.message
      }
    }
  }
}

// Renders the classified reason as the same kind of human-readable warning the
// per-provider failures already produce, so both appear side by side in the run
// report and the eval artifact instead of one being visible and the other mute.
const warningForSummarizerUnavailable = (
  reason: SummarizerUnavailableReason | undefined
): readonly string[] => {
  if (reason === undefined) {
    return []
  }

  if (reason.kind === 'no-callable-model') {
    return [
      'External change-intent model summarizer resolved no callable model; the run used the deterministic digest instead.'
    ]
  }

  if (reason.kind === 'ai-review-disabled') {
    return [
      'External change-intent model summarizer was requested but aiReview.enabled is false; the run used the deterministic digest instead.'
    ]
  }

  return [
    `External change-intent model summarizer unavailable (${reason.code}): ${reason.message} The run used the deterministic digest instead.`
  ]
}

// The call-time counterpart of the warning above. Resolution-time failure (no
// callable model, resolution threw) was already classified and surfaced; a
// summarizer that resolves and then throws mid-run -- provider outage, rate limit,
// schema rejection -- produced nothing but a debug line, so a degraded run looked
// exactly like one that chose the digest on purpose. That asymmetry is what let a
// summarizer which threw on every real provider adapter go unnoticed.
const warningForSummarizerFallback = (
  reason: string | undefined
): readonly string[] =>
  reason === undefined
    ? []
    : [
        `External change-intent model summarizer failed during the run (${reason}) The run used the deterministic digest instead.`
      ]

// The per-provider status spec 11 asks for. `empty` is deliberately its own value
// rather than being folded into `included`: a provider that ran cleanly and found
// nothing is the case a misconfigured directory produces, and reporting it as
// included would make the run's most common misconfiguration look like a success.
const providerStatus = (
  metric: ContextIngestionResult['providerMetrics'][number]
): 'included' | 'empty' | 'failed' => {
  if (metric.failed) {
    return 'failed'
  }

  return metric.fragmentCount === 0 ? 'empty' : 'included'
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
    return {
      assembledContext: input.assembledContext,
      usage: undefined,
      warnings: []
    }
  }

  let usage: RunTokenUsage | undefined
  // An explicitly injected summarizer (test seam) is never "unavailable" -- it
  // was handed in on purpose, so it carries no reason.
  const summarizerSelection: SummarizerSelection =
    input.summarizer !== undefined
      ? { summarizer: input.summarizer }
      : await selectSummarizer({
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
        })
  const summarizer = summarizerSelection.summarizer

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

  // Kept separate from `warnings`: these counts feed step/debug metrics that count
  // ingestion providers specifically, and the summarizer-unavailable warning
  // (prepended below) is not one of those providers.
  //
  // Counted from the METRICS, not from the length of the warning list. Spec 11
  // gives `failedProviders` one meaning — "a provider that fails at run time" —
  // and states in the same breath that "a provider that finds nothing is not a
  // failure and must not be worded as one". The warning list holds all three
  // unused cases, so deriving the count from it reported every quiet provider as
  // a failure; with the providers on by default that is the ordinary shape of a
  // repository carrying no written intent, and `observability.json` recorded it
  // as two failures on every such run. `providerStatus` below already draws this
  // exact line for the per-provider event.
  const providerWarnings = warningsForUnusedProviders(result.providerMetrics)
  const failedProviders = result.providerMetrics.filter(
    (metric) => metric.failed
  ).length
  // Providers that contributed no fragment, for whatever reason — the quantity
  // the warning list actually has one entry per. Reported alongside rather than
  // folded in, because "nothing failed and nothing was found" and "something
  // broke" call for different actions.
  const unusedProviders = providerWarnings.length

  // Spec 11 requires per-provider observability. A single aggregate step reduced
  // every provider to one failure COUNT, so "which provider went quiet" and "which
  // one carried the change intent" were both unanswerable after the fact — and a
  // debug LINE is not an event: it is off at the default log level and reaches
  // neither `observability.json` nor a trace. Only ids, counts, byte totals and a
  // duration are recorded — never gathered content, which is untrusted external
  // text.
  for (const metric of result.providerMetrics) {
    input.observability.recordCompletedStep({
      name: 'context_ingestion_provider',
      durationMs: metric.durationMs,
      attributes: {
        // The provider's own stable origin label (e.g. `inbox:.codereviewer/context`),
        // which is what every warning about it names too.
        originLabel: metric.id,
        providerType: metric.type,
        status: providerStatus(metric),
        matchedCount: metric.matchedCount,
        fragmentCount: metric.fragmentCount,
        truncatedFragmentCount: metric.truncatedFragmentCount,
        bytes: metric.bytes
      }
    })
    input.logger.debug('Context ingestion provider completed.', {
      provider_id: metric.id,
      provider_type: metric.type,
      matched_count: metric.matchedCount,
      fragment_count: metric.fragmentCount,
      truncated_fragment_count: metric.truncatedFragmentCount,
      bytes: metric.bytes,
      failed: metric.failed
    })
  }
  const warnings = [
    ...warningForSummarizerUnavailable(
      summarizerSelection.modelSummarizerUnavailableReason
    ),
    ...warningForSummarizerFallback(result.summarizerFallbackReason),
    ...providerWarnings,
    // Deliberately not folded into `providerWarnings`: `unusedProviders` counts
    // providers that gave nothing, and a bounded provider gave something.
    ...warningsForBoundedProviders(result.providerMetrics)
  ]

  // What the summarizer was handed, measured before it ran. Spec 11 requires it
  // alongside the output size: without the input, a four-line brief cannot be told
  // apart from a four-line ticket, and the compression the summarizer performed is
  // exactly what the pair reports.
  const gatheredBytes = result.providerMetrics.reduce(
    (total, metric) => total + metric.bytes,
    0
  )

  if (result.brief === undefined) {
    step.end({
      fragmentCount: result.fragmentCount,
      failedProviders,
      unusedProviders,
      injected: 0,
      summaryInputBytes: gatheredBytes,
      // NULL, not 0 or false. No brief exists, so neither its size nor whether it
      // was truncated is known — and a brief of zero bytes that was not truncated
      // is a different run from one that produced none at all.
      briefBytes: null,
      summaryTruncated: null
    })
    input.logger.debug('Context ingestion produced no brief.', {
      fragment_count: result.fragmentCount,
      failed_providers: failedProviders,
      unused_providers: unusedProviders
    })
    return { assembledContext: input.assembledContext, usage, warnings }
  }

  const brief = result.brief
  const briefBytes = Buffer.byteLength(brief.text, 'utf8')
  // One ledger entry PER TASK, because the brief is sent per task.
  //
  // It used to be one entry for the whole run, carrying no `taskId`, while the
  // same document was appended to every task's review context — so a run with
  // twenty tasks sent the brief twenty times and accounted for it once, and any
  // "how much context did this run send" answer read low by nineteen copies of
  // it. Its two siblings already do this: the task diff is ledgered inside the
  // per-task loop ("Recorded per task because that is how many times they are
  // sent", `context.ts`) and the analyzer-signal document carries
  // `taskId: task.id`.
  //
  // `bytesConsidered` is the brief's own size, not the summarizer's input. What
  // this task considered was the brief, and it took all of it; the compression
  // the summarizer performed is a property of the RUN, not of any task, and
  // repeating `gatheredBytes` on every entry would overstate it by the task
  // count. Spec 11 already requires that pair on the ingestion step, where it is
  // reported once as `summaryInputBytes`/`briefBytes` — see `step.end` below.
  // `decision` still carries whether the brief was summarized or truncated.
  const briefLedgerEntries: ContextLedgerEntry[] = []
  const tasks: readonly WorkflowReviewTask[] = input.assembledContext.tasks.map(
    (task) => {
      const ledgerEntry = createContextLedgerEntry({
        kind: 'support-signal-output',
        taskId: task.id,
        decision: ledgerDecisionFor(brief.mode, brief.truncated),
        reason: 'task-context-change-intent',
        bytesConsidered: briefBytes,
        bytesIncluded: briefBytes,
        content: brief.text
      })

      briefLedgerEntries.push(ledgerEntry)

      return WorkflowReviewTaskSchema.parse({
        ...task,
        reviewContext: [
          ...task.reviewContext,
          {
            kind: 'change-intent' as const,
            content: brief.text,
            ledgerEntryId: ledgerEntry.id
          }
        ],
        contextEntryIds: [...task.contextEntryIds, ledgerEntry.id]
      })
    }
  )

  step.end({
    fragmentCount: result.fragmentCount,
    failedProviders,
    unusedProviders,
    injected: tasks.length,
    summaryInputBytes: gatheredBytes,
    briefBytes,
    // Whether anything between the sources and the injected brief was cut. A brief
    // that summarizes part of a ticket must never report itself complete.
    summaryTruncated: brief.truncated
  })
  input.logger.debug('Context ingestion completed.', {
    fragment_count: result.fragmentCount,
    failed_providers: failedProviders,
    unused_providers: unusedProviders,
    brief_bytes: briefBytes,
    summary_mode: brief.mode
  })

  return {
    assembledContext: {
      ...input.assembledContext,
      tasks,
      contextLedger: [
        ...input.assembledContext.contextLedger,
        ...briefLedgerEntries
      ]
    },
    usage,
    warnings
  }
}
