import { describe, expect, test } from 'vitest'
import { buildIntentEvalReport } from './intent-eval-report.js'
import { renderIntentEvalSummary } from './intent-eval-rendering.js'
import {
  SPEC_DENOMINATOR_NOT_MEASURABLE,
  type IntentScore
} from './intent-eval-scoring.js'

const arm = (
  overrides: Partial<IntentScore['arms']['prewritten']> = {}
): IntentScore['arms']['prewritten'] => ({
  arm: 'prewritten',
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
      reason: SPEC_DENOMINATOR_NOT_MEASURABLE
    }
  },
  obligationCount: 4,
  anchoredObligationCount: 3,
  unanchoredObligationCount: 1,
  notContradictedCount: 1,
  notContradictedClearingOutstandingCount: 1,
  humanObligationCount: 6,
  ...overrides
})

const render = (input: {
  readonly score: IntentScore
  readonly modelName?: string
}): string =>
  renderIntentEvalSummary(
    buildIntentEvalReport({
      score: input.score,
      generatedAt: new Date('2026-08-12T09:00:00.000Z'),
      datasetId: 'intent-fulfilment-prewritten',
      selection: {
        manifestPath: 'eval/corpora/intent-fulfilment/manifest.json',
        caseRoot: '.codereviewer/eval/intent-cases/intent-fulfilment',
        caseFilters: [],
        selectedCaseIds: ['pw01-example']
      },
      engine: { commit: 'a'.repeat(40) },
      provenance: {
        answerKeyDigest: 'digest',
        answerKeyDigestByCase: {},
        configHash: 'config',
        ...(input.modelName === undefined
          ? {}
          : { providerId: 'openai', modelName: input.modelName })
      },
      warnings: []
    })
  )

const score = (
  overrides: Partial<IntentScore> = {}
): IntentScore => ({
  coverage: {
    totalCaseCount: 1,
    scoredCaseCount: 1,
    refusedCaseCount: 0,
    unmeasuredCaseCount: 0,
    totalExpectationCount: 3,
    scoredExpectationCount: 3
  },
  arms: {
    prewritten: arm(),
    posthoc: arm({
      arm: 'posthoc',
      scoredCaseCount: 0,
      expectationCount: 0,
      outstandingRecall: { status: 'not-measured', reason: 'No case scored.' }
    })
  },
  caseScores: [
    {
      caseId: 'pw01-example',
      arm: 'prewritten',
      status: 'scored',
      obligationCount: 4,
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
          clearedBy: ['not-contradicted']
        }
      ]
    }
  ],
  warnings: [],
  ...overrides
})

describe('intent eval summary', () => {
  // The rate spec 23 defines is permanently not measurable here, and a bare
  // percentage beside it would be quoted as if it were that rate.
  test('never prints a percentage for the not-measurable rate', () => {
    const summary = render({ score: score() })

    expect(summary).toContain('as spec 23 defines the rate')
    expect(summary).toContain('not measured')
    expect(summary).toContain(
      'The numerator (`claimCount`) is exactly what spec 23 asks for'
    )
  })

  // Each false-satisfied claim is listed rather than counted: the count is the
  // number the capability is judged on, and a reader has to be able to check each
  // one against the diff.
  test('names every false-satisfied claim and what cleared it', () => {
    const summary = render({ score: score() })

    expect(summary).toContain('the three arms are never run')
    expect(summary).toContain('not-contradicted')
  })

  test('says so plainly when nothing was cleared', () => {
    const summary = render({
      score: score({
        caseScores: [
          {
            caseId: 'pw01-example',
            arm: 'prewritten',
            status: 'scored',
            obligationCount: 4,
            anchoredObligationCount: 3,
            notContradictedCount: 1,
            expectations: []
          }
        ]
      })
    })

    expect(summary).toContain(
      'No enumerated outstanding obligation was reported off the list.'
    )
  })

  // A rate is a property of a model. This repository has already had to void
  // figures that could not name one.
  test('refuses to let an unrecorded model pass silently', () => {
    expect(render({ score: score() })).toContain(
      'a rate is a property of a model'
    )
    expect(render({ score: score(), modelName: 'gpt-5.3-codex' })).toContain(
      'openai/gpt-5.3-codex'
    )
  })

  test('renders a refused case as a refusal rather than a zero', () => {
    const summary = render({
      score: score({
        coverage: {
          totalCaseCount: 2,
          scoredCaseCount: 1,
          refusedCaseCount: 1,
          unmeasuredCaseCount: 0,
          totalExpectationCount: 6,
          scoredExpectationCount: 3
        },
        caseScores: [
          ...score().caseScores,
          {
            caseId: 'pw02-example',
            arm: 'prewritten',
            status: 'refused',
            code: 'intent_too_many_obligations',
            detail: 'the extraction yielded at least 40 obligations',
            expectationCount: 3
          }
        ]
      })
    })

    expect(summary).toContain('refused (intent_too_many_obligations)')
    expect(summary).toContain('A refused case is **not** a case with zero obligations.')
  })

  test('prints nothing for an arm no case scored', () => {
    expect(render({ score: score() })).toContain(
      'No case in this arm was scored, so every figure below would be over an empty denominator'
    )
  })
})
