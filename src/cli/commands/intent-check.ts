// `intent check` (spec 23).
//
// What it produces is a MAPPING between the stated intent and the change: the
// obligations the intent states, each citing the line it was read from, and for
// each one either the changed lines that address it or nothing. It is not a
// verdict, nothing is admitted, nothing carries a severity, and spec 23 makes
// advisory-only a REQUIREMENT rather than a default — "The command MUST NOT be
// able to fail a pipeline on fulfilment grounds. This is not configurable" —
// because published measurement puts spurious rejection of model requirement-
// conformance judgement at 26-36%, rising to 73-88% when the same call also
// explains itself. The exit code is therefore 0 whatever the report says,
// INCLUDING when there is no intent to read, and only a configuration or usage
// failure (2) or a repository failure (3) changes it.
//
// It is one of three independently runnable stages and shares no context or output
// with the other two: `review` can block, `intent check` and `impact check`
// cannot.
//
// Output mirrors `impact check`: stdout stays exactly one JSON document so scripted
// use keeps working, and the rendered Markdown lands in a run directory beside where
// `review` writes `report.md`. The rendering matters more here than there — this
// lane's dominant measured error is a MISREAD answer rather than a wrong one, and a
// document that names what the search found is where that is preserved or lost. See
// `intent-markdown.ts`.
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createContextRetriever } from '../../domains/context-retrieval/index.js'
import {
  createIntentFulfilmentLane,
  renderIntentFulfilmentMarkdown,
  runIntentFulfilment
} from '../../domains/intent-fulfilment/index.js'
import {
  checkOutputFormats,
  runCheckCommand,
  type CheckOutputFormat
} from '../advisory-check-command.js'
import { parseEnumOption } from '../args.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'
import { mapErrorResult } from '../cli-error-results.js'
import { createCliLogger } from '../command-logging.js'
import { mediatedFileReader } from '../mediated-file-reader.js'
import {
  INTENT_MARKDOWN_ARTIFACT_NAME,
  jsonResult,
  writeIntentFulfilmentArtifacts
} from '../run-artifacts.js'

export const runIntent = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  let format: CheckOutputFormat | undefined

  try {
    format = parseEnumOption(args, '--format', checkOutputFormats)
  } catch (error) {
    return mapErrorResult(error, 'config')
  }

  return runCheckCommand({
    name: 'intent',
    args,
    options,
    commandOptions: ['--format'],
    report: async ({ loadedConfig, baseRef, headRef }) => {
      // Change-intent sources are read by spec 11's ingestion instead of through
      // this retriever, which owns its own bounds and its own redaction.
      const retriever = createContextRetriever({
        repositoryRoot: options.cwd,
        budget: {
          maxReads: loadedConfig.config.review.maxFiles,
          maxBytesPerRead: loadedConfig.config.review.maxFileBytes,
          maxSearches: 0
        },
        paths: {
          include: loadedConfig.config.paths.include,
          exclude: loadedConfig.config.paths.exclude
        }
      })
      const logger = createCliLogger({
        config: loadedConfig.config,
        command: 'intent',
        sink: options.logSink
      })
      // Absent unless the capability is enabled AND a provider resolves. Every other
      // outcome reports `provider-unavailable` with a warning and still exits 0.
      const lane = await createIntentFulfilmentLane({
        config: loadedConfig.config,
        environment: options.environment ?? {},
        ...(options.providerImport === undefined
          ? {}
          : { providerImport: options.providerImport }),
        logger
      })

      try {
        return await runIntentFulfilment({
          repositoryRoot: options.cwd,
          config: loadedConfig.config,
          ...(baseRef === undefined ? {} : { baseRef }),
          ...(headRef === undefined ? {} : { headRef }),
          ...(options.now === undefined ? {} : { generatedAt: options.now() }),
          ...(lane === undefined
            ? {}
            : {
                agents: {
                  extractObligations: lane.extractObligations,
                  judge: lane.judge,
                  explain: lane.explain
                },
                usage: lane.usage
              }),
          readChangedFile: mediatedFileReader(retriever)
        })
      } finally {
        await lane?.shutdown()
      }
    },
    present: async (report, { loadedConfig }) => {
      const markdown = renderIntentFulfilmentMarkdown(report)

      // The four outcomes that mapped nothing leave nothing behind. Writing a run
      // directory per invocation for a capability that is off by default would
      // accumulate empty directories in a repository whose owner never asked for
      // the stage — and they are not in the run index, so nothing would ever
      // enumerate them again. `no-intent` is the ordinary case for most changes,
      // which is exactly why it must not litter. The report still says so on
      // stdout, and `--format markdown` still renders it.
      if (report.status !== 'completed') {
        return format === 'markdown' ? { stdout: markdown } : {}
      }

      const artifactRoot = path.posix.join(
        loadedConfig.config.paths.artifactDir,
        `intent-${randomUUID()}`
      )

      await writeIntentFulfilmentArtifacts({
        repositoryRoot: options.cwd,
        artifactRoot,
        reportJson: jsonResult(report),
        reportMarkdown: markdown
      })

      return {
        ...(format === 'markdown' ? { stdout: markdown } : {}),
        // The path goes to stderr rather than into the report on stdout: the report
        // is a strict schema a consumer parses, and stdout has to stay exactly one
        // JSON document for the scripted use that already exists.
        stderr: `Intent-fulfilment report: ${path.posix.join(artifactRoot, INTENT_MARKDOWN_ARTIFACT_NAME)}\n`
      }
    }
  })
}
