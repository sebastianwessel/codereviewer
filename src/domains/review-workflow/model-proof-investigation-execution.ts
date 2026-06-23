import {
  type EvidenceRecord
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  type FindingInvestigationInput,
  type FindingInvestigationResult,
  type FindingInvestigationRunner,
  type ReviewContextDocument,
  type TaskReviewInput
} from './model-agent-contracts.js'
import { findingInvestigationInputForCandidate } from './model-investigation-packet.js'
import {
  proofRunnerlessInvestigationOutput
} from './model-proof-default-investigation.js'
import { proofInvestigationProviderRecovery } from './model-proof-provider-recovery.js'
import {
  type ProviderIssue,
  type ProviderIssueForError
} from './model-provider-issues.js'

export type ProofInvestigationExecution = {
  readonly output: FindingInvestigationResult
  readonly providerIssues: readonly ProviderIssue[]
}

export const proofInvestigationExecutionForCandidate = async (
  input: {
    readonly taskInput: TaskReviewInput
    readonly candidate: CandidateFinding
    readonly suspicion: FindingInvestigationInput['suspicion']
    readonly contextEvidence: readonly EvidenceRecord[]
    readonly contextReviewContext: readonly ReviewContextDocument[]
    readonly evidenceIds: readonly string[]
    readonly maxTaskInputBytes?: number | undefined
    readonly investigateFinding: FindingInvestigationRunner | undefined
    readonly providerIssueForError: ProviderIssueForError
    readonly signal: AbortSignal | undefined
  }
): Promise<ProofInvestigationExecution> => {
  if (input.investigateFinding === undefined) {
    return {
      output: proofRunnerlessInvestigationOutput({
        evidenceIds: input.evidenceIds
      }),
      providerIssues: []
    }
  }

  let investigationInput: FindingInvestigationInput

  try {
    investigationInput = findingInvestigationInputForCandidate({
      taskInput: input.taskInput,
      candidate: input.candidate,
      suspicion: input.suspicion,
      contextEvidence: input.contextEvidence,
      contextReviewContext: input.contextReviewContext,
      evidenceIds: input.evidenceIds,
      maxTaskInputBytes: input.maxTaskInputBytes
    }).input
  } catch (error: unknown) {
    const recovery = proofInvestigationProviderRecovery({
      error,
      stage: 'suspicion-investigation-packet',
      rationaleSummary:
        'Suspicion investigation packet exceeded the provider budget before proof could be established.',
      providerIssueForError: input.providerIssueForError
    })

    return {
      output: recovery.output,
      providerIssues: recovery.providerIssues
    }
  }

  return input.investigateFinding(investigationInput, input.signal)
    .then((output) => ({
      output,
      providerIssues: []
    }))
    .catch((error: unknown) => {
      const recovery = proofInvestigationProviderRecovery({
        error,
        stage: 'suspicion-investigation',
        rationaleSummary:
          'Suspicion investigation failed before a proof could be established.',
        providerIssueForError: input.providerIssueForError
      })

      return {
        output: recovery.output,
        providerIssues: recovery.providerIssues
      }
    })
}
