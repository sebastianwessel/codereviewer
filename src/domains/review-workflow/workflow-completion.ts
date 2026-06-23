import { z } from 'zod'
import {
  RejectedFindingSchema,
  type AdmittedFinding,
  type EvidenceRecord,
  type FindingAggregateResult,
  type FindingJudgeResult,
  type InvestigationTrace,
  type ModelSuspicion,
  type ProofPacket,
  type PromotionDecision,
  PromotionDecisionSchema,
  type RefutationResult,
  type RejectedFinding,
  type ReviewIntent,
  type ReviewReport
} from '../../shared/contracts/index.js'
import { assertDeterministicSignalEvidenceOwnsPath } from '../deterministic-signals/index.js'
import {
  admitCandidate,
  evaluateQualityGate,
  matchBaselineFindings,
  reviewedLineRangeForContent,
  type BaselineFingerprintRecord,
  type CandidateFinding,
  type QualityGateThresholds,
  type ReviewedDiffRange,
  type ReviewedLineRange
} from '../admission/index.js'
import {
  createReviewSharedContext,
  type AdmissionDecisionRecord
} from '../shared-context/index.js'
import { type ContextLedgerEntry } from '../review-planning/index.js'
import {
  ReviewContextDocumentSchema,
  type ProviderIssue,
  type WorkflowTaskEvent
} from './model-agent-contracts.js'
import {
  ReviewWorkflowOutputSchema,
  type ReviewWorkflowInput,
  type ReviewWorkflowOutput
} from './workflow-contracts.js'

const runAdmission = (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly candidates: readonly CandidateFinding[]
    readonly evidence?: readonly EvidenceRecord[]
    readonly rejectedFindings?: readonly RejectedFinding[]
    readonly admissionDecisions?: readonly AdmissionDecisionRecord[]
    readonly instructionHashes: readonly string[]
    readonly skillHashes: readonly string[]
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
  const reviewedLineRanges =
    input.workflowInput.reviewedLineRanges ??
    reviewedLineRangesFromReviewContext(input.workflowInput.reviewContext ?? [])
  const reviewedDiffRanges: readonly ReviewedDiffRange[] | undefined =
    input.workflowInput.reviewedDiffRanges

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
      policy: {
        reviewedPaths: input.workflowInput.reviewedPaths,
        ...(reviewedLineRanges === undefined ? {} : { reviewedLineRanges }),
        ...(reviewedDiffRanges === undefined ? {} : { reviewedDiffRanges }),
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

export const rejectedReasonForPromotionDecision = (
  decision: PromotionDecision
): RejectedFinding['reason'] => {
  const reason = decision.reason.toLowerCase()

  if (reason.includes('deterministic contradiction')) {
    return 'deterministic-contradiction'
  }

  if (reason.includes('refuted')) {
    return 'refuted'
  }

  if (reason.includes('static-analysis')) {
    return 'static-analysis-duplicate'
  }

  if (decision.refutationId !== undefined) {
    return 'refuted'
  }

  return 'insufficient-evidence'
}

export const rejectedFindingForPromotionDecision = (
  decision: PromotionDecision
): RejectedFinding =>
  RejectedFindingSchema.parse({
    candidateId: decision.candidateId,
    status: 'rejected',
    reason: rejectedReasonForPromotionDecision(decision),
    message: decision.reason,
    evidenceIds: []
  })

export const admissionDecisionForRejectedPromotion = (
  decision: PromotionDecision
): AdmissionDecisionRecord => ({
  candidateId: decision.candidateId,
  status: 'rejected',
  rejectedReason: rejectedReasonForPromotionDecision(decision)
})

const uniqueEvidenceRecords = (
  evidenceRecords: readonly EvidenceRecord[]
): readonly EvidenceRecord[] => {
  const byId = new Map<string, EvidenceRecord>()

  for (const evidence of evidenceRecords) {
    if (!byId.has(evidence.id)) {
      byId.set(evidence.id, evidence)
    }
  }

  return [...byId.values()]
}

const uniqueById = <T extends { readonly id: string }>(
  values: readonly T[]
): readonly T[] => {
  const byId = new Map<string, T>()

  for (const value of values) {
    if (!byId.has(value.id)) {
      byId.set(value.id, value)
    }
  }

  return [...byId.values()]
}

const uniqueRejectedFindingsByCandidateId = (
  findings: readonly RejectedFinding[]
): readonly RejectedFinding[] => {
  const byCandidateId = new Map<string, RejectedFinding>()

  for (const finding of findings) {
    if (!byCandidateId.has(finding.candidateId)) {
      byCandidateId.set(finding.candidateId, finding)
    }
  }

  return [...byCandidateId.values()]
}

const uniqueAdmissionDecisionsByCandidateId = (
  decisions: readonly AdmissionDecisionRecord[]
): readonly AdmissionDecisionRecord[] => {
  const byCandidateId = new Map<string, AdmissionDecisionRecord>()

  for (const decision of decisions) {
    if (!byCandidateId.has(decision.candidateId)) {
      byCandidateId.set(decision.candidateId, decision)
    }
  }

  return [...byCandidateId.values()]
}

const refutationIdByProofPacketId = (
  refutationResults: readonly RefutationResult[]
): ReadonlyMap<string, string> => {
  const byProofPacketId = new Map<string, string>()

  for (const refutation of refutationResults) {
    if (!byProofPacketId.has(refutation.proofPacketId)) {
      byProofPacketId.set(refutation.proofPacketId, refutation.id)
    }
  }

  return byProofPacketId
}

const refutationByProofPacketId = (
  refutationResults: readonly RefutationResult[]
): ReadonlyMap<string, RefutationResult> => {
  const byProofPacketId = new Map<string, RefutationResult>()

  for (const refutation of refutationResults) {
    if (!byProofPacketId.has(refutation.proofPacketId)) {
      byProofPacketId.set(refutation.proofPacketId, refutation)
    }
  }

  return byProofPacketId
}

const nonAdmittedDecisionByCandidateId = (
  decisions: readonly AdmissionDecisionRecord[]
): ReadonlyMap<string, AdmissionDecisionRecord> => {
  const byCandidateId = new Map<string, AdmissionDecisionRecord>()

  for (const decision of decisions) {
    if (decision.status !== 'admitted' && !byCandidateId.has(decision.candidateId)) {
      byCandidateId.set(decision.candidateId, decision)
    }
  }

  return byCandidateId
}

const rejectedFindingByCandidateId = (
  findings: readonly RejectedFinding[]
): ReadonlyMap<string, RejectedFinding> => {
  const byCandidateId = new Map<string, RejectedFinding>()

  for (const finding of findings) {
    if (!byCandidateId.has(finding.candidateId)) {
      byCandidateId.set(finding.candidateId, finding)
    }
  }

  return byCandidateId
}

const terminalPromotionReason = (input: {
  readonly decision: AdmissionDecisionRecord
  readonly rejectedFinding?: RejectedFinding | undefined
}): RejectedFinding['reason'] =>
  input.decision.rejectedReason ??
  input.rejectedFinding?.reason ??
  'insufficient-evidence'

const reconcilePromotionDecisionsWithAdmission = (input: {
  readonly promotionDecisions: readonly PromotionDecision[]
  readonly artifactOnlyCandidateIds: ReadonlySet<string>
  readonly admissionDecisions: readonly AdmissionDecisionRecord[]
  readonly rejectedFindings: readonly RejectedFinding[]
  readonly refutationResults: readonly RefutationResult[]
}): readonly PromotionDecision[] => {
  const terminalDecisions = nonAdmittedDecisionByCandidateId(
    input.admissionDecisions
  )
  const rejectedFindings = rejectedFindingByCandidateId(input.rejectedFindings)
  const refutationIds = refutationIdByProofPacketId(input.refutationResults)
  const refutations = refutationByProofPacketId(input.refutationResults)

  return input.promotionDecisions.map((decision) => {
    const terminalDecision = terminalDecisions.get(decision.candidateId)
    const refutationId =
      decision.proofPacketId === undefined
        ? undefined
        : refutationIds.get(decision.proofPacketId)

    if (terminalDecision === undefined) {
      if (
        decision.status === 'actionable' &&
        input.artifactOnlyCandidateIds.has(decision.candidateId)
      ) {
        const reason =
          decision.proofPacketId === undefined
            ? 'artifact-only'
            : (refutations.get(decision.proofPacketId)?.verdict ??
              'artifact-only')

        return PromotionDecisionSchema.parse({
          ...decision,
          ...(decision.refutationId !== undefined || refutationId === undefined
            ? {}
            : { refutationId }),
          status: 'artifact-only',
          reason: `Final admission kept this proof candidate artifact-only: ${reason}.`
        })
      }

      return decision
    }

    if (decision.status === 'rejected') {
      return decision
    }

    const reason = terminalPromotionReason({
      decision: terminalDecision,
      rejectedFinding: rejectedFindings.get(decision.candidateId)
    })
    const status =
      terminalDecision.status === 'rejected' ? 'rejected' : 'artifact-only'

    return PromotionDecisionSchema.parse({
      ...decision,
      ...(decision.refutationId !== undefined ||
      decision.proofPacketId === undefined ||
      refutationId === undefined
        ? {}
        : { refutationId }),
      status,
      reason:
        terminalDecision.status === 'rejected'
          ? `Final admission rejected this proof candidate: ${reason}.`
          : `Final admission kept this proof candidate artifact-only: ${reason}.`
    })
  })
}

const providerIssueKey = (issue: ProviderIssue): string =>
  JSON.stringify({
    code: issue.code,
    stage: issue.stage ?? null,
    recovered: issue.recovered ?? null,
    message: issue.message ?? null
  })

const uniqueProviderIssues = (
  providerIssues: readonly ProviderIssue[]
): readonly ProviderIssue[] => {
  const byKey = new Map<string, ProviderIssue>()

  for (const issue of providerIssues) {
    const key = providerIssueKey(issue)

    if (!byKey.has(key)) {
      byKey.set(key, issue)
    }
  }

  return [...byKey.values()]
}

const uniqueContextLedgerEntries = (
  entries: readonly ContextLedgerEntry[]
): readonly ContextLedgerEntry[] => {
  const byId = new Map<string, ContextLedgerEntry>()

  for (const entry of entries) {
    if (!byId.has(entry.id)) {
      byId.set(entry.id, entry)
    }
  }

  return [...byId.values()]
}

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
    readonly modelSuspicions: readonly ModelSuspicion[]
    readonly investigationTraces: readonly InvestigationTrace[]
    readonly proofPackets: readonly ProofPacket[]
    readonly refutationResults: readonly RefutationResult[]
    readonly aggregateResults: readonly FindingAggregateResult[]
    readonly reviewIntents: readonly ReviewIntent[]
    readonly modelTaskDiagnostics?: readonly ReviewReport['modelTaskDiagnostics'][number][]
    readonly judgeResults: readonly FindingJudgeResult[]
    readonly promotionDecisions: readonly PromotionDecision[]
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
  const evidence = uniqueEvidenceRecords(input.evidence)
  const modelSuspicions = uniqueById(input.modelSuspicions)
  const proofPackets = uniqueById(input.proofPackets)
  const refutationResults = uniqueById(input.refutationResults)
  const aggregateResults = uniqueById(input.aggregateResults)
  const judgeResults = uniqueById(input.judgeResults)
  const providerIssues = uniqueProviderIssues(input.providerIssues)
  const contextLedgerEntries = uniqueContextLedgerEntries(
    input.contextLedgerEntries
  )
  const candidateFindings = uniqueById(input.candidateFindings)
  const preRejectedFindings = uniqueRejectedFindingsByCandidateId(
    input.preRejectedFindings
  )
  const preAdmissionDecisions = uniqueAdmissionDecisionsByCandidateId(
    input.preAdmissionDecisions
  )
  const terminalCandidateIds = terminalPreAdmissionCandidateIds({
    rejectedFindings: preRejectedFindings,
    admissionDecisions: preAdmissionDecisions
  })
  const admissionCandidates = uniqueById(input.admissionCandidates).filter(
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
  const promotionDecisions = reconcilePromotionDecisionsWithAdmission({
    promotionDecisions: input.promotionDecisions,
    artifactOnlyCandidateIds,
    admissionDecisions,
    rejectedFindings,
    refutationResults
  })
  const artifactOnlyFindingIds = new Set(
    admissionDecisions.flatMap((decision) =>
      artifactOnlyCandidateIds.has(decision.candidateId) &&
      decision.findingId !== undefined
        ? [decision.findingId]
        : []
    )
  )
  const visibleFindings = admittedFindings.map((finding) =>
    artifactOnlyFindingIds.has(finding.id)
      ? {
          ...finding,
          reporterEligibility: 'artifact-only' as const
        }
      : finding
  )
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
    thresholds: input.workflowInput.qualityGate as QualityGateThresholds
  })

  return ReviewWorkflowOutputSchema.parse({
    admittedFindings: baseline.admittedFindings,
    rejectedFindings,
    evidence,
    candidateFindings,
    contextLedgerEntries,
    reviewIntents: input.reviewIntents,
    modelSuspicions,
    modelTaskDiagnostics: input.modelTaskDiagnostics ?? [],
    investigationTraces: input.investigationTraces,
    proofPackets,
    refutationResults,
    aggregateResults,
    judgeResults,
    promotionDecisions,
    providerIssues,
    admissionDecisions,
    taskEvents: input.taskEvents,
    qualityGate,
    instructionHashes: input.instructionHashes,
    skillHashes: input.skillHashes,
    warnings: baseline.warnings
  })
}
