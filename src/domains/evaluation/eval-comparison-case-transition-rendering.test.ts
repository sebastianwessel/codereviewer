import { describe, expect, test } from 'vitest'
import { appendEvalComparisonCaseTransitions, caseStatusById } from './eval-comparison-case-transition-rendering.js'

describe('eval comparison case transition rendering', () => {
  test('exports case status and transition renderers', () => {
    expect(typeof caseStatusById).toBe('function')
    expect(typeof appendEvalComparisonCaseTransitions).toBe('function')
  })
})
