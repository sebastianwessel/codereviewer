// `eval compare` — adjudicates one arm of eval runs against another.
import {
  renderEvalComparison,
  type EvalComparisonReport
} from '../../domains/evaluation/index.js'
import { parseOptionValues, unknownCliOption } from '../args.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'
import { mapErrorResult, usageError } from '../cli-error-results.js'
import { readEvalComparisonReport } from '../eval-report-files.js'

export const runEvalCompare = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(args, ['--base', '--head'])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  try {
    // Both flags are REPEATABLE: an arm is a set of runs, because this project's
    // own decision rule requires several runs per arm and adjudicating one
    // report against one report throws away most of the evidence that was paid
    // for.
    const basePaths = parseOptionValues(args, '--base')
    const headPaths = parseOptionValues(args, '--head')

    if (basePaths.length === 0 || headPaths.length === 0) {
      return usageError('eval compare requires --base and --head report paths')
    }

    // Unequal arms are refused rather than truncated or zipped: per-expectation
    // outcomes measured over different run counts are not paired observations,
    // and a 2/3 against a 1/1 would read as movement that is an artifact of the
    // run counts.
    if (basePaths.length !== headPaths.length) {
      return usageError(
        `eval compare requires the same number of --base and --head reports; got ${basePaths.length} base and ${headPaths.length} head`
      )
    }

    const readArm = async (
      paths: readonly string[]
    ): Promise<{ readonly label: string; readonly report: EvalComparisonReport }[]> =>
      Promise.all(
        paths.map(async (reportPath) => ({
          label: reportPath,
          report: await readEvalComparisonReport(options.cwd, reportPath)
        }))
      )

    return {
      exitCode: 0,
      stdout: `${renderEvalComparison({
        base: await readArm(basePaths),
        head: await readArm(headPaths)
      })}\n`,
      stderr: ''
    }
  } catch (error) {
    return mapErrorResult(error, 'config')
  }
}
