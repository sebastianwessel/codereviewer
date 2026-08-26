import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { EvidenceRecordSchema } from '../../shared/contracts/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import { createRedactor } from '../../shared/redaction/redactor.js'
import {
  createContextLedgerEntry,
  type ContextLedgerEntry
} from '../review-planning/index.js'
import { ContextRetrievalBudgetSchema, type ContextRetrievalBudget } from './budget.js'
import {
  compileEligibilityConfig,
  evaluatePathEligibility,
  type ContextRetrievalEligibilityConfig
} from './eligibility.js'
import { readBudgetExhaustedCondition } from './expected-conditions.js'
import { sliceUtf8Bytes, utf8ByteLength } from '../../shared/text/utf8-bytes.js'
import { createGrepEngine } from './grep-engine.js'
import type { ContextRetrievalMatchMode } from './line-matching.js'
import {
  portableChildPath,
  resolveEligibleExistingPath,
  type RequestedEntryKind
} from './path-safety.js'
import type {
  ContextRetrievalResult,
  RetrievalResultRecord
} from './retrieval-result.js'

// Re-exported from their own module so the grep engine can consume them without
// importing this factory back. Every existing importer keeps its import path.
export type {
  ContextRetrievalMatch,
  ContextRetrievalResult
} from './retrieval-result.js'

export type ContextRetriever = {
  readonly budget: () => ContextRetrievalBudget
  /**
   * Halve the per-read byte allowance, reporting whether a reduction was possible.
   *
   * Spec 28: nothing caps a read in advance, so an oversized context is discovered
   * by hitting the provider's real limit. When that happens on a tool-enabled call,
   * the retry must fetch LESS — splitting the task instead would refetch the same
   * file and overflow identically. Returns false at the floor, which is the caller's
   * signal to stop reducing and fail or split instead.
   */
  readonly reduceReadBudget: () => boolean
  readonly readRepositoryFile: (input: {
    readonly path: string
    readonly taskId?: string
    // Spec 28: the caller narrows the read deliberately. Absent means the whole file.
    readonly startLine?: number
    readonly endLine?: number
  }) => Promise<ContextRetrievalResult>
  readonly listRepositoryDirectory: (input: {
    readonly path: string
    readonly taskId?: string
  }) => Promise<ContextRetrievalResult>
  readonly grepRepository: (input: {
    readonly query: string
    readonly paths?: readonly string[]
    readonly taskId?: string
    readonly matchMode?: ContextRetrievalMatchMode
    // Tightens this one query's match cap below `budget.maxMatches`. A caller
    // issuing many queries uses it so one heavily-referenced symbol cannot
    // consume the share of the others. It can only tighten: a value above the
    // budget's cap is clamped to it, so the budget stays the authority.
    readonly maxMatchesPerQuery?: number
  }) => Promise<ContextRetrievalResult>
  /**
   * Run several searches over ONE repository traversal, in query order.
   *
   * Same bounded surface as `grepRepository` — one budgeted search, one ledger
   * entry and one evidence record per query, each with its own match cap — but the
   * repository is walked and each eligible file read once for the whole batch
   * instead of once per query. Callers that know all their queries up front
   * (`lookupSymbolReferences`) use this; a model-driven tool call cannot and does
   * not.
   */
  readonly grepRepositoryBatch: (input: {
    readonly queries: readonly {
      readonly query: string
      readonly matchMode?: ContextRetrievalMatchMode
      readonly maxMatchesPerQuery?: number
    }[]
    readonly paths?: readonly string[]
    readonly taskId?: string
  }) => Promise<readonly ContextRetrievalResult[]>
}

const evidenceIdFor = (value: string): string =>
  `ev_${sha256(value).slice(0, 24)}`

/**
 * What a listed directory entry is, or that it could not be established.
 *
 * `stat` follows symlinks, so a dangling link — and a plain race with a
 * concurrent delete — throws. Run unguarded inside the `Promise.all` below, one
 * such entry rejected the WHOLE listing, and the model was told a directory it
 * can read is unreadable. The search traversal already takes the other side of
 * this (`grep-engine.ts`: "skip it rather than failing the whole search"), and a
 * listing is the surface where being wrong is most expensive.
 *
 * The entry is still LISTED, under `unknown`, rather than dropped: an omitted
 * name understates the directory silently, which is the shape this repository
 * has a name for. What a caller may conclude from `unknown <path>` is that the
 * name exists and its kind could not be determined — not that it is absent, and
 * not that it is a file.
 */
const listedEntryKind = async (
  childAbsolutePath: string
): Promise<'dir' | 'file' | 'unknown'> => {
  try {
    return (await stat(childAbsolutePath)).isDirectory() ? 'dir' : 'file'
  } catch {
    return 'unknown'
  }
}

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
  readonly paths?: ContextRetrievalEligibilityConfig
}): ContextRetriever => {
  const redactor = createRedactor()
  const budget = ContextRetrievalBudgetSchema.parse(input.budget ?? {})
  const ledgerEntries = input.ledgerEntries
  const compiledEligibility = compileEligibilityConfig(input.paths)

  const resolveEligibleExisting = (
    requestedPath: string,
    entryKind: RequestedEntryKind
  ) =>
    resolveEligibleExistingPath({
      repositoryRoot: input.repositoryRoot,
      requestedPath,
      compiledEligibility,
      entryKind
    })

  const recordResult = (
    record: RetrievalResultRecord
  ): ContextRetrievalResult => {
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
              // Where the served content begins, not the top of the file. A
              // ranged read pinned to line 1 points its evidence at content it
              // never returned.
              startLine: record.startLine ?? 1,
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
      ...(record.startLine === undefined ? {} : { startLine: record.startLine }),
      summary: record.summary,
      content: record.content,
      ledgerEntry,
      evidence
    }
  }
  // The search engine, over this retriever's own budget, redactor, eligibility
  // gate, path resolver and recorder. It lives in `grep-engine.ts` so this
  // factory reads as the surface it publishes; nothing below the returned object
  // is reachable code any more.
  const runGrepQueries = createGrepEngine({
    budget,
    redactor,
    compiledEligibility,
    resolveEligibleExisting,
    recordResult
  })

  return {
    budget: () => ({ ...budget }),
    reduceReadBudget: () => {
      // A floor rather than zero: below this a read returns too little to be worth
      // the round trip, and continuing to halve would loop toward nothing.
      const floor = 4_000

      if (budget.maxBytesPerRead <= floor) {
        return false
      }

      budget.maxBytesPerRead = Math.max(
        floor,
        Math.floor(budget.maxBytesPerRead / 2)
      )

      return true
    },
    readRepositoryFile: async ({ path: requestedPath, taskId, startLine, endLine }) => {
      const { portablePath, absolutePath } = await resolveEligibleExisting(
        requestedPath,
        'file'
      )

      if (budget.usedReads >= budget.maxReads) {
        throw readBudgetExhaustedCondition()
      }
      budget.usedReads += 1
      const content = await readFile(absolutePath, 'utf8')
      const redacted = redactor.redact(content)
      // Spec 28: an explicitly requested line range is served exactly. This is the
      // reviewer narrowing its own read after locating what it needs, which is the
      // whole point — a prefix chosen by us is the worst possible guess, because the
      // definition worth consulting is rarely at the top of a file.
      const lines = redacted.split(/\r\n|\n|\r/u)
      const ranged =
        startLine === undefined && endLine === undefined
          ? redacted
          : lines
              .slice(
                Math.max(0, (startLine ?? 1) - 1),
                endLine === undefined ? lines.length : endLine
              )
              .join('\n')
      // Cut on a CHARACTER boundary, through the shared helper, not by slicing
      // the encoded buffer. A buffer cut landing inside a multi-byte sequence
      // decodes to U+FFFD — so the model was handed a line of "real source"
      // ending in a replacement character, and a two-byte character cut in half
      // was replaced by a three-byte U+FFFD, making `bytesIncluded` exceed
      // `bytesConsidered` and `createContextLedgerEntry` throw. That reached the
      // model as an unexplained tool failure rather than a disclosed condition.
      // `sliceUtf8Bytes` exists for exactly this and its two sibling consumers
      // already use it; this was the last private copy.
      const includedText = sliceUtf8Bytes(ranged, budget.maxBytesPerRead)
      const rangeNote =
        startLine === undefined && endLine === undefined
          ? ''
          : ` Lines ${startLine ?? 1}-${endLine ?? lines.length} of ${lines.length}.`
      // The file line the served bytes begin at, reported so a consumer can
      // address them in the file's own coordinates instead of guessing 1. Absent
      // for a whole-file read, where there is nothing to say. `Math.max` mirrors
      // the slice above: a start below 1 still serves the top of the file, so it
      // must still be described as starting there.
      const servedStartLine =
        startLine === undefined && endLine === undefined
          ? undefined
          : Math.max(1, startLine ?? 1)

      return recordResult({
        tool: 'read',
        path: portablePath,
        ...(taskId === undefined ? {} : { taskId }),
        ...(servedStartLine === undefined ? {} : { startLine: servedStartLine }),
        reason: 'context-retrieval-read',
        content: includedText,
        bytesConsidered: utf8ByteLength(ranged),
        bytesIncluded: utf8ByteLength(includedText),
        summary: `Read ${portablePath} for investigation context.${rangeNote} File has ${lines.length} lines. Preview hash ${sha256(
          linePreview(includedText)
        ).slice(0, 16)}.`,
        redactionApplied: redacted !== content
      })
    },
    listRepositoryDirectory: async ({ path: requestedPath, taskId }) => {
      const { portablePath, absolutePath } = await resolveEligibleExisting(
        requestedPath,
        'directory'
      )

      if (budget.usedReads >= budget.maxReads) {
        throw readBudgetExhaustedCondition()
      }
      budget.usedReads += 1
      // Read with entry types because the gate below needs each entry's KIND: a
      // subdirectory is judged on what may live beneath it, a file on its own
      // name. A `Dirent` reports a symlink as neither, so a link is gated as the
      // plain entry it is rather than as whatever it points at — the
      // conservative direction, and the same one the search traversal takes.
      const entries = await readdir(absolutePath, { withFileTypes: true })
      // Entries the eligibility gate rejects (dotfiles, excluded globs, ...)
      // are dropped before they are ever stat'd or surfaced, so a directory
      // listing cannot reveal the presence of a secret or excluded file. This is
      // half of what makes a traversable directory safe: being allowed to list a
      // directory grants nothing about the entries inside it.
      const eligibleEntryNames = entries
        .filter(
          (entry) =>
            evaluatePathEligibility(
              portableChildPath(portablePath, entry.name),
              compiledEligibility,
              entry.isDirectory() ? 'directory' : 'file'
            ).eligible
        )
        .map((entry) => entry.name)
      const childSummaries = await Promise.all(
        eligibleEntryNames.slice(0, budget.maxMatches).map(async (entryName) => {
          const childKind = await listedEntryKind(
            path.join(absolutePath, entryName)
          )

          return `${childKind} ${portableChildPath(portablePath, entryName)}`
        })
      )
      // A listing cut at the cap said "N entries returned" and nothing else, so
      // a model that saw a fifth of a directory concluded a file was not in it.
      // The count that was cut is named, in the text the model reads, for the
      // same reason a truncated READ is (see `truncationNotice`).
      const listingCut =
        eligibleEntryNames.length > childSummaries.length
          ? `\n[TRUNCATED: ${childSummaries.length} of ${eligibleEntryNames.length} eligible entries shown. Absence of a name below this point is NOT evidence it is missing — list a subdirectory directly, or use repo_grep.]`
          : ''
      const content = `${childSummaries.join('\n')}${listingCut}`

      return recordResult({
        tool: 'list',
        path: portablePath,
        ...(taskId === undefined ? {} : { taskId }),
        reason: 'context-retrieval-list',
        content,
        bytesConsidered: Buffer.byteLength(content),
        bytesIncluded: Buffer.byteLength(content),
        summary: `Listed ${portablePath}; ${childSummaries.length} of ${eligibleEntryNames.length} eligible entries returned.`
      })
    },
    grepRepository: async (input) => {
      const [result] = await runGrepQueries({
        queries: [
          {
            query: input.query,
            ...(input.matchMode === undefined
              ? {}
              : { matchMode: input.matchMode }),
            ...(input.maxMatchesPerQuery === undefined
              ? {}
              : { maxMatchesPerQuery: input.maxMatchesPerQuery })
          }
        ],
        ...(input.paths === undefined ? {} : { paths: input.paths }),
        ...(input.taskId === undefined ? {} : { taskId: input.taskId })
      })

      // `runGrepQueries` returns exactly one result per query, so a single-query
      // call always has one. The throw is unreachable and exists only because the
      // array index type is optional.
      if (result === undefined) {
        throw new TypeError('Context retrieval search produced no result.')
      }

      return result
    },
    grepRepositoryBatch: (input) => runGrepQueries(input)
  }
}
