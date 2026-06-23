import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import { createReviewRunStartState } from './review-runner-run-state.js'

describe('review runner run state', () => {
  test('creates deterministic run start state from injected clock and run id', () => {
    const config = CodeReviewerConfigSchema.parse({
      review: { depth: 'balanced' }
    })
    const startedAt = new Date('2026-06-23T10:30:00.000Z')

    const state = createReviewRunStartState({
      config,
      runId: 'run-fixed',
      now: () => startedAt
    })

    expect(state).toEqual({
      now: expect.any(Function),
      startedAt,
      runId: 'run-fixed',
      configHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    })

    expect(
      createReviewRunStartState({
        config,
        runId: 'run-fixed',
        now: () => new Date('2030-01-01T00:00:00.000Z')
      }).configHash
    ).toBe(state.configHash)
    expect(
      createReviewRunStartState({
        config: CodeReviewerConfigSchema.parse({
          review: { depth: 'thorough' }
        }),
        runId: 'run-fixed',
        now: () => startedAt
      }).configHash
    ).not.toBe(state.configHash)
  })

  test('generates prefixed run ids when none is provided', () => {
    const state = createReviewRunStartState({
      config: CodeReviewerConfigSchema.parse({}),
      now: () => new Date('2026-06-23T10:30:00.000Z')
    })

    expect(state.runId).toMatch(/^run-[0-9a-f-]+$/)
  })
})
