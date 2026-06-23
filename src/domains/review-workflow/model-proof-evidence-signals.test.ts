import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../shared/contracts/index.js'
import { proofEvidenceSignalsFor } from './model-proof-evidence-signals.js'

const evidence = (
  input: {
    readonly id: string
    readonly kind?: EvidenceRecord['kind']
    readonly source: string
    readonly summary: string
    readonly ruleId?: string
  }
): EvidenceRecord => ({
  id: input.id,
  kind: input.kind ?? 'diagnostic',
  source: input.source,
  summary: input.summary,
  ...(input.ruleId === undefined ? {} : { ruleId: input.ruleId }),
  redactionApplied: true
})

describe('model proof evidence signals', () => {
  test('classifies external static-analysis duplicate evidence', () => {
    expect(
      proofEvidenceSignalsFor([
        evidence({
          id: 'ev_codeql1',
          source: 'codeql',
          ruleId: 'js/sql-injection',
          summary: 'CodeQL already reports this changed sink.'
        })
      ])
    ).toEqual({
      staticAnalysisDuplicate: true,
      deterministicContradiction: false
    })

    expect(
      proofEvidenceSignalsFor([
        evidence({
          id: 'ev_linter1',
          source: 'eslint',
          summary: 'static-analysis-duplicate from linter output.'
        })
      ]).staticAnalysisDuplicate
    ).toBe(true)
  })

  test('classifies deterministic contradiction evidence', () => {
    expect(
      proofEvidenceSignalsFor([
        evidence({
          id: 'ev_contradiction1',
          source: 'deterministic-signal',
          summary: 'Deterministic-contradiction: guard prevents this path.'
        })
      ])
    ).toEqual({
      staticAnalysisDuplicate: false,
      deterministicContradiction: true
    })
  })

  test('ignores unrelated evidence text', () => {
    expect(
      proofEvidenceSignalsFor([
        evidence({
          id: 'ev_context1',
          kind: 'file',
          source: 'context',
          summary: 'The file contains the reviewed branch.'
        })
      ])
    ).toEqual({
      staticAnalysisDuplicate: false,
      deterministicContradiction: false
    })
  })
})
