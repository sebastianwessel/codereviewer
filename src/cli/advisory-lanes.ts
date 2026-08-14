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
//
// WHY THIS FILE IS IN `src/cli/` AND NOT IN A DOMAIN. It imports `change-impact`
// and `intent-fulfilment`, and spec 01 (enforced structurally by
// `domains/change-impact/import-boundary.test.ts`) forbids `review-workflow`
// importing `change-impact` and vice versa, in both directions. That boundary
// exists for a product reason: a failed impact review must not be able to fail a
// diff review it shares no code path with. This file COMPOSES two independent
// advisory domains, and composing domains is what the CLI/application layer is
// for — so it stays here. Do not "tidy" it into `review-workflow`.
import type { ChangeImpactReferenceReport } from '../domains/change-impact/index.js'
import type { IntentFulfilmentReport } from '../domains/intent-fulfilment/index.js'
import { roundUsd, type LaneUsage } from '../domains/costs/index.js'
import { normalizeError } from '../shared/errors/error-normalizer.js'
import type { Logger } from '../domains/observability/index.js'
import type { RunContext } from '../domains/run-context/index.js'
import {
  changeImpactLaneDescriptor,
  intentFulfilmentLaneDescriptor,
  runAdvisoryStageReport,
  type AdvisoryLaneDescriptor,
  type AdvisoryModelLane,
  type AdvisoryStageReport
} from './advisory-lane.js'
import type { CliRunOptions } from './cli-contract.js'

// The run's model-spend ceiling and what it has spent against it so far.
//
// `spentUsd` is `undefined` when the spend is NOT KNOWN — no provider cost and
// no configured price — which is a different fact from having spent nothing, and
// the two must not be conflated: one means "there is room", the other means
// "nobody can say".
export type AdvisoryCostBudget = {
  readonly maxCostUsd: number | undefined
  readonly spentUsd: number | undefined
}

export type AdvisoryLaneInput = {
  readonly options: CliRunOptions
  readonly runContext: RunContext
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly baseRef: string | undefined
  readonly headRef: string | undefined
  // REQUIRED as a key, for the same reason `explicitFiles` is: a caller has to
  // state what this run may still spend rather than inherit an answer.
  readonly costBudget: AdvisoryCostBudget
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

// BOTH STAGES SPEND, AND `review.maxCostUsd` DID NOT REACH THEM.
//
// The cap is checked once, on the review's own cost, before the success result
// is built (`run/results/completion-state.ts`). Both stages run after that, from
// `review.ts`, and neither carried any cost accounting of its own — so a
// configured cap bounded the review and nothing else. The intent stage pays a
// provider PER OBLIGATION (`intentFulfilment.maxObligations`, default 100), so
// what the cap failed to bound is material rather than marginal. Latent while
// both stages were off by default; live since they were flipped on.
//
// ONE CEILING, NOT THREE. The number an operator writes in `review.maxCostUsd`
// is what they are willing to spend on `codereviewer review`. A per-stage cap
// would let one invocation spend a multiple of that number with every stage
// reporting itself within budget, so the stages consume the HEADROOM the review
// left, in the order they run, each measured against what the ones before it
// actually spent.
//
// BOUNDED YET UNABLE TO FAIL THE RUN — in tension only if "bounded" is read as
// "gated". Specs 22 and 23 forbid an advisory stage failing the pipeline, and
// this stops SPENDING rather than judging: a stage with no headroom does not
// start, the review keeps its own exit code and quality gate, and the reader
// gets the warning below. No budget outcome here can reach the gate.
//
// STOPPED BEFORE, NOT REPORTED AFTER. An overrun reported afterwards is a
// receipt, not a bound — the money is spent by the time it is written. The check
// sits ahead of the diff, so a stage with no headroom issues no git subprocess
// and resolves no provider.
//
// WHAT IT DOES NOT BOUND, said plainly because a half-described bound is worse
// than none: a stage that STARTS with headroom runs to completion, so the run's
// true ceiling is the cap plus one stage's spend. Cutting a stage off mid-flight
// would have to publish a partial report, and neither spec defines one. The fix
// and verification lanes (spec 12) also spend after the review's check; their
// spend is COUNTED here, but they are not themselves gated — the same argument
// applies to them and it is a separate change.
//
// SPECS 04, 22 AND 23 DO NOT COVER THIS. Spec 04 documents `maxCostUsd` as a
// check on the review's computed cost that fails the run; neither stage spec
// mentions cost. This is ahead of the specs rather than derived from them, and
// is recorded here rather than written into `specs/`, which is the human's to
// change — exactly as the explicit-file narrowing above is. The sentence they
// are owed: a stage that spends is bounded by the run's cost budget, and it
// stops instead of failing.
//
// `undefined` when the stage may proceed. The rule lives in one place because
// both stages ask the same question and a second copy would drift.
const advisoryBudgetSkipWarning = (input: {
  readonly name: string
  readonly command: string
  readonly budget: AdvisoryCostBudget
}): string | undefined => {
  const { maxCostUsd, spentUsd } = input.budget

  // No cap configured, or a spend nobody can compute — spec 04 already states
  // the review's own cap goes unenforced when cost is unavailable, and refusing
  // a stage on a total that does not exist would be inventing an overrun.
  if (maxCostUsd === undefined || spentUsd === undefined) {
    return undefined
  }

  // `>=`, where the review's own check uses `>`. That check judges an amount
  // already spent; this one asks whether there is room to spend more. A run
  // landing exactly on its cap passes the review and arrives here with nothing
  // left, and no stage can spend zero.
  if (spentUsd < maxCostUsd) {
    return undefined
  }

  return `The ${input.name} stage produced no report because this run had already spent ${spentUsd} USD of its ${maxCostUsd} USD budget (review.maxCostUsd), and this stage spends per model call. It was stopped before spending rather than reported over budget afterwards; the review itself is unaffected. Raise review.maxCostUsd, or run \`codereviewer ${input.command} check --base-ref <ref> --head-ref <ref>\` under its own budget.`
}

/**
 * Folds one stage's spend into the budget the next stage is measured against.
 *
 * The figure is the `usage` block the stage already publishes on its own report,
 * so enforcement and the artifact a reader inspects cannot disagree.
 */
export const advisoryCostBudgetAfterLane = (
  budget: AdvisoryCostBudget,
  usage: LaneUsage | undefined
): AdvisoryCostBudget => {
  // No usage block at all: the stage resolved no provider or made no call and
  // spent nothing. A KNOWN zero, unlike the unpriced case below.
  if (usage === undefined) {
    return budget
  }

  return {
    maxCostUsd: budget.maxCostUsd,
    spentUsd:
      // Tokens the run has no price for. Treating them as free would wave the
      // next stage through on a total known to be too low, which is the silent
      // optimism this repository keeps finding; the total becomes unknown
      // instead, which stops enforcement rather than faking it.
      usage.costUsd === undefined || budget.spentUsd === undefined
        ? undefined
        : roundUsd(budget.spentUsd + usage.costUsd)
  }
}

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

// One advisory stage inside a `review` run: the switch, the two skip rules, and
// the failure guard, in the order a reader is owed them.
//
// Which stage this is arrives entirely in the descriptor. The two stages used to
// be two functions differing only by noun substitution, which is how the
// `explicitFiles` check reached one of them a day before the other.
const runAdvisoryStage = async <
  TReport extends AdvisoryStageReport,
  TLane extends AdvisoryModelLane,
  TAgents
>(
  descriptor: AdvisoryLaneDescriptor<TReport, TLane, TAgents>,
  input: AdvisoryLaneInput
): Promise<{
  readonly report: TReport | undefined
  readonly warnings: readonly string[]
}> => {
  if (!descriptor.isEnabled(input.runContext.config)) {
    return { report: undefined, warnings: [] }
  }

  // Checked after `enabled`, so a stage the operator switched off stays silent
  // here too: it was never going to answer, and there is nothing to explain the
  // absence of.
  if (input.explicitFiles !== undefined) {
    return {
      report: undefined,
      warnings: [explicitFileSkipWarning(descriptor)]
    }
  }

  // After the explicit-file check, because that run would not have spent
  // anything anyway: the reason a reader is owed is the structural one.
  const budgetSkip = advisoryBudgetSkipWarning({
    name: descriptor.name,
    command: descriptor.command,
    budget: input.costBudget
  })

  if (budgetSkip !== undefined) {
    return { report: undefined, warnings: [budgetSkip] }
  }

  return await guardAdvisoryStage({
    name: descriptor.name,
    logger: input.logger,
    run: async () =>
      await runAdvisoryStageReport({
        descriptor,
        runContext: input.runContext,
        environment: input.environment,
        baseRef: input.baseRef,
        headRef: input.headRef,
        generatedAt: input.options.now?.(),
        providerImport: input.options.providerImport,
        logger: input.logger
      })
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
  const impact = await runAdvisoryStage(changeImpactLaneDescriptor, input)
  // The second stage is measured against what the first one actually spent.
  // Checking both against the review's spend alone would let the second run on
  // headroom the first had already consumed — the sequential order is what makes
  // a shared ceiling enforceable at all.
  const intent = await runAdvisoryStage(intentFulfilmentLaneDescriptor, {
    ...input,
    costBudget: advisoryCostBudgetAfterLane(
      input.costBudget,
      impact.report?.usage
    )
  })

  return {
    impact: impact.report,
    intent: intent.report,
    warnings: [...impact.warnings, ...intent.warnings]
  }
}
