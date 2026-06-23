import {
  ModelSuspicionSchema,
  type ContextRequest,
  type ModelSuspicion
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { sha256 } from '../../shared/hash/hash.js'

export type ProofSuspicionSeed = {
  readonly suspicionId: string
  contextRequests: ContextRequest[]
  requestedContext: string[]
}

export const proofSuspicionSeedForCandidate = (
  input: {
    readonly candidate: CandidateFinding
    readonly contextRequests: readonly ContextRequest[]
    readonly requestedContext: readonly string[]
  }
): ProofSuspicionSeed => ({
  suspicionId: `susp_${sha256(
    `${input.candidate.id}:${input.candidate.location.path}:${input.candidate.location.startLine}`
  ).slice(0, 16)}`,
  contextRequests: [...input.contextRequests],
  requestedContext:
    input.requestedContext.length === 0
      ? [
          `Inspect ${input.candidate.location.path} near line ${input.candidate.location.startLine}.`,
          'Check reachable guards, alternate paths, tests, and configuration before promotion.'
        ]
      : [...input.requestedContext]
})

export const proofSuspicionForEvidence = (
  input: {
    readonly candidate: CandidateFinding
    readonly seed: ProofSuspicionSeed
    readonly evidenceIds: readonly string[]
    readonly status: ModelSuspicion['status']
  }
): ModelSuspicion =>
  ModelSuspicionSchema.parse({
    id: input.seed.suspicionId,
    taskId: input.candidate.taskId,
    category: input.candidate.category,
    severityHint: input.candidate.severity,
    title: input.candidate.title,
    hypothesis: input.candidate.description,
    primaryLocation: input.candidate.location,
    contextRequests: input.seed.contextRequests,
    requestedContext: input.seed.requestedContext,
    evidenceIds: [...input.evidenceIds],
    proposedBy: input.candidate.proposedBy,
    status: input.status
  })
