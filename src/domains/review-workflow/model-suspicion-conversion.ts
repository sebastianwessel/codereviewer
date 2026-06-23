import {
  type ContextRequest,
  type EvidenceRecord
} from '../../shared/contracts/index.js'
import {
  CandidateFindingSchema,
  type CandidateFinding
} from '../admission/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import {
  ModelSuspicionSuggestionSchema,
  type ModelSuspicionConversion,
  type ModelSuspicionDropReason,
  type ModelSuspicionSuggestion,
  type ModelTaskSuggestions,
  type TaskReviewInput
} from './model-agent-contracts.js'

const schemaInvalidIssueKey = (issue: {
  readonly path: readonly PropertyKey[]
  readonly code: string
}): string => {
  const path =
    issue.path.length === 0
      ? '(root)'
      : issue.path.map((part) => String(part)).join('.')

  return `${path}:${issue.code}`.slice(0, 120)
}

const duplicateTokenStopWords = new Set([
  'the',
  'and',
  'that',
  'this',
  'with',
  'from',
  'when',
  'into',
  'same',
  'issue',
  'model',
  'reports',
  'reported'
])

const duplicateTokens = (value: string): Set<string> =>
  new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length >= 4 && !duplicateTokenStopWords.has(token))
  )

const hasTokenOverlap = (
  left: string,
  right: string,
  minimumOverlap: number
): boolean => {
  const leftTokens = duplicateTokens(left)
  const rightTokens = duplicateTokens(right)
  let overlap = 0

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1
    }
  }

  return overlap >= minimumOverlap
}

const suggestionRestatesTrustedCandidate = (
  candidate: CandidateFinding,
  suggestion: ModelSuspicionSuggestion
): boolean => {
  if (
    candidate.proposedBy !== 'deterministic-trusted-rule' ||
    suggestion.path === undefined ||
    suggestion.startLine === undefined ||
    suggestion.title === undefined ||
    suggestion.description === undefined ||
    candidate.location.path !== suggestion.path
  ) {
    return false
  }

  const lineDistance = Math.abs(candidate.location.startLine - suggestion.startLine)

  if (lineDistance > 12) {
    return false
  }

  return hasTokenOverlap(
    `${candidate.title}\n${candidate.description}`,
    `${suggestion.title}\n${suggestion.description}`,
    2
  )
}

const suggestionDuplicatesInputCandidate = (
  input: TaskReviewInput,
  suggestion: ModelSuspicionSuggestion,
  evidenceIds: readonly string[]
): boolean => {
  if (
    suggestion.category === undefined ||
    suggestion.path === undefined ||
    suggestion.startLine === undefined
  ) {
    return false
  }

  const suggestionEvidenceIds = new Set(evidenceIds)

  return input.candidates.some(
    (candidate) =>
      candidate.location.path === suggestion.path &&
      (candidate.proposedBy === 'deterministic-trusted-rule'
        ? (evidenceIds.length > 0 &&
            candidate.evidenceIds.some((evidenceId) =>
              suggestionEvidenceIds.has(evidenceId)
            )) ||
          suggestionRestatesTrustedCandidate(candidate, suggestion)
        : candidate.category === suggestion.category &&
          candidate.location.startLine === suggestion.startLine &&
          (evidenceIds.length === 0 ||
            candidate.evidenceIds.some((evidenceId) =>
              suggestionEvidenceIds.has(evidenceId)
            )))
  )
}

const unsupportedTruncationClaimPattern =
  /\b(?:truncated|malformed|incomplete|invalid\s+(?:json|schema)|missing\s+(?:closing|end)|ends?\s+abruptly)\b/iu
const fileLikeTruncationTargetPattern =
  /\b(?:file|json|schema|source|context|excerpt)\b/iu

const hasDiagnosticEvidenceForPath = (
  evidence: readonly EvidenceRecord[],
  path: string
): boolean =>
  evidence.some(
    (record) =>
      record.kind === 'diagnostic' && record.location?.path === path
  )

const isUnsupportedTruncationClaim = (
  input: TaskReviewInput,
  suggestion: ModelSuspicionSuggestion
): boolean => {
  if (suggestion.path === undefined) {
    return false
  }

  const claimText = `${suggestion.title ?? ''}\n${suggestion.description ?? ''}`

  return (
    unsupportedTruncationClaimPattern.test(claimText) &&
    fileLikeTruncationTargetPattern.test(claimText) &&
    !hasDiagnosticEvidenceForPath(input.evidence, suggestion.path)
  )
}

const candidateFromSuggestion = (
  input: TaskReviewInput,
  suggestion: ModelSuspicionSuggestion
): ModelSuspicionConversion => {
  if (
    suggestion.category === undefined ||
    suggestion.severity === undefined ||
    suggestion.title === undefined ||
    suggestion.description === undefined ||
    suggestion.path === undefined ||
    suggestion.startLine === undefined
  ) {
    return { dropReason: 'missing-required-field' }
  }

  if (!input.task.paths.includes(suggestion.path)) {
    return { dropReason: 'path-outside-task' }
  }

  if (isUnsupportedTruncationClaim(input, suggestion)) {
    return { dropReason: 'unsupported-truncation-claim' }
  }

  const taskEvidenceIds = new Set(input.evidence.map((evidence) => evidence.id))
  const citedEvidenceIds = suggestion.evidenceIds ?? []
  const validCitedEvidenceIds = citedEvidenceIds.filter((evidenceId) =>
    taskEvidenceIds.has(evidenceId)
  )
  const evidenceIds = [...new Set(validCitedEvidenceIds)]

  if (suggestionDuplicatesInputCandidate(input, suggestion, evidenceIds)) {
    return { dropReason: 'duplicate-input-candidate' }
  }

  const id = `cand_${sha256(
    `${input.task.id}:${suggestion.path}:${suggestion.startLine}:${suggestion.title}`
  ).slice(0, 16)}`
  const fixEdits = (suggestion.fixEdits ?? []).filter((edit) =>
    input.task.paths.includes(edit.path)
  )

  return {
    candidate: CandidateFindingSchema.parse({
      id,
      taskId: input.task.id,
      category: suggestion.category,
      severity: suggestion.severity,
      title: suggestion.title.slice(0, 120),
      description: suggestion.description.slice(0, 1200),
      location: {
        path: suggestion.path,
        startLine: suggestion.startLine,
        side: 'file'
      },
      evidenceIds,
      proposedBy: 'review-agent',
      ...(suggestion.fixSummary === undefined
        ? {}
        : { suggestedFix: suggestion.fixSummary }),
      ...(evidenceIds.length === 0 ||
      (suggestion.fixSummary === undefined && fixEdits.length === 0)
        ? {}
        : {
            fixProposal: {
              summary:
                suggestion.fixSummary ??
                'Apply the proposed evidence-backed manual edit.',
              evidenceIds,
              safety: 'manual-review',
              ...(fixEdits.length === 0 ? {} : { edits: fixEdits })
            }
          })
    }),
    contextRequests: (suggestion.contextRequests ?? []).filter((request) => {
      if (request.path === undefined) {
        return true
      }

      return input.task.paths.some(
        (taskPath) =>
          taskPath === request.path || taskPath.startsWith(`${request.path}/`)
      )
    }),
    requestedContext: suggestion.requestedContext ?? []
  }
}

export const candidatesFromModelSuspicions = (
  input: TaskReviewInput,
  suggestions: ModelTaskSuggestions
): {
  readonly candidates: readonly CandidateFinding[]
  readonly contextRequestsByCandidateId: Readonly<Record<string, readonly ContextRequest[]>>
  readonly requestedContextByCandidateId: Readonly<Record<string, readonly string[]>>
  readonly droppedSuspicionReasons: Readonly<Record<ModelSuspicionDropReason, number>>
  readonly schemaInvalidSuggestionIssueCounts: Readonly<Record<string, number>>
} => {
  const droppedSuspicionReasons: Record<ModelSuspicionDropReason, number> = {
    'schema-invalid': 0,
    'missing-required-field': 0,
    'path-outside-task': 0,
    'missing-task-evidence': 0,
    'duplicate-input-candidate': 0,
    'unsupported-truncation-claim': 0
  }
  const candidates: CandidateFinding[] = []
  const candidateIds = new Set<string>()
  const contextRequestsByCandidateId: Record<string, readonly ContextRequest[]> = {}
  const requestedContextByCandidateId: Record<string, readonly string[]> = {}
  const schemaInvalidSuggestionIssueCounts: Record<string, number> = {}

  for (const suggestion of suggestions.suspicions) {
    const parsedSuggestion = ModelSuspicionSuggestionSchema.safeParse(suggestion)

    if (!parsedSuggestion.success) {
      droppedSuspicionReasons['schema-invalid'] += 1
      for (const issue of parsedSuggestion.error.issues) {
        const key = schemaInvalidIssueKey(issue)
        schemaInvalidSuggestionIssueCounts[key] =
          (schemaInvalidSuggestionIssueCounts[key] ?? 0) + 1
      }
      continue
    }

    const conversion = candidateFromSuggestion(input, parsedSuggestion.data)

    if (conversion.candidate !== undefined) {
      if (candidateIds.has(conversion.candidate.id)) {
        droppedSuspicionReasons['duplicate-input-candidate'] += 1
        continue
      }

      candidateIds.add(conversion.candidate.id)
      candidates.push(conversion.candidate)
      contextRequestsByCandidateId[conversion.candidate.id] =
        conversion.contextRequests ?? []
      requestedContextByCandidateId[conversion.candidate.id] =
        conversion.requestedContext ?? []
      continue
    }

    if (conversion.dropReason !== undefined) {
      droppedSuspicionReasons[conversion.dropReason] += 1
    }
  }

  return {
    candidates,
    contextRequestsByCandidateId,
    requestedContextByCandidateId,
    droppedSuspicionReasons,
    schemaInvalidSuggestionIssueCounts
  }
}
