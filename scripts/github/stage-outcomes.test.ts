import { describe, expect, it } from 'vitest'
import {
  classifyStageOutcome,
  jobExitCode,
  parseCliError,
  skippedStage,
  stageDefinitions,
  type StageDefinition
} from './stage-outcomes.js'

const stage = (id: string): StageDefinition =>
  stageDefinitions.find((definition) => definition.id === id) as StageDefinition

const review = stage('review')
const intent = stage('intent')

describe('stage definitions', () => {
  it('marks exactly one stage as blocking', () => {
    expect(
      stageDefinitions.filter((definition) => definition.kind === 'blocking')
    ).toHaveLength(1)
    expect(stage('review').kind).toBe('blocking')
  })

  it('marks intent, impact and conformance advisory, as their specs require', () => {
    for (const id of ['intent', 'impact', 'conformance']) {
      expect(stage(id).kind).toBe('advisory')
    }
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

  it('classifies an advisory exit code 1 as failed, never as a gate', () => {
    // Only the blocking stage has a gate. An advisory command that exits
    // non-zero did not "fail a check"; it failed to run.
    expect(
      classifyStageOutcome(intent, { exitCode: 1, stdout: '', stderr: '' })
        .status
    ).toBe('failed')
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

  it('NEVER fails the job for an advisory stage, whatever it reported', () => {
    const outcomes = [
      classifyStageOutcome(review, { exitCode: 0, stdout: '{}', stderr: '' }),
      ...['intent', 'impact', 'conformance'].map((id) =>
        classifyStageOutcome(stage(id), {
          exitCode: 3,
          stdout: '',
          stderr: '{"code":"repository_error","message":"no merge base"}'
        })
      )
    ]

    expect(jobExitCode(outcomes)).toBe(0)
  })

  it('passes when the review passed and nothing was skipped into a failure', () => {
    expect(
      jobExitCode([
        classifyStageOutcome(review, { exitCode: 0, stdout: '{}', stderr: '' }),
        skippedStage(intent, 'provider not configured')
      ])
    ).toBe(0)
  })
})
