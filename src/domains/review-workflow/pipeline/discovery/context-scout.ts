// Spec 18: the context scout.
//
// A cheap, narrow model call CHOOSES which out-of-change symbols matter for this
// change; deterministic code FETCHES their bodies; the reviewer then runs exactly as
// it does today — one call, no tools. The separation is the whole point. Giving the
// reviewer the tools instead (spec 16) lost recall every time it was measured, and
// the tool-free reviewer is the configuration that measures ~68% recall at 100%
// adjusted precision.
//
// The scout can only ever ADD context. It never sees a finding, never judges code,
// and a symbol it names reaches the packet only when deterministic resolution finds
// that symbol in a file the eligibility gate already allows.

import {
  ContextScoutInputSchema,
  ModelContextScoutResultSchema,
  contextScoutRequests,
  type ContextScoutRequest,
  type ContextScoutRunner,
  type TaskReviewInput,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { type ContextRetriever } from '../../../context-retrieval/index.js'
import {
  extractSymbolBody,
  type SymbolBodyExtraction
} from '../../run/context/symbol-body.js'

export type ContextScoutBounds = {
  readonly maxSymbols: number
  readonly maxBytesPerSymbol: number
}

export type ContextScoutOutcome = {
  // Rendered section appended to the discovery prompt, or '' when the scout asked
  // for nothing or nothing resolved. Empty means the prompt is unchanged.
  readonly section: string
  readonly requestedCount: number
  readonly resolvedCount: number
  readonly bytesInjected: number
}

const emptyOutcome: ContextScoutOutcome = {
  section: '',
  requestedCount: 0,
  resolvedCount: 0,
  bytesInjected: 0
}

// Finds the 1-based line that declares `name` in `content`. The deterministic facts
// that would give this directly are not carried into the workflow packet, so the
// declaring line is located here by scanning for a word-boundary occurrence of the
// name on a line that also looks like a declaration rather than a use. Being wrong
// costs one symbol (extractSymbolBody rejects a line that does not declare the
// name), never a wrong body silently injected.
const declarationLineFor = (
  content: string,
  name: string
): number | undefined => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  // A declaration keyword, an exported binding, or `name(` / `name =` at the start
  // of a line — the shapes shared across the languages this engine reviews.
  const declarationPattern = new RegExp(
    `(?:^|\\s)(?:function|func|def|class|interface|type|struct|impl|const|let|var|public|private|protected|static|fn|sub|method)\\s+[^\\n]*\\b${escapedName}\\b|^\\s*(?:export\\s+)?(?:async\\s+)?\\b${escapedName}\\b\\s*(?:[(=:]|\\bfunction\\b)`,
    'u'
  )
  const lines = content.split('\n')

  for (const [index, line] of lines.entries()) {
    if (declarationPattern.test(line)) {
      return index + 1
    }
  }

  return undefined
}

// Resolves one scout request to a symbol body. Every read goes through the mediated
// retriever, so eligibility, redaction, and containment apply exactly as they do to
// any other repository access; an unreadable or ineligible path simply yields
// nothing.
const resolveRequest = async (
  request: ContextScoutRequest,
  input: {
    readonly retriever: ContextRetriever
    readonly taskPaths: readonly string[]
    readonly maxBytesPerSymbol: number
  }
): Promise<SymbolBodyExtraction | undefined> => {
  // A symbol the reviewer already sees in full is not worth re-injecting.
  if (request.path === undefined || input.taskPaths.includes(request.path)) {
    return undefined
  }

  let content: string
  try {
    const result = await input.retriever.readRepositoryFile({
      path: request.path
    })
    content = result.content
  } catch {
    return undefined
  }

  const declarationLine = declarationLineFor(content, request.name)

  if (declarationLine === undefined) {
    return undefined
  }

  return extractSymbolBody({
    path: request.path,
    content,
    name: request.name,
    declarationLine,
    maxBytes: input.maxBytesPerSymbol
  })
}

const renderScoutSection = (
  bodies: readonly SymbolBodyExtraction[]
): string => {
  if (bodies.length === 0) {
    return ''
  }

  const rendered = bodies
    .map(
      (body) =>
        `### DEFINITION: ${body.path} — ${body.name} (lines ${body.startLine}-${body.endLine}${
          body.truncated ? ', truncated' : ''
        })\n${body.content}`
    )
    .join('\n\n')

  // Framed exactly like the existing referenced-definition section: context only,
  // never a review target, so findings stay restricted to the task's paths.
  return (
    `\n## Referenced definitions (from unchanged files, for context only)\n` +
    `These are the definitions this change depends on, pulled from unchanged files. ` +
    `Use them to judge whether the changed code is correct against how these ` +
    `actually behave. Do NOT review them and do NOT report findings for these ` +
    `files — report findings ONLY for files in the task's paths (the changed ` +
    `files).\n${rendered}`
  )
}

/**
 * Runs the scout for one task and returns the extra context to append to the
 * discovery prompt. Any failure degrades to no extra context: the scout is an aid,
 * so a scout that errors must cost context, never the review.
 */
export const runContextScout = async (
  input: {
    readonly taskInput: TaskReviewInput
    readonly task: WorkflowReviewTask
    readonly reviewText: string
    readonly runScout: ContextScoutRunner
    readonly retriever: ContextRetriever
    readonly bounds: ContextScoutBounds
    readonly signal?: AbortSignal | undefined
  }
): Promise<ContextScoutOutcome> => {
  let requests: readonly ContextScoutRequest[]

  try {
    const result = ModelContextScoutResultSchema.parse(
      await input.runScout(
        ContextScoutInputSchema.parse({
          taskId: input.task.id,
          paths: [...input.task.paths],
          reviewText: input.reviewText
        }),
        input.signal
      )
    )
    requests = contextScoutRequests(result).slice(0, input.bounds.maxSymbols)
  } catch {
    return emptyOutcome
  }

  if (requests.length === 0) {
    return emptyOutcome
  }

  const resolved: SymbolBodyExtraction[] = []

  for (const request of requests) {
    const body = await resolveRequest(request, {
      retriever: input.retriever,
      taskPaths: input.task.paths,
      maxBytesPerSymbol: input.bounds.maxBytesPerSymbol
    })

    if (body !== undefined) {
      resolved.push(body)
    }
  }

  const section = renderScoutSection(resolved)

  return {
    section,
    requestedCount: requests.length,
    resolvedCount: resolved.length,
    bytesInjected: Buffer.byteLength(section)
  }
}
