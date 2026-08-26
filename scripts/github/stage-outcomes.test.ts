import { describe, expect, it } from 'vitest'
import {
  classifyStageOutcome,
  jobExitCode,
  parseCliError,
  reviewStageDefinition,
  skippedStage
} from './stage-outcomes.js'

const review = reviewStageDefinition

describe('stage definitions', () => {
  // `review` is the only stage this workflow spawns — the two advisory reference
  // lanes (specs 22, 23) run inside it now (`src/cli/advisory-lanes.ts`) and no
  // longer produce a `StageOutcome` of their own to classify here.
  it('the one spawned stage is the blocking one', () => {
    expect(review.kind).toBe('blocking')
    expect(review.command).toEqual(['review'])
  })
})

describe('classifyStageOutcome', () => {
  it('reads the review stdout when the run succeeded', () => {
    const outcome = classifyStageOutcome(review, {
      exitCode: 0,
      stdout: '{"runId":"run_1","artifactDir":".codereviewer/runs/run_1"}',
      stderr: ''
    })

    expect(outcome.status).toBe('passed')
    expect(outcome.stdout).toEqual({
      runId: 'run_1',
      artifactDir: '.codereviewer/runs/run_1'
    })
  })

  it('maps review exit code 1 to a failed quality gate, not to a crash', () => {
    const outcome = classifyStageOutcome(review, {
      exitCode: 1,
      stdout: '{"runId":"run_1","qualityGatePassed":false,"artifactDir":"d"}',
      stderr: ''
    })

    expect(outcome.status).toBe('gate-failed')
    expect(outcome.stdout).toEqual({
      runId: 'run_1',
      qualityGatePassed: false,
      artifactDir: 'd'
    })
  })

  it('carries the structured error code and message of a failed run', () => {
    const outcome = classifyStageOutcome(review, {
      exitCode: 4,
      stdout: '',
      stderr: '{"code":"provider_error","message":"rate limit exceeded"}'
    })

    expect(outcome).toMatchObject({
      status: 'failed',
      errorCode: 'provider_error',
      message: 'rate limit exceeded'
    })
  })

  it('finds the artifact directory of a run that failed after writing partial artifacts', () => {
    const outcome = classifyStageOutcome(review, {
      exitCode: 5,
      stdout: '',
      stderr:
        '{"code":"reporting_error","message":"could not render","artifactDir":".codereviewer/runs/run_1"}'
    })

    expect(outcome.status).toBe('failed')
    expect(outcome.artifactDir).toBe('.codereviewer/runs/run_1')
  })

  it('falls back to the exit-code meaning when stderr carries no JSON', () => {
    const outcome = classifyStageOutcome(review, {
      exitCode: 3,
      stdout: '',
      stderr: 'fatal: not a git repository'
    })

    expect(outcome.status).toBe('failed')
    expect(outcome.message).toContain('repository error')
  })
})

describe('parseCliError', () => {
  it('finds the JSON object after log noise on stderr', () => {
    expect(
      parseCliError('some log line\n{"code":"config_error","message":"bad"}')
    ).toEqual({ code: 'config_error', message: 'bad' })
  })

  it('returns undefined for stderr that carries no structured error', () => {
    expect(parseCliError('')).toBeUndefined()
    expect(parseCliError('plain failure')).toBeUndefined()
    expect(parseCliError('{"notacode":1}')).toBeUndefined()
  })
})

describe('jobExitCode', () => {
  it('fails the job when the quality gate failed', () => {
    expect(
      jobExitCode([
        classifyStageOutcome(review, { exitCode: 1, stdout: '', stderr: '' })
      ])
    ).toBe(1)
  })

  it('fails the job when the review itself could not run', () => {
    expect(
      jobExitCode([
        classifyStageOutcome(review, { exitCode: 4, stdout: '', stderr: '' })
      ])
    ).toBe(1)
  })

  // The advisory reference lanes (specs 22, 23) run inside `review` now
  // (`src/cli/advisory-lanes.ts`) rather than as their own spawned stage, so a
  // lane that could not run no longer produces a `StageOutcome` here at all —
  // it surfaces as a warning on the review report instead. There is nothing
  // left for `jobExitCode` to see from a failed lane; this is covered
  // end-to-end in `pipeline.test.ts`.
  it('passes when the review stage was skipped rather than run', () => {
    expect(jobExitCode([skippedStage(review, 'fork pull request')])).toBe(0)
  })
})
