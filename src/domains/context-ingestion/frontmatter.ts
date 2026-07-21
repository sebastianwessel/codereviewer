export type ParsedFrontmatter = {
  readonly metadata: Readonly<Record<string, string>>
  readonly body: string
}

// Lenient frontmatter parse for pipeline-provided context files. Unlike skill
// files, an inbox file without frontmatter is valid: the whole content is the
// body. Only simple `key: value` scalars are read; nested YAML is ignored rather
// than rejected, because inbox content is untrusted and must never throw.
export const parseFrontmatter = (content: string): ParsedFrontmatter => {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { metadata: {}, body: content }
  }

  const end = content.indexOf('\n---', 3)

  if (end < 0) {
    return { metadata: {}, body: content }
  }

  const metadata: Record<string, string> = {}

  for (const rawLine of content.slice(4, end).split(/\r?\n/u)) {
    const separator = rawLine.indexOf(':')

    if (separator <= 0) {
      continue
    }

    const key = rawLine.slice(0, separator).trim()
    const value = rawLine
      .slice(separator + 1)
      .trim()
      .replace(/^"|"$/gu, '')
      .replace(/^'|'$/gu, '')

    if (key.length > 0) {
      metadata[key] = value
    }
  }

  // Skip the closing delimiter line after `\n---`.
  const bodyStart = content.indexOf('\n', end + 1)
  const body = bodyStart < 0 ? '' : content.slice(bodyStart + 1)

  return { metadata, body }
}
