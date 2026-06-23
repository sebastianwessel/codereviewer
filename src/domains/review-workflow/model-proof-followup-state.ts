import {
  mergeContextArtifacts,
  type ContextRequestArtifacts
} from './model-context-artifacts.js'
import { type FindingInvestigationResult } from './model-agent-contracts.js'
import { type ProofSuspicionSeed } from './model-proof-suspicion-seed.js'

export type ProofFollowUpState = {
  readonly suspicionSeed: ProofSuspicionSeed
  readonly contextArtifacts: ContextRequestArtifacts
}

export const proofFollowUpStateWithResult = (
  input: {
    readonly state: ProofFollowUpState
    readonly investigationOutput: FindingInvestigationResult
    readonly followUpArtifacts: ContextRequestArtifacts
  }
): ProofFollowUpState => ({
  suspicionSeed: {
    suspicionId: input.state.suspicionSeed.suspicionId,
    contextRequests: [
      ...input.state.suspicionSeed.contextRequests,
      ...input.investigationOutput.contextRequests
    ],
    requestedContext: [
      ...new Set([
        ...input.state.suspicionSeed.requestedContext,
        ...input.investigationOutput.requestedContext
      ])
    ]
  },
  contextArtifacts: mergeContextArtifacts(
    input.state.contextArtifacts,
    input.followUpArtifacts
  )
})
