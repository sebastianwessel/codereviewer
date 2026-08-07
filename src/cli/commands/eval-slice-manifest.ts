// `eval slice-manifest` — records what a hydrated slice root actually contains,
// so a measurement run can state which corpus it scored.
import { createEvalSliceManifest } from '../../domains/evaluation/index.js'
import { parseOptionValue, unknownCliOption } from '../args.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'
import { mapErrorResult, usageError } from '../cli-error-results.js'
import { jsonResult } from '../run-artifacts.js'

export const runEvalSliceManifest = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(args, ['--slice-root'])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  try {
    const sliceRoot = parseOptionValue(args, '--slice-root')

    if (sliceRoot === undefined) {
      return usageError('eval slice-manifest requires --slice-root')
    }

    const manifest = await createEvalSliceManifest({
      repositoryRoot: options.cwd,
      sliceRoot
    })

    return {
      exitCode: 0,
      stdout: jsonResult(manifest),
      stderr: ''
    }
  } catch (error) {
    return mapErrorResult(error, 'repository')
  }
}
