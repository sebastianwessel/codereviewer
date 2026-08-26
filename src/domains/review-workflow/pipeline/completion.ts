import type { z } from 'zod'
import type {
  AdmittedFinding,
  EvidenceRecord,
  RefutationResult,
  RejectedFinding,
  ReviewDiscoveryReport
} from '../../../shared/contracts/index.js'
import { assertDeterministicSignalEvidenceOwnsPath } from '../../deterministic-signals/index.js'
import {
  admitCandidate,
  anchorSourceFilesFromChunks,
  createSourceAnchorResolver,
  evaluateQualityGate,
  matchBaselineFindings,
  reviewedLineRangeForContent,
  type BaselineFingerprintRecord,
  type CandidateFinding,
  type ReviewedDiffRange,
  type ReviewedLineRange,
  type TaskSourceChunkRange
} from '../../admission/index.js'
import {
  createReviewSharedContext,
  type AdmissionDecisionRecord
} from '../../shared-context/index.js'
import type { ContextLedgerEntry } from '../../review-planning/index.js'
import type {
  ReviewContextDocumentSchema,
  WorkflowReviewTask,
  WorkflowTaskEvent
} from './agent-contracts.js'
import type { ProviderIssue } from './provider-issues.js'
import {
  ReviewWorkflowOutputSchema,
  type ReviewWorkflowInput,
  type ReviewWorkflowOutput
} from './contracts.js'

const runAdmission = (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly candidates: readonly CandidateFinding[]
    readonly evidence?: readonly EvidenceRecord[]
    readonly rejectedFindings?: readonly RejectedFinding[]
    readonly admissionDecisions?: readonly AdmissionDecisionRecord[]
    readonly instructionHashes: readonly string[]
    readonly skillHashes: readonly string[]
    // Sub-tasks discovery actually ran, in addition to the planned ones.
    readonly reviewedTasks?: readonly WorkflowReviewTask[]
  }
): {
  readonly admittedFindings: readonly AdmittedFinding[]
  readonly rejectedFindings: readonly RejectedFinding[]
  readonly admissionDecisions: readonly AdmissionDecisionRecord[]
} => {
  const context = createReviewSharedContext()
  const admittedFindings: AdmittedFinding[] = []
  const rejectedFindings: RejectedFinding[] = [
    ...(input.rejectedFindings ?? [])
  ]
  const admissionDecisions: AdmissionDecisionRecord[] = [
    ...(input.admissionDecisions ?? [])
  ]
  const evidenceRecords = input.evidence ?? input.workflowInput.evidence
  const resolveAnchorText = createSourceAnchorResolver(
    anchorSourceFilesFromChunks(input.workflowInput.reviewContext ?? [])
  )
  const reviewedLineRanges =
    input.workflowInput.reviewedLineRanges ??
    reviewedLineRangesFromReviewContext(input.workflowInput.reviewContext ?? [])
  const reviewedDiffRanges: readonly ReviewedDiffRange[] | undefined =
    input.workflowInput.reviewedDiffRanges
  // Which lines each task was actually shown. A file too large for one packet is
  // split into chunks that each become their own task, so a task's candidate must
  // fall inside its own chunk; the whole-file range cannot tell the difference.
  // Planned tasks AND the sub-tasks discovery actually ran. Only the latter carry a
  // genuine sub-file span, and their synthetic ids match nothing in the planned list
  // — so deriving ranges from planned tasks alone made this check silently pass for
  // every partition and every reactive half, which is precisely where a
  // chunk-relative line number could still arise.
  const taskSourceChunkRanges = taskSourceChunkRangesFromTasks([
    ...(input.workflowInput.tasks ?? []),
    ...(input.reviewedTasks ?? [])
  ])

  for (const evidence of evidenceRecords) {
    assertDeterministicSignalEvidenceOwnsPath(evidence)
    context.appendEvidenceRecord(evidence)
  }

  for (const candidate of input.candidates) {
    context.appendCandidateFinding(candidate)
    const result = admitCandidate({
      candidate,
      evidence: evidenceRecords,
      existingAdmittedFindings: admittedFindings,
      resolveAnchorText,
      policy: {
        reviewedPaths: input.workflowInput.reviewedPaths,
        ...(reviewedLineRanges === undefined ? {} : { reviewedLineRanges }),
        ...(reviewedDiffRanges === undefined ? {} : { reviewedDiffRanges }),
        ...(taskSourceChunkRanges.length === 0
          ? {}
          : { taskSourceChunkRanges }),
        minimumSeverity: 'info',
        actionableSeverityThreshold:
          input.workflowInput.admissionPolicy.actionableSeverityThreshold,
        inlineSeverityThreshold:
          input.workflowInput.admissionPolicy.inlineSeverityThreshold,
        provenance: {
          ...input.workflowInput.provenance,
          instructionHashes: input.instructionHashes,
          skillHashes: input.skillHashes
        },
        admittedAt: input.workflowInput.admissionPolicy.admittedAt
      }
    })

    if (result.status === 'admitted') {
      admittedFindings.push(result.admittedFinding)
      context.appendAdmittedFinding(result.admittedFinding)
      const decision: AdmissionDecisionRecord = {
        candidateId: candidate.id,
        status: 'admitted',
        findingId: result.admittedFinding.id
      }
      admissionDecisions.push(decision)
      context.appendAdmissionDecision(decision)
    } else {
      rejectedFindings.push(result.rejectedFinding)
      context.appendRejectedFinding(result.rejectedFinding)
      const decision: AdmissionDecisionRecord = {
        candidateId: candidate.id,
        status: result.status,
        rejectedReason: result.rejectedFinding.reason
      }
      admissionDecisions.push(decision)
      context.appendAdmissionDecision(decision)
    }
  }

  return { admittedFindings, rejectedFindings, admissionDecisions }
}

// Chunk provenance is recorded per (task, path) so a candidate can be checked
// against the chunk of the file its own task was given. Tasks whose file context
// carries no origin (nothing produced one) contribute nothing and stay unchecked.
const taskSourceChunkRangesFromTasks = (
  tasks: readonly WorkflowReviewTask[]
): readonly TaskSourceChunkRange[] =>
  tasks.flatMap((task) =>
    task.reviewContext.flatMap((document) =>
      document.kind === 'file' &&
      document.path !== undefined &&
      document.startLine !== undefined &&
      document.endLine !== undefined
        ? [
            {
              taskId: task.id,
              path: document.path,
              startLine: document.startLine,
              endLine: document.endLine
            }
          ]
        : []
    )
  )

const reviewedLineRangesFromReviewContext = (
  reviewContext: readonly z.infer<typeof ReviewContextDocumentSchema>[]
): readonly ReviewedLineRange[] | undefined => {
  const ranges = reviewContext
    .filter(
      (document) => document.kind === 'file' && document.path !== undefined
    )
    .map((document) =>
      reviewedLineRangeForContent({
        path: document.path!,
        content: document.content
      })
    )

  return ranges.length === 0 ? undefined : ranges
}

/**
 * De-duplicate by a caller-chosen key, keeping the FIRST occurrence.
 *
 * First-wins is load-bearing: the same record can reach completion from several
 * stages, and the earliest one is the one whose provenance the rest of the output
 * already refers to.
 */
const uniqueBy = <T>(
  values: readonly T[],
  keyOf: (value: T) => string
): readonly T[] => {
  const byKey = new Map<string, T>()

  for (const value of values) {
    const key = keyOf(value)

    if (!byKey.has(key)) {
      byKey.set(key, value)
    }
  }

  return [...byKey.values()]
}

const byId = (value: { readonly id: string }): string => value.id

const byCandidateId = (value: { readonly candidateId: string }): string =>
  value.candidateId

// A provider issue carries no id, so its whole reportable shape is its identity.
const providerIssueKey = (issue: ProviderIssue): string =>
  JSON.stringify({
    code: issue.code,
    stage: issue.stage ?? null,
    recovered: issue.recovered ?? null,
    message: issue.message ?? null
  })

const terminalPreAdmissionCandidateIds = (
  input: {
    readonly rejectedFindings: readonly RejectedFinding[]
    readonly admissionDecisions: readonly AdmissionDecisionRecord[]
  }
): ReadonlySet<string> =>
  new Set([
    ...input.rejectedFindings.map((finding) => finding.candidateId),
    ...input.admissionDecisions
      .filter((decision) => decision.status !== 'admitted')
      .map((decision) => decision.candidateId)
  ])

export const completeReviewWorkflow = (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly candidateFindings: readonly CandidateFinding[]
    readonly admissionCandidates: readonly CandidateFinding[]
    readonly artifactOnlyCandidateIds: readonly string[]
    readonly refutationResults: readonly RefutationResult[]
    // Sub-tasks discovery actually ran (partitions, reactive split halves).
    readonly reviewedTasks?: readonly WorkflowReviewTask[]
    // What discovery produced before refutation and admission (spec 27). Passed
    // through untouched: completion decides what is ADMITTED, and a record of what
    // discovery found would stop meaning that the moment this stage edited it.
    readonly discovery?: ReviewDiscoveryReport | undefined
    readonly providerIssues: readonly ProviderIssue[]
    readonly contextLedgerEntries: readonly ContextLedgerEntry[]
    readonly evidence: readonly EvidenceRecord[]
    readonly preRejectedFindings: readonly RejectedFinding[]
    readonly preAdmissionDecisions: readonly AdmissionDecisionRecord[]
    readonly taskEvents: readonly WorkflowTaskEvent[]
    readonly instructionHashes: readonly string[]
    readonly skillHashes: readonly string[]
  }
): ReviewWorkflowOutput => {
  const evidence = uniqueBy(input.evidence, byId)
  const refutationResults = uniqueBy(input.refutationResults, byId)
  const providerIssues = uniqueBy(input.providerIssues, providerIssueKey)
  const contextLedgerEntries = uniqueBy(input.contextLedgerEntries, byId)
  const candidateFindings = uniqueBy(input.candidateFindings, byId)
  const preRejectedFindings = uniqueBy(input.preRejectedFindings, byCandidateId)
  const preAdmissionDecisions = uniqueBy(
    input.preAdmissionDecisions,
    byCandidateId
  )
  const terminalCandidateIds = terminalPreAdmissionCandidateIds({
    rejectedFindings: preRejectedFindings,
    admissionDecisions: preAdmissionDecisions
  })
  const admissionCandidates = uniqueBy(input.admissionCandidates, byId).filter(
    (candidate) => !terminalCandidateIds.has(candidate.id)
  )
  const { admittedFindings, rejectedFindings, admissionDecisions } = runAdmission({
    ...input,
    candidates: admissionCandidates,
    evidence,
    rejectedFindings: preRejectedFindings,
    admissionDecisions: preAdmissionDecisions
  })
  const artifactOnlyCandidateIds = new Set(input.artifactOnlyCandidateIds)
  const artifactOnlyFindingIds = new Set(
    admissionDecisions.flatMap((decision) =>
      artifactOnlyCandidateIds.has(decision.candidateId) &&
      decision.findingId !== undefined
        ? [decision.findingId]
        : []
    )
  )
  // Carry the refutation verdict onto the finding it decided. The report renders
  // an "Unresolved - Needs Human Decision" entry per artifact-only finding and
  // looks the verdict up by `refutationId`; nothing wrote that field, so every
  // entry read "no refutation verdict was recorded" and the reader was told a
  // decision was needed without being told what was already established. Spec 05
  // requires the verdict and its rationale to travel with the finding.
  const refutationIdByFindingId = new Map(
    admissionDecisions.flatMap((decision) => {
      if (decision.findingId === undefined) {
        return []
      }

      const refutation = refutationResults.find(
        (result) => result.candidateId === decision.candidateId
      )

      return refutation === undefined ? [] : [[decision.findingId, refutation.id]]
    })
  )
  const visibleFindings = admittedFindings.map((finding) => {
    const refutationId = refutationIdByFindingId.get(finding.id)

    return {
      ...finding,
      ...(refutationId === undefined ? {} : { refutationId }),
      ...(artifactOnlyFindingIds.has(finding.id)
        ? { reporterEligibility: 'artifact-only' as const }
        : {})
    }
  })
  const baseline = matchBaselineFindings({
    admittedFindings: visibleFindings,
    ...(input.workflowInput.baselineFingerprints === undefined
      ? {}
      : {
          baselineFingerprints:
            input.workflowInput
              .baselineFingerprints as readonly BaselineFingerprintRecord[]
        }),
    baselineConfigured: input.workflowInput.baselineConfigured
  })
  const qualityGate = evaluateQualityGate({
    admittedFindings: baseline.admittedFindings,
    thresholds: input.workflowInput.qualityGate,
    providerIssues
  })

  return ReviewWorkflowOutputSchema.parse({
    ...(input.discovery === undefined ? {} : { discovery: input.discovery }),
    admittedFindings: baseline.admittedFindings,
    rejectedFindings,
    evidence,
    candidateFindings,
    contextLedgerEntries,
    refutationResults,
    providerIssues,
    admissionDecisions,
    taskEvents: input.taskEvents,
    qualityGate,
    instructionHashes: input.instructionHashes,
    skillHashes: input.skillHashes,
    warnings: [...baseline.warnings]
  })
}
