import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { CliErrorEnvelopeSchema } from '../shared/contracts/index.js'
import { createStructuredError } from '../shared/errors/error-normalizer.js'
import { guardedCliRun } from './cli-error-results.js'

const parsedStderr = (stderr: string): unknown => JSON.parse(stderr)

describe('the top-level CLI failure guard', () => {
  test('returns the command result untouched when nothing throws', async () => {
    const result = await guardedCliRun(async () => ({
      exitCode: 1,
      stdout: '{"runId":"run-1"}\n',
      stderr: ''
    }))

    expect(result).toEqual({
      exitCode: 1,
      stdout: '{"runId":"run-1"}\n',
      stderr: ''
    })
  })

  // The escape path this guard exists for: `review` awaits its partial-artifact
  // write from inside its own catch, so an unwritable artifact directory rejects
  // OUT of `runCli` past the classification that would have described it.
  // Without the guard the user gets a Node stack and exit 1 — the code reserved
  // for "run completed, a gate failed".
  test('a filesystem throw escaping runCli still produces the documented envelope and exit code', async () => {
    const escaped = Object.assign(
      new Error(
        "EACCES: permission denied, mkdir '/repo/.codereviewer/runs/run-1'"
      ),
      { code: 'EACCES' }
    )
    const result = await guardedCliRun(async () => {
      throw escaped
    })

    expect(result.exitCode).toBe(5)
    expect(result.stdout).toBe('')

    const envelope = CliErrorEnvelopeSchema.parse(parsedStderr(result.stderr))

    expect(envelope.code).toBe('unknown_error')
    expect(envelope.message).toContain('EACCES')
    // The envelope is the whole document: no stack, no extra keys. The schema is
    // strict, so the parse above already proves the second half.
    expect(result.stderr).not.toContain('at ')
  })

  test('an already-structured error escaping runCli keeps its own code and exit code', async () => {
    const result = await guardedCliRun(async () => {
      throw createStructuredError({
        code: 'baseline_source_unavailable',
        message: 'The review report could not be read.',
        category: 'repository'
      })
    })

    expect(result.exitCode).toBe(3)
    expect(CliErrorEnvelopeSchema.parse(parsedStderr(result.stderr)).code).toBe(
      'baseline_source_unavailable'
    )
  })

  test('a non-Error throw is still described', async () => {
    const result = await guardedCliRun(async () => {
      throw 'the queue exploded'
    })

    expect(result.exitCode).toBe(5)
    expect(CliErrorEnvelopeSchema.parse(parsedStderr(result.stderr))).toEqual({
      code: 'unknown_error',
      message: 'the queue exploded'
    })
  })

  // The guard is the last thing between a failure and a raw stack trace, so it
  // has to survive a value that fails while being described. Reading `message`
  // is the first thing the normalizer does with a thrown object.
  test('the guard cannot itself throw', async () => {
    const hostile = {
      get message(): string {
        throw new Error('message is not readable')
      }
    }
    const result = await guardedCliRun(async () => {
      throw hostile
    })

    expect(result.exitCode).toBe(5)
    expect(CliErrorEnvelopeSchema.parse(parsedStderr(result.stderr)).code).toBe(
      'unknown_error'
    )
  })

  // `src/cli/main.ts` is excluded from coverage (spec 00, *Testing
  // Conventions*), so nothing else would notice the entrypoint going back to an
  // unguarded `await runCli(...)`. Asserted on the source for the same reason
  // `drift-checker-cli-inventory.test.ts` is.
  test('the CLI entrypoint awaits runCli through the guard', async () => {
    const entrypoint = await readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'main.ts'),
      'utf8'
    )

    expect(entrypoint).toContain('guardedCliRun')
    expect(entrypoint).not.toMatch(/await\s+runCli\s*\(/u)
  })
})
