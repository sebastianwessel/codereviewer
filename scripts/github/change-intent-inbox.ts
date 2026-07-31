// Renders the pull-request description into a change-intent inbox file
// (spec 11, `inbox` provider).
//
// This is the whole reason the workflow feeds the pull request in rather than
// running a generic review: the engine's intent lane (spec 23) can only check a
// change against what the author said it would do if somebody puts what the
// author said on disk. The pipeline owns that fetch — the engine holds no forge
// credentials and makes no network call.
//
// What the engine does with it is bounded by spec 11 and is not this module's
// job to enforce: the text is redacted, capped, summarized into one
// `change-intent` document, and presented under an untrusted-content header. It
// cannot approve a finding, move a severity, or touch the quality gate.
//
// What IS this module's job is that the file it writes parses as the pipeline
// intends. The inbox frontmatter parser reads `key: value` lines up to the first
// closing `---`, so a title containing a newline or a `---` run could inject a
// metadata key or truncate the block. `sanitizeFrontmatterValue` removes both.
// The body needs no such guard: it is everything after the closing delimiter, so
// no content in it can reach the metadata block.
import { sanitizeFrontmatterValue } from './sanitize.js'

/** File name written into the configured inbox directory. */
export const CHANGE_INTENT_FILE_NAME = 'pull-request.md'

const MAX_METADATA_VALUE = 300

export type ChangeIntentInput = {
  readonly number: number
  readonly title: string
  readonly body: string
  readonly url: string
  readonly baseRef: string
}

/**
 * The inbox document for a pull request, or `undefined` when the pull request
 * states no intent at all (no title and an empty description).
 *
 * Returning `undefined` rather than an empty file is deliberate: spec 11 treats
 * an empty inbox as "no context", and `intent check` reports `no-intent`
 * plainly. A file containing only boilerplate would instead produce obligations
 * extracted from our own scaffolding.
 */
export const renderChangeIntentDocument = (
  input: ChangeIntentInput
): string | undefined => {
  const title = sanitizeFrontmatterValue(input.title, MAX_METADATA_VALUE)
  const body = input.body.trim()

  if (title.length === 0 && body.length === 0) {
    return undefined
  }

  const metadata: readonly (readonly [string, string])[] = [
    ['source', 'pull-request'],
    ['id', String(input.number)],
    ['title', title],
    ['url', sanitizeFrontmatterValue(input.url, MAX_METADATA_VALUE)]
  ]
  const frontmatter = metadata
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
  const sections = [
    `# ${title.length === 0 ? `Pull request #${input.number}` : title}`,
    `Target branch: ${sanitizeFrontmatterValue(input.baseRef, MAX_METADATA_VALUE)}`,
    ...(body.length === 0 ? [] : [body])
  ]

  return `---\n${frontmatter}\n---\n${sections.join('\n\n')}\n`
}
