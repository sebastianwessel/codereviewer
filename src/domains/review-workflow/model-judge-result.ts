import { z } from 'zod'
import {
  FindingJudgeResultSchema,
  type ContextRequest,
  type FindingJudgeResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import {
  ModelFindingJudgeResultSchema,
  type FindingJudgeInput
} from './model-agent-contracts.js'

const judgeResultIdFor = (
  candidate: CandidateFinding,
  verdict: z.infer<typeof ModelFindingJudgeResultSchema>['verdict'],
  summary: string
): string =>
  `judge_${sha256(`${candidate.id}:${verdict}:${summary}`).slice(0, 16)}`

export const judgeResultForModelOutput = (
  input: {
    readonly candidate: CandidateFinding
    readonly judgeInput: FindingJudgeInput
    readonly output: z.infer<typeof ModelFindingJudgeResultSchema>
    readonly challengeQuestions?: readonly string[]
    readonly contextRequests?: readonly ContextRequest[]
    readonly requestedContext?: readonly string[]
  }
): FindingJudgeResult => {
  const availableEvidenceIds = new Set([
    ...input.judgeInput.evidence.map((record) => record.id),
    ...input.judgeInput.proofPackets.flatMap((packet) => packet.evidenceIds),
    ...input.judgeInput.refutationResults.flatMap((result) => result.evidenceIds)
  ])
  const citedEvidenceIds = input.output.evidenceIds.filter((evidenceId) =>
    availableEvidenceIds.has(evidenceId)
  )
  const verificationChecks = input.output.verificationChecks.map((check) => ({
    ...check,
    evidenceIds: check.evidenceIds.filter((evidenceId) =>
      availableEvidenceIds.has(evidenceId)
    )
  }))
  const verdict =
    input.output.verdict !== 'needs-more-evidence' &&
    citedEvidenceIds.length === 0
      ? 'needs-more-evidence'
      : input.output.verdict

  return FindingJudgeResultSchema.parse({
    id: judgeResultIdFor(input.candidate, verdict, input.output.summary),
    candidateId: input.candidate.id,
    verdict,
    summary: input.output.summary,
    challengeQuestions:
      input.challengeQuestions ?? input.output.challengeQuestions,
    verificationChecks,
    contextRequests: input.contextRequests ?? input.output.contextRequests,
    requestedContext: input.requestedContext ?? input.output.requestedContext,
    evidenceIds: citedEvidenceIds,
    ...(input.judgeInput.proofPackets[0] === undefined
      ? {}
      : { proofPacketId: input.judgeInput.proofPackets[0].id }),
    ...(input.judgeInput.refutationResults[0] === undefined
      ? {}
      : { refutationId: input.judgeInput.refutationResults[0].id })
  })
}
