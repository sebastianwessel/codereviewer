import { describe, expect, test } from 'vitest'
import { normalizeRepositoryRelativePath } from './repository-path.js'

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
