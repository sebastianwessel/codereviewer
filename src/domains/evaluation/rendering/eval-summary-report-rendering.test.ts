import { describe, expect, test } from 'vitest'
import { renderEvalSummary } from './eval-summary-report-rendering.js'

describe('eval summary report rendering module', () => {
  test('exports the focused summary report renderer', () => {
    expect(typeof renderEvalSummary).toBe('function')
  })

})
