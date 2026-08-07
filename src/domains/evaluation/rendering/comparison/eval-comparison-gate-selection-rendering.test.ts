import { describe, expect, test } from 'vitest'
import {
  appendEvalComparisonGate,
  appendEvalComparisonSelection,
  selectionStatus
} from './eval-comparison-gate-selection-rendering.js'
import { parseEvalComparisonReport } from '../../report/eval-comparison-view.js'

const render = (
  base: Record<string, unknown>,
  head: Record<string, unknown>
): string => {
  const pair = {
    base: parseEvalComparisonReport(base),
    head: parseEvalComparisonReport(head)
  }
  const lines: string[] = []
  appendEvalComparisonGate(lines, pair)
  appendEvalComparisonSelection(lines, selectionStatus(pair))

  return lines.join('\n')
}

describe('eval comparison gate selection rendering', () => {
  test('exports focused gate and selection renderers', () => {
    expect(typeof appendEvalComparisonGate).toBe('function')
    expect(typeof appendEvalComparisonSelection).toBe('function')
  })

  // A gate result the report did not record is not a failure, and a judge whose
  // trust flag was never written is not untrustworthy. Both render as unknown.
  test('renders unrecorded gate, fixture count and judge trust as unknown', () => {
    const rendered = render({ metricsVersion: 'x' }, { metricsVersion: 'x' })

    expect(rendered).toContain(
      '| Base | unknown (not recorded) | unknown (not recorded) | unknown (not recorded) |'
    )
    expect(rendered).toContain(
      '| Judge trustworthy | unknown (not recorded) -> unknown (not recorded) |'
    )
  })

  // A refused gate must read as refused in a comparison too, and an archived
  // report's boolean verdict must still render as the verdict it recorded
  // rather than degrading to unknown.
  test('renders the three gate outcomes and an archived boolean verdict', () => {
    const rendered = render(
      { metricsVersion: 'x', regressionGate: { passed: true } },
      { metricsVersion: 'x', regressionGate: { outcome: 'not-evaluable' } }
    )

    expect(rendered).toContain('| Base | PASS |')
    expect(rendered).toContain('| Head | NOT EVALUABLE |')
  })

  // Not knowing whether the two runs scored the same cases is not the same as
  // knowing they did.
  test('warns when a report did not record its selected case set', () => {
    expect(render({ metricsVersion: 'x' }, { metricsVersion: 'x' })).toContain(
      'Warning: a compared report did not record its selected case set'
    )
  })

  test('still warns plainly when recorded case sets differ', () => {
    const rendered = render(
      {
        metricsVersion: 'x',
        selection: { caseFilters: [], selectedCaseIds: ['a', 'b'] }
      },
      {
        metricsVersion: 'x',
        selection: { caseFilters: [], selectedCaseIds: ['a'] }
      }
    )

    expect(rendered).toContain('| Case set | different |')
    expect(rendered).toContain('Warning: selected case sets differ')
    expect(rendered).toContain('| Base-only cases | b |')
  })
})
