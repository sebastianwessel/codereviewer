import { describe, expect, test } from 'vitest'
import { ObligationStatusSchema } from '../../intent-fulfilment/index.js'
import { intentArms } from './intent-corpus.schema.js'
import {
  buildIntentEvalReport,
  parseIntentEvalReport,
  INTENT_EVAL_ARTIFACT_ROOT,
  INTENT_EVAL_REPORT_ARTIFACT_NAME
} from './intent-eval-report.js'
import { INTENT_METRICS_VERSION } from './intent-metrics-versions.js'
import { OUTSTANDING_LIST_PLACEMENT, type IntentScore } from './intent-eval-scoring.js'

const armMetrics = (arm: 'prewritten' | 'posthoc'): IntentScore['arms']['prewritten'] => ({
  arm,
  scoredCaseCount: 1,
  expectationCount: 3,
  outstandingRecall: { status: 'measured', matched: 1, total: 3, rate: 1 / 3 },
  falseSatisfied: {
    claimCount: 2,
    viaEvidenced: 1,
    viaNotContradicted: 1,
    rateOverReached: { status: 'measured', matched: 2, total: 3, rate: 2 / 3 },
    rateOverAllSatisfiedClaims: {
      status: 'not-measured',
      reason: 'The denominator is not available on this corpus.'
    }
  },
  obligationCount: 3,
  anchoredObligationCount: 3,
  unanchoredObligationCount: 0,
  notContradictedCount: 1,
  notContradictedClearingOutstandingCount: 1,
  humanObligationCount: 6
})

const score: IntentScore = {
  coverage: {
    totalCaseCount: 2,
    scoredCaseCount: 1,
    refusedCaseCount: 1,
    unmeasuredCaseCount: 0,
    totalExpectationCount: 6,
    scoredExpectationCount: 3
  },
  arms: { prewritten: armMetrics('prewritten'), posthoc: armMetrics('posthoc') },
  caseScores: [
    {
      caseId: 'pw01-example',
      arm: 'prewritten',
      status: 'scored',
      obligationCount: 3,
      anchoredObligationCount: 3,
      notContradictedCount: 1,
      expectations: [
        {
          caseId: 'pw01-example',
          arm: 'prewritten',
          expectationId: 'out-1',
          statement: 'the three arms are never run',
          outcome: 'false-satisfied',
          candidateObligationIds: ['obl_1'],
          clearedBy: ['evidenced']
        }
      ]
    },
    {
      caseId: 'pw02-example',
      arm: 'prewritten',
      status: 'refused',
      code: 'intent_too_many_obligations',
      detail: 'the extraction yielded at least 40 obligations',
      expectationCount: 3
    }
  ],
  warnings: ['prewritten: no obligation came back not-contradicted.']
}

const build = () =>
  buildIntentEvalReport({
    score,
    generatedAt: new Date('2026-08-12T09:00:00.000Z'),
    datasetId: 'intent-fulfilment-prewritten',
    selection: {
      manifestPath: 'eval/corpora/intent-fulfilment/manifest.json',
      caseRoot: '.codereviewer/eval/intent-cases/intent-fulfilment',
      caseFilters: [],
      selectedCaseIds: ['pw01-example', 'pw02-example']
    },
    engine: { commit: 'a'.repeat(40), workingTreeClean: true },
    provenance: {
      answerKeyDigest: 'digest',
      answerKeyDigestByCase: { 'pw01-example': 'digest-1' },
      configHash: 'config',
      providerId: 'openai',
      modelName: 'gpt-5.3-codex'
    },
    warnings: ['a configuration note']
  })

describe('intent eval report', () => {
  test('carries the anti-pooling report kind and its own metrics version', () => {
    const report = build()

    expect(report.reportKind).toBe('intent-fulfilment-obligations')
    expect(report.metricsVersion).toBe(INTENT_METRICS_VERSION)
    expect(INTENT_EVAL_ARTIFACT_ROOT).toBe('.codereviewer/eval/intent-fulfilment')
    expect(INTENT_EVAL_REPORT_ARTIFACT_NAME).toBe('intent-eval-report.json')
  })

  // The scorer's warnings are the conditions that make a figure unreadable, so a
  // reader who stops after the first line has to see those rather than a
  // configuration note.
  test('puts the scorer warnings ahead of the command warnings', () => {
    expect(build().warnings).toEqual([
      'prewritten: no obligation came back not-contradicted.',
      'a configuration note'
    ])
  })

  test('round-trips through its own parser', () => {
    const report = build()

    expect(parseIntentEvalReport(JSON.parse(JSON.stringify(report)))).toEqual(
      report
    )
  })

  // TWO ARMS AND NO POOLED TOTAL: a blended figure must not be reachable from the
  // artefact, so there is no field for one to be quoted out of.
  test('exposes exactly the two arms and no total', () => {
    expect(Object.keys(build().arms).sort()).toEqual([...intentArms].sort())
  })

  // A `reportKind` literal is only an anti-pooling device while nothing else
  // writes it, and only useful while a foreign report fails to parse as this one.
  test('refuses a report carrying another corpus kind', () => {
    expect(() =>
      parseIntentEvalReport({
        ...build(),
        reportKind: 'change-impact-dependents'
      })
    ).toThrow()
  })

  // The scorer's verdict table and the engine's status enum must stay the same
  // set. A fifth verdict added to the engine has to be a decision here, and this
  // is the assertion that forces one.
  test('the verdict table covers exactly the statuses the engine may emit', () => {
    expect(Object.keys(OUTSTANDING_LIST_PLACEMENT).sort()).toEqual(
      [...ObligationStatusSchema.options].sort()
    )
  })
})
