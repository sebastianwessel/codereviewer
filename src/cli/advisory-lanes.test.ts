import { describe, expect, test } from 'vitest'
import { runAdvisoryStagesForReview } from './advisory-lanes.js'
import { createRunContext } from '../domains/run-context/index.js'
import { CodeReviewerConfigSchema } from '../shared/contracts/index.js'
import type { Logger } from '../domains/observability/index.js'

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
} as unknown as Logger

const inputFor = (
  configOverrides: Record<string, unknown>,
  runGit: (args: readonly string[]) => Promise<string>
) => ({
  options: { cwd: '/repo' } as never,
  runContext: createRunContext({
    repositoryRoot: '/repo',
    config: CodeReviewerConfigSchema.parse(configOverrides),
    runGit: async (args) => await runGit(args),
    readChangedFile: async () => undefined
  }),
  environment: {},
  baseRef: 'main',
  headRef: 'HEAD',
  logger: silentLogger
})

describe('runAdvisoryStagesForReview', () => {
  // The flags are the operator's statement about which questions to ask. Being
  // invoked from `review` rather than from its own command must not turn a stage
  // on, and a stage that is off must not touch the repository at all.
  test('a disabled stage runs nothing and reaches no git', async () => {
    let gitCalls = 0
    const results = await runAdvisoryStagesForReview(
      inputFor({}, async () => {
        gitCalls += 1

        return ''
      })
    )

    expect(results.impact).toBeUndefined()
    expect(results.intent).toBeUndefined()
    expect(results.warnings).toEqual([])
    expect(gitCalls).toBe(0)
  })

  // Specs 22 and 23 make non-blocking a REQUIREMENT. Running beside a stage that
  // can fail the command is exactly where that guarantee would be lost, so the
  // failure has to surface as a warning on the review the reader already has.
  test('a stage that throws yields a warning, not a thrown review', async () => {
    const results = await runAdvisoryStagesForReview(
      inputFor({ changeImpact: { enabled: true } }, async () => {
        throw new Error('git exploded')
      })
    )

    expect(results.impact).toBeUndefined()
    expect(results.warnings).toHaveLength(1)
    expect(results.warnings[0]).toContain('change-impact')
    expect(results.warnings[0]).toContain('produced no report')
  })

  // One failing stage must not take the other down with it.
  test('the second stage still runs after the first one fails', async () => {
    let gitCalls = 0
    const results = await runAdvisoryStagesForReview(
      inputFor(
        { changeImpact: { enabled: true }, intentFulfilment: { enabled: true } },
        async () => {
          gitCalls += 1

          throw new Error('git exploded')
        }
      )
    )

    expect(results.warnings).toHaveLength(2)
    expect(results.warnings[0]).toContain('change-impact')
    expect(results.warnings[1]).toContain('intent-fulfilment')
    // Both stages reached git independently: the memo does not replay a failure.
    expect(gitCalls).toBeGreaterThanOrEqual(2)
  })
})
