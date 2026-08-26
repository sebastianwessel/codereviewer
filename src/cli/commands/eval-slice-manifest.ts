// `eval slice-manifest` — records what a hydrated slice root actually contains,
// so a measurement run can state which corpus it scored.
import { createEvalSliceManifest } from '../../domains/evaluation/index.js'
import {
  createStructuredError,
  isFileNotFoundError
} from '../../shared/errors/error-normalizer.js'
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

    try {
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
      // A mistyped `--slice-root` used to surface as
      // `repository_error: ENOENT: no such file or directory, realpath
      // '<absolute host path>'` — a raw errno, an absolute path belonging to the
      // machine rather than the repository, and a category that means the
      // repository UNDER REVIEW is broken, all for a typo in an argument.
      //
      // The sibling failure on this very command already gets it right
      // (`eval slice-manifest requires --slice-root`, exit 2), which is what made
      // the gap visible: two spellings of the same mistake, one usable and one not.
      if (isFileNotFoundError(error)) {
        throw createStructuredError({
          code: 'config_error',
          message: `The slice root "${sliceRoot}" does not exist. Pass --slice-root at a repository-relative directory that a hydration script has already written, for example .codereviewer/eval/corpus-slices/<name>.`,
          category: 'config',
          details: { sliceRoot, cause: 'missing' }
        })
      }

      throw error
    }
  } catch (error) {
    return mapErrorResult(error, 'repository')
  }
}
