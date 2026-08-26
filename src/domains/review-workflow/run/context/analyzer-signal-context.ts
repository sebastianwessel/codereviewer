// Run stage for analyzer-artifact ingestion (spec 15, Mechanism 2).
//
// Mirrors the change-intent stage exactly: it runs AFTER context assembly, injects
// one context-only document per task, and returns the assembled context unchanged
// when the feature is off — so a run with `security.signals` disabled is
// byte-for-byte identical to one built before this existed.
//
// The document it injects is EVIDENCE, not a candidate. Nothing in this stage
// produces a finding, and the alerts it carries have no route to the report except
// through a model that decides to raise a candidate, that candidate surviving
// refutation, and the deterministic admission gate admitting it — the same path
// every other candidate takes.
//
// Its failures are LOUD. A configured artifact that is missing, oversized, or
// malformed throws out of here and fails the run: an unread artifact that let the
// review continue would produce a report with no security signals in it, which
// reads exactly like a repository that has none.

import type { Logger } from '@purista/harness'
import type { CodeReviewerConfig } from '../../../../shared/contracts/index.js'
import type { EvidenceRecord } from '../../../../shared/contracts/index.js'
import {
  ingestAnalyzerArtifacts,
  renderAnalyzerSignalsSection,
  type ChangedLineRange
} from '../../../analyzer-ingestion/index.js'
import type { NoContentEventRecorder } from '../../../observability/index.js'
import {
  createContextLedgerEntry,
  type ContextLedgerEntry
} from '../../../review-planning/index.js'
import { createRedactor } from '../../../../shared/redaction/redactor.js'
import { WorkflowReviewTaskSchema } from '../../pipeline/agent-contracts.js'
import type { ContextAssemblyResult } from './context.js'

export type AnalyzerSignalContextResult = {
  readonly assembledContext: ContextAssemblyResult
  // Evidence records for the alerts that reached the review, carried into the
  // workflow's evidence set so the report can show what the review was shown.
  readonly evidence: readonly EvidenceRecord[]
  // Disclosures of what is NOT in the review: results dropped as pre-existing,
  // unusable, or over the cap.
  readonly warnings: readonly string[]
}

/**
 * Ingest the configured analyzer artifacts and attach each task's own attributed
 * alerts to it as one `analyzer-signal` context document.
 *
 * A task receives a document only when at least one attributed alert names a file
 * that task reviews. A task with none gets no document at all, rather than one
 * announcing that the analyzers found nothing — an empty list read as an all-clear
 * is the exact misreading the section's framing spends its length preventing.
 */
export const prepareReviewRunnerAnalyzerSignalContext = async (input: {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly assembledContext: ContextAssemblyResult
  readonly changedRanges: readonly ChangedLineRange[]
  readonly observability: NoContentEventRecorder
  readonly logger: Logger
}): Promise<AnalyzerSignalContextResult> => {
  const signals = input.config.security.signals

  if (!signals.enabled) {
    return {
      assembledContext: input.assembledContext,
      evidence: [],
      warnings: []
    }
  }

  const step = input.observability.startStep('analyzer_ingestion', {
    artifactCount: signals.artifacts.length
  })

  try {
    const redactor = createRedactor()
    const result = await ingestAnalyzerArtifacts({
      repositoryRoot: input.repositoryRoot,
      signals,
      paths: {
        include: input.config.paths.include,
        exclude: input.config.paths.exclude
      },
      changedRanges: input.changedRanges,
      redact: (value) => redactor.redact(value)
    })

    // No-content observability (spec 15): counts, rule ids and CWEs only. No
    // analyzer message, no source, no path content.
    for (const metric of result.metrics) {
      input.logger.debug('Analyzer artifact ingested.', {
        analyzer: metric.analyzer,
        analyzer_version: metric.analyzerVersion,
        bytes: metric.bytes,
        result_count: metric.resultCount,
        unusable_count: metric.unusableCount,
        attributed_count: metric.attributedCount,
        pre_existing_count: metric.preExistingCount
      })
    }

    const contextLedger: ContextLedgerEntry[] = [
      ...input.assembledContext.contextLedger
    ]
    const tasks = input.assembledContext.tasks.map((task) => {
      const taskPaths = new Set(task.paths)
      // A task sees an alert when the alert's OWN location is in a file that task
      // reviews. Flow steps in other files travel with the alert as context, but
      // they never route an alert to a task that cannot see the reported code.
      const taskAlerts = result.alerts.filter((entry) =>
        taskPaths.has(entry.alert.location.path)
      )
      const content = renderAnalyzerSignalsSection(taskAlerts)

      if (content.length === 0) {
        return task
      }

      const ledgerEntry = createContextLedgerEntry({
        kind: 'support-signal-output',
        taskId: task.id,
        reason: 'task-context-analyzer-signal',
        decision: 'included',
        bytesConsidered: Buffer.byteLength(content, 'utf8'),
        bytesIncluded: Buffer.byteLength(content, 'utf8'),
        content
      })
      contextLedger.push(ledgerEntry)

      return WorkflowReviewTaskSchema.parse({
        ...task,
        reviewContext: [
          ...task.reviewContext,
          {
            kind: 'analyzer-signal' as const,
            content,
            ledgerEntryId: ledgerEntry.id
          }
        ]
      })
    })

    step.end({
      artifactCount: result.metrics.length,
      alertCount: result.alerts.length
    })

    return {
      assembledContext: {
        ...input.assembledContext,
        tasks,
        contextLedger
      },
      evidence: result.evidence,
      warnings: result.warnings
    }
  } catch (error) {
    step.fail(
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { readonly code: unknown }).code)
        : 'analyzer_ingestion_failed',
      { artifactCount: signals.artifacts.length }
    )

    throw error
  }
}
