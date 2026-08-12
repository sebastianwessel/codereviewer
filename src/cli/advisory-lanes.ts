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
  // The `--file`/`--files` list, when the run was given one. REQUIRED as a key
  // even though the value may be `undefined`, so a caller has to state whether
  // this run was scoped to explicit paths rather than inherit an answer — the
  // property that has to be stated is exactly the one a future call site would
  // otherwise forget, and forgetting it is how this went unnoticed.
  readonly explicitFiles: readonly string[] | undefined
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

// "There was no change set to reason about" is NOT "the stage broke", and both
// stages hit it at the same moment: a scratch directory, a shallow CI clone, or
// a `review --files …` run whose refs share no history reaches intake with
// nothing to diff. Before this distinction existed, the default run reported
// twice that a stage "could not complete", followed by intake's own remediation
// sentence — text that reads like the engine failed on an ordinary repository.
//
// The warning is NOT removed. Absence must never produce a clean answer here: a
// reader who expected an impact or intent report is still told there is none,
// and why. Only the sentence changes, and only for the codes below — every other
// failure keeps the language of a failure.
//
// Keyed by code rather than by category because the whole point is to be narrow:
// `repository` also covers a timeout, an unknown ref and an unreadable file,
// none of which are ordinary.
const ordinaryEmptyChangeSetReasons: Readonly<Record<string, string>> = {
  merge_base_unavailable:
    'git could not resolve a merge base for the base and head refs, which is ordinary in a shallow clone or a checkout without their shared history',
  no_reviewable_change: 'the base and head refs differ by no files'
}

// NEITHER STAGE CAN ANSWER AN EXPLICIT-FILE RUN, and the reason is structural
// rather than a missing feature. `review --file`/`--files` bypasses git entirely
// and reviews exactly the paths it names (the run summary carries no
// `mergeBaseRef` for precisely this reason); both stages are defined over a
// base/head DIFF and take no path list. Run anyway, they resolve the ambient
// refs and answer a question about a different change set than the one under
// review — `impact-report.json` naming symbols in files the run never opened,
// and the intent stage paying a provider per obligation to hold the change to
// obligations it was not asked about — with the two artifacts sitting in one run
// directory disagreeing about what "this change" is.
//
// Latent while both stages were off by default. Live from 2026-08-11, when they
// were flipped on and every explicit-file run started doing this.
//
// SPECS 22 AND 23 DO NOT COVER THIS CASE. Both say the lane runs in-process
// "when `<flag>.enabled` is true" and neither mentions an explicit-file run, so
// this narrowing is ahead of the specs rather than derived from them. It is
// recorded here rather than written into `specs/`, which is the human's to
// change: the sentence each spec is owed is that a stage defined over a diff does
// not answer a run that has none.
//
// Skipped WITH A WARNING, never silently, for the reason the whole file is built
// around: absence must not read as an answer. "No impact report" and "nothing
// depends on your change" are the same shape on disk, and only one of them is
// true here. The remedy is named because there is one — the stages' own commands
// still take refs. Each stage names ITS OWN command, because both warnings appear
// together on a default run and a reader following one of them must not be sent
// to the other's answer.
const explicitFileSkipWarning = (input: {
  readonly name: string
  readonly command: string
}): string =>
  `The ${input.name} stage produced no report because this run was scoped to an explicit file list (\`--file\`/\`--files\`), which bypasses the diff this stage reads. Run \`codereviewer ${input.command} check --base-ref <ref> --head-ref <ref>\` over the refs you want covered.`

// The stage did not produce a report, and the reader is told which one and why —
// an advisory stage that vanishes without a word is indistinguishable from one
// that found nothing.
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
    const ordinaryReason = ordinaryEmptyChangeSetReasons[normalized.code]

    if (ordinaryReason !== undefined) {
      // `info`, not `warn`: nothing here needs an operator's attention, and a
      // warn-level log on every scratch-directory run trains readers to ignore
      // the level that does matter.
      input.logger.info(
        `The ${input.name} stage had no change set to work from and produced no report.`,
        { stage: input.name, error_code: normalized.code }
      )

      return {
        report: undefined,
        warnings: [
          `The ${input.name} stage produced no report because this run has no change set to compare: ${ordinaryReason}.`
        ]
      }
    }

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

  // Checked after `enabled`, so a stage the operator switched off stays silent
  // here too: it was never going to answer, and there is nothing to explain the
  // absence of.
  if (input.explicitFiles !== undefined) {
    return {
      report: undefined,
      warnings: [
        explicitFileSkipWarning({ name: 'change-impact', command: 'impact' })
      ]
    }
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

  if (input.explicitFiles !== undefined) {
    return {
      report: undefined,
      warnings: [
        explicitFileSkipWarning({ name: 'intent-fulfilment', command: 'intent' })
      ]
    }
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
