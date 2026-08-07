import { describe, expect, test } from 'vitest'
import { computeAnswerKeyDigest } from './eval-report-provenance.js'
import type { EvalCase } from '../corpus/eval-fixture.schema.js'

const evalCase = (overrides: Partial<EvalCase> = {}): EvalCase => ({
  id: 'case-a',
  language: 'typescript',
  repositoryFixture: 'fixtures/typescript/simple',
  changedFiles: ['src/app.ts'],
  expectedFindings: [
    {
      category: 'bug',
      severity: 'high',
      path: 'src/app.ts',
      lineRange: [10, 12],
      semanticSummary: 'incorrect return value from changed branch'
    }
  ],
  expectedNoFindingZones: [],
  tags: ['unit'],
  ...overrides
})

describe('computeAnswerKeyDigest', () => {
  test('is deterministic for identical case sets', () => {
    const cases = [evalCase()]

    expect(computeAnswerKeyDigest(cases)).toBe(computeAnswerKeyDigest(cases))
  })

  // Order-insensitivity requirement: which case a caller happened to select
  // or list first (a different `--case` flag order, a differently-ordered
  // slice directory read) carries no meaning about WHAT was scored, so it must
  // not be able to produce a different digest for the identical answer key.
  test('is insensitive to the order cases are supplied in', () => {
    const first = evalCase({ id: 'case-a' })
    const second = evalCase({
      id: 'case-b',
      expectedFindings: [
        {
          category: 'security',
          severity: 'critical',
          path: 'src/auth.ts',
          semanticSummary: 'missing authorization check',
          matchMode: 'path-semantic'
        }
      ]
    })

    expect(computeAnswerKeyDigest([first, second])).toBe(
      computeAnswerKeyDigest([second, first])
    )
  })

  // The complementary requirement: expectedIndex is part of the matching
  // contract (assignment prefers the lowest available index), so reordering
  // expectations WITHIN one case is a real content change, not cosmetic
  // reshuffling, and the digest must catch it.
  test('is sensitive to the order of expected findings within a case', () => {
    const findingA = {
      category: 'bug' as const,
      severity: 'high' as const,
      path: 'src/app.ts',
      lineRange: [10, 12] as [number, number],
      semanticSummary: 'first defect'
    }
    const findingB = {
      category: 'bug' as const,
      severity: 'medium' as const,
      path: 'src/app.ts',
      lineRange: [40, 42] as [number, number],
      semanticSummary: 'second defect'
    }

    const forward = evalCase({ expectedFindings: [findingA, findingB] })
    const reversed = evalCase({ expectedFindings: [findingB, findingA] })

    expect(computeAnswerKeyDigest([forward])).not.toBe(
      computeAnswerKeyDigest([reversed])
    )
  })

  // This is the exact regression the digest exists to catch: an archived run
  // reported 78.8% recall after its answer key had since changed underneath
  // it, and nothing in the artifact revealed that. A change to declared
  // severity, path, line range, or the semantic summary must move the digest.
  test('changes when expected-finding content changes (the stale answer-key regression)', () => {
    const original = [evalCase()]
    const mutatedSeverity = [
      evalCase({
        expectedFindings: [
          {
            ...evalCase().expectedFindings[0]!,
            severity: 'critical'
          }
        ]
      })
    ]
    const mutatedLineRange = [
      evalCase({
        expectedFindings: [
          {
            ...evalCase().expectedFindings[0]!,
            lineRange: [1, 2]
          }
        ]
      })
    ]

    const baseline = computeAnswerKeyDigest(original)
    expect(computeAnswerKeyDigest(mutatedSeverity)).not.toBe(baseline)
    expect(computeAnswerKeyDigest(mutatedLineRange)).not.toBe(baseline)
  })

  // Scope decision: the digest covers expected-finding CONTENT only. Case
  // metadata that does not change what recall/precision are scored against --
  // tags, no-finding zones, the changed-file list -- must not move the digest,
  // or routine fixture housekeeping would produce spurious "answer key
  // changed" refusals unrelated to the incident this guards against.
  test('is unaffected by case metadata outside expected-finding content', () => {
    const baseline = computeAnswerKeyDigest([evalCase()])
    const widerZone = computeAnswerKeyDigest([
      evalCase({
        expectedNoFindingZones: [
          { path: 'src/other.ts', reason: 'formatting only' }
        ],
        tags: ['unit', 'extra-tag'],
        changedFiles: ['src/app.ts', 'src/other.ts']
      })
    ])

    expect(widerZone).toBe(baseline)
  })
})
