import {
  type EvidenceRecord,
  type ProofPacket,
  type RefutationResult,
  type ReviewIntent
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type ContextRetriever } from '../context-retrieval/index.js'
import {
  contextArtifactsForRequestedContext,
  type ContextRequestArtifactCache
} from './model-context-artifacts.js'
import {
  type FindingJudgeInput,
  type FindingJudgeOutput,
  type FindingJudgeRunner,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import {
  judgeFollowUpContextStateWithArtifacts,
  type JudgeFollowUpContextState
} from './model-judge-followup-context.js'
import {
  judgeFollowUpOutputStateWithResult,
  type JudgeFollowUpOutputState
} from './model-judge-followup-output.js'
import {
  judgeProviderErrorOutcome,
  type JudgeProviderErrorOutcome
} from './model-judge-provider-error-outcome.js'
import { findingJudgeInputForCandidate } from './model-judge-packet.js'
import {
  type ProviderIssue,
  type ProviderIssueForError
} from './model-provider-issues.js'
import { type ReviewWorkflowInput } from './workflow-contracts.js'

export type CompletedJudgeFollowUpExecution = {
  readonly status: 'completed'
  readonly judgeInput: FindingJudgeInput
  readonly judgeOutput: FindingJudgeOutput
  readonly outputState: JudgeFollowUpOutputState
  readonly contextState: JudgeFollowUpContextState
  readonly providerIssues: readonly ProviderIssue[]
}

export type ProviderErrorJudgeFollowUpExecution = {
  readonly status: 'provider-error'
  readonly outcome: JudgeProviderErrorOutcome
}

export type JudgeFollowUpExecutionResult =
  | CompletedJudgeFollowUpExecution
  | ProviderErrorJudgeFollowUpExecution

export const executeJudgeFollowUpReview = async (
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
    readonly judgeInput: FindingJudgeInput
    readonly judgeOutput: FindingJudgeOutput
    readonly judgeFinding: FindingJudgeRunner
    readonly contextRetriever?: ContextRetriever | undefined
    readonly contextArtifactCache?: ContextRequestArtifactCache | undefined
    readonly signal?: AbortSignal
    readonly providerIssueForError: ProviderIssueForError
  }
): Promise<JudgeFollowUpExecutionResult> => {
  let effectiveJudgeInput = input.judgeInput
  let judgeOutput = input.judgeOutput
  let outputState: JudgeFollowUpOutputState = {
    challengeQuestions: judgeOutput.challengeQuestions,
    contextRequests: judgeOutput.contextRequests,
    requestedContext: judgeOutput.requestedContext
  }
  let usedJudgeFollowUpRounds = 0
  let contextState: JudgeFollowUpContextState = {
    workingEvidence: [...input.evidence],
    additionalEvidence: [],
    additionalEvidenceIds: [],
    additionalReviewContext: []
  }
  const providerIssues: ProviderIssue[] = []
  const maxJudgeFollowUpRounds = Math.max(
    1,
    input.workflowInput.maxInvestigationRounds ?? 1
  )

  while (
    judgeOutput.verdict === 'needs-more-evidence' &&
    (judgeOutput.requestedContext.length > 0 ||
      judgeOutput.contextRequests.length > 0) &&
    input.contextRetriever !== undefined &&
    usedJudgeFollowUpRounds < maxJudgeFollowUpRounds
  ) {
    usedJudgeFollowUpRounds += 1
    const contextArtifacts = await contextArtifactsForRequestedContext({
      candidate: input.candidate,
      requestedContext: judgeOutput.requestedContext,
      contextRequests: judgeOutput.contextRequests,
      contextRetriever: input.contextRetriever,
      cache: input.contextArtifactCache
    }).catch((error: unknown) => {
      providerIssues.push(
        input.providerIssueForError({
          error,
          stage: 'judge-context-retrieval',
          recovered: true
        })
      )

      return undefined
    })

    if (
      contextArtifacts === undefined ||
      (contextArtifacts.evidence.length === 0 &&
        contextArtifacts.reviewContext.length === 0)
    ) {
      break
    }

    contextState = judgeFollowUpContextStateWithArtifacts({
      state: contextState,
      contextArtifacts
    })

    try {
      effectiveJudgeInput = findingJudgeInputForCandidate({
        workflowInput: input.workflowInput,
        tasks: input.tasks,
        candidate: input.candidate,
        sharedDigest: input.sharedDigest,
        evidence: contextState.workingEvidence,
        reviewIntents: input.reviewIntents,
        proofPackets: input.proofPackets,
        refutationResults: input.refutationResults,
        additionalEvidenceIds: contextState.additionalEvidenceIds,
        additionalReviewContext: contextState.additionalReviewContext
      }).input
    } catch (error: unknown) {
      const providerError = judgeProviderErrorOutcome({
        candidate: input.candidate,
        refutationEvidence: input.refutationEvidence,
        error,
        stage: 'judge-follow-up-packet',
        messagePrefix: 'Judge follow-up packet failed',
        providerIssueForError: input.providerIssueForError
      })

      return {
        status: 'provider-error',
        outcome: {
          ...providerError,
          evidence: contextState.additionalEvidence,
          providerIssues: [...providerIssues, ...providerError.providerIssues]
        }
      }
    }

    try {
      judgeOutput = await input.judgeFinding(effectiveJudgeInput, input.signal)
    } catch (error: unknown) {
      const providerError = judgeProviderErrorOutcome({
        candidate: input.candidate,
        refutationEvidence: input.refutationEvidence,
        error,
        stage: 'judge-follow-up',
        messagePrefix: 'Judge follow-up failed',
        providerIssueForError: input.providerIssueForError
      })

      return {
        status: 'provider-error',
        outcome: {
          ...providerError,
          evidence: contextState.additionalEvidence,
          providerIssues: [...providerIssues, ...providerError.providerIssues]
        }
      }
    }

    outputState = judgeFollowUpOutputStateWithResult({
      state: outputState,
      output: judgeOutput
    })
  }

  return {
    status: 'completed',
    judgeInput: effectiveJudgeInput,
    judgeOutput,
    outputState,
    contextState,
    providerIssues
  }
}
