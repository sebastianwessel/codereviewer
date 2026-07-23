import { describe, expect, test } from 'vitest'
import type { FixEdit } from '../../shared/contracts/findings/finding.schema.js'
import { applyFixEdits } from './apply-check.js'

const edit = (over: Partial<FixEdit>): FixEdit => ({
  path: 'src/app.ts',
  startLine: 2,
  endLine: 2,
  replacement: 'const fixed = compute()',
  ...over
})

const file = ['const a = 1', 'const b = broken()', 'const c = 3'].join('\n')

describe('applyFixEdits', () => {
  test('applies a clean single-line edit to the current bytes', () => {
    const result = applyFixEdits(file, [edit({})])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toBe(
        ['const a = 1', 'const fixed = compute()', 'const c = 3'].join('\n')
      )
    }
  })

  test('applies a multi-line replacement spanning a range', () => {
    const result = applyFixEdits(file, [
      edit({ startLine: 1, endLine: 2, replacement: 'const a = 1\nconst b = safe()' })
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toBe(
        ['const a = 1', 'const b = safe()', 'const c = 3'].join('\n')
      )
    }
  })

  test('drops the fix when a line range is past the end of the file', () => {
    const result = applyFixEdits(file, [edit({ startLine: 9, endLine: 9 })])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('line-range-out-of-bounds')
    }
  })

  test('drops the fix when startLine is below 1', () => {
    const result = applyFixEdits(file, [edit({ startLine: 0, endLine: 1 })])
    expect(result.ok).toBe(false)
  })

  test('drops the fix when endLine precedes startLine', () => {
    const result = applyFixEdits(file, [edit({ startLine: 3, endLine: 2 })])
    expect(result.ok).toBe(false)
  })

  test('rejects overlapping edits', () => {
    const result = applyFixEdits(file, [
      edit({ startLine: 1, endLine: 2 }),
      edit({ startLine: 2, endLine: 3 })
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('overlapping-edits')
    }
  })

  test('applies multiple disjoint edits without shifting line numbers', () => {
    const result = applyFixEdits(file, [
      edit({ startLine: 1, endLine: 1, replacement: 'const a = 0' }),
      edit({ startLine: 3, endLine: 3, replacement: 'const c = 4' })
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toBe(
        ['const a = 0', 'const b = broken()', 'const c = 4'].join('\n')
      )
    }
  })

  test('an empty edit set does not apply', () => {
    const result = applyFixEdits(file, [])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('no-edits')
    }
  })
})
