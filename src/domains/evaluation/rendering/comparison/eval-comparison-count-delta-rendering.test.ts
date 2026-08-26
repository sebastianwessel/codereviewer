import { describe, expect, test } from 'vitest'
import { appendComparisonCountDeltaTable } from './eval-comparison-count-delta-rendering.js'

describe('eval comparison count delta rendering', () => {
  test('exports the shared count-delta table appender', () => {
    expect(typeof appendComparisonCountDeltaTable).toBe('function')
  })
})
