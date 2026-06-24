import { z } from 'zod'
import {
  type AdmittedFinding,
  type EvidenceRecord,
  type RefutationResult,
  type RejectedFinding
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
    readonly refutationResults: readonly RefutationResult[]
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
  const refutationResults = uniqueById(input.refutationResults)
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
    refutationResults,
    providerIssues,
    admissionDecisions,
    taskEvents: input.taskEvents,
    qualityGate,
    instructionHashes: input.instructionHashes,
    skillHashes: input.skillHashes,
    warnings: baseline.warnings
  })
}
