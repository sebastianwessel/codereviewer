// `config validate` — resolves the effective configuration and prints it with
// every secret redacted. Nothing it can fail on is a repository fault, so it
// maps every failure through the `config` source rather than sharing the
// classification the other commands use.
import { createRedactedConfigSummary } from '../../domains/configuration/index.js'
import { normalizeError } from '../../shared/errors/error-normalizer.js'
import { unknownCliOption } from '../args.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'
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
      stderr: JSON.stringify({
        code: 'config_error',
        message: normalized.message
      })
    }
  }
}
