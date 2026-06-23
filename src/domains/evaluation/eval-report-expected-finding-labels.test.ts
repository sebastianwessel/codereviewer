import { describe, expect, test } from 'vitest'
import {
  expectedLocationLabel,
  expectedMatchModeLabel,
  formatLineRange
} from './eval-report-expected-finding-labels.js'

describe('eval report expected finding labels', () => {
  test('formats optional line ranges for expected finding labels', () => {
    expect(formatLineRange(undefined)).toBe('')
    expect(formatLineRange([12, 12])).toBe(':12')
    expect(formatLineRange([12, 18])).toBe(':12-18')
  })

  test('formats expected finding locations with semantic-only fallback', () => {
    expect(expectedLocationLabel({})).toBe('(semantic-only)')
    expect(
      expectedLocationLabel({
        path: 'src/app.ts'
      })
    ).toBe('src/app.ts')
    expect(
      expectedLocationLabel({
        path: 'src/app.ts',
        lineRange: [4, 6]
      })
    ).toBe('src/app.ts:4-6')
  })

  test('formats expected match-mode fallback labels', () => {
    expect(expectedMatchModeLabel({})).toBe('semantic-only')
    expect(expectedMatchModeLabel({ path: 'src/app.ts' })).toBe(
      'path-semantic'
    )
    expect(
      expectedMatchModeLabel({
        path: 'src/app.ts',
        lineRange: [4, 4]
      })
    ).toBe('path-line')
    expect(
      expectedMatchModeLabel({
        matchMode: 'semantic-only',
        path: 'src/app.ts',
        lineRange: [4, 4]
      })
    ).toBe('semantic-only')
  })
})
