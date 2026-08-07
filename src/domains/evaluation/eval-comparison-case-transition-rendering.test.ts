import { describe, expect, test } from 'vitest'
import { appendEvalComparisonCaseTransitions, caseStatusById } from './eval-comparison-case-transition-rendering.js'

describe('eval comparison case transition rendering', () => {
  test('exports case status and transition renderers', () => {
    expect(typeof caseStatusById).toBe('function')
    expect(typeof appendEvalComparisonCaseTransitions).toBe('function')
  })

  test('renders one row per case and reports an unrecorded status as unknown', () => {
    const lines: string[] = []
    appendEvalComparisonCaseTransitions(lines, {
      caseIds: ['alpha', 'beta'],
      baseStatus: new Map([
        ['alpha', 'PASS' as const],
        ['beta', 'UNKNOWN' as const]
      ]),
      headStatus: new Map([['alpha', 'FAIL' as const]])
    })

    expect(lines).toEqual([
      '## Case Transitions',
      '',
      '| Case | Base | Head | Change |',
      '| --- | --- | --- | --- |',
      '| alpha | PASS | FAIL | regressed |',
      '| beta | UNKNOWN | - | unknown (not recorded) |',
      ''
    ])
  })

  // No compared case means no table: a header and separator with nothing under
  // them is not an empty result, it is a broken table.
  test('emits nothing when no case is compared', () => {
    const lines: string[] = []
    appendEvalComparisonCaseTransitions(lines, {
      caseIds: [],
      baseStatus: new Map(),
      headStatus: new Map()
    })

    expect(lines).toEqual([])
  })
})
