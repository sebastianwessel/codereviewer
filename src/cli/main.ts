#!/usr/bin/env node
import { guardedCliRun } from './cli-error-results.js'
import { runCli } from './index.js'

// `runCli` is awaited through the guard, never directly: a throw that escapes a
// command's own error mapping must still print the documented `{code, message}`
// envelope at a documented exit code instead of a raw Node stack. See
// `guardedCliRun` for the escape path that makes this reachable.
const result = await guardedCliRun(() =>
  runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    environment: process.env,
    logSink: process.stderr
  })
)

if (result.stdout.length > 0) {
  process.stdout.write(result.stdout)
}

if (result.stderr.length > 0) {
  process.stderr.write(result.stderr)
  process.stderr.write('\n')
}

process.exitCode = result.exitCode
