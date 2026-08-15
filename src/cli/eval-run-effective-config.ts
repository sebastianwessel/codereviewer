// The configuration one `eval run` actually measures under: the committed
// capability pins, and the one contradiction this command resolves rather than
// refuses. Both produce warnings the command surfaces, so neither is silent.
import { applyEvalCapabilityPins } from '../domains/evaluation/index.js'
import type { CodeReviewerConfig } from '../shared/contracts/index.js'

export type EvalRunEffectiveConfig = {
  readonly config: CodeReviewerConfig
  readonly warnings: readonly string[]
}

export const resolveEvalRunEffectiveConfig = (
  input: {
    // The fully-merged configuration the loader produced: file + environment +
    // `--config` + the CLI-only overlay.
    readonly loadedConfig: CodeReviewerConfig
    readonly capabilityOverrides: ReadonlyMap<string, boolean>
  }
): EvalRunEffectiveConfig => {
  // The committed evaluation configuration, applied AFTER everything the
  // loader merged, so the pinned capability set holds against the discovered
  // config file, the environment and `--config` alike. The config RETURNED from
  // here -- not the loader's -- is what the cases run under, what `configHash`
  // is taken over, and what the capability provenance is read from: a pin nobody
  // can read back out of the report would be a belief rather than a fact.
  const pinnedCapabilities = applyEvalCapabilityPins({
    config: input.loadedConfig,
    overrides: input.capabilityOverrides
  })
  // AN EVAL RUN WITH NO PROVIDER STATES THAT, INSTEAD OF ASKING FOR A MODEL IT
  // HAS NOT GOT.
  //
  // `aiReview.enabled` is pinned ON above so a repository config cannot turn an
  // eval into a zero-recall report; a missing provider produces that same
  // report and no pin can repair it, because there is no model to enable. The
  // review runner refuses the contradiction outright
  // (`model_review_provider_missing`) — right for a review whose report a human
  // reads as a verdict on their change, and wrong for the offline eval this
  // command still supports, where the fixtures are the audience: a corpus whose
  // cases expect no finding is scoreable without a model, and any case that
  // DOES expect one already fails loudly at `eval_semantic_judge_missing`,
  // because the judge is missing for exactly the same reason.
  //
  // So the contradiction is resolved once, here, and it is RECORDED rather than
  // quietly applied: `configHash` and `provenance.capabilities` are both read
  // from this config, so the saved report says `aiReview.enabled: false` and no
  // reader can mistake the run for one a model took part in. The warning below
  // says the same thing to the operator.
  const pinnedConfig = pinnedCapabilities.config
  const modelReviewHasNoModel =
    pinnedConfig.aiReview.enabled && pinnedConfig.provider === undefined

  return {
    config: modelReviewHasNoModel
      ? {
          ...pinnedConfig,
          aiReview: { ...pinnedConfig.aiReview, enabled: false }
        }
      : pinnedConfig,
    warnings: [
      ...pinnedCapabilities.warnings,
      ...(modelReviewHasNoModel
        ? [
            'No provider is configured, so no model reviewed any eval case and this run measures nothing about the reviewer. The report records aiReview.enabled: false. Configure `provider` to measure a model; a case with expected findings fails with eval_semantic_judge_missing regardless, because the judge needs the same provider.'
          ]
        : [])
    ]
  }
}
