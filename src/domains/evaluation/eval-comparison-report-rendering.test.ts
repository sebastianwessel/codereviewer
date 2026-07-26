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
  } = {}
): EvalReport =>
  ({
    metricsVersion: overrides.metricsVersion ?? 'test-metrics-version',
    provenance: {
      answerKeyDigest: overrides.answerKeyDigest ?? 'test-answer-key-digest',
      configHash: 'test-config-hash'
    }
  }) as unknown as EvalReport

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

  // The scenario item 3 exists to catch: two reports that computed metrics
  // under the SAME rules (same metricsVersion) but were scored against
  // DIFFERENT answer keys -- exactly what happened when an archived run
  // reported 78.8% recall against a key that had since changed underneath it,
  // with nothing in the artifact revealing it.
  test('refuses to compare reports scored against different answer keys', () => {
    expect(() =>
      renderEvalComparison({
        base: reportWith({ answerKeyDigest: 'answer-key-a' }),
        head: reportWith({ answerKeyDigest: 'answer-key-b' })
      })
    ).toThrow(/different answer keys/u)
  })

})
