// The mediated search engine: one repository traversal answering one or more
// queries, bounded by the same budget every other retrieval call is charged to.
//
// Extracted from `context-retriever.ts`, where it was a 270-line function
// declared AFTER the factory's `return` statement and reachable only through
// hoisting — so a reader of the factory saw a call to something that appeared
// nowhere above it, and the engine could not be exercised without building a
// whole retriever. It takes its dependencies explicitly for that second reason:
// the budget it charges, the redactor it masks matched lines with, the
// eligibility gate it prunes with, the path resolver it starts from, and the
// recorder that ledgers what it served. This is a move, not a rewrite —
// traversal order, budgeting, capping and every emitted string are unchanged.
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { sha256 } from '../../shared/hash/hash.js'
import type { Redactor } from '../../shared/redaction/redactor.js'
import type { ContextRetrievalBudget } from './budget.js'
import {
  evaluatePathEligibility,
  type CompiledEligibilityConfig
} from './eligibility.js'
import {
  queryBlankCondition,
  searchBudgetExhaustedCondition
} from './expected-conditions.js'
import { createLineMatcher, type ContextRetrievalMatchMode } from './line-matching.js'
import { portableChildPath, type RequestedEntryKind } from './path-safety.js'
import type {
  ContextRetrievalMatch,
  ContextRetrievalResult,
  RecordRetrievalResult
} from './retrieval-result.js'

export type GrepEngineDependencies = {
  /**
   * The LIVE budget object, shared with the retriever that owns it. Passed by
   * reference on purpose: searches charged here must be visible to every other
   * mediated call, and a copy would give the engine a private allowance.
   */
  readonly budget: ContextRetrievalBudget
  readonly redactor: Redactor
  readonly compiledEligibility: CompiledEligibilityConfig
  readonly resolveEligibleExisting: (
    requestedPath: string,
    entryKind: RequestedEntryKind
  ) => Promise<{ readonly portablePath: string; readonly absolutePath: string }>
  readonly recordResult: RecordRetrievalResult
}

export type GrepQueriesInput = {
  readonly queries: readonly {
    readonly query: string
    readonly matchMode?: ContextRetrievalMatchMode
    readonly maxMatchesPerQuery?: number
  }[]
  readonly paths?: readonly string[]
  readonly taskId?: string
}

export type RunGrepQueries = (
  input: GrepQueriesInput
) => Promise<readonly ContextRetrievalResult[]>

/**
 * Build the search engine over one set of dependencies.
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
export const createGrepEngine = (
  dependencies: GrepEngineDependencies
): RunGrepQueries => {
  const {
    budget,
    redactor,
    compiledEligibility,
    resolveEligibleExisting,
    recordResult
  } = dependencies

  return async (input) => {
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
