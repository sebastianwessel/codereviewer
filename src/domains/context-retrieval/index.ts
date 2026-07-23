import { readdir, readFile, realpath, stat } from 'node:fs/promises'
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
import {
  compileEligibilityConfig,
  evaluatePathEligibility,
  type CompiledEligibilityConfig,
  type ContextRetrievalEligibilityConfig
} from './eligibility.js'

export const ContextRetrievalBudgetSchema = z.strictObject({
  maxReads: z.int().min(0).default(4),
  usedReads: z.int().min(0).default(0),
  maxSearches: z.int().min(0).default(2),
  usedSearches: z.int().min(0).default(0),
  maxBytesPerRead: z.int().min(1).default(20000),
  maxMatches: z.int().min(1).default(20),
  // Caps how many directory levels a recursive `grep` traversal descends from
  // each requested search root. Depth 0 is the requested root directory
  // itself, so a directory whose depth exceeds this value is not descended
  // into. Bounds traversal cost independently of `maxMatches`, which only
  // bounds match count once a (potentially huge) directory is being scanned.
  maxDepth: z.int().min(0).default(6)
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

export type {
  ContextRetrievalEligibilityConfig,
  EligibilityResult
} from './eligibility.js'

const evidenceIdFor = (value: string): string =>
  `ev_${sha256(value).slice(0, 24)}`

const budgetExceeded = (kind: 'read' | 'search'): TypeError =>
  new TypeError(`Context retrieval ${kind} budget exceeded.`)

// Thrown for a path that resolved and passed containment, but that the
// eligibility gate (dotfiles, node_modules/.git/dist/.codereviewer,
// configured paths.include/exclude) rejects. Distinct from a budget or
// not-found failure so a calling agent can react to each differently.
const notEligibleError = (portablePath: string, reason: string): TypeError =>
  new TypeError(
    `Path "${portablePath}" is not eligible for context retrieval: ${reason}.`
  )

// Thrown when a requested path does not exist inside the repository. Reports
// only the portable (repository-relative) path, never the resolved absolute
// filesystem path, so the error stays safe to surface to a model.
const notFoundError = (portablePath: string): TypeError =>
  new TypeError(`Path "${portablePath}" was not found in the repository.`)

// `resolveExistingPathInsideRoot` throws its own TypeError when a path (or a
// symlink target) escapes the repository root. That message is already
// actionable, so it is left to propagate as-is rather than being folded into
// the generic not-found error below.
const isPathContainmentError = (error: unknown): error is TypeError =>
  error instanceof TypeError && /resolve inside the root/iu.test(error.message)

const portableChildPath = (directory: string, childName: string): string =>
  normalizeRepositoryRelativePath(path.posix.join(directory, childName))

const linePreview = (content: string, maxLines = 12): string =>
  content
    .split(/\r\n|\n|\r/u)
    .slice(0, maxLines)
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n')

// Normalizes a caller-supplied path (liberal about leading `./`, `\`
// separators, and repeated slashes — see `repository-path.ts`), confirms it
// is eligible, then confirms it exists inside the repository root. Any of the
// three failure modes produces a clear, actionable error rather than an
// opaque one.
const resolveEligibleExistingPath = async (options: {
  readonly repositoryRoot: string
  readonly requestedPath: string
  readonly compiledEligibility: CompiledEligibilityConfig
}): Promise<{ readonly portablePath: string; readonly absolutePath: string }> => {
  const portablePath = RepositoryRelativePathSchema.parse(
    normalizeRepositoryRelativePath(options.requestedPath)
  )
  const eligibility = evaluatePathEligibility(
    portablePath,
    options.compiledEligibility
  )

  if (!eligibility.eligible) {
    throw notEligibleError(portablePath, eligibility.reason)
  }

  let absolutePath: string
  try {
    absolutePath = await resolveExistingPathInsideRoot(
      options.repositoryRoot,
      portablePath
    )
  } catch (error) {
    if (isPathContainmentError(error)) {
      throw error
    }

    throw notFoundError(portablePath)
  }

  // Re-evaluate eligibility against the REAL target. `resolveExistingPathInsideRoot`
  // confirms the realpath is *contained* in the root but returns the requested
  // (symlink) path, and eligibility was only checked on the requested name. Without
  // this, an in-repo symlink whose name is eligible but whose realpath is an
  // excluded/secret file (e.g. `notes.txt -> .env`, `-> .git/config`, `-> node_modules/x`)
  // would be read/listed/searched, defeating the hard floor. The write path rejects
  // symlinks outright; the read path follows to the true target and re-checks it.
  const realRoot = await realpath(options.repositoryRoot)
  const realTarget = await realpath(absolutePath)
  const realRelative = path.relative(realRoot, realTarget)
  // Empty means the target is the repository root itself (e.g. list/grep of `.`);
  // equal means no symlink indirection changed the path. Otherwise re-check.
  if (realRelative.length > 0 && realRelative !== portablePath) {
    const realPortable = normalizeRepositoryRelativePath(realRelative)
    const targetEligibility = evaluatePathEligibility(
      realPortable,
      options.compiledEligibility
    )

    if (!targetEligibility.eligible) {
      throw notEligibleError(
        portablePath,
        `resolves to an ineligible target (${targetEligibility.reason})`
      )
    }
  }

  return { portablePath, absolutePath }
}

export const createContextRetriever = (input: {
  readonly repositoryRoot: string
  readonly budget?: Partial<ContextRetrievalBudget>
  readonly ledgerEntries?: ContextLedgerEntry[]
  readonly paths?: ContextRetrievalEligibilityConfig
}): ContextRetriever => {
  const redactor = createRedactor()
  const budget = ContextRetrievalBudgetSchema.parse(input.budget ?? {})
  const ledgerEntries = input.ledgerEntries
  const compiledEligibility = compileEligibilityConfig(input.paths)

  const resolveEligibleExisting = (requestedPath: string) =>
    resolveEligibleExistingPath({
      repositoryRoot: input.repositoryRoot,
      requestedPath,
      compiledEligibility
    })

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
      const { portablePath, absolutePath } = await resolveEligibleExisting(
        requestedPath
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
      const { portablePath, absolutePath } = await resolveEligibleExisting(
        requestedPath
      )

      if (budget.usedReads >= budget.maxReads) {
        throw budgetExceeded('read')
      }
      budget.usedReads += 1
      const entryNames = await readdir(absolutePath)
      // Entries the eligibility gate rejects (dotfiles, excluded globs, ...)
      // are dropped before they are ever stat'd or surfaced, so a directory
      // listing cannot reveal the presence of a secret or excluded file.
      const eligibleEntryNames = entryNames.filter((entryName) =>
        evaluatePathEligibility(
          portableChildPath(portablePath, entryName),
          compiledEligibility
        ).eligible
      )
      const childSummaries = await Promise.all(
        eligibleEntryNames.slice(0, budget.maxMatches).map(async (entryName) => {
          const childAbsolutePath = path.join(absolutePath, entryName)
          const childStat = await stat(childAbsolutePath)

          return `${childStat.isDirectory() ? 'dir' : 'file'} ${portableChildPath(
            portablePath,
            entryName
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

      const collectFileMatches = async (
        portablePath: string,
        absolutePath: string
      ): Promise<void> => {
        if (matches.length >= budget.maxMatches) {
          return
        }

        let content: string

        try {
          content = await readFile(absolutePath, 'utf8')
        } catch {
          // Unreadable (permission error, race with a concurrent delete, a
          // device file, ...): skip it rather than failing the whole search.
          return
        }
        const lines = content.split(/\r\n|\n|\r/u)

        for (const [index, line] of lines.entries()) {
          if (matches.length >= budget.maxMatches) {
            return
          }
          if (line.includes(query)) {
            matches.push(`${portablePath}:${index + 1}`)
          }
        }
      }

      const readEligibleDirectoryEntries = async (absolutePath: string) => {
        try {
          return await readdir(absolutePath, { withFileTypes: true })
        } catch {
          return undefined
        }
      }

      // In-process recursive traversal (never a shell). Bounded by
      // `maxDepth` (directory levels descended) and `maxMatches` (checked
      // before every directory read and every line), and pruned by the
      // eligibility gate: an ineligible directory is never descended into,
      // so excluded/secret content is never read during a search either.
      // Non-regular entries (symlinks, sockets, ...) are silently skipped —
      // the traversal never follows a symlink out of the mediated view.
      const walkDirectory = async (
        portablePath: string,
        absolutePath: string,
        depth: number
      ): Promise<void> => {
        if (matches.length >= budget.maxMatches || depth > budget.maxDepth) {
          return
        }

        const entries = await readEligibleDirectoryEntries(absolutePath)

        if (entries === undefined) {
          return
        }

        for (const entry of entries) {
          if (matches.length >= budget.maxMatches) {
            return
          }

          const childPortablePath = portableChildPath(portablePath, entry.name)

          if (
            !evaluatePathEligibility(childPortablePath, compiledEligibility)
              .eligible
          ) {
            continue
          }

          const childAbsolutePath = path.join(absolutePath, entry.name)

          if (entry.isDirectory()) {
            await walkDirectory(childPortablePath, childAbsolutePath, depth + 1)
          } else if (entry.isFile()) {
            await collectFileMatches(childPortablePath, childAbsolutePath)
          }
        }
      }

      for (const requestedPath of searchPaths) {
        if (matches.length >= budget.maxMatches) {
          break
        }

        const { portablePath, absolutePath } = await resolveEligibleExisting(
          requestedPath
        )
        const entryStat = await stat(absolutePath)

        if (entryStat.isDirectory()) {
          await walkDirectory(portablePath, absolutePath, 0)
        } else {
          await collectFileMatches(portablePath, absolutePath)
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
