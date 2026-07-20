import { z } from 'zod'
import {
  AdmittedFindingSchema,
  CandidateIdSchema,
  CodeLocationSchema,
  ContractIdSchema,
  EvidenceRecordSchema,
  FindingCategorySchema,
  FixEditSchema,
  FixProposalSchema,
  RejectedFindingSchema,
  SeveritySchema,
  TaskIdSchema,
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
import { truncateForContract } from '../../shared/text/truncate.js'

export const CandidateFindingSchema = z.strictObject({
  id: CandidateIdSchema,
  // Shared id primitives keep candidate/task id validation identical across the
  // generation, planning, admission, and report stages. The previous inline
  // `^task_[a-z0-9]+$` rejected intent-grouped ids (`task_intent_<hex>`) and
  // surfaced as a spurious provider configuration error during model-intent runs.
  taskId: TaskIdSchema,
  category: FindingCategorySchema,
  severity: SeveritySchema,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1200),
  location: CodeLocationSchema,
  evidenceIds: z.array(ContractIdSchema),
  proposedBy: z.string().min(1),
  suggestedFix: z.string().max(1200).optional(),
  fixProposal: FixProposalSchema.optional()
})

export type CandidateFinding = z.infer<typeof CandidateFindingSchema>

export type ReviewedLineRange = {
  readonly path: string
  readonly startLine: number
  readonly endLine: number
}

export type ReviewedDiffRange = {
  readonly path: string
  readonly startLine: number
  readonly endLine: number
  readonly changeKind?: 'new' | 'modified' | 'deleted' | undefined
}

export type AdmissionPolicy = {
  readonly reviewedPaths: readonly string[]
  readonly reviewedLineRanges?: readonly ReviewedLineRange[]
  readonly reviewedDiffRanges?: readonly ReviewedDiffRange[]
  readonly minimumSeverity?: Severity
  // Minimum severity for a model-origin candidate to be admitted as actionable.
  // Trusted deterministic-rule candidates are exempt. Below this, the candidate
  // is rejected as below-threshold (recorded as a rejected finding).
  readonly actionableSeverityThreshold?: Severity
  readonly inlineSeverityThreshold: Severity
  readonly provenance: Omit<FindingProvenance, 'instructionHashes' | 'skillHashes'> & {
    readonly instructionHashes: readonly string[]
    readonly skillHashes: readonly string[]
  }
  readonly admittedAt: string
}

// Resolves the source line a finding points at, so the fingerprint can anchor
// on content instead of a line number. Returns undefined when the line cannot
// be resolved (for example a location on the old side of the diff).
export type AnchorTextResolver = (
  location: CandidateFinding['location']
) => string | undefined

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

export const sourceLineCount = (content: string): number =>
  content.length === 0 ? 0 : content.split(/\r\n|\n|\r/u).length

export const reviewedLineRangeForContent = (
  input: {
    readonly path: string
    readonly content: string
  }
): ReviewedLineRange => ({
  path: input.path,
  startLine: 1,
  endLine: sourceLineCount(input.content)
})

const reviewedLineRangeForPath = (
  path: string,
  ranges: readonly ReviewedLineRange[]
): ReviewedLineRange | undefined =>
  ranges.find((range) => range.path === path)

const locationLineRangeIsValid = (
  candidate: CandidateFinding,
  ranges: readonly ReviewedLineRange[] | undefined
): boolean => {
  if (candidate.location.side === 'old' || ranges === undefined) {
    return true
  }

  const reviewedRange = reviewedLineRangeForPath(candidate.location.path, ranges)
  const endLine = candidate.location.endLine ?? candidate.location.startLine

  return (
    reviewedRange !== undefined &&
    candidate.location.startLine >= reviewedRange.startLine &&
    endLine <= reviewedRange.endLine
  )
}

const lineRangesOverlap = (
  left: { readonly startLine: number; readonly endLine: number },
  right: { readonly startLine: number; readonly endLine: number }
): boolean => left.startLine <= right.endLine && right.startLine <= left.endLine

const locationDiffRangeIsInlineEligible = (
  candidate: CandidateFinding,
  ranges: readonly ReviewedDiffRange[] | undefined
): boolean => {
  if (ranges === undefined) {
    return true
  }

  if (candidate.location.side !== 'new') {
    return false
  }

  const candidateRange = {
    startLine: candidate.location.startLine,
    endLine: candidate.location.endLine ?? candidate.location.startLine
  }

  return ranges
    .filter((range) => range.path === candidate.location.path)
    .some((range) => lineRangesOverlap(candidateRange, range))
}

const selectedEvidence = (
  candidate: CandidateFinding,
  evidence: readonly EvidenceRecord[]
): readonly EvidenceRecord[] =>
  candidate.evidenceIds
    .map((evidenceId) => evidence.find((record) => record.id === evidenceId))
    .filter((record): record is EvidenceRecord => record !== undefined)

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

// Anchoring on the text of the reported line rather than its number is what
// lets a finding keep its identity across pushes: edits above it shift the line
// but not the anchor. Editing the anchored line itself does change the
// fingerprint, which is the intended signal that the finding was addressed.
// The emitted value is a truncated hash, so no source text is disclosed.
const createFingerprint = (
  candidate: CandidateFinding,
  resolveAnchorText: AnchorTextResolver | undefined
): FindingFingerprint => ({
  algorithm: 'v2-category-path-title-anchor',
  value: sha256(
    [
      candidate.category,
      candidate.location.path,
      normalizeText(candidate.title),
      normalizeText(resolveAnchorText?.(candidate.location) ?? '')
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
  candidate: CandidateFinding,
  severity: Severity,
  threshold: Severity,
  lineRangeIsValid: boolean,
  diffRangeIsInlineEligible: boolean
): ReporterEligibility =>
  candidate.location.side === 'new' &&
  lineRangeIsValid &&
  diffRangeIsInlineEligible &&
  severityRank[severity] >= severityRank[threshold]
    ? 'inline'
    : 'summary-only'

// Read the `max(n)` length from a (possibly optional) Zod string field. Used so
// redaction caps are derived from the destination schema rather than hard-coded,
// keeping them from drifting away from the contract they must satisfy.
const stringFieldMax = (schema: {
  readonly maxLength?: number | null
  readonly unwrap?: () => { readonly maxLength?: number | null }
}): number => {
  if (typeof schema.maxLength === 'number') {
    return schema.maxLength
  }

  const unwrapped = schema.unwrap?.()

  return typeof unwrapped?.maxLength === 'number'
    ? unwrapped.maxLength
    : Number.POSITIVE_INFINITY
}

// Redaction can lengthen text (a short configured secret becomes `[REDACTED]`),
// so the result is truncated back to its contract cap. Without this, a redacted
// title/description could exceed AdmittedFindingSchema's limit and fail
// validation at admission time.
const redactCandidateField = (
  value: string,
  schema: Parameters<typeof stringFieldMax>[0]
): string =>
  truncateForContract(createRedactor().redact(value), stringFieldMax(schema))

const redactedCandidate = (candidate: CandidateFinding): CandidateFinding => ({
  ...candidate,
  title: redactCandidateField(candidate.title, CandidateFindingSchema.shape.title),
  description: redactCandidateField(
    candidate.description,
    CandidateFindingSchema.shape.description
  ),
  ...(candidate.suggestedFix === undefined
    ? {}
    : {
        suggestedFix: redactCandidateField(
          candidate.suggestedFix,
          CandidateFindingSchema.shape.suggestedFix
        )
      }),
  ...(candidate.fixProposal === undefined
    ? {}
    : {
        fixProposal: {
          ...candidate.fixProposal,
          summary: redactCandidateField(
            candidate.fixProposal.summary,
            FixProposalSchema.shape.summary
          ),
          ...(candidate.fixProposal.edits === undefined
            ? {}
            : {
                edits: candidate.fixProposal.edits.map((edit) => ({
                  ...edit,
                  replacement: redactCandidateField(
                    edit.replacement,
                    FixEditSchema.shape.replacement
                  ),
                  ...(edit.description === undefined
                    ? {}
                    : {
                        description: redactCandidateField(
                          edit.description,
                          FixEditSchema.shape.description
                        )
                      })
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
    readonly resolveAnchorText?: AnchorTextResolver
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

  const lineRangeIsValid = locationLineRangeIsValid(
    candidate,
    input.policy.reviewedLineRanges
  )
  const diffRangeIsInlineEligible = locationDiffRangeIsInlineEligible(
    candidate,
    input.policy.reviewedDiffRanges
  )

  if (!lineRangeIsValid) {
    return {
      status: 'rejected',
      rejectedFinding: makeRejectedFinding({
        candidateId: candidate.id,
        reason: 'location-invalid',
        message: 'Candidate location line range is outside reviewed source input.',
        evidenceIds: candidate.evidenceIds
      })
    }
  }

  const evidence = selectedEvidence(candidate, input.evidence).map((record) =>
    EvidenceRecordSchema.parse(record)
  )

  if (evidence.length === 0) {
    return {
      status: 'needs-more-evidence',
      rejectedFinding: makeRejectedFinding({
        candidateId: candidate.id,
        status: 'needs-more-evidence',
        reason: 'insufficient-evidence',
        message: 'Candidate requires at least one evidence record.',
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

  // Trusted deterministic-rule findings bypass the model severity floor; every
  // other (model-origin) candidate must meet `actionableSeverityThreshold` when
  // set, otherwise the base `minimumSeverity`.
  const severityFloor =
    candidate.proposedBy !== 'deterministic-trusted-rule' &&
    input.policy.actionableSeverityThreshold !== undefined
      ? input.policy.actionableSeverityThreshold
      : input.policy.minimumSeverity

  if (
    severityFloor !== undefined &&
    severityRank[candidate.severity] < severityRank[severityFloor]
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

  const fingerprint = createFingerprint(candidate, input.resolveAnchorText)

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
      candidate,
      candidate.severity,
      input.policy.inlineSeverityThreshold,
      lineRangeIsValid,
      diffRangeIsInlineEligible
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
