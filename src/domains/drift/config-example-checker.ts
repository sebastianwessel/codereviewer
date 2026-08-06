import { z } from 'zod'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import { collectTextFiles, type TextFile } from './markdown-sources.js'

// Validates the JSON configuration examples printed in `docs/` and `skills/`
// against the REAL configuration schema.
//
// It exists because nothing did. `skills/codereviewer-setup` shipped an
// `instructions.files` example in the pre-scoping shape for three days after the
// schema moved to `{ path, scope }`; `drift check` passed cleanly the whole time,
// because every check it runs looks at prose, links and command names and none of
// them parses a fenced block. A documented configuration that `config validate`
// exits 2 on is worse than no example at all: it is a broken setup handed to
// somebody who trusted the page.
//
// The configuration schema is the ONLY authority here. This module never restates
// a key, a default, a bound or a required field — it classifies a block and hands
// it to `CodeReviewerConfigSchema`.

// Every classification decision this module can reach, so a caller never has to
// infer one from an empty issue list.
export const ConfigExampleIssueKindSchema = z.enum([
  // The block was classified as a configuration example and the schema rejected it.
  'schema-rejected',
  // The block was explicitly marked a configuration example and is not valid JSON.
  'unparseable',
  // A scanned root holds Markdown but yielded no configuration example at all.
  // See "Why zero is a failure" below.
  'no-examples-found'
])

export const ConfigExampleIssueSchema = z.strictObject({
  kind: ConfigExampleIssueKindSchema,
  // Repository-relative, POSIX-separated, so a message is copy-pasteable on any
  // platform.
  path: z.string().min(1),
  // 1-based line of the block's OPENING fence. A `no-examples-found` issue points
  // at line 1 of the root it scanned, which is the only line it can name.
  line: z.int().min(1),
  message: z.string().min(1)
})

export const ConfigExampleCheckResultSchema = z.strictObject({
  // Fenced blocks whose info string starts with `json`, across every scanned root.
  jsonBlockCount: z.int().min(0),
  // Of those, the ones classified as configuration examples and validated.
  configExampleCount: z.int().min(0),
  issues: z.array(ConfigExampleIssueSchema)
})

export type ConfigExampleIssueKind = z.infer<typeof ConfigExampleIssueKindSchema>
export type ConfigExampleIssue = z.infer<typeof ConfigExampleIssueSchema>
export type ConfigExampleCheckResult = z.infer<
  typeof ConfigExampleCheckResultSchema
>

// The Markdown roots that carry configuration examples a reader is expected to
// copy. `specs/` is deliberately absent: a spec quotes a schema fragment to argue
// about it, and several of those are illustrative shapes that were never meant to
// be pasted into a config file.
export const configExampleScanRoots = ['docs', 'skills'] as const

export type JsonBlock = {
  readonly path: string
  // 1-based line of the opening fence.
  readonly line: number
  // The info string with the leading `json` token removed, trimmed. Empty when
  // the fence is a plain ```json.
  readonly marker: string
  readonly body: string
}

// The two markers a fenced block may carry after `json`, and what each one means.
//
// `config` FORCES validation for a block content classification would not reach
// on its own — an empty `{}`, or an example whose only key is one the schema
// gained after the page was written. `not-config` is the escape hatch for the
// reverse: a non-configuration document (a report, an error envelope, a fixture)
// that happens to use a top-level configuration key name. Neither is required
// today; both exist so that a page which needs one is not forced to choose
// between a wrong classification and a silent skip.
const forceConfigMarker = 'config'
const notConfigMarker = 'not-config'

// Opening fence: any indentation, three or more backticks, then an info string.
// Indentation is captured so a fence nested inside a list item is closed by its
// own indented fence rather than by the next unindented one.
const openingFencePattern = /^(\s*)(`{3,})\s*(\S[^\n]*)?$/u

const closingFencePattern = (fence: string): RegExp =>
  new RegExp(`^\\s*\`{${fence.length},}\\s*$`, 'u')

// The top-level keys of the configuration document, read from the schema itself.
// A key added to `CodeReviewerConfigSchema` is recognised here in the same commit,
// with nothing to update.
const topLevelConfigKeys = new Set(Object.keys(CodeReviewerConfigSchema.shape))

/**
 * Extracts every fenced block whose info string starts with `json`.
 *
 * Kept exported and pure so the extractor can be exercised on known input: a
 * checker whose extractor silently stops matching would otherwise report a clean
 * result for a repository full of broken examples.
 */
export const extractJsonBlocks = (file: TextFile): readonly JsonBlock[] => {
  const lines = file.content.split('\n')
  const blocks: JsonBlock[] = []
  let index = 0

  while (index < lines.length) {
    const opening = openingFencePattern.exec(lines[index] as string)
    const info = opening?.[3]?.trim() ?? ''
    const infoTokens = info.split(/\s+/u).filter((token) => token.length > 0)

    if (opening === null || infoTokens[0] !== 'json') {
      index += 1
      continue
    }

    const indent = (opening[1] as string).length
    const isClosing = closingFencePattern(opening[2] as string)
    const openingLine = index + 1
    const body: string[] = []

    index += 1

    while (index < lines.length && !isClosing.test(lines[index] as string)) {
      // Strip only the fence's own indentation, so an indented example still
      // parses as JSON while its internal indentation survives.
      body.push((lines[index] as string).slice(indent))
      index += 1
    }

    blocks.push({
      path: file.path,
      line: openingLine,
      marker: infoTokens.slice(1).join(' '),
      body: body.join('\n')
    })
    index += 1
  }

  return blocks
}

const parseJson = (body: string): { readonly value: unknown } | { readonly error: string } => {
  try {
    return { value: JSON.parse(body) as unknown }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'not valid JSON'
    }
  }
}

/**
 * Whether a parsed block is a configuration example.
 *
 * THE CONVENTION, stated once: a configuration example is written rooted at the
 * top level of the configuration document — the shape you would paste into
 * `.codereviewer/config.json` — and is recognised by carrying at least one
 * top-level key of `CodeReviewerConfigSchema`.
 *
 * A FRAGMENT NEEDS NO MARKER AND IS NOT A SPECIAL CASE. Every top-level block of
 * the schema is optional (`provider` is `.optional()`, the rest are
 * `.prefault({})`), so a one-block excerpt and a whole config file are the same
 * document to the schema: `{ "review": { "maxCostUsd": 5 } }` validates on its
 * own. A fragment is therefore validated exactly as far as it goes, and a valid
 * one can never be reported as incomplete — there is no completeness rule to
 * fail.
 *
 * The rule is `some`, not `every`, on purpose. A block mixing configuration keys
 * with foreign ones is the shape a half-updated example takes, and the strict
 * schema is what should judge it — being told `runId` is unrecognised is strictly
 * better than being skipped for having it.
 */
const isConfigExample = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).some((key) => topLevelConfigKeys.has(key))

// One line per schema complaint, naming the configuration path so a reader knows
// which key to open — `instructions.files.0.path: ...`, not "invalid input".
const describeSchemaFailure = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const at = issue.path.length === 0 ? '(root)' : issue.path.join('.')

      return `${at}: ${issue.message}`
    })
    .join('; ')

export const checkConfigExamplesInFile = (
  file: TextFile
): {
  readonly jsonBlockCount: number
  readonly configExampleCount: number
  readonly issues: readonly ConfigExampleIssue[]
} => {
  const blocks = extractJsonBlocks(file)
  const issues: ConfigExampleIssue[] = []
  let configExampleCount = 0

  for (const block of blocks) {
    if (block.marker === notConfigMarker) {
      continue
    }

    const forced = block.marker === forceConfigMarker
    const parsed = parseJson(block.body)

    if ('error' in parsed) {
      // An unmarked block that does not parse is an illustration with an elision
      // in it, not a configuration example — this repository has several, and
      // reporting them would train people to ignore the check. A block that
      // SAYS it is configuration gets no such benefit of the doubt.
      if (forced) {
        issues.push({
          kind: 'unparseable',
          path: block.path,
          line: block.line,
          message: `Block is marked \`json ${forceConfigMarker}\` but is not valid JSON: ${parsed.error}`
        })
      }

      continue
    }

    if (!forced && !isConfigExample(parsed.value)) {
      continue
    }

    configExampleCount += 1

    const result = CodeReviewerConfigSchema.safeParse(parsed.value)

    if (!result.success) {
      issues.push({
        kind: 'schema-rejected',
        path: block.path,
        line: block.line,
        message: `Configuration example is rejected by CodeReviewerConfigSchema — ${describeSchemaFailure(result.error)}`
      })
    }
  }

  return {
    jsonBlockCount: blocks.length,
    configExampleCount,
    issues
  }
}

/**
 * Validates every configuration example under the scanned roots.
 *
 * WHY ZERO IS A FAILURE. This repository has a documented, recurring defect class
 * in which absence produces a confident optimistic answer. A checker that extracts
 * nothing reports a clean result, which reads exactly like a repository with no
 * broken examples — so "found nothing" is an outcome this function refuses to
 * return quietly. A root that holds Markdown and yields no configuration example
 * produces a `no-examples-found` issue, because on these two roots that can only
 * mean the extractor stopped working.
 */
export const checkConfigExamples = async (
  input: {
    readonly repositoryRoot: string
    readonly roots?: readonly string[]
  }
): Promise<ConfigExampleCheckResult> => {
  const roots = input.roots ?? configExampleScanRoots
  const issues: ConfigExampleIssue[] = []
  let jsonBlockCount = 0
  let configExampleCount = 0

  for (const root of roots) {
    const markdownFiles = (
      await collectTextFiles(input.repositoryRoot, root)
    ).filter((file) => file.path.endsWith('.md'))
    let configExamplesInRoot = 0

    for (const file of markdownFiles) {
      const fileResult = checkConfigExamplesInFile(file)

      jsonBlockCount += fileResult.jsonBlockCount
      configExamplesInRoot += fileResult.configExampleCount
      issues.push(...fileResult.issues)
    }

    if (markdownFiles.length > 0 && configExamplesInRoot === 0) {
      issues.push({
        kind: 'no-examples-found',
        path: root,
        line: 1,
        message: `Scanned ${markdownFiles.length} Markdown file(s) under ${root} and classified no configuration example. This root documents configuration, so zero means the extractor stopped matching, not that the examples are fine.`
      })
    }

    configExampleCount += configExamplesInRoot
  }

  return ConfigExampleCheckResultSchema.parse({
    jsonBlockCount,
    configExampleCount,
    issues
  })
}

/** One human-readable line per issue, for a test failure message or a console. */
export const renderConfigExampleIssues = (
  issues: readonly ConfigExampleIssue[]
): string =>
  issues
    .map((issue) => `${issue.path}:${issue.line} [${issue.kind}] ${issue.message}`)
    .join('\n')
