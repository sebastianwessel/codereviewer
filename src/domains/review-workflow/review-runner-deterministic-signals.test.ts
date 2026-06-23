import { describe, expect, test } from 'vitest'
import { prepareReviewRunnerDeterministicSignals } from './review-runner-deterministic-signals.js'

describe('review runner deterministic signal preparation', () => {
  test('extracts parsed evidence and safe metrics for source files', () => {
    const result = prepareReviewRunnerDeterministicSignals([
      {
        path: 'src/app.ts',
        content: 'export const value = 1\n'
      }
    ])

    expect(result.analysis.facts.length).toBeGreaterThan(0)
    expect(result.evidence.length).toBe(result.analysis.evidence.length)
    expect(
      result.evidence
        .filter((record) => record.location !== undefined)
        .every((record) => record.location?.path === 'src/app.ts')
    ).toBe(true)
    expect(result.metrics).toEqual({
      factCount: result.analysis.facts.length,
      evidenceCount: result.evidence.length,
      languageCount: 1,
      testMappingCount: result.testMappings.length,
      structuralEngine: 'typescript-compiler+ast-grep',
      astGrepVersion: expect.stringMatching(/^ast-grep@/)
    })
    expect(result.startAttributes).toEqual({
      structuralEngine: 'typescript-compiler+ast-grep',
      astGrepVersion: result.metrics.astGrepVersion,
      fileCount: 1
    })
  })
})
