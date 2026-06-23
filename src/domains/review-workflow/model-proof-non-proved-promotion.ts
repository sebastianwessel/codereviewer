import {
  PromotionDecisionSchema,
  type PromotionDecision,
  type PromotionDecisionStatus
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'

export const proofNonProvedPromotionDecision = (
  input: {
    readonly candidate: CandidateFinding
    readonly effectiveInvestigationVerdict: 'refuted' | 'needs-more-evidence'
    readonly rationaleSummary: string
    readonly modelWeakOrRefuted: Extract<
      PromotionDecisionStatus,
      'artifact-only' | 'rejected'
    >
  }
): PromotionDecision =>
  PromotionDecisionSchema.parse({
    candidateId: input.candidate.id,
    status:
      input.effectiveInvestigationVerdict === 'refuted'
        ? 'rejected'
        : input.modelWeakOrRefuted,
    reason: input.rationaleSummary.slice(0, 500),
    policy: 'promotion-policy-v1'
  })
