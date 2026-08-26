import { describe, expect, test } from 'vitest'
import {
  attributeAlertsToChange,
  indexChangedRanges,
  rankAttributedAlerts,
  type ChangedLineRange
} from './changed-side-attribution.js'
import { AnalyzerAlertSchema, type AnalyzerAlert } from './contracts.js'

const alertAt = (input: {
  readonly id: string
  readonly path: string
  readonly startLine: number
  readonly endLine?: number
  readonly flowLines?: readonly { readonly path: string; readonly line: number }[]
  readonly relatedLines?: readonly { readonly path: string; readonly line: number }[]
  readonly level?: AnalyzerAlert['level']
  readonly securitySeverity?: number
}): AnalyzerAlert =>
  AnalyzerAlertSchema.parse({
    id: input.id,
    artifact: {
      path: 'reports/analyzer.sarif.json',
      contentHash: 'f'.repeat(64)
    },
    analyzer: { name: 'example-analyzer' },
    ruleId: 'security/example',
    cwe: [],
    level: input.level ?? 'warning',
    ...(input.securitySeverity === undefined
      ? {}
      : { securitySeverity: input.securitySeverity }),
    message: 'An analyzer reported something.',
    location: {
      path: input.path,
      startLine: input.startLine,
      ...(input.endLine === undefined ? {} : { endLine: input.endLine }),
      side: 'new'
    },
    relatedLocations: (input.relatedLines ?? []).map((entry, index) => ({
      id: `${input.id}_related${index}`,
      location: { path: entry.path, startLine: entry.line, side: 'new' },
      message: 'Related location.'
    })),
    dataFlow:
      input.flowLines === undefined
        ? []
        : [
            {
              id: `${input.id}_flow0`,
              label: 'flow',
              steps: input.flowLines.map((entry, index) => ({
                id: `${input.id}_flow0_step${index}`,
                location: { path: entry.path, startLine: entry.line, side: 'new' },
                message: `Step ${index + 1}.`
              }))
            }
          ]
  })

const changedOrders: readonly ChangedLineRange[] = [
  { path: 'src/service/orders.ts', startLine: 40, endLine: 48, changeKind: 'modified' }
]

describe('changed-side attribution', () => {
  test('a pre-existing alert with no changed-side cause is NOT reported', () => {
    const result = attributeAlertsToChange({
      alerts: [
        alertAt({
          id: 'alert_000000000000000000000001',
          path: 'src/service/legacy.ts',
          startLine: 200
        })
      ],
      changedRanges: changedOrders
    })

    expect(result.attributed).toEqual([])
    // Counted, so the omission is disclosed rather than silent.
    expect(result.preExistingCount).toBe(1)
  })

  test('an alert in a changed FILE but outside every changed line is not reported', () => {
    // The decisive precision property: touching one end of a file must not make
    // the change answerable for debt at the other end.
    const result = attributeAlertsToChange({
      alerts: [
        alertAt({
          id: 'alert_000000000000000000000002',
          path: 'src/service/orders.ts',
          startLine: 900
        })
      ],
      changedRanges: changedOrders
    })

    expect(result.attributed).toEqual([])
    expect(result.preExistingCount).toBe(1)
  })

  test('an alert on a changed line is attributed as changed-line', () => {
    const result = attributeAlertsToChange({
      alerts: [
        alertAt({
          id: 'alert_000000000000000000000003',
          path: 'src/service/orders.ts',
          startLine: 42
        })
      ],
      changedRanges: changedOrders
    })

    expect(result.attributed).toHaveLength(1)
    expect(result.attributed[0]?.attribution).toBe('changed-line')
    expect(result.attributed[0]?.attributedPath).toBe('src/service/orders.ts')
    expect(result.attributed[0]?.attributedLine).toBe(42)
    expect(result.preExistingCount).toBe(0)
  })

  test('an alert whose span overlaps a changed range is attributed', () => {
    const result = attributeAlertsToChange({
      alerts: [
        alertAt({
          id: 'alert_000000000000000000000004',
          path: 'src/service/orders.ts',
          startLine: 30,
          endLine: 41
        })
      ],
      changedRanges: changedOrders
    })

    expect(result.attributed[0]?.attribution).toBe('changed-line')
    expect(result.attributed[0]?.attributedLine).toBe(40)
  })

  test('an alert reported in unchanged code is attributed when its FLOW crosses the change', () => {
    // The "change exposes an existing path" case this design can catch: the sink is
    // old code, but a step of the traced path is a changed line.
    const result = attributeAlertsToChange({
      alerts: [
        alertAt({
          id: 'alert_000000000000000000000005',
          path: 'src/service/legacy.ts',
          startLine: 120,
          flowLines: [
            { path: 'src/service/orders.ts', line: 44 },
            { path: 'src/service/legacy.ts', line: 120 }
          ]
        })
      ],
      changedRanges: changedOrders
    })

    expect(result.attributed).toHaveLength(1)
    expect(result.attributed[0]?.attribution).toBe('changed-flow')
    expect(result.attributed[0]?.attributedPath).toBe('src/service/orders.ts')
    expect(result.attributed[0]?.attributedLine).toBe(44)
  })

  test('a related location on a changed line also attributes the alert', () => {
    const result = attributeAlertsToChange({
      alerts: [
        alertAt({
          id: 'alert_000000000000000000000006',
          path: 'src/service/legacy.ts',
          startLine: 120,
          relatedLines: [{ path: 'src/service/orders.ts', line: 47 }]
        })
      ],
      changedRanges: changedOrders
    })

    expect(result.attributed[0]?.attribution).toBe('changed-flow')
    expect(result.attributed[0]?.attributedLine).toBe(47)
  })

  test('with no changed ranges nothing is attributed', () => {
    const result = attributeAlertsToChange({
      alerts: [
        alertAt({
          id: 'alert_000000000000000000000007',
          path: 'src/service/orders.ts',
          startLine: 42
        })
      ],
      changedRanges: []
    })

    expect(result.attributed).toEqual([])
    expect(result.preExistingCount).toBe(1)
  })

  test('deleted ranges do not attribute a new-side alert', () => {
    // A deleted range describes old-side lines that no longer exist; matching a
    // new-side alert against them would attribute by coincidence of numbering.
    const result = attributeAlertsToChange({
      alerts: [
        alertAt({
          id: 'alert_000000000000000000000008',
          path: 'src/service/orders.ts',
          startLine: 42
        })
      ],
      changedRanges: [
        {
          path: 'src/service/orders.ts',
          startLine: 40,
          endLine: 48,
          changeKind: 'deleted'
        }
      ]
    })

    expect(result.attributed).toEqual([])
    expect(result.preExistingCount).toBe(1)
  })

  test('indexChangedRanges normalizes an empty end line to the start line', () => {
    const indexed = indexChangedRanges([
      { path: 'src/a.ts', startLine: 5, endLine: 0 }
    ])

    expect(indexed.get('src/a.ts')).toEqual([
      { path: 'src/a.ts', startLine: 5, endLine: 5 }
    ])
  })

  test('ranking prefers producer severity, then level, then a stable id order', () => {
    const ranked = rankAttributedAlerts([
      {
        alert: alertAt({
          id: 'alert_0000000000000000000000b1',
          path: 'src/a.ts',
          startLine: 1,
          level: 'note'
        }),
        attribution: 'changed-line',
        attributedPath: 'src/a.ts',
        attributedLine: 1
      },
      {
        alert: alertAt({
          id: 'alert_0000000000000000000000a1',
          path: 'src/a.ts',
          startLine: 2,
          level: 'error'
        }),
        attribution: 'changed-line',
        attributedPath: 'src/a.ts',
        attributedLine: 2
      },
      {
        alert: alertAt({
          id: 'alert_0000000000000000000000c1',
          path: 'src/a.ts',
          startLine: 3,
          level: 'note',
          securitySeverity: 9.1
        }),
        attribution: 'changed-line',
        attributedPath: 'src/a.ts',
        attributedLine: 3
      }
    ])

    expect(ranked.map((entry) => entry.alert.id)).toEqual([
      'alert_0000000000000000000000c1',
      'alert_0000000000000000000000a1',
      'alert_0000000000000000000000b1'
    ])
  })
})
