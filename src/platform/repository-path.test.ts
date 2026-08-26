import { describe, expect, test } from 'vitest'
import {
  locationsOverlap,
  normalizeRepositoryRelativePath,
  sameRepositoryPath
} from './repository-path.js'

describe('normalizeRepositoryRelativePath', () => {
  test('normalizes the repository root to "."', () => {
    expect(normalizeRepositoryRelativePath('.')).toBe('.')
    expect(normalizeRepositoryRelativePath('./')).toBe('.')
  })

  test('strips a leading "./" from a relative path', () => {
    expect(normalizeRepositoryRelativePath('./src/app.ts')).toBe('src/app.ts')
  })

  test('normalizes backslash separators to forward slashes', () => {
    expect(normalizeRepositoryRelativePath('src\\app.ts')).toBe('src/app.ts')
  })

  test('collapses a redundant "./" segment and duplicate separators', () => {
    expect(normalizeRepositoryRelativePath('src/./app.ts')).toBe('src/app.ts')
    expect(normalizeRepositoryRelativePath('src//app.ts')).toBe('src/app.ts')
  })

  test('rejects traversal above the repository root', () => {
    expect(() => normalizeRepositoryRelativePath('../outside.ts')).toThrow()
  })
})

describe('sameRepositoryPath', () => {
  // The hole the refutation copy of this predicate had: it compared the two
  // paths with `===`, so a support signal recorded as `./src/app.ts` did not
  // corroborate a candidate at `src/app.ts` and the corroboration was lost with
  // no trace. Every spelling below is the same file.
  test.each([
    ['src/app.ts', './src/app.ts'],
    ['src/app.ts', 'src\\app.ts'],
    ['src/app.ts', 'src/./app.ts'],
    ['src/app.ts', 'src//app.ts']
  ])('treats %s and %s as the same file', (left, right) => {
    expect(sameRepositoryPath(left, right)).toBe(true)
  })

  test('distinguishes different files', () => {
    expect(sameRepositoryPath('src/app.ts', 'src/other.ts')).toBe(false)
  })
})

describe('locationsOverlap', () => {
  test('overlaps across path spellings when the lines meet', () => {
    expect(
      locationsOverlap(
        { path: 'src/app.ts', startLine: 10, endLine: 20 },
        { path: './src/app.ts', startLine: 20, endLine: 30 }
      )
    ).toBe(true)
  })

  test('an absent endLine means the single startLine', () => {
    expect(
      locationsOverlap(
        { path: 'src/app.ts', startLine: 10 },
        { path: 'src/app.ts', startLine: 10 }
      )
    ).toBe(true)
    expect(
      locationsOverlap(
        { path: 'src/app.ts', startLine: 10 },
        { path: 'src/app.ts', startLine: 11 }
      )
    ).toBe(false)
  })

  test('the same lines in different files do not overlap', () => {
    expect(
      locationsOverlap(
        { path: 'src/app.ts', startLine: 10, endLine: 20 },
        { path: 'src/other.ts', startLine: 10, endLine: 20 }
      )
    ).toBe(false)
  })
})
