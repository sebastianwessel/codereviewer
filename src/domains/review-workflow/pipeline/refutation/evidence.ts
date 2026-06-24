import {
  EvidenceRecordSchema,
  type EvidenceRecord
} from '../../../../shared/contracts/index.js'
import {
  CandidateFindingSchema,
  type CandidateFinding
} from '../../../admission/index.js'
import { createRedactor } from '../../../../shared/redaction/redactor.js'
import { sha256 } from '../../../../shared/hash/hash.js'
import { type FindingRefutationResult } from '../agent-contracts.js'

export const refutationEvidenceIdFor = (
  candidate: CandidateFinding,
  refutation: FindingRefutationResult
): string =>
  `ev_${sha256(
    `${candidate.id}:${candidate.location.path}:${candidate.location.startLine}:${refutation.rationaleSummary}`
  ).slice(0, 24)}`

export const createRefutationEvidence = (
  input: {
    readonly candidate: CandidateFinding
    readonly refutation: FindingRefutationResult
  }
): EvidenceRecord => {
  const redactor = createRedactor()

  return EvidenceRecordSchema.parse({
    id: refutationEvidenceIdFor(input.candidate, input.refutation),
    kind: 'model-rationale',
    summary: redactor.redact(input.refutation.rationaleSummary).slice(0, 500),
    location: input.candidate.location,
    source: 'refutation-check',
    redactionApplied: true
  })
}

export const provedFixEditsFor = (
  input: {
    readonly candidate: CandidateFinding
    readonly refutation: FindingRefutationResult
  }
): NonNullable<NonNullable<CandidateFinding['fixProposal']>['edits']> => {
  const redactor = createRedactor()

  return (input.refutation.fixEdits ?? [])
    .filter((edit) => edit.path === input.candidate.location.path)
    .map((edit) => ({
      ...edit,
      replacement: redactor.redact(edit.replacement),
      ...(edit.description === undefined
        ? {}
        : { description: redactor.redact(edit.description) })
    }))
}

export const enrichProvedCandidate = (
  input: {
    readonly candidate: CandidateFinding
    readonly refutation: FindingRefutationResult
    readonly refutationEvidence: EvidenceRecord
  }
): CandidateFinding => {
  const evidenceIds = [
    ...new Set([...input.candidate.evidenceIds, input.refutationEvidence.id])
  ]
  const fixEdits = provedFixEditsFor(input)
  const redactor = createRedactor()

  return CandidateFindingSchema.parse({
    ...input.candidate,
    evidenceIds,
    ...(input.refutation.fixSummary === undefined && fixEdits.length === 0
      ? input.candidate.fixProposal === undefined
        ? {}
        : {
            fixProposal: {
              ...input.candidate.fixProposal,
              evidenceIds
            }
          }
      : {
          fixProposal: {
            summary: redactor
              .redact(
                  input.refutation.fixSummary ??
                  input.candidate.suggestedFix ??
                  input.candidate.fixProposal?.summary ??
                  'Apply the proved manual fix.'
              )
              .slice(0, 1200),
            evidenceIds,
            safety: 'manual-review',
            ...(fixEdits.length === 0 ? {} : { edits: fixEdits })
          }
        })
  })
}
