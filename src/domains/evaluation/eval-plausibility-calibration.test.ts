import type { Logger } from '@purista/harness'
import { describe, expect, test } from 'vitest'
import type { EvalPlausibilityJudge } from './eval-plausibility-judge.js'
import {
  DEFAULT_MINIMUM_PLAUSIBILITY_AGREEMENT,
  evalPlausibilityCalibrationSet,
  scorePlausibilityCalibration,
  type EvalPlausibilityCalibrationPair
} from './eval-plausibility-calibration.js'

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
  input: Parameters<EvalPlausibilityJudge>[0]
): EvalPlausibilityCalibrationPair => {
  const pair = evalPlausibilityCalibrationSet.find(
    (candidate) =>
      candidate.findingTitle === input.findingTitle &&
      candidate.findingDescription === input.findingDescription
  )

  if (pair === undefined) {
    throw new Error(`Unknown calibration pair for "${input.findingTitle}".`)
  }

  return pair
}

// Agrees with every human label.
const perfectJudge: EvalPlausibilityJudge = async (input) => ({
  plausible: pairFor(input).isGenuine,
  reason: 'Matches the human label.'
})

// Correct on the obvious pairs, wrong on every hard case: exactly the failure
// mode of a judge that cannot read subtle code and rubber-stamps or dismisses
// the ambiguous findings.
const hardCaseFlippingJudge: EvalPlausibilityJudge = async (input) => {
  const pair = pairFor(input)

  return {
    plausible: pair.kind === 'hard' ? !pair.isGenuine : pair.isGenuine,
    reason: 'Decided without reading the subtle code.'
  }
}

describe('eval plausibility calibration', () => {
  test('covers clear-genuine, clear-spurious, and hard cases', () => {
    const kinds = new Set(
      evalPlausibilityCalibrationSet.map((pair) => pair.kind)
    )

    expect(kinds).toEqual(new Set(['clear-genuine', 'clear-spurious', 'hard']))
    expect(
      evalPlausibilityCalibrationSet.filter((pair) => pair.isGenuine).length
    ).toBeGreaterThan(0)
    expect(
      evalPlausibilityCalibrationSet.filter((pair) => !pair.isGenuine).length
    ).toBeGreaterThan(0)
    expect(
      new Set(evalPlausibilityCalibrationSet.map((pair) => pair.id)).size
    ).toBe(evalPlausibilityCalibrationSet.length)
  })

  test('scores a fully agreeing judge as trustworthy', async () => {
    const result = await scorePlausibilityCalibration({ judge: perfectJudge })

    expect(result.plausibilityJudgeAgreement).toBe(1)
    expect(result.plausibilityJudgeAgreementPairCount).toBe(
      evalPlausibilityCalibrationSet.length
    )
    expect(result.plausibilityJudgeTrustworthy).toBe(true)
  })

  test('marks a judge that flips hard cases as untrustworthy', async () => {
    const result = await scorePlausibilityCalibration({
      judge: hardCaseFlippingJudge
    })

    expect(result.plausibilityJudgeAgreement).toBeLessThan(
      DEFAULT_MINIMUM_PLAUSIBILITY_AGREEMENT
    )
    expect(result.plausibilityJudgeTrustworthy).toBe(false)
  })

  test('honors a configured minimum agreement', async () => {
    const result = await scorePlausibilityCalibration({
      judge: hardCaseFlippingJudge,
      minimumAgreement: 0
    })

    expect(result.plausibilityJudgeTrustworthy).toBe(true)
  })

  test('excludes failed judge calls from the agreement denominator and logs them', async () => {
    const { logger, warnings } = createWarningLogger()
    let call = 0
    const result = await scorePlausibilityCalibration({
      logger,
      judge: async (input) => {
        call += 1
        if (call === 1) {
          throw new Error('plausibility provider exploded')
        }

        return perfectJudge(input)
      }
    })

    expect(result.plausibilityJudgeAgreementPairCount).toBe(
      evalPlausibilityCalibrationSet.length - 1
    )
    expect(result.plausibilityJudgeAgreement).toBe(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.fields).toEqual({
      pair_id: evalPlausibilityCalibrationSet[0]!.id,
      stage: 'eval_plausibility_judge',
      error_code: 'provider_error'
    })
  })

  test('never claims trustworthiness when no pair could be scored', async () => {
    const result = await scorePlausibilityCalibration({
      judge: async () => {
        throw new Error('plausibility provider exploded')
      }
    })

    expect(result.plausibilityJudgeAgreement).toBeUndefined()
    expect(result.plausibilityJudgeAgreementPairCount).toBe(0)
    expect(result.plausibilityJudgeTrustworthy).toBe(false)
  })
})
