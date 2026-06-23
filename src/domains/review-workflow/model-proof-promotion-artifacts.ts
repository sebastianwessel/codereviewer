import { z } from 'zod'
import {
  ProofPacketSchema,
  PromotionDecisionSchema,
  PromotionPolicyConfigSchema,
  RefutationResultSchema,
  type ProofPacket,
  type PromotionDecision,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import { truncateForContract } from '../../shared/text/truncate.js'
import { type FindingInvestigationResult } from './model-agent-contracts.js'

type PromotionPolicy = z.infer<typeof PromotionPolicyConfigSchema>

export const proofPromotionArtifactsForCandidate = (
  input: {
    readonly candidate: CandidateFinding
    readonly suspicionId: string
    readonly proofEvidenceIds: readonly string[]
    readonly investigationOutput: FindingInvestigationResult
    readonly promotionPolicy: PromotionPolicy
    readonly staticAnalysisDuplicate: boolean
    readonly deterministicContradiction: boolean
  }
): {
  readonly proofPacket: ProofPacket
  readonly refutationResult?: RefutationResult
  readonly promotionDecision: PromotionDecision
} => {
  const proofPacketId = `proof_${sha256(
    `${input.candidate.id}:${input.suspicionId}:${input.proofEvidenceIds.join(',')}`
  ).slice(0, 16)}`
  const refutationId = input.deterministicContradiction
    ? `refute_${sha256(`${proofPacketId}:refuted`).slice(0, 16)}`
    : undefined
  const promotionStatus = input.deterministicContradiction
    ? input.promotionPolicy.deterministicContradiction
    : input.staticAnalysisDuplicate
      ? input.promotionPolicy.staticAnalysisDuplicate
      : input.promotionPolicy.modelProof
  const promotionReason = input.deterministicContradiction
    ? `Deterministic contradiction evidence was cited; policy deterministicContradiction=${input.promotionPolicy.deterministicContradiction}.`
    : input.staticAnalysisDuplicate
      ? `The proof duplicates external static-analysis coverage; policy staticAnalysisDuplicate=${input.promotionPolicy.staticAnalysisDuplicate}.`
    : `Proof artifacts were assembled; active refutation is required before admission; policy modelProof=${input.promotionPolicy.modelProof}.`
  const fixDirection =
    input.investigationOutput.fixDirection ??
    input.candidate.fixProposal?.summary ??
    input.candidate.suggestedFix ??
    'Apply a scoped manual fix that removes the proved changed behavior.'
  const proofPacket = ProofPacketSchema.parse({
    id: proofPacketId,
    suspicionId: input.suspicionId,
    candidateId: input.candidate.id,
    changedBehavior:
      input.investigationOutput.changedBehavior ?? input.candidate.description,
    executionOrDataPath:
      input.investigationOutput.executionOrDataPath ??
      'The model tied the suspected behavior to the reviewed task context and cited exact task evidence.',
    violatedInvariant:
      input.investigationOutput.violatedInvariant ?? input.candidate.title,
    impact: input.investigationOutput.impact ?? input.candidate.description,
    introducedByChange:
      input.investigationOutput.introducedByChange ??
      'The suspected issue is located in a reviewed path and must be evaluated against the reviewed diff before promotion.',
    evidenceIds: input.proofEvidenceIds,
    contradictionChecks: [
      truncateForContract(input.investigationOutput.rationaleSummary, 500),
      ...input.investigationOutput.contradictionChecks.map((check) =>
        truncateForContract(check, 500)
      ),
      ...(input.deterministicContradiction
        ? ['Deterministic contradiction evidence was cited.']
        : ['No deterministic contradiction evidence was cited.'])
    ],
    fixDirection
  })
  const refutationResult = input.deterministicContradiction
    ? RefutationResultSchema.parse({
        id: refutationId,
        proofPacketId,
        verdict: 'refuted',
        summary: 'Deterministic contradiction evidence refuted the proof packet.',
        evidenceIds: input.proofEvidenceIds,
        checks: [
          {
            kind: 'task-evidence',
            result: 'passed',
            summary: 'Every proof evidence reference exists in the task packet.',
            evidenceIds: input.proofEvidenceIds
          },
          {
            kind: 'promotion-boundary',
            result: 'passed',
            summary: promotionReason,
            evidenceIds: []
          }
        ]
      })
    : undefined

  return {
    proofPacket,
    ...(refutationResult === undefined ? {} : { refutationResult }),
    promotionDecision: PromotionDecisionSchema.parse({
      candidateId: input.candidate.id,
      proofPacketId,
      ...(refutationId === undefined ? {} : { refutationId }),
      status: promotionStatus,
      reason: promotionReason,
      policy: 'promotion-policy-v1'
    })
  }
}
