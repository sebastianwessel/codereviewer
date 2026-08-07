// The CLI's half of the eval regression gate: which thresholds a run is judged
// against, and what its outcome means as an exit code. The gate itself is
// evaluated inside the evaluation domain; the policy of what to demand and how
// to report it belongs to the command that invokes it.
import type {
  EvalRegressionGateOutcome,
  EvalRegressionThresholds
} from '../domains/evaluation/index.js'
import type { CodeReviewerConfig } from '../shared/contracts/index.js'

// `eval run`'s regression-gate thresholds, resolved from the `stable`/`strict`
// profile plus config overrides plus one CLI override (spec 06, "Eval
// Regression Gate"). `stable` deliberately gates on only two signals:
//
// - `minParseValidity: 1` — every eval output either validates against the
//   review-report schema or it does not. There is no sampling distribution
//   here to be flaky about.
// - `failOnProviderError: true` — a provider call either errored or it did
//   not. Same reasoning: mechanical, not statistical.
//
// It deliberately does NOT default-gate on `minRecall`, `minProductRecall`, or
// `maxFalsePositiveCount`. Recall is a MEAN over a model-backed, non-
// deterministic run: this project's own measurement found a run-to-run
// standard deviation of several percentage points on the primary corpus
// (repeated runs of one identical configuration; see "Metrics" in
// specs/06-evaluation-and-quality-gates.md). A default gate that thresholds on
// mean recall would fail unpredictably depending on which side of that band a
// given run landed on — which is a WORSE default than the gate this replaces,
// because at least the old gate failed every time for the same reason instead
// of flaking. `maxFalsePositiveCount` has the same problem from a different
// angle: it counts every unmatched admitted finding RAW, including real
// defects a fixture's expected-findings list simply never enumerated (this
// project measured raw precision as low as 44% on a corpus later shown to be
// ~83% precise once judged against actual code rather than the fixture's
// possibly-incomplete list). Gating on the raw count by default would recreate
// exactly the "exits non-zero on essentially every run" failure mode this
// change exists to fix. Both remain available to opt into explicitly, via
// `evaluation.regressionGate.overrides` or the `strict` profile, for a
// maintainer who has verified they hold for their own fixture set.
const STABLE_EVAL_REGRESSION_GATE_THRESHOLDS: EvalRegressionThresholds = {
  minParseValidity: 1,
  failOnProviderError: true
}

// `strict` is the gate this change replaces as the default: perfect recall and
// zero tolerated false positives. Kept as an explicit, named opt-in rather than
// deleted, since a maintainer preparing an actual release cut may want exactly
// this all-or-nothing bar rather than the CI-smoke-test-shaped `stable` gate.
const STRICT_EVAL_REGRESSION_GATE_THRESHOLDS: EvalRegressionThresholds = {
  minParseValidity: 1,
  minRecall: 1,
  maxFalsePositiveCount: 0,
  failOnProviderError: true
}

// The CLI `--gate-profile` flag is folded into `cliConfig.evaluation` before
// `loadCodeReviewerConfig` runs (same seam `--review-mode`/`--review-depth`
// use), so by the time this reads `config.evaluation.regressionGate` it
// already reflects config file, environment, and CLI precedence in the
// project's usual order — there is no separate override parameter to track
// here.
export const resolveEvalRegressionGateThresholds = (
  config: CodeReviewerConfig
): EvalRegressionThresholds => {
  const profileThresholds =
    config.evaluation.regressionGate.profile === 'strict'
      ? STRICT_EVAL_REGRESSION_GATE_THRESHOLDS
      : STABLE_EVAL_REGRESSION_GATE_THRESHOLDS

  return {
    ...profileThresholds,
    ...config.evaluation.regressionGate.overrides,
    // Restated explicitly: both profiles always set `failOnProviderError`, but
    // the config-schema override for it is optional (absent, not `undefined`,
    // when a project does not set it), and that optionality otherwise widens
    // the spread's inferred type to `boolean | undefined` even though the
    // fallback below makes the runtime value always defined.
    failOnProviderError:
      config.evaluation.regressionGate.overrides.failOnProviderError ??
      profileThresholds.failOnProviderError
  }
}

// The eval regression gate's three outcomes as exit codes.
//
// `not-evaluable` is neither `0` nor `1` on purpose. Exiting `0` would report a
// pass the gate could not establish; exiting `1` would report an infrastructure
// problem — a case whose cost or duration was never measured because its
// provider call failed — as a quality failure, which this project's standing
// rule forbids. `4` is the CLI's existing refusal code for an input a command
// declines to judge because it could not see it whole.
export const evalGateExitCode = (
  outcome: EvalRegressionGateOutcome
): number => {
  switch (outcome) {
    case 'passed':
      return 0
    case 'failed':
      return 1
    default:
      return 4
  }
}
