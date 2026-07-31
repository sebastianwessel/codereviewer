// Re-exported so this domain keeps one import site for its text helpers. The
// implementation is the shared one: this file used to carry its own binary search
// over UTF-16 code-unit indices, which could cut between the halves of a surrogate
// pair and emit a lone surrogate, while its doc comment promised the opposite.
export { sliceUtf8Bytes as truncateToUtf8Bytes } from '../../shared/text/utf8-bytes.js'


// Minimal glob matcher for the changed-files provider. Supports `**`, `*`, and
// `?` against POSIX-style repository paths.
//
// NOT the shared matcher in `src/shared/glob/glob-matcher.ts`, and not
// interchangeable with it: the two disagree on zero-segment cases. `dist/**`
// compiles to `^dist/.*$` here but to `^dist(?:/.*)?$` there, so the shared one
// also matches a file named exactly `dist`; and a `**` glued to other characters
// inside a segment (`**.md`) crosses path separators here but is treated as a
// literal segment there. The shared matcher additionally throws on a pattern
// longer than 4096 characters, which would escape this provider's
// never-fail-the-review contract because matchers are compiled outside the
// per-provider try block. Unify only together with a decision about those cases.
const globToRegExp = (pattern: string): RegExp => {
  const normalized = pattern.replaceAll('\\', '/')
  let source = '^'

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    const next = normalized[index + 1]

    if (char === '*' && next === '*') {
      // `**/` matches zero or more leading directory segments, so `**/*.md`
      // matches a root-level file as well as a nested one.
      if (normalized[index + 2] === '/') {
        source += '(?:.*/)?'
        index += 2
      } else {
        source += '.*'
        index += 1
      }
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char?.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&') ?? ''
    }
  }

  return new RegExp(`${source}$`, 'u')
}

export const compileGlobMatchers = (
  patterns: readonly string[]
): readonly RegExp[] => patterns.map(globToRegExp)

export const matchesAnyGlob = (
  portablePath: string,
  matchers: readonly RegExp[]
): boolean => matchers.some((matcher) => matcher.test(portablePath))
