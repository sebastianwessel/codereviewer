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

  test('promotes trusted deterministic signal evidence into support-signal candidates', () => {
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

    expect(result.supportSignalCandidates).toHaveLength(2)
    expect(result.supportSignalCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'bug',
          severity: 'medium',
          title: 'Dayjs object equality uses reference comparison',
          location: expect.objectContaining({
            path: 'src/slots.ts',
            startLine: 6,
            side: 'new'
          }),
          proposedBy: 'deterministic-trusted-rule'
        }),
        expect.objectContaining({
          category: 'bug',
          severity: 'medium',
          title: 'Slot end is derived from slot start time',
          location: expect.objectContaining({
            path: 'src/slots.ts',
            startLine: 7,
            side: 'new'
          }),
          proposedBy: 'deterministic-trusted-rule'
        })
      ])
    )
    expect(result.reviewTasks[0]?.candidateIds).toEqual(
      result.supportSignalCandidates.map((candidate) => candidate.id)
    )
    expect(result.metrics.supportSignalCandidateCount).toBe(2)
  })

  test('promotes prorated discount deterministic evidence into a support-signal candidate', () => {
    const sourceFiles = [
      {
        path: 'src/billing.ts',
        content: [
          'export const totalDueCents = (items: readonly InvoiceItem[]): number =>',
          '  items.reduce((total, item) => {',
          '    const subtotal = item.quantity * item.unitCents',
          '',
          '    if (item.prorated) {',
          '      return total + subtotal',
          '    }',
          '',
          '    return total + subtotal - item.discountCents',
          '  }, 0)'
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

    expect(result.supportSignalCandidates).toEqual([
      expect.objectContaining({
        category: 'bug',
        severity: 'medium',
        title: 'Prorated billing branch omits discount',
        location: expect.objectContaining({
          path: 'src/billing.ts',
          startLine: 6,
          side: 'new'
        }),
        proposedBy: 'deterministic-trusted-rule'
      })
    ])
  })
})
