import { describe, expect, test } from 'vitest'
import { renderEvalComparison } from './eval-comparison-report-rendering.js'

describe('eval comparison report rendering module', () => {
  test('exports the focused comparison report renderer', () => {
    expect(typeof renderEvalComparison).toBe('function')
  })
})
