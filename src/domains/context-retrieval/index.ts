import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'
import {
  EvidenceRecordSchema,
  RepositoryRelativePathSchema,
  type EvidenceRecord
} from '../../shared/contracts/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import { createRedactor } from '../../shared/redaction/redactor.js'
import {
  createContextLedgerEntry,
  type ContextLedgerEntry
} from '../review-planning/index.js'

export const ContextRetrievalBudgetSchema = z.strictObject({
  maxReads: z.int().min(0).default(4),
  usedReads: z.int().min(0).default(0),
  maxSearches: z.int().min(0).default(2),
  usedSearches: z.int().min(0).default(0),
  maxBytesPerRead: z.int().min(1).default(20000),
  maxMatches: z.int().min(1).default(20)
})

export type ContextRetrievalBudget = z.infer<typeof ContextRetrievalBudgetSchema>

export type ContextRetrievalResult = {
  readonly tool: 'read' | 'list' | 'grep'
  readonly path?: string
  readonly queryHash?: string
  readonly summary: string
  readonly content: string
  readonly ledgerEntry: ContextLedgerEntry
  readonly evidence: EvidenceRecord
}

export type ContextRetriever = {
  readonly budget: () => ContextRetrievalBudget
  readonly readRepositoryFile: (input: {
    readonly path: string
    readonly taskId?: string
  }) => Promise<ContextRetrievalResult>
  readonly listRepositoryDirectory: (input: {
    readonly path: string
    readonly taskId?: string
  }) => Promise<ContextRetrievalResult>
  readonly grepRepository: (input: {
    readonly query: string
    readonly paths?: readonly string[]
    readonly taskId?: string
  }) => Promise<ContextRetrievalResult>
}

const evidenceIdFor = (value: string): string =>
  `ev_${sha256(value).slice(0, 24)}`

const budgetExceeded = (kind: 'read' | 'search'): TypeError =>
  new TypeError(`Context retrieval ${kind} budget exceeded.`)

const portableChildPath = (directory: string, childName: string): string =>
  normalizeRepositoryRelativePath(path.posix.join(directory, childName))

const linePreview = (content: string, maxLines = 12): string =>
  content
    .split(/\r\n|\n|\r/u)
    .slice(0, maxLines)
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n')

export const createContextRetriever = (input: {
  readonly repositoryRoot: string
  readonly budget?: Partial<ContextRetrievalBudget>
  readonly ledgerEntries?: ContextLedgerEntry[]
}): ContextRetriever => {
  const redactor = createRedactor()
  const budget = ContextRetrievalBudgetSchema.parse(input.budget ?? {})
  const ledgerEntries = input.ledgerEntries

  const recordResult = (record: {
    readonly tool: ContextRetrievalResult['tool']
    readonly reason: string
    readonly path?: string
    readonly taskId?: string
    readonly content: string
    readonly bytesConsidered: number
    readonly bytesIncluded: number
    readonly summary: string
    readonly queryHash?: string
    readonly redactionApplied?: boolean
  }): ContextRetrievalResult => {
    const ledgerEntry = createContextLedgerEntry({
      kind: 'tool-result',
      ...(record.path === undefined ? {} : { path: record.path }),
      ...(record.taskId === undefined ? {} : { taskId: record.taskId }),
      reason: record.reason,
      decision:
        record.bytesIncluded < record.bytesConsidered ? 'truncated' : 'included',
      bytesConsidered: record.bytesConsidered,
      bytesIncluded: record.bytesIncluded,
      content: record.content
    })
    ledgerEntries?.push(ledgerEntry)
    const evidence = EvidenceRecordSchema.parse({
      id: evidenceIdFor(
        `${record.tool}:${record.path ?? ''}:${record.queryHash ?? ''}:${
          ledgerEntry.id
        }`
      ),
      kind: record.tool === 'grep' ? 'tool-search' : 'tool-read',
      summary: record.summary,
      ...(record.path === undefined
        ? {}
        : {
            location: {
              path: record.path,
              startLine: 1,
              side: 'file'
            }
          }),
      source: 'context-retrieval',
      contentHash: sha256(record.content),
      rawContentRef: ledgerEntry.id,
      redactionApplied: record.redactionApplied ?? false
    })

    return {
      tool: record.tool,
      ...(record.path === undefined ? {} : { path: record.path }),
      ...(record.queryHash === undefined ? {} : { queryHash: record.queryHash }),
      summary: record.summary,
      content: record.content,
      ledgerEntry,
      evidence
    }
  }

  return {
    budget: () => ({ ...budget }),
    readRepositoryFile: async ({ path: requestedPath, taskId }) => {
      const portablePath = RepositoryRelativePathSchema.parse(
        normalizeRepositoryRelativePath(requestedPath)
      )
      const absolutePath = await resolveExistingPathInsideRoot(
        input.repositoryRoot,
        portablePath
      )
      if (budget.usedReads >= budget.maxReads) {
        throw budgetExceeded('read')
      }
      budget.usedReads += 1
      const content = await readFile(absolutePath, 'utf8')
      const redacted = redactor.redact(content)
      const included = Buffer.from(redacted).subarray(0, budget.maxBytesPerRead)
      const includedText = included.toString('utf8')

      return recordResult({
        tool: 'read',
        path: portablePath,
        ...(taskId === undefined ? {} : { taskId }),
        reason: 'context-retrieval-read',
        content: includedText,
        bytesConsidered: Buffer.byteLength(redacted),
        bytesIncluded: Buffer.byteLength(includedText),
        summary: `Read ${portablePath} for investigation context. Preview hash ${sha256(
          linePreview(includedText)
        ).slice(0, 16)}.`,
        redactionApplied: redacted !== content
      })
    },
    listRepositoryDirectory: async ({ path: requestedPath, taskId }) => {
      const portablePath = RepositoryRelativePathSchema.parse(
        normalizeRepositoryRelativePath(requestedPath)
      )
      const absolutePath = await resolveExistingPathInsideRoot(
        input.repositoryRoot,
        portablePath
      )
      if (budget.usedReads >= budget.maxReads) {
        throw budgetExceeded('read')
      }
      budget.usedReads += 1
      const entries = await readdir(absolutePath)
      const childSummaries = await Promise.all(
        entries.slice(0, budget.maxMatches).map(async (entry) => {
          const childAbsolutePath = path.join(absolutePath, entry)
          const childStat = await stat(childAbsolutePath)

          return `${childStat.isDirectory() ? 'dir' : 'file'} ${portableChildPath(
            portablePath,
            entry
          )}`
        })
      )
      const content = childSummaries.join('\n')

      return recordResult({
        tool: 'list',
        path: portablePath,
        ...(taskId === undefined ? {} : { taskId }),
        reason: 'context-retrieval-list',
        content,
        bytesConsidered: Buffer.byteLength(content),
        bytesIncluded: Buffer.byteLength(content),
        summary: `Listed ${portablePath}; ${childSummaries.length} entries returned.`
      })
    },
    grepRepository: async ({ query, paths, taskId }) => {
      if (query.trim().length === 0) {
        throw new TypeError('Context retrieval query must not be empty.')
      }
      if (budget.usedSearches >= budget.maxSearches) {
        throw budgetExceeded('search')
      }
      budget.usedSearches += 1
      const queryHash = sha256(query)
      const searchPaths =
        paths === undefined || paths.length === 0 ? ['.'] : [...paths]
      const matches: string[] = []

      for (const requestedPath of searchPaths) {
        if (matches.length >= budget.maxMatches) {
          break
        }
        const portablePath = RepositoryRelativePathSchema.parse(
          normalizeRepositoryRelativePath(requestedPath)
        )
        const absolutePath = await resolveExistingPathInsideRoot(
          input.repositoryRoot,
          portablePath
        )
        const fileStat = await stat(absolutePath)

        if (fileStat.isDirectory()) {
          continue
        }
        const content = await readFile(absolutePath, 'utf8')
        const lines = content.split(/\r\n|\n|\r/u)

        for (const [index, line] of lines.entries()) {
          if (matches.length >= budget.maxMatches) {
            break
          }
          if (line.includes(query)) {
            matches.push(`${portablePath}:${index + 1}`)
          }
        }
      }

      const content = matches.join('\n')

      return recordResult({
        tool: 'grep',
        ...(taskId === undefined ? {} : { taskId }),
        reason: 'context-retrieval-grep',
        content,
        bytesConsidered: Buffer.byteLength(content),
        bytesIncluded: Buffer.byteLength(content),
        summary: `Searched repository context for query hash ${queryHash.slice(
          0,
          16
        )}; ${matches.length} matches returned.`,
        queryHash
      })
    }
  }
}
