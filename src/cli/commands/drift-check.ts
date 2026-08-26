// `drift check` — the deterministic docs/specs/schema drift gate. It is the one
// check command that CAN fail: drift is a fact about the repository, not a
// model judgement, so a failing check exits 1.
import { runDriftCheck } from '../../domains/drift/index.js'
import { unknownCliOption } from '../args.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'
import { mapErrorResult, usageError } from '../cli-error-results.js'
import { loadConfigForCommand } from '../command-config.js'
import { jsonResult } from '../run-artifacts.js'

export const runDrift = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(args, [])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  if (args[0] !== 'check') {
    return usageError('Expected command: drift check')
  }

  try {
    const loadedConfig = await loadConfigForCommand(args.slice(1), options)
    const result = await runDriftCheck({
      repositoryRoot: options.cwd,
      config: loadedConfig.config
    })

    return {
      exitCode: result.passed ? 0 : 1,
      stdout: jsonResult(result),
      stderr: ''
    }
  } catch (error) {
    return mapErrorResult(error, 'config')
  }
}
