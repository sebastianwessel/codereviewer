import {
  type ContextRequest,
  type EvidenceRecord
} from '../../shared/contracts/index.js'
import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'
import { type CandidateFinding } from '../admission/index.js'
import { type ContextRetriever } from '../context-retrieval/index.js'
import { retrieveCriticContext } from './critic-context.js'
import {
  ReviewContextDocumentSchema,
  type ReviewContextDocument
} from './model-agent-contracts.js'

const uniqueContextEvidence = (
  evidence: readonly EvidenceRecord[]
): readonly EvidenceRecord[] => {
  const seen = new Set<string>()
  const unique: EvidenceRecord[] = []

  for (const record of evidence) {
    if (seen.has(record.id)) {
      continue
    }
    seen.add(record.id)
    unique.push(record)
  }

  return unique
}

const uniqueReviewContext = (
  reviewContext: readonly ReviewContextDocument[]
): readonly ReviewContextDocument[] => {
  const seen = new Set<string>()
  const unique: ReviewContextDocument[] = []

  for (const document of reviewContext) {
    if (seen.has(document.ledgerEntryId)) {
      continue
    }
    seen.add(document.ledgerEntryId)
    unique.push(document)
  }

  return unique
}

export type ContextRequestArtifacts = {
  readonly evidence: readonly EvidenceRecord[]
  readonly reviewContext: readonly ReviewContextDocument[]
}

export type ContextRequestArtifactCache = Map<
  string,
  Promise<ContextRequestArtifacts>
>

export const mergeContextArtifacts = (
  left: ContextRequestArtifacts,
  right: ContextRequestArtifacts
): ContextRequestArtifacts => ({
  evidence: uniqueContextEvidence([...left.evidence, ...right.evidence]),
  reviewContext: uniqueReviewContext([
    ...left.reviewContext,
    ...right.reviewContext
  ])
})

const reviewContextDocumentForContextResult = (
  result: Awaited<
    ReturnType<
      NonNullable<ContextRetriever>['readRepositoryFile']
    >
  >
): ReviewContextDocument =>
  ReviewContextDocumentSchema.parse({
    kind: result.tool === 'read' ? 'file' : 'support-signal-output',
    ...(result.path === undefined ? {} : { path: result.path }),
    content: result.content,
    ledgerEntryId: result.ledgerEntry.id
  })

const canonicalContextRequests = (
  contextRequests: readonly ContextRequest[]
): readonly {
  readonly tool: ContextRequest['tool']
  readonly path: string
  readonly query: string
}[] => {
  const requestKeys = new Set<string>()

  for (const request of contextRequests) {
    const normalizedPath =
      request.path === undefined
        ? ''
        : normalizeRepositoryRelativePath(request.path)

    requestKeys.add(
      JSON.stringify({
        tool: request.tool,
        path: normalizedPath,
        query: request.query ?? ''
      })
    )
  }

  return [...requestKeys]
    .sort()
    .map((requestKey) => JSON.parse(requestKey) as {
      readonly tool: ContextRequest['tool']
      readonly path: string
      readonly query: string
    })
}

const cacheKeyForRequestedContext = (input: {
  readonly candidate: CandidateFinding
  readonly requestedContext: readonly string[]
  readonly contextRequests?: readonly ContextRequest[]
}): string => {
  const contextRequests = input.contextRequests ?? []
  const requiresCandidateFallback =
    contextRequests.length === 0 ||
    contextRequests.some(
      (request) =>
        request.path === undefined ||
        (request.tool === 'grep' && request.query === undefined)
    )

  return JSON.stringify({
    taskId: input.candidate.taskId,
    ...(requiresCandidateFallback
      ? { fallbackPath: input.candidate.location.path }
      : {}),
    contextRequests: canonicalContextRequests(contextRequests),
    requestedContext:
      contextRequests.length === 0 ? [...input.requestedContext] : []
  })
}

const retrieveContextArtifacts = async (input: {
  readonly candidate: CandidateFinding
  readonly requestedContext: readonly string[]
  readonly contextRequests?: readonly ContextRequest[]
  readonly contextRetriever: ContextRetriever
}): Promise<ContextRequestArtifacts> => {
  const evidence: EvidenceRecord[] = []
  const reviewContext: ReviewContextDocument[] = []

  for (const result of await retrieveCriticContext({
    candidate: input.candidate,
    requestedContext: input.requestedContext,
    ...(input.contextRequests === undefined
      ? {}
      : { contextRequests: input.contextRequests }),
    contextRetriever: input.contextRetriever
  })) {
    evidence.push(result.evidence)
    reviewContext.push(reviewContextDocumentForContextResult(result))
  }

  return {
    evidence: uniqueContextEvidence(evidence),
    reviewContext
  }
}

export const contextArtifactsForRequestedContext = async (
  input: {
    readonly candidate: CandidateFinding
    readonly requestedContext: readonly string[]
    readonly contextRequests?: readonly ContextRequest[]
    readonly contextRetriever?: ContextRetriever | undefined
    readonly cache?: ContextRequestArtifactCache | undefined
  }
): Promise<ContextRequestArtifacts> => {
  const contextRetriever = input.contextRetriever

  if (contextRetriever === undefined) {
    return {
      evidence: [],
      reviewContext: []
    }
  }

  if (input.cache === undefined) {
    return retrieveContextArtifacts({
      candidate: input.candidate,
      requestedContext: input.requestedContext,
      ...(input.contextRequests === undefined
        ? {}
        : { contextRequests: input.contextRequests }),
      contextRetriever
    })
  }

  const cacheKey = cacheKeyForRequestedContext(input)
  const cached = input.cache.get(cacheKey)

  if (cached !== undefined) {
    return cached
  }

  const artifacts = retrieveContextArtifacts({
    candidate: input.candidate,
    requestedContext: input.requestedContext,
    ...(input.contextRequests === undefined
      ? {}
      : { contextRequests: input.contextRequests }),
    contextRetriever
  })

  input.cache.set(cacheKey, artifacts)

  return artifacts
}
