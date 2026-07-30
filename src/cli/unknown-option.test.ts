// Every command rejects an option it does not implement.
//
// This is a measurement-integrity test, not a usability one. A parser that
// locates its options by exact token match ignores everything else, so a flag the
// command does not support changes nothing and the run proceeds as though it had
// been honoured. Two incidents in this project came from exactly that: an A/B
// whose config flag never reached the run, costing roughly $11.50 to compare a
// build against itself; and `eval run --help`, which executed a full default
// evaluation instead of printing usage.

import { describe, expect, test } from 'vitest'
import { globalCliOptions, unknownCliOption } from './args.js'
import { runCli } from './index.js'

const cli = async (args: readonly string[]) =>
  runCli(args, { cwd: process.cwd(), environment: {} })

describe('unknownCliOption', () => {
  test('accepts a command option and every global option', () => {
    expect(
      unknownCliOption(
        ['--slice-root', 'a', ...globalCliOptions.filter((o) => o !== '--debug')],
        ['--slice-root']
      )
    ).toBeUndefined()
  })

  test('names the first unrecognized option', () => {
    expect(unknownCliOption(['--slice-root', 'a', '--nope', '--also'], ['--slice-root'])).toBe(
      '--nope'
    )
  })

  test('does not mistake an option value for an option', () => {
    // A value never starts with `--`; treating one as an option would reject
    // valid invocations.
    expect(unknownCliOption(['--report', 'build/report.json'], ['--report'])).toBeUndefined()
  })

  test('checks the name of an --option=value spelling', () => {
    expect(unknownCliOption(['--slice-root=a'], ['--slice-root'])).toBeUndefined()
    expect(unknownCliOption(['--nope=a'], ['--slice-root'])).toBe('--nope')
  })

  test('leaves single-dash tokens and the end-of-options marker alone', () => {
    // Those are values or a convention, and their own parsers report them better.
    expect(unknownCliOption(['--', '-x'], [])).toBeUndefined()
  })
})

describe('command-level rejection', () => {
  // The literal invocation that silently ran a full default evaluation.
  test('eval run --help does not run an evaluation', async () => {
    const result = await cli(['eval', 'run', '--help'])

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--help')
    expect(result.stdout).not.toContain('Evaluation Summary')
  })

  test.each([
    ['review', ['review', '--file', 'src/app.ts', '--nope']],
    ['eval run', ['eval', 'run', '--slice-root', 'x', '--nope']],
    ['eval compare', ['eval', 'compare', '--base', 'a', '--head', 'b', '--nope']],
    ['eval recall-report', ['eval', 'recall-report', '--report', 'a', '--nope']],
    ['eval slice-manifest', ['eval', 'slice-manifest', '--slice-root', 'x', '--nope']],
    ['baseline write', ['baseline', 'write', '--report', 'a', '--nope']],
    ['config validate', ['config', 'validate', '--nope']],
    ['drift check', ['drift', 'check', '--nope']],
    ['impact check', ['impact', 'check', '--nope']],
    ['intent check', ['intent', 'check', '--nope']],
    ['conformance check', ['conformance', 'check', '--nope']]
  ])('%s rejects an unknown option', async (_name, args) => {
    const result = await cli(args)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--nope')
  })

  test('a command option is not rejected by another command that lacks it', async () => {
    // Guards against collapsing the per-command sets into one permissive union,
    // which would restore the original bug for every mistyped-but-real flag.
    const result = await cli(['drift', 'check', '--slice-root', 'x'])

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--slice-root')
  })
})
