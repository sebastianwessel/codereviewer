import { describe, expect, test } from 'vitest'
import {
  appendMetricGroupCoverageDeltas,
  appendMetricGroupProofLoopDeltas,
  appendMetricGroupQualityDeltas,
  appendMetricGroupResourceDeltas,
  comparableMetricGroups,
  metricGroupCoverageDeltas
} from './eval-comparison-metric-group-rendering.js'

describe('eval comparison metric group rendering', () => {
  test('exports metric-group comparison helpers', () => {
    expect(typeof comparableMetricGroups).toBe('function')
    expect(typeof metricGroupCoverageDeltas).toBe('function')
    expect(typeof appendMetricGroupCoverageDeltas).toBe('function')
    expect(typeof appendMetricGroupQualityDeltas).toBe('function')
    expect(typeof appendMetricGroupResourceDeltas).toBe('function')
    expect(typeof appendMetricGroupProofLoopDeltas).toBe('function')
  })
})
