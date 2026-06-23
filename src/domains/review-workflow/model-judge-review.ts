import {
  type EvidenceRecord,
  type FindingJudgeResult,
  type ProofPacket,
  type RefutationResult,
  type RejectedFinding,
  type ReviewIntent
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type ContextRetriever } from '../context-retrieval/index.js'
import { type AdmissionDecisionRecord } from '../shared-context/index.js'
import { type ContextRequestArtifactCache } from './model-context-artifacts.js'
import {
  type FindingJudgeInput,
  type FindingJudgeOutput,
  type FindingJudgeRunner,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { executeJudgeFollowUpReview } from './model-judge-followup-execution.js'
import { judgeProviderErrorOutcome } from './model-judge-provider-error-outcome.js'
import { findingJudgeInputForCandidate } from './model-judge-packet.js'
import { judgeResultForModelOutput } from './model-judge-result.js'
import { judgeVerdictOutcome } from './model-judge-verdict-outcome.js'
import {
  type ProviderIssue,
  type ProviderIssueForError
} from './model-provider-issues.js'
import { type ReviewWorkflowInput } from './workflow-contracts.js'

export type JudgeReviewOutcome = {
  readonly status: 'passed' | 'rejected' | 'provider-error'
  readonly evidence: readonly EvidenceRecord[]
  readonly rejectedFindings: readonly RejectedFinding[]
  readonly admissionDecisions: readonly AdmissionDecisionRecord[]
  readonly judgeResults: readonly FindingJudgeResult[]
  readonly providerIssues: readonly ProviderIssue[]
}

export const reviewCandidateWithJudge = async (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly tasks: readonly WorkflowReviewTask[]
    readonly candidate: CandidateFinding
    readonly sharedDigest: string
    readonly evidence: readonly EvidenceRecord[]
    readonly reviewIntents: readonly ReviewIntent[]
    readonly proofPackets: readonly ProofPacket[]
    readonly refutationResults: readonly RefutationResult[]
    readonly refutationEvidence: EvidenceRecord
    readonly judgeFinding: FindingJudgeRunner
    readonly contextRetriever?: ContextRetriever | undefined
    readonly contextArtifactCache?: ContextRequestArtifactCache | undefined
    readonly signal?: AbortSignal
    readonly providerIssueForError: ProviderIssueForError
  }
): Promise<JudgeReviewOutcome> => {
  let effectiveJudgeInput: FindingJudgeInput
  let judgeOutput: FindingJudgeOutput

  try {
    effectiveJudgeInput = findingJudgeInputForCandidate({
      workflowInput: input.workflowInput,
      tasks: input.tasks,
      candidate: input.candidate,
      sharedDigest: input.sharedDigest,
      evidence: input.evidence,
      reviewIntents: input.reviewIntents,
      proofPackets: input.proofPackets,
      refutationResults: input.refutationResults
    }).input
  } catch (error: unknown) {
    return judgeProviderErrorOutcome({
      candidate: input.candidate,
      refutationEvidence: input.refutationEvidence,
      error,
      stage: 'judge-packet',
      messagePrefix: 'Judge packet failed',
      providerIssueForError: input.providerIssueForError
    })
  }

  try {
    judgeOutput = await input.judgeFinding(effectiveJudgeInput, input.signal)
  } catch (error: unknown) {
    return judgeProviderErrorOutcome({
      candidate: input.candidate,
      refutationEvidence: input.refutationEvidence,
      error,
      stage: 'judge-finding',
      messagePrefix: 'Judge check failed',
      providerIssueForError: input.providerIssueForError
    })
  }

  const followUpResult = await executeJudgeFollowUpReview({
    workflowInput: input.workflowInput,
    tasks: input.tasks,
    candidate: input.candidate,
    sharedDigest: input.sharedDigest,
    evidence: input.evidence,
    reviewIntents: input.reviewIntents,
    proofPackets: input.proofPackets,
    refutationResults: input.refutationResults,
    refutationEvidence: input.refutationEvidence,
    judgeInput: effectiveJudgeInput,
    judgeOutput,
    judgeFinding: input.judgeFinding,
    providerIssueForError: input.providerIssueForError,
    ...(input.contextRetriever === undefined
      ? {}
      : { contextRetriever: input.contextRetriever }),
    ...(input.contextArtifactCache === undefined
      ? {}
      : { contextArtifactCache: input.contextArtifactCache }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })

  if (followUpResult.status === 'provider-error') {
    return followUpResult.outcome
  }

  const judgeResult = judgeResultForModelOutput({
    candidate: input.candidate,
    judgeInput: followUpResult.judgeInput,
    output: followUpResult.judgeOutput,
    challengeQuestions: followUpResult.outputState.challengeQuestions,
    contextRequests: followUpResult.outputState.contextRequests,
    requestedContext: followUpResult.outputState.requestedContext
  })

  return judgeVerdictOutcome({
    candidate: input.candidate,
    judgeResult,
    evidence: followUpResult.contextState.additionalEvidence,
    providerIssues: followUpResult.providerIssues
  })
}
