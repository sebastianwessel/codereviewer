// The model boundary: what an answer has to be before it can become a finding.
//
// Two properties are guarded here because both are one careless edit away from
// silently disappearing:
//
//   THE OUTPUT SCHEMA HAS NO FREE-TEXT FIELD. Spec 22's consequence sentence is
//   composed in code; asking the judging call for it reproduces the mechanism this
//   repository has already measured (spurious rejection 26-36%, rising to 73-88%
//   when the same call also explains itself).
//
//   AN UNUSABLE ANSWER RESOLVES TO `undetermined`, NEVER TO `does-not-rely`.
//   `undetermined` is counted and reported nowhere; `does-not-rely` is a second
//   claim — that this dependent is unaffected — and making it on the strength of an
//   answer that did not parse is exactly the silent-optimism failure this codebase
//   keeps finding.

import { describe, expect, test } from 'vitest'
import {
  ModelRelianceJudgementSchema,
  normalizeRelianceJudgement,
  relianceJudgementInputFor,
  verifyRelianceJudgement
} from './reliance-judgement.js'

describe('the model-bound answer schema', () => {
  test('carries a verdict and a line, and nowhere to write prose', () => {
    expect(Object.keys(ModelRelianceJudgementSchema.shape)).toEqual([
      'relies',
      'line'
    ])
    for (const forbidden of [
      'reason',
      'rationale',
      'explanation',
      'note',
      'summary',
      'consequence',
      'severity'
    ]) {
      expect(Object.keys(ModelRelianceJudgementSchema.shape)).not.toContain(
        forbidden
      )
    }
  })

  test('is loose where a model answers in words', () => {
    // A strict enum here turns "Yes, it relies." into a provider-side validation
    // error and loses the answer entirely. Loose at the boundary, authoritative in
    // the normalizer — the same division the refutation results use, for the same
    // measured reason.
    expect(
      ModelRelianceJudgementSchema.safeParse({ relies: 'anything at all' })
        .success
    ).toBe(true)
  })
})

describe('normalizing an answer', () => {
  test('accepts the three answers regardless of case and punctuation', () => {
    expect(
      normalizeRelianceJudgement({ relies: 'Relies.', line: 12 })
    ).toEqual({ status: 'relies', line: 12 })
    expect(normalizeRelianceJudgement({ relies: 'DOES-NOT-RELY' })).toEqual({
      status: 'does-not-rely'
    })
    expect(normalizeRelianceJudgement({ relies: 'undetermined' })).toEqual({
      status: 'undetermined'
    })
  })

  test('a relies answer with no line is undetermined, not a finding', () => {
    // Spec 22 requires a finding to carry the dependent's path AND line, so a
    // "yes" that points nowhere cannot become one.
    expect(normalizeRelianceJudgement({ relies: 'relies' })).toEqual({
      status: 'undetermined'
    })
    expect(normalizeRelianceJudgement({ relies: 'relies', line: 0 })).toEqual({
      status: 'undetermined'
    })
  })

  test('anything unusable is undetermined rather than does-not-rely', () => {
    for (const value of [
      undefined,
      null,
      {},
      { relies: 'probably' },
      { relies: 42 }
    ]) {
      expect(normalizeRelianceJudgement(value).status).toBe('undetermined')
    }
  })
})

describe('verifying a located line', () => {
  const sites = [{ line: 7 }, { line: 19 }]

  test('keeps a reliance on a line the search located', () => {
    expect(
      verifyRelianceJudgement({ status: 'relies', line: 19 }, sites)
    ).toEqual({ status: 'relies', line: 19 })
  })

  test('discards a line the search never located', () => {
    expect(
      verifyRelianceJudgement({ status: 'relies', line: 400 }, sites)
    ).toEqual({ status: 'undetermined' })
  })

  test('leaves the other two answers alone', () => {
    expect(
      verifyRelianceJudgement({ status: 'does-not-rely' }, sites)
    ).toEqual({ status: 'does-not-rely' })
  })
})

describe('the packet', () => {
  test('leads with the changed symbol so consecutive calls share a prefix', () => {
    // FIELD ORDER IS LOAD-BEARING. The symbol half is identical for every dependent
    // of that symbol; putting the per-dependent half first would cut the shared
    // prefix and buy a guaranteed cache miss on every call.
    const packet = relianceJudgementInputFor({
      symbolName: 'fetchUser',
      contractChanges: ['may now fail where it previously did not'],
      dependentPath: 'src/caller.ts',
      sites: [{ line: 7, text: 'fetchUser()' }]
    })

    expect(Object.keys(packet)).toEqual(['changedSymbol', 'dependent'])
    expect(packet.dependent.sites).toEqual([{ line: 7, text: 'fetchUser()' }])
  })
})
