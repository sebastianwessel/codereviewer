import { describe, expect, test } from 'vitest'
import { renderEvalRecallReport } from './eval-recall-report-rendering.js'

describe('eval recall report rendering module', () => {
  test('exports the focused recall report renderer', () => {
    expect(typeof renderEvalRecallReport).toBe('function')
  })
})
