// The one body both advisory `check` commands are.
//
// `impact check` and `intent check` are two independently runnable ADVISORY
// stages that share one shape: they accept the two git refs and `--format`,
// require the `check` subcommand, load configuration in a scope of its own so a
// malformed config file exits 2 as a config error rather than being swept into
// the repository fallback the rest of the command needs for git failures, run
// the stage, and print a report with exit code 0 WHATEVER the report says. A
// further advisory stage cannot accidentally acquire the ability to fail a
// pipeline, because there is no second copy of this to add one to.
//
// Everything the two stages differ on — the switch, the lane, the run, the
// renderer, the artifact names, the stderr label, and whether a given report is
// worth leaving on disk — arrives in the lane descriptor (`advisory-lane.ts`), so
// nothing below branches on which stage is running.
//
// This used to be a generic skeleton taking `report`/`present` callbacks, with
// each command supplying its own pair. The descriptor states the same
// differences as data, so the callback seam had no second implementation left to
// serve and two seams for one job would be the duplication back again.
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { normalizeError } from '../shared/errors/error-normalizer.js'
import {
  runAdvisoryStageReport,
  type AdvisoryLaneDescriptor,
  type AdvisoryModelLane,
  type AdvisoryStageReport
} from './advisory-lane.js'
import { parseEnumOption, parseOptionValue, unknownCliOption } from './args.js'
import type { CliResult, CliRunOptions } from './cli-contract.js'
import { mapErrorResult, usageError } from './cli-error-results.js'
import {
  loadConfigForCommand,
  type LoadedCodeReviewerConfig
} from './command-config.js'
import { createCliLogger } from './command-logging.js'
import { jsonResult, writeAdvisoryCheckArtifacts } from './run-artifacts.js'
import { createRunContext } from '../domains/run-context/index.js'

// JSON is the default because it was the only output these commands ever had, and a
// script reading stdout must keep working unchanged.
//
// ONE definition for both reference stages: the VALUES `--format` accepts are the
// same question answered twice, and two copies of it would be free to drift. The
// option SETS still differ per command — see `AdvisoryLaneDescriptor` — so a flag
// one stage implements stays unknown to the others.
const checkOutputFormats = ['json', 'markdown'] as const

type CheckOutputFormat = (typeof checkOutputFormats)[number]

// What a check command puts in front of the reader on top of the default
// presentation, which is the report as pretty JSON on stdout and an empty stderr.
// An absent field keeps that default.
type CheckCommandPresentation = {
  readonly stdout?: string
  readonly stderr?: string
}

// Presentation runs AFTER the report exists and must never decide whether the
// command succeeded. Rendering a document or writing an artifact is a courtesy to
// the reader; failing an advisory stage because a file could not be written would
// turn "we could not show you this nicely" into "your pipeline is broken", and
// specs 22 and 23 make exiting 0 a requirement rather than a default. So a
// presentation failure degrades to the default JSON output plus a line saying
// what was lost.
const presentCheckReport = async (
  present: () => Promise<CheckCommandPresentation>
): Promise<CheckCommandPresentation> => {
  try {
    return await present()
  } catch (error) {
    return {
      stderr: `Could not render or write the report artifacts: ${normalizeError(error, { source: 'report' }).message}\n`
    }
  }
}

// The report as JSON on stdout is the contract a script already depends on, so
// the rendered Markdown goes to the run directory beside where `review` writes
// `report.md` — a report a reviewer has to go looking for is not in the workflow
// they actually use, which is the gap specs 22 and 23 both record — and its path
// is named on stderr. `--format markdown` puts the same document on stdout for
// someone reading it in a terminal or piping it into a pull-request body.
const presentCheckedReport = async <
  TReport extends AdvisoryStageReport,
  TLane extends AdvisoryModelLane,
  TAgents
>(input: {
  readonly descriptor: AdvisoryLaneDescriptor<TReport, TLane, TAgents>
  readonly report: TReport
  readonly loadedConfig: LoadedCodeReviewerConfig
  readonly format: CheckOutputFormat | undefined
  readonly repositoryRoot: string
}): Promise<CheckCommandPresentation> => {
  const { descriptor, format } = input
  const markdown = descriptor.renderMarkdown(input.report)

  // A run that analysed nothing leaves nothing behind. The report still says so
  // on stdout, and `--format markdown` still renders it.
  if (!descriptor.leavesArtifacts(input.report)) {
    return format === 'markdown' ? { stdout: markdown } : {}
  }

  // A run of its own, in the same place `review` puts one. The id is prefixed so
  // a directory listing says which stage produced it; nothing reads the prefix.
  const artifactRoot = path.posix.join(
    input.loadedConfig.config.paths.artifactDir,
    `${descriptor.command}-${randomUUID()}`
  )

  await writeAdvisoryCheckArtifacts({
    repositoryRoot: input.repositoryRoot,
    artifactRoot,
    jsonArtifactName: descriptor.jsonArtifactName,
    markdownArtifactName: descriptor.markdownArtifactName,
    reportJson: jsonResult(input.report),
    reportMarkdown: markdown
  })

  return {
    ...(format === 'markdown' ? { stdout: markdown } : {}),
    // The path goes to stderr rather than into the report on stdout: the report
    // is a strict schema a consumer parses, and stdout has to stay exactly one
    // JSON document for the scripted use that already exists.
    stderr: `${descriptor.reportLabel}: ${path.posix.join(artifactRoot, descriptor.markdownArtifactName)}\n`
  }
}

/** One advisory `check` command, driven entirely by its lane descriptor. */
export const runAdvisoryCheckCommand = async <
  TReport extends AdvisoryStageReport,
  TLane extends AdvisoryModelLane,
  TAgents
>(
  descriptor: AdvisoryLaneDescriptor<TReport, TLane, TAgents>,
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  let format: CheckOutputFormat | undefined

  // Parsed before the unknown-option sweep, so `--format html` is reported as the
  // unsupported value it is rather than passing that check and failing later.
  try {
    format = parseEnumOption(args, '--format', checkOutputFormats)
  } catch (error) {
    return mapErrorResult(error, 'config')
  }

  const unrecognized = unknownCliOption(args, [
    '--base-ref',
    '--head-ref',
    '--format'
  ])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  if (args[0] !== 'check') {
    return usageError(`Expected command: ${descriptor.command} check`)
  }

  const checkArgs = args.slice(1)
  let loadedConfig: LoadedCodeReviewerConfig

  try {
    loadedConfig = await loadConfigForCommand(checkArgs, options)
  } catch (error) {
    return mapErrorResult(error, 'config')
  }

  try {
    const report = await runAdvisoryStageReport({
      descriptor,
      // One context for the whole invocation. Both advisory commands used to
      // build their own identical mediated retriever and then read the same
      // changed files through it a second time; the duplication was invisible
      // because each command's copy was correct on its own. Handing them one
      // context also means that when the stages run in one process the git
      // subprocesses and file reads happen once for all of them.
      runContext: createRunContext({
        repositoryRoot: options.cwd,
        config: loadedConfig.config
      }),
      baseRef: parseOptionValue(checkArgs, '--base-ref'),
      headRef: parseOptionValue(checkArgs, '--head-ref'),
      environment: options.environment ?? {},
      generatedAt: options.now?.(),
      providerImport: options.providerImport,
      logger: createCliLogger({
        config: loadedConfig.config,
        command: descriptor.command,
        sink: options.logSink
      })
    })
    const presentation = await presentCheckReport(async () =>
      presentCheckedReport({
        descriptor,
        report,
        loadedConfig,
        format,
        repositoryRoot: options.cwd
      })
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
