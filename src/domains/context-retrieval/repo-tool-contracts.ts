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
import type { ContextRetrievalResult } from './index.js'

export const RepoReadToolInputSchema = z.strictObject({
  path: z.string().min(1).describe('Repository-relative path of the file to read.')
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
  read: 'Read a repository file (bounded, line-numbered). Input: { path }.',
  list: 'List a repository directory. Input: { path }. Excluded and secret paths are never listed.',
  grep: 'Search the repository for a literal substring (recursive, bounded). Input: { query, paths? }.'
} as const

// The tool ids exposed to a model, in the order they are declared on an agent.
export const REPO_TOOL_IDS = ['repo_read', 'repo_list', 'repo_grep'] as const

// Adds 1-based line numbers so every provider receives file content in the same
// deterministic, line-anchored shape the general review's mediated read uses.
const withLineNumbers = (content: string): string =>
  content
    .split(/\r\n|\n|\r/u)
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n')

export const toRepoToolOutput = (
  result: ContextRetrievalResult,
  lineNumbered: boolean
): RepoToolOutput => ({
  summary: result.summary,
  content: lineNumbered ? withLineNumbers(result.content) : result.content
})
