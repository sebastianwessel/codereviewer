import {
  type ProofPacket,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type FindingRefutationResult } from './model-agent-contracts.js'

export const proofPacketForCandidate = (
  candidate: CandidateFinding,
  proofPackets: readonly ProofPacket[]
): ProofPacket | undefined =>
  proofPackets.find((proofPacket) => proofPacket.candidateId === candidate.id)

export const proofLoopRefutationFor = (
  proofPacket: ProofPacket | undefined,
  refutationResults: readonly RefutationResult[]
): RefutationResult | undefined =>
  proofPacket === undefined
    ? undefined
    : refutationResults.find(
        (refutation) => refutation.proofPacketId === proofPacket.id
      )

export const refutationResultFromProofLoop = (
  input: {
    readonly candidate: CandidateFinding
    readonly proofPackets: readonly ProofPacket[]
    readonly refutationResults: readonly RefutationResult[]
  }
): FindingRefutationResult | undefined => {
  const proofPacket = proofPacketForCandidate(input.candidate, input.proofPackets)
  const refutation = proofLoopRefutationFor(proofPacket, input.refutationResults)

  if (proofPacket === undefined || refutation === undefined) {
    return undefined
  }

  return {
    verdict:
      refutation.verdict === 'provider-error'
        ? 'needs-more-evidence'
        : refutation.verdict,
    rationaleSummary: refutation.summary,
    ...(refutation.verdict === 'proved'
      ? { fixSummary: proofPacket.fixDirection }
      : {})
  }
}
