// The model-facing contract for the mediated repository tools. Shared by every
// lane that exposes them (the `investigate_claim` agent, spec 12; tool-enabled
// holistic discovery, spec 16) so both present the SAME tool ids, input shapes,
// descriptions, and output shaping to the provider.
//
// Tool ids are prefixed (`repo_*`) so they do not collide with the harness's
// reserved built-in tool names (`read`/`list`/`grep`/...). The harness rejects a
// custom tool whose id equals a built-in name at build time, and a colliding id
// would otherwise route execution to the sandbox built-in instead of these
// mediated, ledgered, eligibility-gated handlers.

import { z } from 'zod'
import type { ContextRetrievalResult } from './context-retriever.js'

export const RepoReadToolInputSchema = z.strictObject({
  path: z.string().min(1).describe('Repository-relative path of the file to read.'),
  // Spec 28: the reviewer narrows the read itself instead of us guessing a prefix
  // for it. A prefix is the worst possible guess — the definition worth consulting
  // is rarely at the top of a file — so `repo_grep` locates it and this reads it.
  startLine: z
    .int()
    .min(1)
    .optional()
    .describe('Optional first line to read (1-based). Omit to start at the top.'),
  endLine: z
    .int()
    .min(1)
    .optional()
    .describe('Optional last line to read (1-based, inclusive). Omit to read to the end.')
})

export const RepoListToolInputSchema = z.strictObject({
  path: z
    .string()
    .min(1)
    .describe('Repository-relative path of the directory to list.')
})

export const RepoGrepToolInputSchema = z.strictObject({
  query: z.string().min(1).describe('Literal substring to search for.'),
  paths: z
    .array(z.string().min(1))
    .optional()
    .describe('Optional repository-relative paths (files or directories) to search.')
})

export const RepoToolOutputSchema = z.strictObject({
  summary: z.string(),
  content: z.string()
})

export type RepoToolOutput = z.infer<typeof RepoToolOutputSchema>

export const REPO_TOOL_DESCRIPTIONS = {
  read: 'Read a repository file (line-numbered). Input: { path, startLine?, endLine? }. Large files report their total line count — use repo_grep to locate what you need, then re-read that line range rather than reading the whole file.',
  list: 'List a repository directory. Input: { path }. Excluded and secret paths are never listed.',
  grep: 'Search the repository for a literal substring (recursive, bounded). Input: { query, paths? }.'
} as const

// The tool ids exposed to a model, in the order they are declared on an agent.
export const REPO_TOOL_IDS = ['repo_read', 'repo_list', 'repo_grep'] as const

// Adds line numbers so every provider receives file content in the same
// deterministic, line-anchored shape the general review's mediated read uses.
//
// Numbered from the served content's own origin, exactly as that read numbers a
// file chunk from the chunk's absolute origin — and for the same reason it gives:
// numbering every chunk from 1 produced locations that were plausible but wrong.
// Here the contradiction was inside a single tool result, whose summary already
// said "Lines 20-23 of 30" over a body numbered `1:`. Spec 28 makes that the
// normal case, not an edge one: `repo_grep` answers in absolute `path:line`
// coordinates and the tool description tells the model to re-read that range, so
// the first hop of the advertised loop is a ranged read.
const withLineNumbers = (content: string, firstLine: number): string =>
  content
    .split(/\r\n|\n|\r/u)
    .map((line, index) => `${index + firstLine}: ${line}`)
    .join('\n')

// A read that hit `maxBytesPerRead` is CUT MID-FILE. The model was never told.
//
// It received line-numbered content ending at an arbitrary line, with a summary
// saying only "Read <path> for investigation context", and no way to know the file
// continued. So "this function has no null check" could mean "the null check was
// below the cut" — a confident conclusion drawn from a file the model believed it
// had read in full.
//
// This is the failure shape found four times in this project's limits on
// 2026-08-01: a cap whose binding produces a plausible answer rather than an error.
// It matters more here than elsewhere because cross-file retrieval was MEASURED NET
// NEGATIVE and withdrawn on that measurement — 66.7% to 44.4% recall at nine cases,
// 68.8% to 56.3% at sixteen, with precision holding at 100%, i.e. the loss was
// exactly recall. Silently truncated reads are a mechanism that produces that
// signature, and it was never ruled out. The verdict now carries that caveat.
//
// The ledger entry already carried `bytesConsidered` and `bytesIncluded`; only the
// model-facing output omitted it. This appends an unmissable marker to the content
// itself rather than a field, because a field is something a model may ignore and a
// trailing line in the text it is reading is not.
const truncationNotice = (result: ContextRetrievalResult): string =>
  result.ledgerEntry.decision === 'truncated'
    ? `\n[TRUNCATED: you have seen the first ${result.ledgerEntry.bytesIncluded} of ${result.ledgerEntry.bytesConsidered} bytes. Absence of something below this point is NOT evidence it is missing. Use repo_grep to locate what you need, then repo_read the same path with startLine/endLine to read that range in full.]`
    : ''

export const toRepoToolOutput = (
  result: ContextRetrievalResult,
  lineNumbered: boolean
): RepoToolOutput => ({
  summary:
    result.ledgerEntry.decision === 'truncated'
      ? `${result.summary} TRUNCATED at the per-read byte limit; the file continues.`
      : result.summary,
  content:
    (lineNumbered
      ? withLineNumbers(result.content, result.startLine ?? 1)
      : result.content) + truncationNotice(result)
})
