import {
  type InvestigationTrace,
  type ModelSuspicion,
  type ProofPacket
} from '../../shared/contracts/index.js'
import { normalizeError } from '../../shared/errors/error-normalizer.js'
import {
  SiblingSweepInputSchema,
  type ModelTaskSuggestions,
  type SiblingSweepInput,
  type TaskReviewInput
} from './model-agent-contracts.js'
import {
  providerIssueForError,
  type ProviderIssue
} from './model-provider-issues.js'

export type ModelTaskSiblingProviderLogger = {
  readonly debug: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}

export type ModelTaskSiblingProofArtifacts = {
  readonly proofPackets: readonly ProofPacket[]
  readonly modelSuspicions: readonly ModelSuspicion[]
  readonly investigationTraces: readonly InvestigationTrace[]
}

export type ModelTaskSiblingProviderSweepResult = {
  readonly suggestions?: ModelTaskSuggestions | undefined
  readonly providerIssues: readonly ProviderIssue[]
}

export type ModelTaskSiblingProviderSweepRunner = (
  input: SiblingSweepInput,
  signal: AbortSignal | undefined
) => Promise<ModelTaskSuggestions>

const provedSuspicionIdsFor = (proofPackets: readonly ProofPacket[]): Set<string> =>
  new Set(proofPackets.map((proofPacket) => proofPacket.suspicionId))

const siblingSweepInputFor = (
  taskInput: TaskReviewInput,
  proofArtifacts: ModelTaskSiblingProofArtifacts
): SiblingSweepInput => {
  const provedSuspicionIds = provedSuspicionIdsFor(proofArtifacts.proofPackets)

  return SiblingSweepInputSchema.parse({
    ...taskInput,
    proofPackets: proofArtifacts.proofPackets,
    modelSuspicions: proofArtifacts.modelSuspicions.filter((suspicion) =>
      provedSuspicionIds.has(suspicion.id)
    ),
    investigationTraces: proofArtifacts.investigationTraces.filter((trace) =>
      provedSuspicionIds.has(trace.suspicionId)
    )
  })
}

export const runModelTaskSiblingProviderSweep = async (input: {
  readonly taskInput: TaskReviewInput
  readonly proofArtifacts: ModelTaskSiblingProofArtifacts
  readonly logger: ModelTaskSiblingProviderLogger
  readonly sweepSiblingSuspicions: ModelTaskSiblingProviderSweepRunner
  readonly signal?: AbortSignal | undefined
}): Promise<ModelTaskSiblingProviderSweepResult> => {
  input.logger.debug('Sibling sweep provider call started.', {
    task_id: input.taskInput.task.id,
    proof_packet_count: input.proofArtifacts.proofPackets.length,
    reviewed_diff_range_count: input.taskInput.reviewedDiffRanges.length,
    path_count: input.taskInput.task.paths.length
  })

  const sweepInput = siblingSweepInputFor(input.taskInput, input.proofArtifacts)

  try {
    return {
      suggestions: await input.sweepSiblingSuspicions(
        sweepInput,
        input.signal
      ),
      providerIssues: []
    }
  } catch (error: unknown) {
    input.logger.debug('Sibling sweep provider call failed.', {
      task_id: input.taskInput.task.id,
      error_code: normalizeError(error, {
        source: 'provider',
        operation: 'sibling-sweep'
      }).code
    })

    return {
      providerIssues: [
        providerIssueForError({
          error: new Error('Sibling sweep failed.'),
          stage: 'sibling-sweep',
          recovered: true
        })
      ]
    }
  }
}
