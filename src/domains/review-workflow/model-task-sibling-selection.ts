import { type ContextRequest } from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  type ModelSuspicionDropReason,
  type ModelTaskSuggestions,
  type TaskReviewInput
} from './model-agent-contracts.js'
import { candidatesFromModelSuspicions } from './model-suspicion-conversion.js'

export type SelectedModelTaskSiblingCandidates = {
  readonly candidates: readonly CandidateFinding[]
  readonly contextRequestsByCandidateId: Readonly<Record<string, readonly ContextRequest[]>>
  readonly requestedContextByCandidateId: Readonly<Record<string, readonly string[]>>
  readonly droppedSuspicionReasons: Readonly<Record<ModelSuspicionDropReason, number>>
  readonly schemaInvalidSuggestionIssueCounts: Readonly<Record<string, number>>
}

const candidateMatchesExisting = (
  candidate: CandidateFinding,
  existingCandidates: readonly CandidateFinding[]
): boolean =>
  existingCandidates.some(
    (existing) =>
      existing.category === candidate.category &&
      existing.location.path === candidate.location.path &&
      existing.location.startLine === candidate.location.startLine
  )

const uniqueCandidatesByLocation = (
  candidates: readonly CandidateFinding[],
  existingCandidates: readonly CandidateFinding[]
): readonly CandidateFinding[] => {
  const unique: CandidateFinding[] = []

  for (const candidate of candidates) {
    if (
      candidateMatchesExisting(candidate, existingCandidates) ||
      candidateMatchesExisting(candidate, unique)
    ) {
      continue
    }

    unique.push(candidate)
  }

  return unique
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

export const selectModelTaskSiblingCandidates = (input: {
  readonly taskInput: TaskReviewInput
  readonly suggestions: ModelTaskSuggestions
  readonly primaryCandidates: readonly CandidateFinding[]
  readonly maxSuspicionsPerTask?: number | undefined
  readonly reserveModelInvestigationSlots: (requested: number) => number
}): SelectedModelTaskSiblingCandidates => {
  const converted = candidatesFromModelSuspicions(
    input.taskInput,
    input.suggestions
  )
  const uniqueSiblingCandidates = uniqueCandidatesByLocation(
    converted.candidates,
    input.primaryCandidates
  )
  const maxSiblingSuspicions =
    input.maxSuspicionsPerTask === undefined
      ? 2
      : Math.max(0, input.maxSuspicionsPerTask - input.primaryCandidates.length)
  const reservedSiblingInvestigations = input.reserveModelInvestigationSlots(
    Math.min(maxSiblingSuspicions, uniqueSiblingCandidates.length)
  )
  const candidates = uniqueSiblingCandidates.slice(
    0,
    reservedSiblingInvestigations
  )

  return {
    candidates,
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
