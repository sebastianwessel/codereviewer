import { z } from 'zod'
import {
  type ContextRequest,
  type EvidenceRecord,
  type PromotionPolicyConfig
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type ContextRetriever } from '../context-retrieval/index.js'
import {
  type ContextRequestArtifactCache,
  type ContextRequestArtifacts
} from './model-context-artifacts.js'
import {
  TaskReviewResultSchema,
  type FindingInvestigationRunner,
  type TaskReviewInput
} from './model-agent-contracts.js'
import { proofLoopArtifactsForCandidate } from './model-proof-candidate-loop.js'
import {
  emptyProofTaskArtifacts,
  proofTaskArtifactsWithCandidate
} from './model-proof-task-result-aggregation.js'
import { type ProviderIssueForError } from './model-provider-issues.js'

export const proofLoopArtifactsForTaskResult = async (
  input: TaskReviewInput,
  candidates: readonly CandidateFinding[],
  contextRequestsByCandidateId: Readonly<Record<string, readonly ContextRequest[]>>,
  requestedContextByCandidateId: Readonly<Record<string, readonly string[]>>,
  contextRetriever: ContextRetriever | undefined,
  promotionPolicy: PromotionPolicyConfig,
  maxInvestigationRounds: number,
  maxTaskInputBytes: number | undefined,
  investigateFinding: FindingInvestigationRunner | undefined,
  providerIssueForError: ProviderIssueForError,
  contextArtifactCache: ContextRequestArtifactCache | undefined,
  signal: AbortSignal | undefined
): Promise<
  Pick<
  z.infer<typeof TaskReviewResultSchema>,
  | 'modelSuspicions'
  | 'investigationTraces'
  | 'proofPackets'
  | 'refutationResults'
  | 'promotionDecisions'
  | 'providerIssues'
> & { readonly evidenceRecords: readonly EvidenceRecord[] }
> => {
  const taskArtifacts = emptyProofTaskArtifacts()
  const effectiveContextArtifactCache =
    contextArtifactCache ?? new Map<string, Promise<ContextRequestArtifacts>>()

  for (const candidate of candidates) {
    const artifacts = await proofLoopArtifactsForCandidate({
      taskInput: input,
      candidate,
      contextRequests: contextRequestsByCandidateId[candidate.id] ?? [],
      requestedContext: requestedContextByCandidateId[candidate.id] ?? [],
      contextRetriever,
      promotionPolicy,
      maxInvestigationRounds,
      maxTaskInputBytes,
      investigateFinding,
      providerIssueForError,
      contextArtifactCache: effectiveContextArtifactCache,
      signal
    })

    proofTaskArtifactsWithCandidate({
      state: taskArtifacts,
      candidateArtifacts: artifacts
    })
  }

  return taskArtifacts
}
