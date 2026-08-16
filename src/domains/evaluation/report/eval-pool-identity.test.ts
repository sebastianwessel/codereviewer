import { describe, expect, test } from 'vitest'
import {
  judgeIdentityOf,
  poolIdentityRefusals,
  poolIdentityWarnings,
  POOL_IDENTITY_UNRECORDED,
  type PoolCandidate
} from './eval-pool-identity.js'

const stated = (overrides: Partial<PoolCandidate> = {}): PoolCandidate => ({
  metricsVersion: '2026-08-07.open-redirect-mechanism',
  provenance: {
    answerKeyDigest: 'a'.repeat(64),
    modelName: 'openai/gpt-5.3-codex',
    judgeModelName: 'openai/gpt-5.3-codex'
  },
  ...overrides
})

describe('pooling several finished runs', () => {
  // A POOL OF ONE IS NOT A POOL. The whole tolerance argument rests on this:
  // reading one archive is unaffected, whatever it does or does not record.
  test('never refuses a single report, however little it states', () => {
    expect(poolIdentityRefusals([{ label: 'archive.json' }])).toEqual([])
    expect(poolIdentityWarnings([{ label: 'archive.json' }])).toEqual([])
  })

  test('pools runs that agree on every identity', () => {
    expect(poolIdentityRefusals([stated(), stated()])).toEqual([])
    expect(poolIdentityWarnings([stated(), stated()])).toEqual([])
  })

  test('refuses runs scored by different rules', () => {
    expect(
      poolIdentityRefusals([
        stated({ label: 'a.json', metricsVersion: 'v1' }),
        stated({ label: 'b.json', metricsVersion: 'v2' })
      ])
    ).toEqual([
      'Refusing to pool evaluation runs scored by different rules: metrics versions v1 (a.json), v2 (b.json).'
    ])
  })

  test('refuses runs scored against different answer keys', () => {
    const refusals = poolIdentityRefusals([
      stated({ provenance: { answerKeyDigest: 'answer-key-a' } }),
      stated({ provenance: { answerKeyDigest: 'answer-key-b' } })
    ])

    expect(refusals.join(' ')).toContain('different answer keys')
  })

  test('refuses runs scored by different judges', () => {
    const refusals = poolIdentityRefusals([
      stated({
        label: 'a.json',
        provenance: { answerKeyDigest: 'k', judgeModelName: 'judge-one' }
      }),
      stated({
        label: 'b.json',
        provenance: { answerKeyDigest: 'k', judgeModelName: 'judge-two' }
      })
    ])

    expect(refusals).toEqual([
      'Refusing to pool evaluation runs scored by different judges: judge models judge-one (a.json), judge-two (b.json).'
    ])
  })

  // Every dimension is reported, not just the first one to fail. A reader who
  // fixes the metrics-version mismatch should not then discover the answer key
  // moved too.
  test('names every dimension that disagrees', () => {
    expect(
      poolIdentityRefusals([
        stated({ metricsVersion: 'v1', provenance: { answerKeyDigest: 'k1' } }),
        stated({ metricsVersion: 'v2', provenance: { answerKeyDigest: 'k2' } })
      ])
    ).toHaveLength(2)
  })
})

// THE CASE THAT ACTUALLY MATTERS. 121 of the 516 eval reports on disk in this
// repository carry neither `metricsVersion` nor `provenance` — they predate both
// fields. Requiring either would re-break archive reading, which is the failure
// `eval-recall-view.ts` exists to end; treating absence as "matches anything"
// would let a silent archive pool with every report ever written.
describe('a report that cannot state its identity', () => {
  test('refuses to pool with a report that can', () => {
    const refusals = poolIdentityRefusals([
      stated({ label: 'today.json' }),
      { label: 'archive.json' }
    ])

    expect(refusals.join(' ')).toContain(POOL_IDENTITY_UNRECORDED)
    expect(refusals.join(' ')).toContain('archive.json')
    expect(refusals).toHaveLength(3)
  })

  // Deliberately permissive, and therefore deliberately loud: `unrecorded`
  // equals `unrecorded` because it is the same absence, not because anything was
  // checked.
  test('pools with another that cannot, and says so on every dimension', () => {
    const archives = [{ label: 'one.json' }, { label: 'two.json' }]

    expect(poolIdentityRefusals(archives)).toEqual([])
    expect(poolIdentityWarnings(archives)).toHaveLength(3)
    expect(poolIdentityWarnings(archives).join(' ')).toContain(
      'never that they agree'
    )
  })

  // The warning is about a shared silence, so one report stating the value ends
  // it — that pool was refused, not warned about.
  test('is not warned about when some report states the value', () => {
    expect(
      poolIdentityWarnings([stated(), stated({ metricsVersion: undefined })])
    ).toEqual([])
  })
})

describe('the judge a report was scored by', () => {
  test('is the pinned judge model when the report names one', () => {
    expect(
      judgeIdentityOf({ modelName: 'reviewer', judgeModelName: 'judge' })
    ).toBe('judge')
  })

  // A report written before `evaluation.judgeModel` became pinnable records no
  // judge, and on those runs the judge WAS the reviewer's model. Falling back to
  // `unrecorded` instead would refuse two archived reports against each other for
  // a difference that does not exist.
  test('falls back to the reviewer model, not to unrecorded', () => {
    expect(judgeIdentityOf({ modelName: 'reviewer' })).toBe('reviewer')
    expect(judgeIdentityOf(undefined)).toBe(POOL_IDENTITY_UNRECORDED)
  })
})
