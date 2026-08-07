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

const parseGlobParts = (pattern: string): readonly GlobPart[] => {
  if (pattern.length > maxGlobPatternLength) {
    throw new TypeError('Glob pattern exceeds the maximum supported length.')
  }

  return pattern
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) =>
      segment === '**'
        ? { kind: 'globstar' }
        : { kind: 'literal', source: segmentToRegExpSource(segment) }
    )
}

export const globToRegExp = (pattern: string): RegExp => {
  const parts = parseGlobParts(pattern)

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

// A pattern that can never match. Returned for a glob no directory can be an
// ancestor of, so callers keep working with a plain `RegExp` instead of a
// nullable one; an empty alternation would be a syntax error and `^$` would
// wrongly match the empty path.
const neverMatchingRegExpSource = '(?!)'

// Builds the matcher for the DIRECTORIES a file matching `pattern` could live
// beneath.
//
// The include layer scopes files (spec 04), so a pattern like `src/**/*` says
// nothing about `src` itself — yet nothing under `src` is reachable without
// traversing it. This answers the question a traversal actually asks: could a
// path matching this pattern exist below this directory?
//
// A literal-prefix shortcut cannot answer it. `packages/*/src/**/*` requires
// `packages/a` to be traversable, so every prefix is built from the same
// per-segment sources `globToRegExp` uses, and a wildcard in the middle of a
// pattern is handled like any other segment.
export const globToAncestorRegExp = (pattern: string): RegExp => {
  const parts = parseGlobParts(pattern)
  const ancestorSources: string[] = []
  let prefixSource = ''

  for (const [index, part] of parts.entries()) {
    if (part.kind === 'globstar') {
      // `**` matches zero or more whole segments, so from here on ANY depth
      // below the prefix can still lead to a matching file — and the prefix
      // itself can, because the globstar may match nothing. Nothing after this
      // point can narrow that, so the scan stops.
      ancestorSources.push(
        prefixSource === '' ? '.*' : `${prefixSource}(?:/.*)?`
      )
      break
    }

    prefixSource =
      prefixSource === '' ? part.source : `${prefixSource}/${part.source}`

    // The LAST segment of a globstar-free pattern describes the file itself, and
    // a file has no path below it. Only the earlier segments name directories a
    // matching file could live beneath.
    if (index < parts.length - 1) {
      ancestorSources.push(prefixSource)
    }
  }

  return new RegExp(
    ancestorSources.length === 0
      ? neverMatchingRegExpSource
      : `^(?:${ancestorSources.join('|')})$`
  )
}

export const compileGlobMatchers = (
  patterns: readonly string[]
): readonly RegExp[] => patterns.map(globToRegExp)

export const compileGlobAncestorMatchers = (
  patterns: readonly string[]
): readonly RegExp[] => patterns.map(globToAncestorRegExp)

export const matchesAnyGlob = (
  portablePath: string,
  matchers: readonly RegExp[]
): boolean => matchers.some((matcher) => matcher.test(portablePath))
