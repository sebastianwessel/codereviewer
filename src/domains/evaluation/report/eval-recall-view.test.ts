import { describe, expect, test } from 'vitest'
import { parseEvalRecallView } from './eval-recall-view.js'

// The exact payload shape that stopped opening on 2026-08-11: four
// per-classification finding arrays on the case result, no `producedFindings`,
// and `schemaVersion: '1.0'`. Every engine-pinned archive under
// `.codereviewer/eval/` looks like this, and they are the evidence base the
// ledger is written from.
const legacyCaseResultReport = {
  schemaVersion: '1.0',
  metricsVersion: '2026-08-07.open-redirect-mechanism',
  generatedAt: '2026-08-07T00:00:00.000Z',
  fixtureCount: 1,
  selection: {
    fixtureSource: 'slice-root',
    caseFilters: [],
    selectedCaseIds: ['case-a']
  },
  caseResults: [
    {
      caseId: 'case-a',
      expectedFindings: [
        {
          expectedIndex: 0,
          category: 'security',
          severity: 'high',
          path: 'src/app.ts',
          matchMode: 'path-semantic',
          diffScope: 'in-diff',
          semanticSummary: 'The guard is missing on the admin route.'
        }
      ],
      matchedFindings: [{ expectedIndex: 0, findingId: 'find_a' }],
      // The four arrays `producedFindings` replaced. A strict producer contract
      // rejects the report on these, which is what broke `eval recall-report`.
      duplicateFindings: [],
      falsePositiveFindings: [{ findingId: 'find_b', title: 'noise' }],
      unlistedRealFindings: [],
      artifactOnlyFalsePositiveFindings: []
    }
  ]
}

describe('the recall view', () => {
  test('opens an archive written before producedFindings existed', () => {
    const view = parseEvalRecallView(legacyCaseResultReport)

    expect(view.caseResults[0]?.caseId).toBe('case-a')
    expect(view.caseResults[0]?.matchedFindings).toEqual([
      { expectedIndex: 0, findingId: 'find_a' }
    ])
    expect(view.caseResults[0]?.expectedFindings[0]?.semanticSummary).toContain(
      'admin route'
    )
  })

  // The bound on the tolerance. An older report is a report; one missing the
  // fields recall is computed FROM is broken, and recall derived from it would be
  // wrong in the direction that flatters the engine — an expectation with no
  // matches recorded reads as a miss.
  test('refuses a payload missing the fields recall is computed from', () => {
    const { matchedFindings: _dropped, ...withoutMatches } =
      legacyCaseResultReport.caseResults[0]!

    expect(() =>
      parseEvalRecallView({
        ...legacyCaseResultReport,
        caseResults: [withoutMatches]
      })
    ).toThrow()
  })

  // Tolerance is for shape drift, not for a different artifact entirely.
  test('refuses something that is not an eval report', () => {
    expect(() => parseEvalRecallView({ hello: 'world' })).toThrow()
  })
})
