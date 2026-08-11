// `eval compare` — adjudicates one arm of eval runs against another.
import {
  renderEvalComparison,
  type EvalComparisonReport,
  type EvalComparisonRun
} from '../../domains/evaluation/index.js'
import { parseOptionValues, unknownCliOption } from '../args.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'
import { mapErrorResult, usageError } from '../cli-error-results.js'
import { readEvalComparisonReport } from '../eval-report-files.js'

// A capability difference between the reports is WARNED about and never
// refused, and the reasoning is the one `provenance.configHash` already carries:
// running both sides of a deliberate flag change is exactly the comparison this
// command exists to make, so refusing it would block the command's purpose. That
// is the opposite of the judge-model check above, where the difference makes the
// numbers uninterpretable rather than merely explicable.
//
// What it must not do is stay silent. A capability difference is a candidate
// explanation for every delta the report prints, and until provenance recorded
// the flags a reader had only two opaque config hashes to notice it with.
//
// Reports are pooled across both arms rather than compared arm to arm, matching
// the judge check: a flag that differs BETWEEN the runs of one arm is at least as
// misleading as one that differs across arms, and pooling catches both.
const capabilityDifferenceWarnings = (
  runs: readonly EvalComparisonRun[]
): readonly string[] => {
  const unrecorded = runs
    .filter(({ report }) => report.provenance?.capabilities === undefined)
    .map(({ label }) => label)
  const recorded = runs.filter(
    ({ report }) => report.provenance?.capabilities !== undefined
  )
  const valuesByCapability = new Map<string, Map<boolean, string[]>>()

  for (const { label, report } of recorded) {
    for (const [capability, enabled] of Object.entries(
      report.provenance?.capabilities ?? {}
    )) {
      const labelsByValue = valuesByCapability.get(capability) ?? new Map()
      labelsByValue.set(enabled, [...(labelsByValue.get(enabled) ?? []), label])
      valuesByCapability.set(capability, labelsByValue)
    }
  }

  // A capability recorded by only SOME of the reports differs too: the reports
  // that omit it were produced by a build whose capability set was different, so
  // the key's absence is itself the difference and is reported as `not recorded`
  // rather than assumed to be `false`.
  const differing = [...valuesByCapability.entries()]
    .filter(
      ([, labelsByValue]) =>
        labelsByValue.size > 1 ||
        [...labelsByValue.values()].flat().length !== recorded.length
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([capability, labelsByValue]) => {
      const stated = [...labelsByValue.values()].flat()
      const missing = recorded
        .map(({ label }) => label)
        .filter((label) => !stated.includes(label))

      // `true` before `false` so the enabled side reads first, then the reports
      // that never stated the capability at all.
      return `${capability} (${[
        ...[...labelsByValue.entries()]
          .sort(([left], [right]) => Number(right) - Number(left))
          .map(([enabled, labels]) => `${enabled}: ${labels.join(', ')}`),
        ...(missing.length === 0 ? [] : [`not recorded: ${missing.join(', ')}`])
      ].join('; ')})`
    })
  const warnings: string[] = []

  if (differing.length > 0) {
    warnings.push(
      'Warning: these reports were produced under different capabilities. That is ' +
        'legitimate — measuring what one flag does by running both sides is what ' +
        'this command is for — but it is a candidate explanation for every delta ' +
        `below: ${differing.join('; ')}`
    )
  }

  if (unrecorded.length > 0) {
    warnings.push(
      'Warning: these reports record no capability flags, so a capability ' +
        'difference cannot be ruled out for them — absent means not recorded, ' +
        `never that nothing was enabled: ${unrecorded.join(', ')}`
    )
  }

  return warnings
}

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
      stderr: capabilityDifferenceWarnings([...base, ...head]).join('\n')
    }
  } catch (error) {
    return mapErrorResult(error, 'config')
  }
}
