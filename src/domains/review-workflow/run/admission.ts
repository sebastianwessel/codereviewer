import type { Logger } from '@purista/harness'
import {
  admitCandidate,
  CandidateFindingSchema,
  evaluateQualityGate,
  matchBaselineFindings,
  type BaselineFingerprintRecord,
  type CandidateFinding,
  type ReviewedDiffRange,
  type ReviewedLineRange
} from '../../admission/index.js'
import type {
  CodeReviewerConfig,
  EvidenceRecord,
  ReviewReport
} from '../../../shared/contracts/index.js'
import {
  assertDeterministicSignalEvidenceOwnsPath,
  deterministicSignalExtractorVersions
} from '../../deterministic-signals/index.js'
import {
  createReviewTaskQueue,
  type ReviewTaskQueueRecord
} from '../../review-planning/index.js'
import type { ContextLedgerEntry } from '../../review-planning/context-ledger.js'
import type { ReviewSharedContextSnapshot } from '../../shared-context/index.js'
import type { NoContentEventRecorder } from '../../observability/index.js'
import { qualityGateThresholdsFor } from './workflow-input.js'
import type { WorkflowReviewTask } from './context/context.js'
import type { ReviewWorkflowOutput } from '../pipeline/contracts.js'

export type ReviewRunnerAdmissionState = Pick<
  ReviewReport,
  'admittedFindings' | 'rejectedFindings' | 'qualityGate'
> & {
  readonly evidence: readonly EvidenceRecord[]
  readonly candidateFindings: readonly CandidateFinding[]
  readonly refutationResults: ReviewReport['refutationResults']
  readonly providerIssues: ReviewReport['providerIssues']
  readonly contextLedgerEntries: readonly ContextLedgerEntry[]
  readonly admissionDecisions: ReviewSharedContextSnapshot['admissionDecisions']
  readonly taskEvents: ReviewSharedContextSnapshot['taskEvents']
  readonly warnings: readonly string[]
}

export const sharedTaskEventFromWorkflow = (
  event: {
    readonly id: string
    readonly kind: ReviewSharedContextSnapshot['taskEvents'][number]['kind']
    readonly round: number
    readonly paths: readonly string[]
    readonly state: ReviewSharedContextSnapshot['taskEvents'][number]['state']
    readonly workerId?: string | undefined
    readonly message?: string | undefined
  }
): ReviewSharedContextSnapshot['taskEvents'][number] => ({
  id: event.id,
  kind: event.kind,
  round: event.round,
  paths: event.paths,
  state: event.state,
  ...(event.workerId === undefined ? {} : { workerId: event.workerId }),
  ...(event.message === undefined ? {} : { message: event.message })
})

export const sharedAdmissionDecisionFromWorkflow = (
  decision: {
    readonly candidateId: string
    readonly status: ReviewSharedContextSnapshot['admissionDecisions'][number]['status']
    readonly findingId?: string | undefined
    readonly rejectedReason?: ReviewSharedContextSnapshot['admissionDecisions'][number]['rejectedReason'] | undefined
    readonly supersedes?: string | undefined
  }
): ReviewSharedContextSnapshot['admissionDecisions'][number] => ({
  candidateId: decision.candidateId,
  status: decision.status,
  ...(decision.findingId === undefined ? {} : { findingId: decision.findingId }),
  ...(decision.rejectedReason === undefined
    ? {}
    : { rejectedReason: decision.rejectedReason }),
  ...(decision.supersedes === undefined ? {} : { supersedes: decision.supersedes })
})

export const candidateFindingsFromTaskResults = (
  results: readonly unknown[]
): readonly CandidateFinding[] =>
  results.flatMap((result) => {
    if (
      typeof result !== 'object' ||
      result === null ||
      !('candidates' in result) ||
      !Array.isArray(result.candidates)
    ) {
      return []
    }

    return result.candidates
      .map((candidate) => CandidateFindingSchema.safeParse(candidate))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data)
  })

const deterministicTaskEventFromQueueRecord = (
  record: ReviewTaskQueueRecord<WorkflowReviewTask>
): ReviewSharedContextSnapshot['taskEvents'][number] =>
  sharedTaskEventFromWorkflow({
    id: record.id,
    kind: record.kind,
    round: record.round,
    paths: record.paths,
    state: record.state,
    ...(record.workerId === undefined ? {} : { workerId: record.workerId }),
    ...(record.message === undefined ? {} : { message: record.message })
  })

export const runDeterministicReviewTaskQueue = (
  input: {
    readonly tasks: readonly WorkflowReviewTask[]
    readonly maxConcurrentTasks: number
  }
): ReviewSharedContextSnapshot['taskEvents'] => {
  const queue = createReviewTaskQueue(input.tasks)
  let workerRound = 0

  while (true) {
    const batch = queue.claimBatch({
      limit: input.maxConcurrentTasks,
      workerId: `deterministic-worker-${workerRound + 1}`
    })

    if (batch.length === 0) {
      break
    }

    workerRound += 1
    for (const task of batch) {
      queue.complete(task.id, 'deterministic support signal task completed')
    }
  }

  return queue.snapshot().map(deterministicTaskEventFromQueueRecord)
}

export const timedOutTaskEventsFor = (
  tasks: readonly WorkflowReviewTask[]
): ReviewSharedContextSnapshot['taskEvents'] =>
  tasks.flatMap((task) => [
    sharedTaskEventFromWorkflow({
      id: task.id,
      kind: task.kind,
      round: task.round,
      paths: task.paths,
      state: 'planned'
    }),
    sharedTaskEventFromWorkflow({
      id: task.id,
      kind: task.kind,
      round: task.round,
      paths: task.paths,
      state: 'failed',
      workerId: 'review-timeout',
      message: 'review run timed out'
    })
  ])

export const runDeterministicAdmission = (
  input: {
    readonly reviewedPaths: readonly string[]
    readonly reviewedLineRanges: readonly ReviewedLineRange[]
    readonly reviewedDiffRanges: readonly ReviewedDiffRange[]
    readonly candidates: readonly CandidateFinding[]
    readonly evidence: readonly EvidenceRecord[]
    readonly config: CodeReviewerConfig
    readonly admittedAt: string
    readonly configHash: string
    readonly instructionHashes: readonly string[]
    readonly skillHashes: readonly string[]
    readonly baselineConfigured: boolean
    readonly baselineFingerprints?: readonly BaselineFingerprintRecord[]
    readonly taskEvents: ReviewSharedContextSnapshot['taskEvents']
  }
): ReviewRunnerAdmissionState => {
  const admittedFindings = []
  const rejectedFindings = []
  const admissionDecisions: ReviewSharedContextSnapshot['admissionDecisions'] = []

  for (const record of input.evidence) {
    assertDeterministicSignalEvidenceOwnsPath(record)
  }

  for (const candidate of input.candidates) {
    const result = admitCandidate({
      candidate,
      evidence: input.evidence,
      existingAdmittedFindings: admittedFindings,
      policy: {
        reviewedPaths: input.reviewedPaths,
        reviewedLineRanges: input.reviewedLineRanges,
        reviewedDiffRanges: input.reviewedDiffRanges,
        minimumSeverity: 'info',
        actionableSeverityThreshold:
          input.config.aiReview.actionableSeverityThreshold,
        inlineSeverityThreshold: input.config.review.inlineSeverityThreshold,
        provenance: {
          reviewer: 'deterministic-support-signal',
          instructionHashes: [...input.instructionHashes],
          skillHashes: [...input.skillHashes],
          signalVersions: deterministicSignalExtractorVersions,
          configHash: input.configHash
        },
        admittedAt: input.admittedAt
      }
    })

    if (result.status === 'admitted') {
      admittedFindings.push(result.admittedFinding)
      admissionDecisions.push({
        candidateId: candidate.id,
        status: 'admitted',
        findingId: result.admittedFinding.id
      })
    } else {
      rejectedFindings.push(result.rejectedFinding)
      admissionDecisions.push({
        candidateId: candidate.id,
        status: result.status,
        rejectedReason: result.rejectedFinding.reason
      })
    }
  }

  const baseline = matchBaselineFindings({
    admittedFindings,
    ...(input.baselineFingerprints === undefined
      ? {}
      : { baselineFingerprints: input.baselineFingerprints }),
    baselineConfigured: input.baselineConfigured
  })
  const qualityGate = evaluateQualityGate({
    admittedFindings: baseline.admittedFindings,
    thresholds: qualityGateThresholdsFor(input.config)
  })

  return {
    admittedFindings: [...baseline.admittedFindings],
    rejectedFindings: [...rejectedFindings],
    qualityGate,
    evidence: [...input.evidence],
    candidateFindings: [...input.candidates],
    refutationResults: [],
    providerIssues: [],
    contextLedgerEntries: [],
    admissionDecisions,
    taskEvents: input.taskEvents,
    warnings: [...baseline.warnings]
  }
}

export const admissionFromProviderWorkflowOutput = (
  output: ReviewWorkflowOutput
): ReviewRunnerAdmissionState => ({
  evidence: output.evidence,
  admittedFindings: output.admittedFindings,
  rejectedFindings: output.rejectedFindings,
  qualityGate: output.qualityGate,
  candidateFindings: output.candidateFindings,
  refutationResults: output.refutationResults,
  providerIssues: output.providerIssues,
  contextLedgerEntries: output.contextLedgerEntries,
  admissionDecisions: output.admissionDecisions.map(
    sharedAdmissionDecisionFromWorkflow
  ),
  taskEvents: output.taskEvents.map(sharedTaskEventFromWorkflow),
  warnings: output.warnings
})

export const prepareReviewRunnerAdmissionState = (
  input: {
    readonly providerWorkflowOutput?: ReviewWorkflowOutput | undefined
    readonly reviewedPaths: readonly string[]
    readonly reviewedLineRanges: readonly ReviewedLineRange[]
    readonly reviewedDiffRanges: readonly ReviewedDiffRange[]
    readonly candidates: readonly CandidateFinding[]
    readonly evidence: readonly EvidenceRecord[]
    readonly config: CodeReviewerConfig
    readonly admittedAt: string
    readonly configHash: string
    readonly instructionHashes: readonly string[]
    readonly skillHashes: readonly string[]
    readonly baselineConfigured: boolean
    readonly baselineFingerprints?: readonly BaselineFingerprintRecord[] | undefined
    readonly tasks: readonly WorkflowReviewTask[]
    readonly observability?: NoContentEventRecorder | undefined
    readonly logger?: Logger | undefined
  }
): {
  readonly admission: ReviewRunnerAdmissionState
  readonly deterministicTaskQueueRan: boolean
} => {
  if (input.providerWorkflowOutput !== undefined) {
    return {
      admission: admissionFromProviderWorkflowOutput(input.providerWorkflowOutput),
      deterministicTaskQueueRan: false
    }
  }

  const deterministicStep = input.observability?.startStep(
    'deterministic_task_queue',
    {
      taskCount: input.tasks.length
    }
  )
  const taskEvents = runDeterministicReviewTaskQueue({
    tasks: input.tasks,
    maxConcurrentTasks: input.config.review.maxConcurrentTasks
  })
  deterministicStep?.end({ taskCount: taskEvents.length })
  input.logger?.debug('Deterministic task queue completed.', {
    task_count: taskEvents.length
  })

  return {
    admission: runDeterministicAdmission({
      reviewedPaths: input.reviewedPaths,
      reviewedLineRanges: input.reviewedLineRanges,
      reviewedDiffRanges: input.reviewedDiffRanges,
      candidates: input.candidates,
      evidence: input.evidence,
      config: input.config,
      admittedAt: input.admittedAt,
      configHash: input.configHash,
      instructionHashes: input.instructionHashes,
      skillHashes: input.skillHashes,
      baselineConfigured: input.baselineConfigured,
      taskEvents,
      ...(input.baselineFingerprints === undefined
        ? {}
        : { baselineFingerprints: input.baselineFingerprints })
    }),
    deterministicTaskQueueRan: true
  }
}
