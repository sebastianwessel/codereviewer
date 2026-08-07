import { describe, expect, test } from 'vitest'
import {
  compileGlobMatchers,
  globToAncestorRegExp,
  globToRegExp,
  matchesAnyGlob
} from './glob-matcher.js'

describe('glob matcher', () => {
  test('matches a single path segment with *', () => {
    const matcher = globToRegExp('src/*.ts')

    expect(matcher.test('src/app.ts')).toBe(true)
    expect(matcher.test('src/nested/app.ts')).toBe(false)
  })

  test('matches any depth with **', () => {
    const matcher = globToRegExp('node_modules/**')

    expect(matcher.test('node_modules/pkg/index.js')).toBe(true)
    expect(matcher.test('src/node_modules-note.ts')).toBe(false)
  })

  test('a leading ** also matches a top-level entry with no directories', () => {
    const matcher = globToRegExp('**/*')

    expect(matcher.test('app.ts')).toBe(true)
    expect(matcher.test('src/app.ts')).toBe(true)
    expect(matcher.test('src/nested/app.ts')).toBe(true)
  })

  test('a leading ** combined with a suffix matches a top-level file', () => {
    const matcher = globToRegExp('**/*.min.js')

    expect(matcher.test('bundle.min.js')).toBe(true)
    expect(matcher.test('dist/bundle.min.js')).toBe(true)
    expect(matcher.test('bundle.js')).toBe(false)
  })

  test('a trailing ** after a literal matches the bare literal and its contents', () => {
    const matcher = globToRegExp('dist/**')

    expect(matcher.test('dist')).toBe(true)
    expect(matcher.test('dist/')).toBe(true)
    expect(matcher.test('dist/bundle.js')).toBe(true)
    expect(matcher.test('dist/nested/bundle.js')).toBe(true)
    expect(matcher.test('distant')).toBe(false)
  })

  test('a leading ** combined with an exact name matches it at the root', () => {
    const matcher = globToRegExp('**/package-lock.json')

    expect(matcher.test('package-lock.json')).toBe(true)
    expect(matcher.test('nested/package-lock.json')).toBe(true)
    expect(matcher.test('package-lock.json.bak')).toBe(false)
  })

  test('a middle ** matches zero or more directories between two literals', () => {
    const matcher = globToRegExp('a/**/z')

    expect(matcher.test('a/z')).toBe(true)
    expect(matcher.test('a/b/z')).toBe(true)
    expect(matcher.test('a/b/c/z')).toBe(true)
    expect(matcher.test('az')).toBe(false)
    expect(matcher.test('a/zz')).toBe(false)
  })

  test('matches a single character with ?', () => {
    const matcher = globToRegExp('src/app?.ts')

    expect(matcher.test('src/app1.ts')).toBe(true)
    expect(matcher.test('src/app12.ts')).toBe(false)
  })

  test('escapes regex-special characters literally', () => {
    const matcher = globToRegExp('src/app.ts')

    expect(matcher.test('src/appXts')).toBe(false)
    expect(matcher.test('src/app.ts')).toBe(true)
  })

  test('rejects patterns beyond the supported length', () => {
    expect(() => globToRegExp('*'.repeat(4097))).toThrow(/maximum supported length/iu)
  })

  test('matchesAnyGlob reports a hit across multiple patterns', () => {
    const matchers = compileGlobMatchers(['dist/**', '**/*.map'])

    expect(matchesAnyGlob('dist/index.js', matchers)).toBe(true)
    expect(matchesAnyGlob('src/index.js.map', matchers)).toBe(true)
    expect(matchesAnyGlob('src/index.ts', matchers)).toBe(false)
  })
})

// The directories a pattern's files can live beneath. `paths.include` scopes
// files, so this is what a traversal has to ask before descending: could a path
// matching this pattern exist below here?
describe('glob ancestor matcher', () => {
  test('admits every directory level a pattern can reach through', () => {
    const matcher = globToAncestorRegExp('src/**/*')

    expect(matcher.test('src')).toBe(true)
    expect(matcher.test('src/domains')).toBe(true)
    expect(matcher.test('src/domains/context-retrieval')).toBe(true)
    expect(matcher.test('docs')).toBe(false)
  })

  test('handles a wildcard in the middle of a pattern', () => {
    const matcher = globToAncestorRegExp('packages/*/src/**/*')

    expect(matcher.test('packages')).toBe(true)
    expect(matcher.test('packages/a')).toBe(true)
    expect(matcher.test('packages/a/src')).toBe(true)
    expect(matcher.test('packages/a/src/nested')).toBe(true)
    // A sibling of the pattern's `src` segment holds no matching file.
    expect(matcher.test('packages/a/lib')).toBe(false)
  })

  test('admits everything under a leading globstar', () => {
    const matcher = globToAncestorRegExp('**/*.ts')

    expect(matcher.test('docs')).toBe(true)
    expect(matcher.test('docs/guides')).toBe(true)
  })

  test('a pattern naming one file admits no directory at all', () => {
    // The only segment describes the file itself, and no path lies below a file.
    expect(globToAncestorRegExp('README.md').test('README.md')).toBe(false)
    expect(globToAncestorRegExp('*').test('src')).toBe(false)
  })

  test('the last segment of a globstar-free pattern is the file, not a directory', () => {
    const matcher = globToAncestorRegExp('src/app.ts')

    expect(matcher.test('src')).toBe(true)
    expect(matcher.test('src/app.ts')).toBe(false)
  })

  test('rejects patterns beyond the supported length', () => {
    expect(() => globToAncestorRegExp('*'.repeat(4097))).toThrow(
      /maximum supported length/iu
    )
  })
})
