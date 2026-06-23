import path from 'node:path'
import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'
import type { CandidateFinding } from '../admission/index.js'
import type { ContextRequest } from '../../shared/contracts/index.js'
import type {
  ContextRetrievalResult,
  ContextRetriever
} from '../context-retrieval/index.js'

const quotedContextQueryPattern = /["'`]([^"'`]{1,80})["'`]/u
const repositoryPathPattern =
  /\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9]+)?\b/u

const grepQueryFromContextRequest = (request: string): string | undefined => {
  const quoted = quotedContextQueryPattern.exec(request)

  if (quoted?.[1] !== undefined) {
    return quoted[1]
  }

  return undefined
}

const pathFromContextRequest = (
  request: string,
  fallbackPath: string
): string => repositoryPathPattern.exec(request)?.[0] ?? fallbackPath

const contextRequestKey = (input: {
  readonly tool: ContextRequest['tool']
  readonly path?: string
  readonly query?: string
  readonly fallbackPath: string
}): string => {
  const effectivePath = normalizeRepositoryRelativePath(
    input.path ?? input.fallbackPath
  )
  const effectiveQuery = input.query ?? ''

  return `${input.tool}:${effectivePath}:${effectiveQuery}`
}

export const retrieveCriticContext = async (input: {
  readonly candidate: CandidateFinding
  readonly requestedContext: readonly string[]
  readonly contextRequests?: readonly ContextRequest[]
  readonly contextRetriever?: ContextRetriever | undefined
}): Promise<readonly ContextRetrievalResult[]> => {
  const contextRetriever = input.contextRetriever
  const results: ContextRetrievalResult[] = []

  if (contextRetriever === undefined) {
    return results
  }

  const appendResult = async (
    action: () => Promise<ContextRetrievalResult>
  ): Promise<void> => {
    const result = await action().catch(() => undefined)

    if (result !== undefined) {
      results.push(result)
    }
  }

  if (input.contextRequests !== undefined && input.contextRequests.length > 0) {
    const executedRequestKeys = new Set<string>()

    for (const request of input.contextRequests) {
      const requestPath = request.path
      const requestQuery = request.query
      const requestKey = contextRequestKey({
        tool: request.tool,
        ...(requestPath === undefined ? {} : { path: requestPath }),
        ...(requestQuery === undefined ? {} : { query: requestQuery }),
        fallbackPath: input.candidate.location.path
      })

      if (executedRequestKeys.has(requestKey)) {
        continue
      }
      executedRequestKeys.add(requestKey)

      if (request.tool === 'read' && requestPath !== undefined) {
        await appendResult(() =>
          contextRetriever.readRepositoryFile({
            path: requestPath,
            taskId: input.candidate.taskId
          })
        )
      }

      if (request.tool === 'list' && requestPath !== undefined) {
        await appendResult(() =>
          contextRetriever.listRepositoryDirectory({
            path: requestPath,
            taskId: input.candidate.taskId
          })
        )
      }

      if (request.tool === 'grep' && requestQuery !== undefined) {
        await appendResult(() =>
          contextRetriever.grepRepository({
            query: requestQuery,
            paths:
              requestPath === undefined
                ? [input.candidate.location.path]
                : [requestPath],
            taskId: input.candidate.taskId
          })
        )
      }
    }

    return results
  }

  await appendResult(() =>
    contextRetriever.readRepositoryFile({
      path: input.candidate.location.path,
      taskId: input.candidate.taskId
    })
  )

  for (const request of input.requestedContext) {
    if (/\b(?:list|directory|folder)\b/iu.test(request)) {
      await appendResult(() =>
        contextRetriever.listRepositoryDirectory({
          path: path.posix.dirname(input.candidate.location.path),
          taskId: input.candidate.taskId
        })
      )
    }

    if (/\b(?:grep|search|find|reference|usage|call|symbol)\b/iu.test(request)) {
      const query = grepQueryFromContextRequest(request)

      if (query !== undefined) {
        await appendResult(() =>
          contextRetriever.grepRepository({
            query,
            paths: [
              pathFromContextRequest(request, input.candidate.location.path)
            ],
            taskId: input.candidate.taskId
          })
        )
      }
    }
  }

  return results
}
