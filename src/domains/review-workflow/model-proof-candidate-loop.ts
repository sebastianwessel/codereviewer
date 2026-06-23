import {
  type ContextRequest,
  type PromotionPolicyConfig
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type ContextRetriever } from '../context-retrieval/index.js'
import {
  contextArtifactsForRequestedContext,
  type ContextRequestArtifactCache
} from './model-context-artifacts.js'
import {
  type FindingInvestigationResult,
  type FindingInvestigationRunner,
  type TaskReviewInput
} from './model-agent-contracts.js'
import { proofCandidateArtifactsForInvestigation } from './model-proof-candidate-artifacts.js'
import { proofCandidateEvidenceFor } from './model-proof-candidate-evidence.js'
import { proofMissingInvestigationOutput } from './model-proof-default-investigation.js'
import { proofEvidenceSignalsFor } from './model-proof-evidence-signals.js'
import { proofFollowUpArtifactsAreUsable } from './model-proof-followup-artifacts.js'
import { proofShouldRequestFollowUpContext } from './model-proof-followup-eligibility.js'
import { proofFollowUpStateWithResult } from './model-proof-followup-state.js'
import { proofInvestigationExecutionForCandidate } from './model-proof-investigation-execution.js'
import {
  proofSuspicionForEvidence,
  proofSuspicionSeedForCandidate
} from './model-proof-suspicion-seed.js'
import { type ProofLoopCandidateArtifacts } from './model-proof-task-result-aggregation.js'
import {
  type ProviderIssue,
  type ProviderIssueForError
} from './model-provider-issues.js'

export const proofLoopArtifactsForCandidate = async (
  input: {
    readonly taskInput: TaskReviewInput
    readonly candidate: CandidateFinding
    readonly contextRequests: readonly ContextRequest[]
    readonly requestedContext: readonly string[]
    readonly contextRetriever?: ContextRetriever | undefined
    readonly promotionPolicy: PromotionPolicyConfig
    readonly maxInvestigationRounds: number
    readonly maxTaskInputBytes?: number | undefined
    readonly investigateFinding?: FindingInvestigationRunner | undefined
    readonly providerIssueForError: ProviderIssueForError
    readonly contextArtifactCache?: ContextRequestArtifactCache | undefined
    readonly signal?: AbortSignal | undefined
  }
): Promise<ProofLoopCandidateArtifacts> => {
  let contextArtifacts = await contextArtifactsForRequestedContext({
    candidate: input.candidate,
    contextRequests: input.contextRequests,
    requestedContext: input.requestedContext,
    contextRetriever: input.contextRetriever,
    cache: input.contextArtifactCache
  })
  const evidenceRecords = [...contextArtifacts.evidence]
  const { seedEvidenceIds, citedEvidence } = proofCandidateEvidenceFor({
    taskEvidence: input.taskInput.evidence,
    candidate: input.candidate
  })
  const evidenceSignals =
    input.taskInput.provenance.reviewer === 'review-agent'
      ? proofEvidenceSignalsFor(citedEvidence)
      : {
          staticAnalysisDuplicate: false,
          deterministicContradiction: false
        }
  let suspicionSeed = proofSuspicionSeedForCandidate({
    candidate: input.candidate,
    contextRequests: input.contextRequests,
    requestedContext: input.requestedContext
  })
  const providerIssues: ProviderIssue[] = []
  let investigationOutput: FindingInvestigationResult | undefined
  let usedInvestigationRounds = 0

  do {
    usedInvestigationRounds += 1
    const evidenceIds = [
      ...contextArtifacts.evidence.map((evidence) => evidence.id),
      ...seedEvidenceIds
    ]
    const provisionalSuspicion = proofSuspicionForEvidence({
      candidate: input.candidate,
      seed: suspicionSeed,
      evidenceIds,
      status: 'investigating'
    })

    const investigationExecution =
      await proofInvestigationExecutionForCandidate({
        taskInput: input.taskInput,
        candidate: input.candidate,
        suspicion: provisionalSuspicion,
        contextEvidence: contextArtifacts.evidence,
        contextReviewContext: contextArtifacts.reviewContext,
        evidenceIds,
        maxTaskInputBytes: input.maxTaskInputBytes,
        investigateFinding: input.investigateFinding,
        providerIssueForError: input.providerIssueForError,
        signal: input.signal
      })
    investigationOutput = investigationExecution.output
    providerIssues.push(...investigationExecution.providerIssues)

    if (
      !proofShouldRequestFollowUpContext({
        verdict: investigationOutput.verdict,
        hasContextRetriever: input.contextRetriever !== undefined,
        usedInvestigationRounds,
        maxInvestigationRounds: input.maxInvestigationRounds,
        contextRequestCount: investigationOutput.contextRequests.length,
        requestedContextCount: investigationOutput.requestedContext.length
      })
    ) {
      break
    }

    const followUpArtifacts = await contextArtifactsForRequestedContext({
      candidate: input.candidate,
      contextRequests: investigationOutput.contextRequests,
      requestedContext: investigationOutput.requestedContext,
      contextRetriever: input.contextRetriever,
      cache: input.contextArtifactCache
    }).catch((error: unknown) => {
      providerIssues.push(
        input.providerIssueForError({
          error,
          stage: 'suspicion-investigation-context',
          recovered: true
        })
      )

      return undefined
    })

    if (!proofFollowUpArtifactsAreUsable(followUpArtifacts)) {
      break
    }

    const followUpState = proofFollowUpStateWithResult({
      state: {
        suspicionSeed,
        contextArtifacts
      },
      investigationOutput,
      followUpArtifacts
    })
    suspicionSeed = followUpState.suspicionSeed
    contextArtifacts = followUpState.contextArtifacts
  } while (usedInvestigationRounds < input.maxInvestigationRounds)

  investigationOutput ??= proofMissingInvestigationOutput()
  return proofCandidateArtifactsForInvestigation({
    candidate: input.candidate,
    suspicionSeed,
    initialEvidenceRecords: evidenceRecords,
    contextArtifacts,
    seedEvidenceIds,
    investigationOutput,
    evidenceSignals,
    promotionPolicy: input.promotionPolicy,
    providerIssues,
    retrievalBudget: input.contextRetriever?.budget(),
    usedInvestigationRounds,
    maxInvestigationRounds: input.maxInvestigationRounds
  })
}
