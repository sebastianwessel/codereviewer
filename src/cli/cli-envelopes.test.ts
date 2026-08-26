import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import {
  CliErrorEnvelopeSchema,
  ReviewStdoutEnvelopeSchema,
  RunErrorArtifactSchema
} from '../shared/contracts/index.js'
import { mapErrorResult } from './cli-error-results.js'
import {
  baselineWriteStdout,
  cliError,
  reviewStdout,
  runErrorArtifact
} from './cli-envelopes.js'
import { runCli } from './index.js'

const createTempDir = async (): Promise<string> => {
  const directory = join(tmpdir(), `codereviewer-envelopes-${crypto.randomUUID()}`)
  await mkdir(directory, { recursive: true })
  return directory
}

describe('validated stdout envelopes', () => {
  test('return the envelope unchanged when it satisfies its contract', () => {
    expect(
      reviewStdout({
        runId: 'run-1',
        qualityGatePassed: false,
        artifactDir: '.codereviewer/runs/run-1'
      })
    ).toEqual({
      runId: 'run-1',
      qualityGatePassed: false,
      artifactDir: '.codereviewer/runs/run-1'
    })
    expect(
      baselineWriteStdout({
        baselinePath: '.codereviewer/baseline.json',
        sourceReportPath: '.codereviewer/runs/run-1/report.json',
        entryCount: 2
      }).entryCount
    ).toBe(2)
    expect(
      runErrorArtifact({
        code: 'provider_error',
        message: 'The provider failed.',
        category: 'provider',
        recoverable: true
      }).recoverable
    ).toBe(true)
  })

  // The classification the wrapping exists for. A raw `ZodError` reaching a
  // command's catch is classified as a CONFIGURATION error — exit 2, with a
  // message beginning "Configuration is invalid" — which would blame the user's
  // config for a fault in this repository's own output. It is an internal
  // invariant violation, so it is raised as one and lands on exit 5.
  test('a violated success envelope becomes an internal error, not a config error', () => {
    let thrown: unknown

    try {
      reviewStdout({
        runId: '',
        qualityGatePassed: true,
        artifactDir: '.codereviewer/runs/run-1'
      })
    } catch (error) {
      thrown = error
    }

    const result = mapErrorResult(thrown, 'repository')

    expect(result.exitCode).toBe(5)
    expect(JSON.parse(result.stderr).code).toBe('cli_envelope_invalid')
    expect(JSON.parse(result.stderr).message).toContain('review')
  })
})

describe('the failure-path documents are always emitted', () => {
  // The asymmetry with the success envelopes, and the reason for it: both of
  // these builders are called FROM a catch block. Throwing there would replace a
  // reported error with an unhandled rejection — exit 1, which CI reads as "gate
  // failed, artifacts complete", the most misleading signal available. So a
  // violation is reported IN the document, under a code a reader can grep,
  // rather than raised.
  test('degrades to a valid envelope that names the violation', () => {
    const degraded = cliError({
      code: '',
      message: 'A real failure whose envelope was built wrong.'
    })

    expect(CliErrorEnvelopeSchema.safeParse(degraded).success).toBe(true)
    expect(degraded.code).toBe('cli_envelope_invalid')
    expect(degraded.message).toContain('code')
  })

  test('the run error artifact degrades rather than losing the whole partial write', () => {
    const degraded = runErrorArtifact({
      code: 'provider_error',
      message: '',
      category: 'provider',
      recoverable: true
    })

    expect(RunErrorArtifactSchema.safeParse(degraded).success).toBe(true)
    expect(degraded.code).toBe('cli_envelope_invalid')
    expect(degraded.category).toBe('internal')
    // The run's real failure is not lost: the same catch reports it on stderr,
    // and the degraded artifact says where to look.
    expect(degraded.message).toContain('stderr')
  })

  test('passes a well-formed envelope through, with and without artifactDir', () => {
    expect(cliError({ code: 'usage_error', message: 'Unknown option --nope' })).toEqual(
      { code: 'usage_error', message: 'Unknown option --nope' }
    )
    expect(
      cliError({
        code: 'provider_error',
        message: 'The provider failed.',
        artifactDir: '.codereviewer/runs/run-1'
      }).artifactDir
    ).toBe('.codereviewer/runs/run-1')
  })
})

// The end-to-end half: the contracts are only worth having if the REAL commands
// go through them. These run the dispatcher and validate what it actually wrote,
// so deleting a validation call at a producer is not enough to keep the suite
// green.
describe('what the CLI really writes satisfies the contracts', () => {
  test('a usage error writes a conforming error envelope', async () => {
    const result = await runCli([], { cwd: process.cwd(), environment: {} })

    expect(result.exitCode).toBe(2)
    expect(CliErrorEnvelopeSchema.parse(JSON.parse(result.stderr)).code).toBe(
      'usage_error'
    )
  })

  test('a failing command writes a conforming error envelope', async () => {
    const result = await runCli(['baseline', 'write'], {
      cwd: await createTempDir(),
      environment: {}
    })

    expect(result.exitCode).toBe(3)
    expect(CliErrorEnvelopeSchema.parse(JSON.parse(result.stderr)).code).toBe(
      'baseline_source_unavailable'
    )
  })

  test('config validate writes a conforming error envelope', async () => {
    const result = await runCli(['config', 'validate', '--config', 'nope.json'], {
      cwd: await createTempDir(),
      environment: {}
    })

    expect(result.exitCode).toBe(2)
    expect(
      CliErrorEnvelopeSchema.safeParse(JSON.parse(result.stderr)).success
    ).toBe(true)
  })

  // The two SUCCESS envelopes are validated where the commands that emit them
  // are already exercised — `review-command.test.ts` and
  // `baseline-command.test.ts` each run a real deterministic command, and a
  // second run here would buy nothing but seconds. This is the type-level half:
  // the envelope a producer hands over is the contract's own inferred type, so a
  // renamed field is a compile error before it is a test failure.
  test('the review envelope type is the contract type', () => {
    const envelope = reviewStdout({
      runId: 'run-1',
      qualityGatePassed: true,
      artifactDir: '.codereviewer/runs/run-1'
    })

    expect(ReviewStdoutEnvelopeSchema.parse(envelope)).toEqual(envelope)
  })
})
