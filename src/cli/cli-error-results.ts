// How a command failure becomes a `CliResult`.
//
// Three entry points, kept together because they are the three parts of one
// taxonomy: a usage error the CLI itself detects before doing any work (always
// exit 2), a thrown error that reached a command boundary (exit code taken from
// the normalized error), and the guard around `runCli` itself for a throw that
// reached no command boundary at all.
import {
  isFileSystemError,
  isZodError,
  normalizeError,
  type ErrorSource
} from '../shared/errors/error-normalizer.js'
import type { CliResult } from './cli-contract.js'
import { cliError } from './cli-envelopes.js'
import { jsonResult } from './run-artifacts.js'

export const usageError = (message: string): CliResult => ({
  exitCode: 2,
  stdout: '',
  stderr: JSON.stringify(cliError({ code: 'usage_error', message }))
})

// Classify errors that reach a command boundary so they map to the documented
// exit codes: configuration/usage/path errors exit 2, filesystem/repository
// errors exit 3. Already-structured errors keep their own category regardless of
// the fallback. Raw `TypeError`s only originate from CLI argument parsing and
// config/path validation, all of which are configuration/usage errors.
const classifyCliErrorSource = (
  error: unknown,
  fallback: ErrorSource
): ErrorSource => {
  if (isZodError(error) || error instanceof TypeError) {
    return 'config'
  }

  if (isFileSystemError(error)) {
    return 'repository'
  }

  return fallback
}

export const mapErrorResult = (
  error: unknown,
  fallback: ErrorSource
): CliResult => {
  const normalized = normalizeError(error, {
    source: classifyCliErrorSource(error, fallback)
  })

  return {
    exitCode: normalized.exitCode,
    stdout: '',
    stderr: jsonResult(
      cliError({
        code: normalized.code,
        message: normalized.message
      })
    )
  }
}

// What is printed when the mapping below cannot run at all. Built as a constant
// string rather than through the normalizer and the envelope builder, because
// those are precisely the parts that have already been shown to fail when this
// value is used: nothing here can throw. Code and exit code are the documented
// internal ones, so a reader of the taxonomy is never handed a code that is not
// in it (`docs/06-reference/exit-codes-and-error-codes.md`).
const undescribableFailureResult: CliResult = {
  exitCode: 5,
  stdout: '',
  stderr: `${JSON.stringify(
    {
      code: 'unknown_error',
      message:
        'The CLI failed, and the failure could not be described. This is a defect in this engine.'
    },
    null,
    2
  )}\n`
}

/**
 * Runs the CLI under a guard, so a throw that escapes `runCli` still leaves the
 * process inside the documented contract.
 *
 * Every command maps its own throws through `mapErrorResult`, so this is a
 * narrow path — but not an unreachable one, and the reachable case is the one a
 * user is least able to interpret: `review` awaits its partial-artifact write
 * from INSIDE its own catch, so a run that fails while the artifact directory is
 * unwritable (`EACCES`, `ENOSPC`, `EROFS`) rejects out of `runCli` after the
 * catch that would have classified it. Without this guard Node prints a raw
 * stack — absolute paths, an unredacted message, no `code` — and exits `1`,
 * which is the code this CLI reserves for "run completed, a gate failed". A
 * pipeline would read a crash as a clean, complete run.
 *
 * A value that is ALREADY a `StructuredError` keeps its own code and exit code:
 * it was classified by whoever raised it, and re-classifying it here would
 * discard that. Anything else is an internal invariant violation by definition —
 * it escaped every boundary that exists to classify it — and normalizes to
 * `unknown_error` at exit `5` (`specs/00-conventions.md`, *Error Conventions*).
 *
 * This function cannot throw. It is the last thing standing between a failure
 * and a raw stack trace, so a failure inside the guard falls back to a constant
 * envelope rather than propagating.
 */
export const guardedCliRun = async (
  runCliCall: () => Promise<CliResult>
): Promise<CliResult> => {
  try {
    return await runCliCall()
  } catch (error) {
    try {
      const normalized = normalizeError(error, {
        source: 'internal',
        operation: 'run_cli'
      })

      return {
        exitCode: normalized.exitCode,
        stdout: '',
        stderr: jsonResult(
          cliError({
            code: normalized.code,
            message: normalized.message
          })
        )
      }
    } catch {
      return undescribableFailureResult
    }
  }
}
