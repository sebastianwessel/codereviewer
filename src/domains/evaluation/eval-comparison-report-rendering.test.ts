import { describe, expect, test } from 'vitest'
import { renderEvalComparison } from './eval-comparison-report-rendering.js'
import type { EvalReport } from './eval-report-contracts.js'

// Minimal report shape carrying only the fields the comparability guards read.
// Both guards throw before touching anything else, so a fixture that
// fabricated a whole report would test rendering, not the refusal.
const reportWith = (
  overrides: {
    readonly metricsVersion?: string
    readonly answerKeyDigest?: string
    readonly answerKeyDigestByCase?: Readonly<Record<string, string>>
  } = {}
): EvalReport =>
  ({
    metricsVersion: overrides.metricsVersion ?? 'test-metrics-version',
    provenance: {
      answerKeyDigest: overrides.answerKeyDigest ?? 'test-answer-key-digest',
      answerKeyDigestByCase: overrides.answerKeyDigestByCase ?? {},
      configHash: 'test-config-hash'
    }
  }) as unknown as EvalReport

const reportWithProvenance = (
  answerKeyDigestByCase: Readonly<Record<string, string>>
): EvalReport => reportWith({ answerKeyDigestByCase })

describe('eval comparison report rendering module', () => {
  test('exports the focused comparison report renderer', () => {
    expect(typeof renderEvalComparison).toBe('function')
  })

  test('refuses to compare reports scored by different metrics versions', () => {
    expect(() =>
      renderEvalComparison({
        base: reportWith({ metricsVersion: 'v1' }),
        head: reportWith({ metricsVersion: 'v2' })
      })
    ).toThrow(/different rules/u)
  })

  // The scenario this exists to catch: two reports that computed metrics under
  // the SAME rules but whose SHARED cases were scored against different
  // expectations -- what happened when an archived run reported 78.8% recall
  // against a key that had since changed underneath it, with nothing in the
  // artifact revealing it.
  test('refuses when a case both runs scored has different expectations', () => {
    expect(() =>
      renderEvalComparison({
        base: reportWithProvenance({ 'case-a': 'digest-one' }),
        head: reportWithProvenance({ 'case-a': 'digest-two' })
      })
    ).toThrow(/different expectations/u)
  })

  // The guard must not block ordinary work. Comparing a filtered run against a
  // fuller one changes the aggregate digest, but the report already warns about
  // a differing selection further down, and refusing it outright would make the
  // guard blunt enough that someone would reasonably delete it.
  test('names the diverged cases rather than only reporting that something differs', () => {
    expect(() =>
      renderEvalComparison({
        base: reportWithProvenance({ 'case-a': 'one', 'case-b': 'two' }),
        head: reportWithProvenance({ 'case-a': 'one', 'case-b': 'changed' })
      })
    ).toThrow(/case-b/u)
  })
})
