import type { Logger } from '@purista/harness'
import {
  ReviewReportSchema,
  type CodeReviewerConfig,
  type CoverageSummary,
  type EvidenceRecord,
  type ReviewReport
} from '../../../../shared/contracts/index.js'
import { sha256 } from '../../../../shared/hash/hash.js'
import type { CandidateFinding } from '../../../admission/index.js'
import type {
  DeterministicSignalExtraction,
  SupportSignalSourceFile
} from '../../../deterministic-signals/index.js'
import type { RunCostSummary } from '../../../costs/index.js'
import type { ContextLedgerEntry } from '../../../review-planning/context-ledger.js'
import {
  createReviewSharedContext,
  type ReviewSharedContextSnapshot
} from '../../../shared-context/index.js'
import type { NoContentEventRecorder } from '../../../observability/index.js'
import type { ReviewRunnerAdmissionState } from '../admission.js'

type ReviewRunSummaryInput = {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly baseRef?: string | undefined
  readonly headRef?: string | undefined
  readonly runId: string
  readonly startedAt: Date
  readonly completedAt: Date
  readonly configHash: string
  readonly warnings: readonly string[]
  readonly runCost?: RunCostSummary
}

export const createReviewRunSummary = (
  input: ReviewRunSummaryInput
): ReviewReport['run'] => ({
  runId: input.runId,
  startedAt: input.startedAt.toISOString(),
  completedAt: input.completedAt.toISOString(),
  mode: input.config.review.mode,
  depth: input.config.review.depth,
  repositoryRootHash: sha256(input.repositoryRoot),
  baseRef: input.baseRef ?? input.config.review.baseRef,
  headRef: input.headRef ?? input.config.review.headRef,
  configHash: input.configHash,
  ...(input.config.provider === undefined
    ? {}
    : {
        provider: input.config.provider.id,
        model: input.config.provider.model
      }),
  durationMs: Math.max(
    0,
    input.completedAt.getTime() - input.startedAt.getTime()
  ),
  ...(input.runCost?.costUsd === undefined
    ? {}
    : { costUsd: input.runCost.costUsd }),
  ...(input.runCost?.inputTokens === undefined
    ? {}
    : { inputTokens: input.runCost.inputTokens }),
  ...(input.runCost?.cachedInputTokens === undefined
    ? {}
    : { cachedInputTokens: input.runCost.cachedInputTokens }),
  ...(input.runCost?.outputTokens === undefined
    ? {}
    : { outputTokens: input.runCost.outputTokens }),
  warnings: [...input.warnings]
})

export const createCoverageSummary = (
  input: {
    readonly sourceFiles: readonly SupportSignalSourceFile[]
    readonly contextLedger: readonly ContextLedgerEntry[]
  }
): CoverageSummary => {
  const files = input.sourceFiles.map((file) => {
    const sourceBytes = Buffer.byteLength(file.content)
    const fileEntries = input.contextLedger.filter(
      (entry) =>
        entry.kind === 'file' &&
        entry.path === file.path &&
        entry.reason === 'task-context-source-chunk'
    )
    const coveredBytes = fileEntries.reduce(
      (total, entry) => total + entry.bytesIncluded,
      0
    )
    const incompleteReason =
      coveredBytes >= sourceBytes
        ? undefined
        : `Only ${coveredBytes} of ${sourceBytes} bytes were assigned to review tasks.`

    return {
      path: file.path,
      contentHash: sha256(file.content),
      status:
        incompleteReason === undefined
          ? ('complete' as const)
          : ('incomplete' as const),
      bytes: sourceBytes,
      coveredBytes,
      taskIds: [...new Set(fileEntries.flatMap((entry) => entry.taskId ?? []))],
      ...(incompleteReason === undefined ? {} : { incompleteReason })
    }
  })
  const incompleteReasons = files
    .filter((file) => file.status === 'incomplete')
    .map((file) => `${file.path}: ${file.incompleteReason}`)
  const reviewableBytes = files.reduce((total, file) => total + file.bytes, 0)
  const coveredBytes = files.reduce((total, file) => total + file.coveredBytes, 0)

  return {
    status: incompleteReasons.length === 0 ? 'complete' : 'incomplete',
    reviewableFileCount: files.length,
    coveredFileCount: files.filter((file) => file.status === 'complete').length,
    reviewableBytes,
    coveredBytes,
    incompleteReasons,
    files
  }
}

export const createSharedContextSnapshot = (input: {
  readonly analysis: DeterministicSignalExtraction
  readonly taskEvents: ReviewSharedContextSnapshot['taskEvents']
  readonly contextLedger: readonly ContextLedgerEntry[]
  readonly evidence: readonly EvidenceRecord[]
  readonly candidates: readonly CandidateFinding[]
  readonly admissionDecisions: ReviewSharedContextSnapshot['admissionDecisions']
  readonly admittedFindings: ReviewReport['admittedFindings']
  readonly rejectedFindings: ReviewReport['rejectedFindings']
}): ReviewSharedContextSnapshot => {
  const context = createReviewSharedContext()

  for (const fact of input.analysis.facts) {
    context.appendSupportSignalFact(fact)
  }

  for (const taskEvent of input.taskEvents) {
    context.appendTask(taskEvent)
  }

  for (const entry of input.contextLedger) {
    context.appendContextLedgerEntry(entry)
  }

  for (const evidence of input.evidence) {
    context.appendEvidenceRecord(evidence)
  }

  for (const candidate of input.candidates) {
    context.appendCandidateFinding(candidate)
  }

  for (const finding of input.admittedFindings) {
    context.appendAdmittedFinding(finding)
  }

  for (const finding of input.rejectedFindings) {
    context.appendRejectedFinding(finding)
  }

  for (const decision of input.admissionDecisions) {
    context.appendAdmissionDecision(decision)
  }

  return context.snapshot()
}

export const createReviewReport = (input: {
  readonly run: ReviewReport['run']
  readonly coverage: CoverageSummary
  readonly admittedFindings: ReviewReport['admittedFindings']
  readonly rejectedFindings: ReviewReport['rejectedFindings']
  readonly evidence: readonly EvidenceRecord[]
  readonly skippedFiles: readonly ReviewReport['skippedFiles'][number][]
  readonly qualityGate: ReviewReport['qualityGate']
  readonly refutationResults: ReviewReport['refutationResults']
  readonly providerIssues: ReviewReport['providerIssues']
  readonly resolvedBaselineEntries?: readonly NonNullable<
    ReviewReport['resolvedBaselineEntries']
  >[number][]
}): ReviewReport =>
  ReviewReportSchema.parse({
    schemaVersion: '1.0',
    run: input.run,
    coverage: input.coverage,
    admittedFindings: input.admittedFindings,
    rejectedFindings: input.rejectedFindings,
    evidence: input.evidence,
    skippedFiles: input.skippedFiles,
    qualityGate: input.qualityGate,
    refutationResults: input.refutationResults,
    providerIssues: input.providerIssues,
    ...(input.resolvedBaselineEntries === undefined
      ? {}
      : { resolvedBaselineEntries: input.resolvedBaselineEntries }),
    artifacts: []
  })

export type ReviewRunnerSuccessReportMetrics = {
  readonly admittedFindingCount: number
  readonly rejectedFindingCount: number
  readonly evidenceCount: number
}

export type ReviewRunnerSuccessResult = {
  readonly report: ReviewReport
  readonly contextLedger: readonly ContextLedgerEntry[]
  readonly sharedContext: ReviewSharedContextSnapshot
  readonly reportMetrics: ReviewRunnerSuccessReportMetrics
}

export const prepareReviewRunnerSuccessResult = (
  input: {
    readonly repositoryRoot: string
    readonly config: CodeReviewerConfig
    readonly baseRef?: string | undefined
    readonly headRef?: string | undefined
    readonly runId: string
    readonly startedAt: Date
    readonly completedAt: Date
    readonly configHash: string
    readonly warnings: readonly string[]
    readonly runCost?: RunCostSummary | undefined
    readonly analysis: DeterministicSignalExtraction
    readonly coverage: CoverageSummary
    readonly contextLedger: readonly ContextLedgerEntry[]
    readonly skippedFiles: readonly ReviewReport['skippedFiles'][number][]
    readonly admission: ReviewRunnerAdmissionState
    readonly resolvedBaselineEntries: readonly NonNullable<
      ReviewReport['resolvedBaselineEntries']
    >[number][]
    readonly observability?: NoContentEventRecorder | undefined
    readonly logger?: Logger | undefined
  }
): ReviewRunnerSuccessResult => {
  const reportStep = input.observability?.startStep('report_assembly')
  const report = createReviewReport({
    run: createReviewRunSummary({
      repositoryRoot: input.repositoryRoot,
      config: input.config,
      ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
      ...(input.headRef === undefined ? {} : { headRef: input.headRef }),
      runId: input.runId,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      configHash: input.configHash,
      warnings: input.warnings,
      ...(input.runCost === undefined ? {} : { runCost: input.runCost })
    }),
    coverage: input.coverage,
    admittedFindings: input.admission.admittedFindings,
    rejectedFindings: input.admission.rejectedFindings,
    evidence: input.admission.evidence,
    skippedFiles: input.skippedFiles,
    qualityGate: input.admission.qualityGate,
    refutationResults: input.admission.refutationResults,
    providerIssues: input.admission.providerIssues,
    ...(input.config.baseline.includeResolvedInReport
      ? { resolvedBaselineEntries: input.resolvedBaselineEntries }
      : {})
  })
  const sharedContext = createSharedContextSnapshot({
    analysis: input.analysis,
    taskEvents: input.admission.taskEvents,
    contextLedger: input.contextLedger,
    evidence: input.admission.evidence,
    candidates: input.admission.candidateFindings,
    admissionDecisions: input.admission.admissionDecisions,
    admittedFindings: input.admission.admittedFindings,
    rejectedFindings: input.admission.rejectedFindings
  })

  const result = {
    report,
    contextLedger: input.contextLedger,
    sharedContext,
    reportMetrics: {
      admittedFindingCount: input.admission.admittedFindings.length,
      rejectedFindingCount: input.admission.rejectedFindings.length,
      evidenceCount: input.admission.evidence.length
    }
  }
  reportStep?.end(result.reportMetrics)
  input.logger?.info('Review run completed.', {
    admitted_finding_count: result.reportMetrics.admittedFindingCount,
    rejected_finding_count: result.reportMetrics.rejectedFindingCount,
    evidence_count: result.reportMetrics.evidenceCount,
    coverage_status: input.coverage.status,
    quality_gate_passed: input.admission.qualityGate?.passed ?? true
  })

  return result
}
