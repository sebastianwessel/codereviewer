import { describe, expect, test } from 'vitest'
import { appendEvalComparisonGate, appendEvalComparisonSelection } from './eval-comparison-gate-selection-rendering.js'

describe('eval comparison gate selection rendering', () => {
  test('exports focused gate and selection renderers', () => {
    expect(typeof appendEvalComparisonGate).toBe('function')
    expect(typeof appendEvalComparisonSelection).toBe('function')
  })
})
