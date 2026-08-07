// The skeleton both advisory `check` commands are built from, plus the option
// values they share. Written once so a further advisory stage cannot
// accidentally acquire the ability to fail a pipeline.
import { normalizeError } from '../shared/errors/error-normalizer.js'
import { parseOptionValue, unknownCliOption } from './args.js'
import type { CliResult, CliRunOptions } from './cli-contract.js'
import { mapErrorResult, usageError } from './cli-error-results.js'
import {
  loadConfigForCommand,
  type LoadedCodeReviewerConfig
} from './command-config.js'
import { jsonResult } from './run-artifacts.js'

// JSON is the default because it was the only output these commands ever had, and a
// script reading stdout must keep working unchanged.
//
// ONE definition for both reference stages. `commandOptions` stays per-command on
// purpose — a flag one stage implements must remain unknown to the others — but the
// VALUES `--format` accepts are the same question answered twice, and two copies of
// it would be free to drift.
export const checkOutputFormats = ['json', 'markdown'] as const

export type CheckOutputFormat = (typeof checkOutputFormats)[number]

// What a check command may put in front of the reader on top of the default
// presentation, which is the report as pretty JSON on stdout and an empty stderr.
// An absent field keeps that default, so a stage that renders nothing extra needs
// to say nothing.
export type CheckCommandPresentation = {
  readonly stdout?: string
  readonly stderr?: string
}

// Presentation runs AFTER the report exists and must never decide whether the
// command succeeded. Rendering a document or writing an artifact is a courtesy to
// the reader; failing an advisory stage because a file could not be written would
// turn "we could not show you this nicely" into "your pipeline is broken", and
// spec 22 makes exiting 0 a requirement rather than a default. So a presentation
// failure degrades to the default JSON output plus a line saying what was lost.
const presentCheckReport = async <TReport>(
  present: ((report: TReport) => Promise<CheckCommandPresentation>) | undefined,
  report: TReport
): Promise<CheckCommandPresentation> => {
  if (present === undefined) {
    return {}
  }

  try {
    return await present(report)
  } catch (error) {
    return {
      stderr: `Could not render or write the report artifacts: ${normalizeError(error, { source: 'report' }).message}\n`
    }
  }
}

// `impact check` and `intent check` are two independently runnable ADVISORY
// stages that share one shape: they accept the two git refs, require the `check`
// subcommand, load configuration in a scope of its own so a malformed config file
// exits 2 as a config error rather than being swept into the repository fallback
// the rest of the command needs for git failures, and then print a report as JSON
// with exit code 0 WHATEVER the report says. Only the report body and its
// presentation differ, so the skeleton is written once here — a further advisory
// stage cannot accidentally acquire the ability to fail a pipeline.
export const runCheckCommand = async <TReport>(
  input: {
    readonly name: string
    readonly args: readonly string[]
    readonly options: CliRunOptions
    // Options this stage accepts beyond the two git refs every check takes. The
    // sets stay per-command rather than pooled into one permissive union, so a
    // flag one stage implements is still unknown to the others.
    readonly commandOptions?: readonly string[]
    readonly report: (context: {
      readonly loadedConfig: LoadedCodeReviewerConfig
      readonly baseRef: string | undefined
      readonly headRef: string | undefined
    }) => Promise<TReport>
    readonly present?: (
      report: TReport,
      context: { readonly loadedConfig: LoadedCodeReviewerConfig }
    ) => Promise<CheckCommandPresentation>
  }
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(input.args, [
    '--base-ref',
    '--head-ref',
    ...(input.commandOptions ?? [])
  ])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  if (input.args[0] !== 'check') {
    return usageError(`Expected command: ${input.name} check`)
  }

  const checkArgs = input.args.slice(1)
  let loadedConfig: LoadedCodeReviewerConfig

  try {
    loadedConfig = await loadConfigForCommand(checkArgs, input.options)
  } catch (error) {
    return mapErrorResult(error, 'config')
  }

  try {
    const report = await input.report({
      loadedConfig,
      baseRef: parseOptionValue(checkArgs, '--base-ref'),
      headRef: parseOptionValue(checkArgs, '--head-ref')
    })
    const present = input.present
    const presentation = await presentCheckReport(
      present === undefined
        ? undefined
        : (presented: TReport) => present(presented, { loadedConfig }),
      report
    )

    return {
      exitCode: 0,
      stdout: presentation.stdout ?? jsonResult(report),
      stderr: presentation.stderr ?? ''
    }
  } catch (error) {
    return mapErrorResult(error, 'repository')
  }
}
