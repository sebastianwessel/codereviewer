import { type ContextRequest } from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  type ModelSuspicionDropReason,
  type ModelTaskSuggestions,
  type TaskReviewInput
} from './model-agent-contracts.js'
import { candidatesFromModelSuspicions } from './model-suspicion-conversion.js'

export type SelectedModelTaskCandidates = {
  readonly candidates: readonly CandidateFinding[]
  readonly convertedCandidateCount: number
  readonly requestedInvestigationSlotCount: number
  readonly reservedInvestigationSlotCount: number
  readonly budgetDroppedCandidateCount: number
  readonly contextRequestsByCandidateId: Readonly<Record<string, readonly ContextRequest[]>>
  readonly requestedContextByCandidateId: Readonly<Record<string, readonly string[]>>
  readonly droppedSuspicionReasons: Readonly<Record<ModelSuspicionDropReason, number>>
  readonly schemaInvalidSuggestionIssueCounts: Readonly<Record<string, number>>
}

const filterCandidateRecord = <T>(
  candidates: readonly CandidateFinding[],
  valuesByCandidateId: Readonly<Record<string, readonly T[]>>
): Readonly<Record<string, readonly T[]>> => {
  const selected: Record<string, readonly T[]> = {}

  for (const candidate of candidates) {
    selected[candidate.id] = valuesByCandidateId[candidate.id] ?? []
  }

  return selected
}

export const selectModelTaskCandidates = (input: {
  readonly taskInput: TaskReviewInput
  readonly suggestions: ModelTaskSuggestions
  readonly maxSuspicionsPerTask?: number | undefined
  readonly reserveModelInvestigationSlots: (requested: number) => number
}): SelectedModelTaskCandidates => {
  const converted = candidatesFromModelSuspicions(
    input.taskInput,
    input.suggestions
  )
  const maxTaskSuspicions =
    input.maxSuspicionsPerTask ?? converted.candidates.length
  const requestedInvestigationSlotCount = Math.min(
    maxTaskSuspicions,
    converted.candidates.length
  )
  const reservedInvestigations = input.reserveModelInvestigationSlots(
    requestedInvestigationSlotCount
  )
  const candidates = converted.candidates.slice(0, reservedInvestigations)

  return {
    candidates,
    convertedCandidateCount: converted.candidates.length,
    requestedInvestigationSlotCount,
    reservedInvestigationSlotCount: reservedInvestigations,
    budgetDroppedCandidateCount: Math.max(
      0,
      converted.candidates.length - candidates.length
    ),
    contextRequestsByCandidateId: filterCandidateRecord(
      candidates,
      converted.contextRequestsByCandidateId
    ),
    requestedContextByCandidateId: filterCandidateRecord(
      candidates,
      converted.requestedContextByCandidateId
    ),
    droppedSuspicionReasons: converted.droppedSuspicionReasons,
    schemaInvalidSuggestionIssueCounts:
      converted.schemaInvalidSuggestionIssueCounts
  }
}
