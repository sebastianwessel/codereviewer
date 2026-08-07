// The CLI entrypoint: it maps a command line to one command module and nothing
// else. Every command owns its own option set, its own error classification and
// its own exit code, so this file has no logic to share and no state to hold —
// which is what keeps the usage message below the CLI's single enumeration of
// what it dispatches (see `drift-checker-cli-inventory.test.ts`).
import type { CliResult, CliRunOptions } from './cli-contract.js'
import { usageError } from './cli-error-results.js'
import { runBaselineWrite } from './commands/baseline-write.js'
import { runConfigValidate } from './commands/config-validate.js'
import { runDrift } from './commands/drift-check.js'
import { runEvalCompare } from './commands/eval-compare.js'
import { runEvalImpact } from './commands/eval-impact.js'
import { runEvalRecallReport } from './commands/eval-recall-report.js'
import { runEval } from './commands/eval-run.js'
import { runEvalSliceManifest } from './commands/eval-slice-manifest.js'
import { runImpact } from './commands/impact-check.js'
import { runIntent } from './commands/intent-check.js'
import { runReview } from './commands/review.js'

// The package's `./cli` export is this file, so the two types every caller of
// `runCli` needs are re-exported here. They are declared in `cli-contract.ts`
// because every command module imports them and each one is imported here: a
// declaration in this file would make the command modules import the dispatcher
// back.
export type { CliResult, CliRunOptions } from './cli-contract.js'

export const runCli = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const [command, subcommand, ...rest] = args
  // Commands that own their own subcommand parsing (`review` takes none;
  // `drift`/`impact`/`intent` require `check`) receive everything after the
  // command name.
  const commandArgs = args.slice(1)

  if (command === 'config' && subcommand === 'validate') {
    return runConfigValidate(rest, options)
  }

  if (command === 'review') {
    return runReview(commandArgs, options)
  }

  if (command === 'eval') {
    if (subcommand === 'run') {
      return runEval(rest, options)
    }

    if (subcommand === 'compare') {
      return runEvalCompare(rest, options)
    }

    if (subcommand === 'recall-report') {
      return runEvalRecallReport(rest, options)
    }

    if (subcommand === 'slice-manifest') {
      return runEvalSliceManifest(rest, options)
    }

    // The change-impact corpus, which MUST NOT be pooled with the slice corpus
    // `eval run` scores. It is a separate subcommand with a separate option set
    // and a separate artefact for exactly that reason.
    if (subcommand === 'impact') {
      return runEvalImpact(rest, options)
    }
  }

  if (command === 'baseline' && subcommand === 'write') {
    return runBaselineWrite(rest, options)
  }

  if (command === 'drift') {
    return runDrift(commandArgs, options)
  }

  if (command === 'impact') {
    return runImpact(commandArgs, options)
  }

  if (command === 'intent') {
    return runIntent(commandArgs, options)
  }

  return usageError(
    'Expected command: config validate, review, baseline write, eval run, eval impact, eval compare, eval recall-report, eval slice-manifest, drift check, impact check, or intent check'
  )
}
