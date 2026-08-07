import { describe, expect, test } from 'vitest'
import { appendEvalComparisonMetricDeltas } from './eval-comparison-aggregate-metric-rendering.js'

describe('eval comparison aggregate metric rendering', () => {
  test('exports the aggregate metric-delta renderer', () => {
    expect(typeof appendEvalComparisonMetricDeltas).toBe('function')
  })
})
