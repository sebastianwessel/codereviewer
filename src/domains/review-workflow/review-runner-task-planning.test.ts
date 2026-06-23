import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import { prepareReviewRunnerDeterministicSignals } from './review-runner-deterministic-signals.js'
import { prepareReviewRunnerTaskPlanning } from './review-runner-task-planning.js'

describe('review runner task planning', () => {
  test('plans review tasks with support-signal candidates and safe metrics', () => {
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

    expect(result.supportSignalCandidates).toEqual([])
    expect(result.reviewTasks.length).toBeGreaterThan(0)
    expect(result.reviewTasks.every((task) => task.paths.includes('src/app.ts'))).toBe(
      true
    )
    expect(result.metrics).toEqual({
      taskCount: result.reviewTasks.length,
      supportSignalCandidateCount: 0
    })
  })

  // The benchmark-fitted deterministic rules (dayjs, slot-end, prorated) were
  // removed as eval-gaming, so the extractor no longer emits the rule evidence
  // that previously promoted trusted support-signal candidates. The promotion
  // mechanism itself remains; it simply receives no benchmark-rule evidence now.
  test('does not promote support-signal candidates from removed benchmark heuristics', () => {
    const sourceFiles = [
      {
        path: 'src/slots.ts',
        content: [
          "import dayjs, { type Dayjs } from 'dayjs'",
          'const minuteOfDay = (value: Dayjs): number => value.hour() * 60 + value.minute()',
          'export const slotWindow = (time: Dayjs, utcOffset: number) => {',
          '  const slotEndTime = time.add(30, "minutes").utc()',
          '  const slotStartTime = time.utc()',
          '  if (dayjs(slotStartTime).add(utcOffset, "minutes") === dayjs(slotEndTime).add(utcOffset, "minutes")) return undefined',
          '  const end = slotStartTime.hour() * 60 + slotStartTime.minute()',
          '  return end',
          '}'
        ].join('\n')
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

    expect(result.supportSignalCandidates).toEqual([])
    expect(result.metrics.supportSignalCandidateCount).toBe(0)
    // Generic structural facts (the dayjs import) are still extracted.
    expect(deterministicSignals.analysis.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'import',
          name: 'dayjs',
          path: 'src/slots.ts'
        })
      ])
    )
  })
})
