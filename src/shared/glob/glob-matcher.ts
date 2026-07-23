// Minimal glob matcher for repository-relative, POSIX-style paths. Supports
// `*` (single path-segment wildcard), `**` (zero or more whole path
// segments), and `?` (single character). No external glob dependency:
// patterns come only from trusted configuration (`paths.include` /
// `paths.exclude`), so a small, auditable implementation is preferable to a
// third-party dependency.
const maxGlobPatternLength = 4096

const escapeLiteralChar = (char: string): string =>
  char.replace(/[|\\{}()[\]^$+.]/g, '\\$&')

// Translates one `/`-delimited pattern segment (never `**` itself, that is
// handled by the caller) into the regex source for that segment: `*` for any
// run of non-separator characters, `?` for exactly one, everything else
// escaped and matched literally.
const segmentToRegExpSource = (segment: string): string => {
  let source = ''

  for (const char of segment) {
    if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += escapeLiteralChar(char)
    }
  }

  return source
}

type GlobPart =
  | { readonly kind: 'literal'; readonly source: string }
  | { readonly kind: 'globstar' }

export const globToRegExp = (pattern: string): RegExp => {
  if (pattern.length > maxGlobPatternLength) {
    throw new TypeError('Glob pattern exceeds the maximum supported length.')
  }

  const normalizedPattern = pattern.replaceAll('\\', '/')
  const parts: readonly GlobPart[] = normalizedPattern
    .split('/')
    .map((segment) =>
      segment === '**'
        ? { kind: 'globstar' }
        : { kind: 'literal', source: segmentToRegExpSource(segment) }
    )

  let source = '^'

  parts.forEach((part, index) => {
    const isFirst = index === 0
    const isLast = index === parts.length - 1

    if (part.kind === 'literal') {
      source += part.source

      // A literal segment is followed by an explicit `/` only when the next
      // segment is itself a literal; a following globstar contributes its
      // own connecting separator (see below), so segments stay correctly
      // delimited either way without doubling up the slash.
      const nextPart = parts[index + 1]

      if (nextPart !== undefined && nextPart.kind === 'literal') {
        source += '/'
      }

      return
    }

    // A `**` segment matches zero or more whole path segments. Its regex
    // depends on position so that zero-match cases stay correct: a leading
    // globstar also matches a top-level entry with no directories at all
    // (`**/*` matches `app.ts`, not only `src/app.ts`), and a trailing
    // globstar after a literal also matches the literal path itself
    // (`dist/**` matches `dist`, not only `dist/x`).
    if (isFirst && isLast) {
      source += '.*'
    } else if (isFirst) {
      source += '(?:.*/)?'
    } else if (isLast) {
      // Zero-or-more trailing segments: `dist/**` matches `dist`, `dist/`, and
      // `dist/x` (the connecting `/` is part of the optional group).
      source += '(?:/.*)?'
    } else {
      source += '/(?:.*/)?'
    }
  })

  source += '$'

  return new RegExp(source)
}

export const compileGlobMatchers = (
  patterns: readonly string[]
): readonly RegExp[] => patterns.map(globToRegExp)

export const matchesAnyGlob = (
  portablePath: string,
  matchers: readonly RegExp[]
): boolean => matchers.some((matcher) => matcher.test(portablePath))
