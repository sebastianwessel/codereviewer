import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'
import {
  EvidenceRecordSchema,
  type EvidenceRecord
} from '../../shared/contracts/index.js'
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
import {
  queryBlankCondition,
  readBudgetExhaustedCondition,
  searchBudgetExhaustedCondition
} from './expected-conditions.js'
import { sliceUtf8Bytes, utf8ByteLength } from '../../shared/text/utf8-bytes.js'
import { createLineMatcher, type ContextRetrievalMatchMode } from './line-matching.js'
import { resolveEligibleExistingPath, type RequestedEntryKind } from './path-safety.js'

// One matched line, with the text that matched. Returning the text is what makes
// a search result usable on its own: previously a caller received `path:line`
// only and had to spend a second mediated read per hit to see what it had found.
export type ContextRetrievalMatch = {
  readonly path: string
  readonly line: number
  readonly text: string
}

export type ContextRetrievalResult = {
  readonly tool: 'read' | 'list' | 'grep'
  readonly path?: string
  readonly queryHash?: string
  readonly summary: string
  readonly content: string
  // The file line `content` begins at, present only for a `read` that was
  // narrowed to a range (spec 28). Without it the content is just bytes, and the
  // only thing that could number them is 1 — which contradicts the summary this
  // same result carries ("Lines 20-23 of 30") and, worse, contradicts the
  // absolute `path:line` coordinates `grep` hands back, which is where a ranged
  // read's bounds came from in the first place.
  readonly startLine?: number
  // Structured matches, present only for `grep`. Additive: `content` keeps its
  // historical `path:line` shape so every existing caller and every model-facing
  // tool output is byte-identical.
  readonly matches?: readonly ContextRetrievalMatch[]
  readonly ledgerEntry: ContextLedgerEntry
  readonly evidence: EvidenceRecord
}

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
    // The file line `content` starts at, when it is not the top of the file.
    readonly startLine?: number
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
          const childAbsolutePath = path.join(absolutePath, entryName)
          const childStat = await stat(childAbsolutePath)

          return `${childStat.isDirectory() ? 'dir' : 'file'} ${portableChildPath(
            portablePath,
            entryName
          )}`
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

  /**
   * Run several searches over ONE repository traversal.
   *
   * Every query is still budgeted, capped, ledgered and evidenced independently —
   * a batch is an execution detail, not a relaxation of the bounded surface. What
   * it removes is the file I/O: the previous shape re-walked the repository and
   * re-read every eligible file once PER query, so a change-impact run looking up
   * 27 changed symbols read the same 1,181 files 27 times (192 MB of reads for a
   * 7 MB working set, ~45% of the command's wall clock).
   *
   * Results are identical to running the queries one at a time: traversal order is
   * the same, each query keeps its own match list and its own cap, and the walk
   * stops once EVERY query is satisfied rather than once the single query was.
   */
  async function runGrepQueries(input: {
    readonly queries: readonly {
      readonly query: string
      readonly matchMode?: ContextRetrievalMatchMode
      readonly maxMatchesPerQuery?: number
    }[]
    readonly paths?: readonly string[]
    readonly taskId?: string
  }): Promise<readonly ContextRetrievalResult[]> {
    for (const entry of input.queries) {
      // An expected condition, not a fault: the model-facing schema's `min(1)`
      // stops the empty string but admits a query of spaces, so a model can reach
      // this — and a blank query is a mistake it can correct on the next call. As a
      // `TypeError` it reached the model as the harness's "Tool execution failed."
      // with the reason stripped, which is the one thing this surface must never do.
      if (entry.query.trim().length === 0) {
        throw queryBlankCondition()
      }
    }

    if (input.queries.length === 0) {
      return []
    }

    // Charged up front for the whole batch. A batch that cannot be afforded in
    // full is refused rather than partially served, so the budget stays the
    // authority on how many searches a caller may make.
    if (budget.usedSearches + input.queries.length > budget.maxSearches) {
      throw searchBudgetExhaustedCondition()
    }
    budget.usedSearches += input.queries.length

    // One match past the cap is collected on purpose. Whether a search was cut
    // then becomes a FACT — there is a match that did not fit — instead of the
    // inference "we returned exactly the cap, so maybe there were more". The
    // extra is dropped before the result is assembled, so callers see at most
    // `matchLimit`. `symbol-reference-lookup.ts` already resolves the same
    // question the same way.
    const states = input.queries.map((entry) => {
      const matchLimit =
        entry.maxMatchesPerQuery === undefined
          ? budget.maxMatches
          : Math.min(budget.maxMatches, entry.maxMatchesPerQuery)

      return {
        query: entry.query,
        queryHash: sha256(entry.query),
        matchLimit,
        collectLimit: matchLimit + 1,
        lineMatches: createLineMatcher(entry.query, entry.matchMode ?? 'literal'),
        matches: [] as ContextRetrievalMatch[]
      }
    })
    // Set when the traversal declined to descend because `maxDepth` was reached.
    // A depth-pruned search returns fewer matches, or none, and is otherwise
    // indistinguishable from a search that looked everywhere and found nothing —
    // which turns "I did not look there" into "there is nothing there".
    let depthPruned = false
    const searchPaths =
      input.paths === undefined || input.paths.length === 0
        ? ['.']
        : [...input.paths]
    const allSatisfied = (): boolean =>
      states.every((state) => state.matches.length >= state.collectLimit)

    const collectFileMatches = async (
      portablePath: string,
      absolutePath: string
    ): Promise<void> => {
      if (allSatisfied()) {
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
      // Both match modes require the query to appear in the file as a substring
      // (`identifier` only adds boundary conditions around that same substring),
      // so a whole-file test settles every line at once for the queries this file
      // cannot match. With many queries sharing one traversal that prefilter is
      // what keeps per-line work proportional to the queries a file can actually
      // answer instead of to the whole batch.
      const active = states.filter(
        (state) =>
          state.matches.length < state.collectLimit &&
          content.includes(state.query)
      )

      if (active.length === 0) {
        return
      }
      const lines = content.split(/\r\n|\n|\r/u)

      for (const [index, line] of lines.entries()) {
        let redacted: string | undefined

        for (const state of active) {
          if (state.matches.length >= state.collectLimit) {
            continue
          }
          if (!state.lineMatches(line)) {
            continue
          }

          // Matching runs against the RAW line so which lines match is
          // unchanged, but the text handed back is redacted with the same
          // redactor the mediated read uses: a search result must never
          // surface a secret a read of the same file would have masked.
          // Redacted at most once per line however many queries matched it.
          redacted ??= redactor.redact(line)
          state.matches.push({
            path: portablePath,
            line: index + 1,
            text: redacted
          })
        }

        if (allSatisfied()) {
          return
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
      if (allSatisfied()) {
        return
      }

      if (depth > budget.maxDepth) {
        depthPruned = true

        return
      }

      const entries = await readEligibleDirectoryEntries(absolutePath)

      if (entries === undefined) {
        return
      }

      for (const entry of entries) {
        if (allSatisfied()) {
          return
        }

        const childPortablePath = portableChildPath(portablePath, entry.name)

        // Gated as the kind it is, before anything is read or descended into. A
        // subdirectory passes when an included file could live beneath it; a FILE
        // must match the include list itself. That is what keeps a traversable
        // directory from serving the files in it that the configuration does not
        // cover (spec 07, *Mediated Read Eligibility*).
        if (
          !evaluatePathEligibility(
            childPortablePath,
            compiledEligibility,
            entry.isDirectory() ? 'directory' : 'file'
          ).eligible
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
      if (allSatisfied()) {
        break
      }

      // A search root is a subtree to walk or a single file to scan, and the
      // resolver holds it to the rule for whichever it turns out to be: a file
      // that reaches `collectFileMatches` below has passed the FILE rule, never
      // the directory relaxation.
      const { portablePath, absolutePath } = await resolveEligibleExisting(
        requestedPath,
        'file-or-directory'
      )
      const entryStat = await stat(absolutePath)

      if (entryStat.isDirectory()) {
        await walkDirectory(portablePath, absolutePath, 0)
      } else {
        await collectFileMatches(portablePath, absolutePath)
      }
    }

    return states.map((state) => {
      // The over-fetched match is evidence that more exist; it is not returned.
      const capReached = state.matches.length > state.matchLimit
      const matches = state.matches.slice(0, state.matchLimit)
      // `content` keeps its historical `path:line` shape. The matched text is
      // returned separately in `matches`, so a model-facing tool output and
      // every existing caller stay byte-identical.
      const content = matches
        .map((match) => `${match.path}:${match.line}`)
        .join('\n')
      // A search that was cut used to return exactly N hits and say "N matches
      // returned", so the model concluded "these are all the callers" — the very
      // reasoning step cross-file retrieval and claim investigation exist to
      // perform. `bytesConsidered` equals `bytesIncluded` for a grep by
      // construction, so the read path's `truncationNotice` can never fire here;
      // the notice has to be part of the content.
      //
      // Depth pruning is disclosed separately because it is a different claim: a
      // match cap means "there are more of these", while a depth bound means
      // "there are places I did not look at all".
      const cutNotices = [
        capReached
          ? `[TRUNCATED: the match cap of ${state.matchLimit} was reached and more matches exist. These are NOT all the matches. Narrow the query, or pass \`paths\` to search a subtree.]`
          : '',
        depthPruned
          ? `[NOT EXHAUSTIVE: directories deeper than ${budget.maxDepth} levels below the search root were not descended into. Absence of a match is NOT evidence there is none. Pass \`paths\` to search a deeper subtree directly.]`
          : ''
      ].filter((notice) => notice.length > 0)
      const contentWithNotices =
        cutNotices.length === 0
          ? content
          : `${content}${content.length === 0 ? '' : '\n'}${cutNotices.join('\n')}`

      return {
        ...recordResult({
          tool: 'grep',
          ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
          reason: 'context-retrieval-grep',
          content: contentWithNotices,
          bytesConsidered: Buffer.byteLength(contentWithNotices),
          bytesIncluded: Buffer.byteLength(contentWithNotices),
          summary: `Searched repository context for query hash ${state.queryHash.slice(
            0,
            16
          )}; ${matches.length} matches returned${
            capReached ? ' (match cap reached; more exist)' : ''
          }${depthPruned ? ' (search depth bound reached; not exhaustive)' : ''}.`,
          queryHash: state.queryHash
        }),
        matches
      }
    })
  }
}
