// Spec 23's Second Amendment: a real address is not automatically evidence.
//
// The failure this closes, measured 2026-07-31: a planted behavioural obligation
// ("make runs that request the withdrawn kind by name fail intake with exit code
// 2") was reported ADDRESSED on two REMOVED lines — an enum member and a
// comparison against it — from a commit that removes the kind and adds no intake
// check. Every structural guard passed, because both citations were real lines the
// change really touched. The address was valid and attached to the wrong claim.
//
// The tests below cover the fix AND the two ways it could do more harm than good:
// by downgrading verdicts it merely dislikes, and by suppressing on uncertainty.

import { describe, expect, test } from 'vitest'
import { toJSONSchema, z } from 'zod'
import {
  ModelCitationAptnessSchema,
  applyCitationAptness,
  citationAptnessInputFor,
  normalizeCitationAptness
} from './aptness.js'
import type { VerifiedJudgement } from './judgement.js'

const addressed: VerifiedJudgement = {
  status: 'addressed',
  evidence: [
    {
      path: 'src/domains/review-workflow/pipeline/agent-contracts.ts',
      line: 49,
      side: 'removed',
      text: "'guarded-region'"
    }
  ]
}

describe('normalizeCitationAptness', () => {
  test.each([
    ['apt', 'apt'],
    ['Apt.', 'apt'],
    ['INAPT', 'inapt'],
    ['inapt', 'inapt'],
    ['undetermined', 'undetermined']
  ])('resolves %j to %j', (value, expected) => {
    expect(normalizeCitationAptness({ verdict: value })).toBe(expected)
  })

  test.each([
    [{ verdict: 'probably fine' }],
    [{ verdict: '' }],
    [{}],
    [undefined],
    [{ verdict: 'apt', reason: 'because' }]
  ])('resolves the unusable answer %j to undetermined', (value) => {
    // Undetermined LEAVES THE VERDICT STANDING, so an unusable answer here cannot
    // suppress a possibly-correct `addressed`. That direction is the point.
    expect(normalizeCitationAptness(value)).toBe('undetermined')
  })
})

describe('applyCitationAptness', () => {
  test('downgrades an addressed verdict whose citations are inapt', () => {
    expect(applyCitationAptness(addressed, 'inapt')).toEqual({
      judgement: { status: 'undetermined' },
      downgraded: true
    })
  })

  test('downgrades to undetermined, never to unaddressed', () => {
    // Inapt evidence is not evidence that NOTHING addresses the obligation. That
    // would be a second claim built on the failure of the first.
    const outcome = applyCitationAptness(addressed, 'inapt')

    expect(outcome.judgement.status).not.toBe('unaddressed')
  })

  test.each([['apt'], ['undetermined']] as const)(
    'leaves the verdict untouched on %j',
    (aptness) => {
      expect(applyCitationAptness(addressed, aptness)).toEqual({
        judgement: addressed,
        downgraded: false
      })
    }
  )

  test.each([['unaddressed'], ['undetermined']] as const)(
    'cannot alter a %j verdict, whatever the aptness answer',
    (status) => {
      const judgement = { status } as VerifiedJudgement

      for (const aptness of ['apt', 'inapt', 'undetermined'] as const) {
        expect(applyCitationAptness(judgement, aptness).judgement).toEqual(
          judgement
        )
      }
    }
  )

  test('can never make a claim stronger', () => {
    // The whole safety argument: this stage is monotonic downward. No aptness
    // answer turns anything INTO addressed.
    for (const status of ['unaddressed', 'undetermined'] as const) {
      for (const aptness of ['apt', 'inapt', 'undetermined'] as const) {
        expect(
          applyCitationAptness({ status } as VerifiedJudgement, aptness).judgement
            .status
        ).not.toBe('addressed')
      }
    }
  })
})

describe('citationAptnessInputFor', () => {
  test('carries the side, so the check can reason about a deletion', () => {
    // Without the side the check cannot tell "this deleted the definition" from
    // "this added the behaviour", which is the distinction it exists to make.
    expect(
      citationAptnessInputFor('Make intake reject the kind.', addressed.evidence)
    ).toEqual({
      obligation: 'Make intake reject the kind.',
      citedLines: [
        {
          path: 'src/domains/review-workflow/pipeline/agent-contracts.ts',
          line: 49,
          side: 'removed',
          text: "'guarded-region'"
        }
      ]
    })
  })
})

describe('aptness output schema', () => {
  const stringFieldPaths = (value: unknown, prefix = ''): readonly string[] => {
    const node =
      typeof value === 'object' && value !== null
        ? (value as { type?: unknown; properties?: Record<string, unknown> })
        : {}

    if (node.type === 'string') {
      return [prefix]
    }

    return Object.entries(node.properties ?? {}).flatMap(([key, child]) =>
      stringFieldPaths(child, prefix === '' ? key : `${prefix}.${key}`)
    )
  }

  test('carries no string field other than the verdict enum', () => {
    // Same requirement as the judgement schema, for the same measured reason: a
    // model justifying a verdict in the same breath as reaching it takes spurious
    // rejection from 26-36% to 73-88%. A `reason` here would reintroduce it.
    expect(
      [...stringFieldPaths(toJSONSchema(ModelCitationAptnessSchema))].sort()
    ).toEqual(['verdict'])
  })

  test('the walker can actually fail, so the assertion above is not vacuous', () => {
    expect(
      [
        ...stringFieldPaths(
          toJSONSchema(ModelCitationAptnessSchema.extend({ reason: z.string() }))
        )
      ].sort()
    ).toEqual(['reason', 'verdict'])
  })
})
