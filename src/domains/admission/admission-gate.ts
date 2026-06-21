import { z } from 'zod'
import {
  AdmittedFindingSchema,
  CodeLocationSchema,
  ContractIdSchema,
  EvidenceRecordSchema,
  FindingCategorySchema,
  FixProposalSchema,
  RejectedFindingSchema,
  SeveritySchema,
  type AdmittedFinding,
  type EvidenceRecord,
  type FindingFingerprint,
  type FindingProvenance,
  type RejectedFinding,
  type ReporterEligibility,
  type Severity
} from '../../shared/contracts/index.js'
import { createRedactor } from '../../shared/redaction/redactor.js'
import { sha256 } from '../../shared/hash/hash.js'

export const CandidateFindingSchema = z.strictObject({
  id: z.string().regex(/^cand_[a-z0-9]+$/),
  taskId: z.string().regex(/^task_[a-z0-9]+$/),
  category: FindingCategorySchema,
  severity: SeveritySchema,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1200),
  location: CodeLocationSchema,
  evidenceIds: z.array(ContractIdSchema).min(1),
  proposedBy: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  suggestedFix: z.string().max(1200).optional(),
  fixProposal: FixProposalSchema.optional()
})

export type CandidateFinding = z.infer<typeof CandidateFindingSchema>

export type AdmissionPolicy = {
  readonly reviewedPaths: readonly string[]
  readonly minimumSeverity?: Severity
  readonly inlineSeverityThreshold: Severity
  readonly provenance: Omit<FindingProvenance, 'instructionHashes' | 'skillHashes'> & {
    readonly instructionHashes: readonly string[]
    readonly skillHashes: readonly string[]
  }
  readonly admittedAt: string
}

export type AdmissionResult =
  | {
      readonly status: 'admitted'
      readonly admittedFinding: AdmittedFinding
      readonly rejectedFinding?: never
    }
  | {
      readonly status: 'rejected' | 'needs-more-evidence'
      readonly rejectedFinding: RejectedFinding
      readonly admittedFinding?: never
    }

const severityRank: Readonly<Record<Severity, number>> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
}

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim()

const idFrom = (prefix: 'find', value: string): string =>
  `${prefix}_${sha256(value).slice(0, 24)}`

const makeRejectedFinding = (
  input: {
    readonly candidateId: string
    readonly status?: 'rejected' | 'needs-more-evidence'
    readonly reason: RejectedFinding['reason']
    readonly message: string
    readonly evidenceIds?: readonly string[]
  }
): RejectedFinding =>
  RejectedFindingSchema.parse({
    candidateId: input.candidateId,
    status: input.status ?? 'rejected',
    reason: input.reason,
    message: createRedactor().redact(input.message).slice(0, 500),
    ...(input.evidenceIds === undefined
      ? {}
      : { evidenceIds: [...input.evidenceIds] })
  })

const candidateIdFrom = (candidate: unknown): string =>
  typeof candidate === 'object' &&
  candidate !== null &&
  'id' in candidate &&
  typeof candidate.id === 'string'
    ? candidate.id
    : 'cand_invalid'

const evidenceIdsFrom = (candidate: unknown): readonly string[] | undefined =>
  typeof candidate === 'object' &&
  candidate !== null &&
  'evidenceIds' in candidate &&
  Array.isArray(candidate.evidenceIds) &&
  candidate.evidenceIds.every((id) => typeof id === 'string')
    ? candidate.evidenceIds
    : undefined

const isReviewedLocation = (
  locationPath: string,
  reviewedPaths: readonly string[]
): boolean => reviewedPaths.includes(locationPath)

const selectedEvidence = (
  candidate: CandidateFinding,
  evidence: readonly EvidenceRecord[]
): readonly EvidenceRecord[] =>
  candidate.evidenceIds
    .map((evidenceId) => evidence.find((record) => record.id === evidenceId))
    .filter((record): record is EvidenceRecord => record !== undefined)

const hasNonModelEvidence = (evidence: readonly EvidenceRecord[]): boolean =>
  evidence.some((record) => record.kind !== 'model-rationale')

const hasUnknownFixProposalEvidence = (candidate: CandidateFinding): boolean => {
  if (candidate.fixProposal === undefined) {
    return false
  }

  const candidateEvidenceIds = new Set(candidate.evidenceIds)

  return candidate.fixProposal.evidenceIds.some(
    (evidenceId) => !candidateEvidenceIds.has(evidenceId)
  )
}

const allEvidenceRedacted = (evidence: readonly EvidenceRecord[]): boolean =>
  evidence.every((record) => record.redactionApplied)

const createFingerprint = (
  candidate: CandidateFinding,
  evidence: readonly EvidenceRecord[]
): FindingFingerprint => ({
  algorithm: 'v1-category-rule-path-location-title-evidence',
  value: sha256(
    [
      candidate.category,
      candidate.location.path,
      candidate.location.startLine,
      candidate.location.side,
      normalizeText(candidate.title),
      evidence.map((record) => record.kind).sort().join(',')
    ].join(':')
  ).slice(0, 32)
})

const hasDuplicateFingerprint = (
  fingerprint: FindingFingerprint,
  findings: readonly AdmittedFinding[]
): boolean =>
  findings.some((finding) =>
    finding.fingerprints.some(
      (existing) =>
        existing.algorithm === fingerprint.algorithm &&
        existing.value === fingerprint.value
    )
  )

const hasDuplicateEvidenceLocation = (
  candidate: CandidateFinding,
  evidence: readonly EvidenceRecord[],
  findings: readonly AdmittedFinding[]
): boolean => {
  const evidenceIds = new Set(evidence.map((record) => record.id))

  return findings.some(
    (finding) =>
      finding.category === candidate.category &&
      finding.location.path === candidate.location.path &&
      finding.location.startLine === candidate.location.startLine &&
      finding.location.side === candidate.location.side &&
      finding.admissionEvidenceIds.some((evidenceId) =>
        evidenceIds.has(evidenceId)
      )
  )
}

const reporterEligibilityFor = (
  severity: Severity,
  threshold: Severity
): ReporterEligibility =>
  severityRank[severity] >= severityRank[threshold] ? 'inline' : 'summary-only'

const redactCandidateText = (value: string): string =>
  createRedactor().redact(value)

const redactedCandidate = (candidate: CandidateFinding): CandidateFinding => ({
  ...candidate,
  title: redactCandidateText(candidate.title),
  description: redactCandidateText(candidate.description),
  ...(candidate.suggestedFix === undefined
    ? {}
    : { suggestedFix: redactCandidateText(candidate.suggestedFix) }),
  ...(candidate.fixProposal === undefined
    ? {}
    : {
        fixProposal: {
          ...candidate.fixProposal,
          summary: redactCandidateText(candidate.fixProposal.summary),
          ...(candidate.fixProposal.edits === undefined
            ? {}
            : {
                edits: candidate.fixProposal.edits.map((edit) => ({
                  ...edit,
                  replacement: redactCandidateText(edit.replacement),
                  ...(edit.description === undefined
                    ? {}
                    : { description: redactCandidateText(edit.description) })
                }))
              })
        }
      })
})

export const admitCandidate = (
  input: {
    readonly candidate: unknown
    readonly evidence: readonly EvidenceRecord[]
    readonly existingAdmittedFindings: readonly AdmittedFinding[]
    readonly policy: AdmissionPolicy
  }
): AdmissionResult => {
  const parsedCandidate = CandidateFindingSchema.safeParse(input.candidate)

  if (!parsedCandidate.success) {
    const invalidEvidenceIds = evidenceIdsFrom(input.candidate)

    return {
      status: 'rejected',
      rejectedFinding: makeRejectedFinding({
        candidateId: candidateIdFrom(input.candidate),
        reason: 'schema-invalid',
        message: `Candidate failed schema validation. ${parsedCandidate.error.issues[0]?.message ?? ''}`,
        ...(invalidEvidenceIds === undefined
          ? {}
          : { evidenceIds: invalidEvidenceIds })
      })
    }
  }

  const candidate = parsedCandidate.data

  if (hasUnknownFixProposalEvidence(candidate)) {
    return {
      status: 'rejected',
      rejectedFinding: makeRejectedFinding({
        candidateId: candidate.id,
        reason: 'schema-invalid',
        message: 'Fix proposal references evidence outside the candidate evidence set.',
        evidenceIds: candidate.evidenceIds
      })
    }
  }

  if (!isReviewedLocation(candidate.location.path, input.policy.reviewedPaths)) {
    return {
      status: 'rejected',
      rejectedFinding: makeRejectedFinding({
        candidateId: candidate.id,
        reason: 'location-invalid',
        message: 'Candidate location is not part of reviewed repository input.',
        evidenceIds: candidate.evidenceIds
      })
    }
  }

  const evidence = selectedEvidence(candidate, input.evidence).map((record) =>
    EvidenceRecordSchema.parse(record)
  )

  if (!hasNonModelEvidence(evidence)) {
    return {
      status: 'needs-more-evidence',
      rejectedFinding: makeRejectedFinding({
        candidateId: candidate.id,
        status: 'needs-more-evidence',
        reason: 'insufficient-evidence',
        message: 'Candidate requires at least one non-model evidence record.',
        evidenceIds: candidate.evidenceIds
      })
    }
  }

  if (!allEvidenceRedacted(evidence)) {
    return {
      status: 'rejected',
      rejectedFinding: makeRejectedFinding({
        candidateId: candidate.id,
        reason: 'unsafe-content',
        message: 'Candidate evidence is not redacted for report-safe output.',
        evidenceIds: candidate.evidenceIds
      })
    }
  }

  if (
    input.policy.minimumSeverity !== undefined &&
    severityRank[candidate.severity] < severityRank[input.policy.minimumSeverity]
  ) {
    return {
      status: 'rejected',
      rejectedFinding: makeRejectedFinding({
        candidateId: candidate.id,
        reason: 'below-threshold',
        message: 'Candidate severity is below configured admission threshold.',
        evidenceIds: candidate.evidenceIds
      })
    }
  }

  const fingerprint = createFingerprint(candidate, evidence)

  if (
    hasDuplicateFingerprint(fingerprint, input.existingAdmittedFindings) ||
    hasDuplicateEvidenceLocation(
      candidate,
      evidence,
      input.existingAdmittedFindings
    )
  ) {
    return {
      status: 'rejected',
      rejectedFinding: makeRejectedFinding({
        candidateId: candidate.id,
        reason: 'duplicate',
        message: 'Candidate duplicates an already admitted finding.',
        evidenceIds: candidate.evidenceIds
      })
    }
  }

  const safeCandidate = redactedCandidate(candidate)
  const admittedFinding = AdmittedFindingSchema.parse({
    ...safeCandidate,
    id: idFrom('find', `${safeCandidate.id}:${fingerprint.value}`),
    admissionStatus: 'admitted',
    admittedAt: input.policy.admittedAt,
    admissionEvidenceIds: evidence.map((record) => record.id),
    reporterEligibility: reporterEligibilityFor(
      candidate.severity,
      input.policy.inlineSeverityThreshold
    ),
    provenance: {
      ...input.policy.provenance,
      instructionHashes: [...input.policy.provenance.instructionHashes],
      skillHashes: [...input.policy.provenance.skillHashes]
    },
    baselineStatus: 'new',
    fingerprints: [fingerprint]
  })

  return {
    status: 'admitted',
    admittedFinding
  }
}
