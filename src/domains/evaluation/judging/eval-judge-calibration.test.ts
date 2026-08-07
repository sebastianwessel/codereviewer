import type { Logger } from '@purista/harness'
import { describe, expect, test } from 'vitest'
import type { EvalSemanticJudge } from './eval-matcher.js'
import {
  DEFAULT_MINIMUM_JUDGE_AGREEMENT,
  evalJudgeCalibrationSet,
  scoreJudgeCalibration,
  type EvalJudgeCalibrationPair
} from './eval-judge-calibration.js'

type CapturedWarning = {
  readonly message: string
  readonly fields?: Record<string, unknown>
}

const createWarningLogger = (): {
  readonly logger: Logger
  readonly warnings: CapturedWarning[]
} => {
  const warnings: CapturedWarning[] = []
  const logger: Logger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: (message, fields) => {
      warnings.push({
        message: String(message),
        ...(fields === undefined ? {} : { fields })
      })
    },
    error: () => {},
    fatal: () => {},
    child: () => logger
  }

  return { logger, warnings }
}

const pairFor = (
  input: Parameters<EvalSemanticJudge>[0]
): EvalJudgeCalibrationPair => {
  const pair = evalJudgeCalibrationSet.find(
    (candidate) =>
      candidate.expectedSummary === input.expectedSummary &&
      candidate.findingTitle === input.findingTitle
  )

  if (pair === undefined) {
    throw new Error(`Unknown calibration pair for "${input.expectedSummary}".`)
  }

  return pair
}

// Agrees with every human label.
const perfectJudge: EvalSemanticJudge = async (input) => ({
  match: pairFor(input).expectedMatch,
  reason: 'Matches the human label.'
})

// Correct on the obvious pairs, wrong on every near-miss: exactly the failure
// mode a vocabulary-overlap heuristic exhibits.
const nearMissFlippingJudge: EvalSemanticJudge = async (input) => {
  const pair = pairFor(input)

  return {
    match:
      pair.kind === 'near-miss' ? !pair.expectedMatch : pair.expectedMatch,
    reason: 'Decided from shared vocabulary.'
  }
}

describe('eval judge calibration', () => {
  test('covers clear matches, clear non-matches, and hard near-misses', () => {
    const kinds = new Set(evalJudgeCalibrationSet.map((pair) => pair.kind))

    expect(kinds).toEqual(
      new Set(['clear-match', 'clear-non-match', 'near-miss'])
    )
    expect(
      evalJudgeCalibrationSet.filter((pair) => pair.expectedMatch).length
    ).toBeGreaterThan(0)
    expect(
      evalJudgeCalibrationSet.filter((pair) => !pair.expectedMatch).length
    ).toBeGreaterThan(0)
    expect(new Set(evalJudgeCalibrationSet.map((pair) => pair.id)).size).toBe(
      evalJudgeCalibrationSet.length
    )
  })

  test('includes the observed near-miss pairs that broke lexical scoring', () => {
    expect(
      evalJudgeCalibrationSet.map((pair) => [
        pair.expectedSummary,
        pair.findingTitle,
        pair.expectedMatch
      ])
    ).toEqual(
      expect.arrayContaining([
        [
          'percentage discount subtracted as absolute amount',
          'Percentage discount computed as absolute subtraction',
          true
        ],
        [
          'SQL injection in the user query builder',
          'User query builder missing null check',
          false
        ],
        [
          'unbounded loop causes memory exhaustion',
          'Loop causes incorrect memory offset',
          false
        ]
      ])
    )
  })

  test('scores a fully agreeing judge as trustworthy', async () => {
    const result = await scoreJudgeCalibration({ judge: perfectJudge })

    expect(result.judgeAgreement).toBe(1)
    expect(result.judgeAgreementPairCount).toBe(evalJudgeCalibrationSet.length)
    expect(result.judgeTrustworthy).toBe(true)
  })

  test('marks a judge that flips near-misses as untrustworthy', async () => {
    const result = await scoreJudgeCalibration({
      judge: nearMissFlippingJudge
    })

    expect(result.judgeAgreement).toBeLessThan(DEFAULT_MINIMUM_JUDGE_AGREEMENT)
    expect(result.judgeTrustworthy).toBe(false)
  })

  test('honors a configured minimum agreement', async () => {
    const result = await scoreJudgeCalibration({
      judge: nearMissFlippingJudge,
      minimumAgreement: 0
    })

    expect(result.judgeTrustworthy).toBe(true)
  })

  test('excludes failed judge calls from the agreement denominator and logs them', async () => {
    const { logger, warnings } = createWarningLogger()
    let call = 0
    const result = await scoreJudgeCalibration({
      logger,
      judge: async (input) => {
        call += 1
        if (call === 1) {
          throw new Error('judge provider exploded')
        }

        return perfectJudge(input)
      }
    })

    expect(result.judgeAgreementPairCount).toBe(
      evalJudgeCalibrationSet.length - 1
    )
    expect(result.judgeAgreement).toBe(1)
    // Calibration has no per-case slot in the eval report, so the failure is
    // surfaced as a no-content warning instead of being silently dropped.
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.fields).toEqual({
      pair_id: evalJudgeCalibrationSet[0]!.id,
      stage: 'eval_semantic_judge',
      error_code: 'provider_error'
    })
  })

  test('never claims trustworthiness when no pair could be scored', async () => {
    const result = await scoreJudgeCalibration({
      judge: async () => {
        throw new Error('judge provider exploded')
      }
    })

    expect(result.judgeAgreement).toBeUndefined()
    expect(result.judgeAgreementPairCount).toBe(0)
    expect(result.judgeTrustworthy).toBe(false)
  })
})
