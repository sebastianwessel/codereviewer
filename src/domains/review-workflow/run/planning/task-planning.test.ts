import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../../../shared/contracts/index.js'
import { prepareReviewRunnerDeterministicSignals } from '../intake/deterministic-signals.js'
import { prepareReviewRunnerTaskPlanning } from './task-planning.js'

describe('review runner task planning', () => {
  test('plans review tasks and reports safe metrics', () => {
    const sourceFiles = [
      {
        path: 'src/app.ts',
        content: 'export const value = 1\n'
      }
    ]
    const deterministicSignals =
      prepareReviewRunnerDeterministicSignals(sourceFiles)
    const config = CodeReviewerConfigSchema.parse({
      review: { depth: 'balanced' }
    })

    const result = prepareReviewRunnerTaskPlanning({
      depth: config.review.depth,
      files: sourceFiles,
      facts: deterministicSignals.analysis.facts,
      evidence: deterministicSignals.evidence
    })

    expect(result.reviewTasks.length).toBeGreaterThan(0)
    expect(result.reviewTasks.every((task) => task.paths.includes('src/app.ts'))).toBe(
      true
    )
    expect(result.metrics).toEqual({
      taskCount: result.reviewTasks.length
    })
  })

})
