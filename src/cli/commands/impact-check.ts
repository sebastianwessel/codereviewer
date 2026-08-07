// `impact check` (spec 22).
//
// It produces a REFERENCE report plus the adjudicated subset of it: the dependents
// shown to rely on the part of the contract that changed, each with its path, its
// line, the contract element and the consequence. Nothing here carries a severity —
// spec 22's findings carry a COMPATIBILITY CLASS instead — and nothing can block.
// The exit code is 0 whatever the report says, and only a configuration (2) or
// repository (3) failure changes that. A breaking change is frequently
// intentional; the command's job is to surface the dependents, not to decide
// whether breaking them is acceptable.
//
// It makes a provider call ONLY for the residue, and only when
// `changeImpact.adjudication.enabled` is set: everything structural — a removed,
// relocated or newly added declaration — is settled in code, and a run without a
// provider still emits those findings and counts the rest as unadjudicated. With
// adjudication off the command remains fully deterministic and free.
//
// The reference list is also spec 22's own falsifier: its removal criterion is
// that the capability must beat naming the changed symbols and letting a human
// grep, and that list IS that baseline.
//
// Its output goes three places, for one reason each. The JSON stays on stdout so
// scripted use keeps working. The rendered Markdown lands in the run directory
// beside where `review` writes `report.md`, because a report a reviewer has to go
// looking for is not in the workflow they actually use — spec 22 records exactly
// that gap. `--format markdown` puts the same document on stdout for someone
// reading it in a terminal or piping it into a pull-request body.
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  createChangeImpactLane,
  renderChangeImpactMarkdown,
  runChangeImpact
} from '../../domains/change-impact/index.js'
import { createContextRetriever } from '../../domains/context-retrieval/index.js'
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
  IMPACT_MARKDOWN_ARTIFACT_NAME,
  jsonResult,
  writeChangeImpactArtifacts
} from '../run-artifacts.js'

export const runImpact = async (
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
    name: 'impact',
    args,
    options,
    commandOptions: ['--format'],
    report: async ({ loadedConfig, baseRef, headRef }) => {
      // The read budget is sized to the review file cap, which is the same bound
      // intake applies to how many files can be changed in one run.
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
        command: 'impact',
        sink: options.logSink
      })
      // Absent unless adjudication is enabled AND a provider resolves. Every other
      // outcome reports `adjudicationStatus: "no-model"`, still emits the findings
      // that need no model, and still exits 0.
      const lane = await createChangeImpactLane({
        config: loadedConfig.config,
        environment: options.environment ?? {},
        ...(options.providerImport === undefined
          ? {}
          : { providerImport: options.providerImport }),
        logger
      })

      try {
        return await runChangeImpact({
          repositoryRoot: options.cwd,
          config: loadedConfig.config,
          ...(baseRef === undefined ? {} : { baseRef }),
          ...(headRef === undefined ? {} : { headRef }),
          ...(options.now === undefined ? {} : { generatedAt: options.now() }),
          ...(lane === undefined
            ? {}
            : {
                agents: { judgeReliance: lane.judgeReliance },
                usage: lane.usage
              }),
          readChangedFile: mediatedFileReader(retriever)
        })
      } finally {
        await lane?.shutdown()
      }
    },
    present: async (report, { loadedConfig }) => {
      const markdown = renderChangeImpactMarkdown(report)

      // A disabled run analysed nothing, so it leaves nothing behind. Writing a
      // run directory per invocation for a capability that is off by default
      // would accumulate empty runs in a repository whose owner never asked for
      // the stage — and these directories are not in the run index, so nothing
      // would ever enumerate them again. The report still says `disabled` on
      // stdout, and `--format markdown` still renders it.
      if (report.status === 'disabled') {
        return format === 'markdown' ? { stdout: markdown } : {}
      }

      // A run of its own, in the same place `review` puts one. The id is prefixed
      // so a directory listing says which stage produced it; nothing reads the
      // prefix.
      const artifactRoot = path.posix.join(
        loadedConfig.config.paths.artifactDir,
        `impact-${randomUUID()}`
      )

      await writeChangeImpactArtifacts({
        repositoryRoot: options.cwd,
        artifactRoot,
        reportJson: jsonResult(report),
        reportMarkdown: markdown
      })

      return {
        ...(format === 'markdown' ? { stdout: markdown } : {}),
        // The path goes to stderr rather than into the report on stdout: the
        // report is a strict schema a consumer parses, and stdout has to stay
        // exactly one JSON document for the scripted use that already exists.
        stderr: `Change-impact report: ${path.posix.join(artifactRoot, IMPACT_MARKDOWN_ARTIFACT_NAME)}\n`
      }
    }
  })
}
