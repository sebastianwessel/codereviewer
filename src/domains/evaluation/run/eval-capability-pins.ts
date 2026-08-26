// THE COMMITTED EVALUATION CONFIGURATION. `eval run` measures a fixed engine,
// not whichever capability set the schema defaults happened to hold on the day
// the run was started or whichever `.codereviewer/config.json` happened to sit
// in the working directory.
//
// It exists because the alternative was tried and failed. Spec 11 used to claim
// eval runs ingested no external context "as a property of the committed
// evaluation configuration"; no such configuration existed, the claim rested on
// `contextSources` happening to default OFF, and the 2026-08-11 default flip
// removed the accident underneath it. Every number in
// `reports/eval-results-ledger.md` was then one default flip away from being
// incomparable to the next run, with nothing in the run saying so.
//
// WHAT IS PINNED: exactly the capability toggles `eval run` can actually reach —
// the review pipeline it drives (`runReview`) plus the fix lane
// `eval-case-runner.ts` invokes. A toggle that no eval-run code path reads
// cannot move a measured number, and pinning it would be noise that still has to
// be maintained. The excluded set is named at the bottom of this file, with the
// command that DOES read each one, so the exclusion is checkable rather than
// asserted.
//
// WHAT EACH IS PINNED TO: the value the ledger's live baselines were measured
// under. That rule, and not "whatever ships", is what keeps a re-run comparable
// to the population it is being compared against — the ledger is a longitudinal
// instrument, and an instrument whose zero point follows the product default
// re-zeroes itself every time a default moves. Two pins therefore disagree with
// today's shipped default on purpose; both say so below.
//
// HOW A PIN CHANGES: run the A/B through `--capability`, record it in the
// ledger, edit the pin here in its own commit, and re-baseline. The pin is the
// thing that makes "re-baseline owed" a statement someone can act on.
//
// WHY THIS IS IN THE EVALUATION DOMAIN AND THE `--capability` PARSER IS NOT:
// this file is the answer to "what configuration was a published number
// measured under", which is measurement policy and belongs beside the runner
// that produces the number. Reading `--capability <flag>=<bool>` off an argv
// array is a command-line concern with no bearing on that answer, and it lives
// in `src/cli/eval-capability-overrides.ts` — where it can use the CLI's own
// option parser without this domain having to import the CLI, which would
// invert the layering. The two halves meet at `evalCapabilityPins`: the parser
// reads the flag NAMES off the table to decide what it will accept, so there is
// still exactly one list of pinned flags.
import {
  CodeReviewerConfigSchema,
  type CodeReviewerConfig
} from '../../../shared/contracts/index.js'
import type { EvalReportCapabilityFlags } from '../report/eval-report-contracts.js'

// One pinned toggle. `read` and `write` are written out per flag rather than
// derived from the `flag` string, for the reason `eval-capability-flags.ts`
// gives beside it: a string-path walk satisfies the type with whatever it
// happens to find, while an explicit accessor pair is checked against the
// configuration type, so a renamed or removed configuration key fails to
// compile instead of silently pinning nothing.
type EvalCapabilityPin = {
  readonly flag: keyof EvalReportCapabilityFlags
  readonly pinned: boolean
  readonly read: (config: CodeReviewerConfig) => boolean
  readonly write: (
    config: CodeReviewerConfig,
    value: boolean
  ) => CodeReviewerConfig
}

export const evalCapabilityPins: readonly EvalCapabilityPin[] = [
  {
    // ON since 2026-08-01 and on for both live baselines (2026-08-05 in-diff,
    // 2026-08-07 security). Pinned at the measured value, which is also the
    // shipped default.
    flag: 'review.crossFileRetrieval.enabled',
    pinned: true,
    read: (config) => config.review.crossFileRetrieval.enabled,
    write: (config, value) => ({
      ...config,
      review: {
        ...config.review,
        crossFileRetrieval: { ...config.review.crossFileRetrieval, enabled: value }
      }
    })
  },
  {
    // Measured 2026-08-10 and not promoted; off in the shipped default and off
    // for every baseline.
    flag: 'review.signalFacts.enabled',
    pinned: false,
    read: (config) => config.review.signalFacts.enabled,
    write: (config, value) => ({
      ...config,
      review: {
        ...config.review,
        signalFacts: { ...config.review.signalFacts, enabled: value }
      }
    })
  },
  {
    // DISAGREES WITH THE SHIPPED DEFAULT, deliberately. Citations were flipped on
    // 2026-08-10 for readability and explicitly not for accuracy — their own
    // pre-registered A/B moved in-diff recall −3.2pp (not significant) and the
    // promotion rule was not met. Both live baselines were measured with the
    // channel empty, so pinning it on would move the eval's zero point by an
    // amount the ledger has already measured as adverse, to buy a report-rendering
    // property the eval does not score. Flip the pin when a run re-establishes the
    // baseline with citations on, not before.
    flag: 'review.citations.enabled',
    pinned: false,
    read: (config) => config.review.citations.enabled,
    write: (config, value) => ({
      ...config,
      review: {
        ...config.review,
        citations: { ...config.review.citations, enabled: value }
      }
    })
  },
  {
    // Skills are read out of the REVIEWED repository, so leaving this to the
    // ambient default lets a fixture checkout change the discovery packet. Off
    // in the shipped default and for every baseline.
    flag: 'skills.enabled',
    pinned: false,
    read: (config) => config.skills.enabled,
    write: (config, value) => ({
      ...config,
      skills: { ...config.skills, enabled: value }
    })
  },
  {
    // Pinned ON, matching the default and every baseline, even though no fixture
    // carries a `.codereviewer/baseline.json` — which is exactly why the flag is
    // inert today. It is pinned rather than dropped because `enabled: false` is
    // NOT the same run: a disabled baseline yields an EMPTY fingerprint set where
    // an absent file yields NONE, and admission distinguishes the two. Pinning it
    // off to defend against a stray fixture baseline file would therefore change
    // the measurement in order to protect it.
    flag: 'baseline.enabled',
    pinned: true,
    read: (config) => config.baseline.enabled,
    write: (config, value) => ({
      ...config,
      baseline: { ...config.baseline, enabled: value }
    })
  },
  {
    // Without it there is no model review to measure. Pinned so a repository
    // config that switches the engine off cannot turn an eval run into a
    // zero-recall report that looks like a regression.
    flag: 'aiReview.enabled',
    pinned: true,
    read: (config) => config.aiReview.enabled,
    write: (config, value) => ({
      ...config,
      aiReview: { ...config.aiReview, enabled: value }
    })
  },
  {
    // DISAGREES WITH THE SHIPPED DEFAULT, deliberately, and this is the pin the
    // file was written for. `contextSources` went on by default on 2026-08-11,
    // UNMEASURED and stated as such in its own schema comment; the brief it
    // produces is injected into every discovery packet. Every figure in the
    // ledger predates the flip, so an eval run that inherited it would compare a
    // reviewer shown the change intent against a population that never was. The
    // owed A/B (on vs off, security corpus) is how this pin changes: run it with
    // `--capability contextSources.enabled=true`.
    flag: 'contextSources.enabled',
    pinned: false,
    read: (config) => config.contextSources.enabled,
    write: (config, value) => ({
      ...config,
      contextSources: { ...config.contextSources, enabled: value }
    })
  },
  {
    // Off in the shipped default and for every baseline; the security lift it
    // exists for was never shown and it costs +61%.
    flag: 'security.dedicatedPass.enabled',
    pinned: false,
    read: (config) => config.security.dedicatedPass.enabled,
    write: (config, value) => ({
      ...config,
      security: {
        ...config.security,
        dedicatedPass: { ...config.security.dedicatedPass, enabled: value }
      }
    })
  },
  {
    // Analyzer artifacts are read from the reviewed repository and a configured
    // artifact that is missing FAILS the run, so an ambient `true` turns fixture
    // contents into provider-error rate. Off in the shipped default and for every
    // baseline.
    flag: 'security.signals.enabled',
    pinned: false,
    read: (config) => config.security.signals.enabled,
    write: (config, value) => ({
      ...config,
      security: {
        ...config.security,
        signals: { ...config.security.signals, enabled: value }
      }
    })
  },
  {
    // Read by `eval-case-runner.ts` directly, and its outcomes are scored, so it
    // reaches a measured number without going through the review pipeline at all.
    // Off in the shipped default and for every baseline; the fix-lane slices are
    // measured by passing `--capability fix.enabled=true`.
    flag: 'fix.enabled',
    pinned: false,
    read: (config) => config.fix.enabled,
    write: (config, value) => ({
      ...config,
      fix: { ...config.fix, enabled: value }
    })
  }
]

// NOT PINNED, and each for the same reason: no `eval run` code path reads it, so
// its value cannot reach a measured number.
//
//   verification.enabled                 `verify`, via `investigation-lanes.ts`.
//   changeImpact.enabled                 the advisory lanes `review` drives, and
//   changeImpact.adjudication.enabled    `impact check` / `intent check` / `eval
//   intentFulfilment.enabled             impact` -- which measure those lanes
//                                        through their own commands and must keep
//                                        reading the operator's configuration.
//   reporting.reviewComments.enabled     `review`'s artifact writing.
//   drift.enabled                        `drift check`.
//   observability.openTelemetry.enabled  exporter wiring; emits no findings.
//   reviewConversation.enabled           no reader outside the contracts.
//
// `eval-capability-flags.test.ts` already fails when a capability is added to the
// configuration schema and not to the provenance contract; the pin set is
// deliberately a SUBSET of that contract and is not required to grow with it.

// The schema's own defaults, parsed once, so a pin can tell "this repository
// asked for something else" from "this is just the default of the day".
//
// The distinction is what keeps the warnings below worth reading. Two pins
// disagree with the shipped default on purpose, so warning on every
// pin-vs-effective difference would print two lines on every run in every
// repository, for a condition the file already documents — and a warning that is
// always there is not a warning. What it CANNOT see is a repository that spells
// out the default value explicitly; that config is overruled silently, and only
// the report's capability provenance shows it.
const schemaDefaultConfig = CodeReviewerConfigSchema.parse({})

export type EvalCapabilityPinResult = {
  readonly config: CodeReviewerConfig
  // Surfaced by the command so neither half of the pin is silent: a
  // configuration the pin overruled would otherwise look like it applied, and an
  // overridden pin would otherwise produce a report that is not comparable to
  // the ledger with nothing in the run saying so.
  readonly warnings: readonly string[]
}

/**
 * Applies the pins to the effective configuration, last, so the pinned value
 * holds whatever the configuration file, the environment, or `--config` said.
 *
 * Called with the already-parsed configuration rather than merged in as raw
 * JSON: every pin is a structural update of a value the schema has validated, so
 * there is no second parse to disagree with the first, and the ambient value is
 * still readable at the moment it is replaced — which is what lets an overruled
 * setting be named instead of silently disappearing.
 */
export const applyEvalCapabilityPins = (input: {
  readonly config: CodeReviewerConfig
  readonly overrides: ReadonlyMap<string, boolean>
}): EvalCapabilityPinResult => {
  const warnings: string[] = []
  let config = input.config

  for (const pin of evalCapabilityPins) {
    const override = input.overrides.get(pin.flag)
    const effective = override ?? pin.pinned
    const ambient = pin.read(config)

    if (override !== undefined && override !== pin.pinned) {
      warnings.push(
        `Eval capability pin "${pin.flag}" was overridden to ${override} on the command line; this run is not comparable to a pinned baseline.`
      )
    } else if (ambient !== effective && ambient !== pin.read(schemaDefaultConfig)) {
      warnings.push(
        `Eval capability pin "${pin.flag}" held at ${effective}; the loaded configuration asked for ${ambient} and an eval run does not take it. Pass --capability ${pin.flag}=${ambient} to measure that deliberately.`
      )
    }

    config = pin.write(config, effective)
  }

  return { config, warnings }
}
