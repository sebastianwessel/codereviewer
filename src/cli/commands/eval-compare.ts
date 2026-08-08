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

    const base = await readArm(basePaths)
    const head = await readArm(headPaths)

    // Arms scored by DIFFERENT judges are refused, for the same reason unequal
    // arm sizes are: the comparison would have two explanations and no way to
    // separate them. If the judge model moved between arms, a recall difference
    // is either a better reviewer or a more generous scorer.
    //
    // A report written before the judge became pinnable records no
    // `judgeModelName`, and on those runs the judge WAS the reviewer's model --
    // so `modelName` is the right fallback identity. That keeps two archived
    // reports comparable with each other, and keeps an archived report
    // comparable with a pinned one that names the same model.
    const judgeIdentity = (report: EvalComparisonReport): string =>
      report.provenance?.judgeModelName ??
      report.provenance?.modelName ??
      '(unrecorded)'
    const judges = new Map<string, string[]>()

    for (const { label, report } of [...base, ...head]) {
      const identity = judgeIdentity(report)
      judges.set(identity, [...(judges.get(identity) ?? []), label])
    }

    if (judges.size > 1) {
      return usageError(
        'eval compare refuses arms scored by different judge models, because a ' +
          'difference between them would be either a better reviewer or a more ' +
          'generous scorer with no way to tell which. Judges found: ' +
          [...judges.entries()]
            .map(([identity, labels]) => `${identity} (${labels.join(', ')})`)
            .join('; ')
      )
    }

    // A run in which cases errored has metrics describing cases that never ran:
    // a 100%-provider-error run reports recall 0.0%, which is an absence of
    // evidence rendered as a number. Its regression gate already fails; refusing
    // it here stops it being pooled into an arm where the gate is not consulted.
    const errored = [...base, ...head].filter(
      ({ report }) => (report.metrics?.providerErrorRate ?? 0) > 0
    )

    if (errored.length > 0) {
      return usageError(
        'eval compare refuses reports with provider errors, because their metrics ' +
          'describe cases that never ran — a fully errored run reports recall 0.0%, ' +
          'which is an absence of evidence, not a measurement. Affected: ' +
          errored
            .map(
              ({ label, report }) =>
                `${label} (${((report.metrics?.providerErrorRate ?? 0) * 100).toFixed(0)}% errored)`
            )
            .join(', ')
      )
    }

    return {
      exitCode: 0,
      stdout: `${renderEvalComparison({ base, head })}\n`,
      stderr: ''
    }
  } catch (error) {
    return mapErrorResult(error, 'config')
  }
}
