// The two advisory reference stages (specs 22 and 23) as the `review` command
// drives them, in the SAME process and over the SAME run context.
//
// They stayed separate CLI commands for a reason that is still true — each is
// independently runnable, and `impact check` / `intent check` still exist — but
// running them as three processes meant three git intakes, three reads of every
// changed file, and two sweeps of the external context providers, for one push.
// Nothing about the stages required that; only the process boundary did.
//
// TWO GUARANTEES SURVIVE THE MOVE, and they are the reason this file exists
// rather than the stages being inlined into the review command:
//
//   1. An advisory stage still CANNOT fail the pipeline. Specs 22 and 23 make
//      that a requirement, not a default. Running inside `review` puts them next
//      to a stage that CAN fail, so each is wrapped here: a throw becomes a
//      warning on the review report and an absent stage report, never a non-zero
//      exit and never a lost review.
//   2. A disabled stage runs NOTHING. The flags are the operator's statement
//      about which questions to ask; being invoked from `review` does not turn a
//      stage on.
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  createChangeImpactLane,
  runChangeImpact,
  type ChangeImpactReferenceReport
} from '../domains/change-impact/index.js'
import {
  createIntentFulfilmentLane,
  runIntentFulfilment,
  type IntentFulfilmentReport
} from '../domains/intent-fulfilment/index.js'
import { normalizeError } from '../shared/errors/error-normalizer.js'
import type { Logger } from '../domains/observability/index.js'
import type { RunContext } from '../domains/run-context/index.js'
import type { CliRunOptions } from './cli-contract.js'

export type AdvisoryLaneInput = {
  readonly options: CliRunOptions
  readonly runContext: RunContext
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly baseRef: string | undefined
  readonly headRef: string | undefined
  readonly logger: Logger
}

export type AdvisoryLaneResults = {
  readonly impact: ChangeImpactReferenceReport | undefined
  readonly intent: IntentFulfilmentReport | undefined
  // Surfaced as review-run warnings, the same way the change-intent provider
  // failure already is. A stage that could not run says so on the one report the
  // reader is already looking at; silence would be the defect.
  readonly warnings: readonly string[]
}

// The stage ran and threw. Its report is lost, the review is not, and the reader
// is told which stage went missing and why — an advisory stage that vanishes
// without a word is indistinguishable from one that found nothing.
const guardAdvisoryStage = async <TReport>(
  input: {
    readonly name: string
    readonly logger: Logger
    readonly run: () => Promise<TReport>
  }
): Promise<{
  readonly report: TReport | undefined
  readonly warnings: readonly string[]
}> => {
  try {
    return { report: await input.run(), warnings: [] }
  } catch (error) {
    const normalized = normalizeError(error, { source: 'repository' })

    input.logger.warn(`The ${input.name} stage failed and was skipped.`, {
      stage: input.name,
      error_code: normalized.code
    })

    return {
      report: undefined,
      warnings: [
        `The ${input.name} stage could not complete and produced no report for this run: ${normalized.message}`
      ]
    }
  }
}

const runImpactStage = async (
  input: AdvisoryLaneInput
): Promise<{
  readonly report: ChangeImpactReferenceReport | undefined
  readonly warnings: readonly string[]
}> => {
  if (!input.runContext.config.changeImpact.enabled) {
    return { report: undefined, warnings: [] }
  }

  return await guardAdvisoryStage({
    name: 'change-impact',
    logger: input.logger,
    run: async () => {
      const lane = await createChangeImpactLane({
        config: input.runContext.config,
        environment: input.environment,
        ...(input.options.providerImport === undefined
          ? {}
          : { providerImport: input.options.providerImport }),
        logger: input.logger
      })

      try {
        return await runChangeImpact({
          repositoryRoot: input.runContext.repositoryRoot,
          config: input.runContext.config,
          ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
          ...(input.headRef === undefined ? {} : { headRef: input.headRef }),
          ...(input.options.now === undefined
            ? {}
            : { generatedAt: input.options.now() }),
          ...(lane === undefined
            ? {}
            : {
                agents: { judgeReliance: lane.judgeReliance },
                usage: lane.usage
              }),
          readChangedFile: input.runContext.readChangedFile,
          runGit: input.runContext.runGit
        })
      } finally {
        await lane?.shutdown()
      }
    }
  })
}

const runIntentStage = async (
  input: AdvisoryLaneInput
): Promise<{
  readonly report: IntentFulfilmentReport | undefined
  readonly warnings: readonly string[]
}> => {
  if (!input.runContext.config.intentFulfilment.enabled) {
    return { report: undefined, warnings: [] }
  }

  return await guardAdvisoryStage({
    name: 'intent-fulfilment',
    logger: input.logger,
    run: async () => {
      const lane = await createIntentFulfilmentLane({
        config: input.runContext.config,
        environment: input.environment,
        ...(input.options.providerImport === undefined
          ? {}
          : { providerImport: input.options.providerImport }),
        logger: input.logger
      })

      try {
        return await runIntentFulfilment({
          repositoryRoot: input.runContext.repositoryRoot,
          config: input.runContext.config,
          ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
          ...(input.headRef === undefined ? {} : { headRef: input.headRef }),
          ...(input.options.now === undefined
            ? {}
            : { generatedAt: input.options.now() }),
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
          readChangedFile: input.runContext.readChangedFile,
          runGit: input.runContext.runGit
        })
      } finally {
        await lane?.shutdown()
      }
    }
  })
}

/**
 * Runs every enabled advisory stage for one review, sequentially.
 *
 * Sequential rather than concurrent on purpose: the point of sharing a run
 * context is that the second stage finds the first stage's git output and file
 * reads already done. Racing them would have both miss the cache and issue the
 * duplicate subprocesses this exists to remove.
 */
export const runAdvisoryStagesForReview = async (
  input: AdvisoryLaneInput
): Promise<AdvisoryLaneResults> => {
  const impact = await runImpactStage(input)
  const intent = await runIntentStage(input)

  return {
    impact: impact.report,
    intent: intent.report,
    warnings: [...impact.warnings, ...intent.warnings]
  }
}

/**
 * Where an advisory stage's artifacts go when it ran as part of a review.
 *
 * Inside the REVIEW's run directory, not a sibling `impact-<uuid>` of its own.
 * One push produced up to three unrelated directories that nothing linked; a
 * reader holding a review run id could not find the impact report that ran
 * beside it. Standalone `impact check` keeps minting its own directory, because
 * there is no review run for it to belong to.
 */
export const advisoryArtifactRoot = (
  artifactDir: string,
  runId: string | undefined
): string =>
  path.posix.join(artifactDir, runId ?? `advisory-${randomUUID()}`)
