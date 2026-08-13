// `config validate` — resolves the effective configuration and prints it with
// every secret redacted. Nothing it can fail on is a repository fault, so it
// maps every failure through the `config` source rather than sharing the
// classification the other commands use.
import { createRedactedConfigSummary } from '../../domains/configuration/index.js'
import { normalizeError } from '../../shared/errors/error-normalizer.js'
import { unknownCliOption } from '../args.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'
import { cliError } from '../cli-envelopes.js'
import { usageError } from '../cli-error-results.js'
import { loadConfigForCommand } from '../command-config.js'

export const runConfigValidate = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(args, [])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  try {
    const config = await loadConfigForCommand(args, options)

    return {
      exitCode: 0,
      stdout: createRedactedConfigSummary(config.config),
      stderr: ''
    }
  } catch (error) {
    const normalized = normalizeError(error, { source: 'config' })
    return {
      exitCode: normalized.exitCode,
      stdout: '',
      stderr: JSON.stringify(
        cliError({
          // The error's OWN code, not a hardcoded `config_error`. The exit code
          // on the line above already comes from `normalized`, so hardcoding this
          // one let the two disagree -- and they do: a
          // `redaction_secret_env_unset` or a `provider_adapter_missing` printed
          // as `config_error` while exiting on its own code, sending a reader to
          // look for a malformed configuration document when the actual fault was
          // an unset environment variable.
          //
          // This command is the one whose entire job is telling an operator what
          // is wrong with their configuration, and it was the only command not
          // reporting `normalized.code` -- every other route goes through
          // `mapErrorResult`, which always has.
          code: normalized.code,
          message: normalized.message
        })
      )
    }
  }
}
