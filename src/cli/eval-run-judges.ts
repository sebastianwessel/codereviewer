// The scorers one `eval run` measures WITH, as opposed to the reviewer it
// measures: the semantic-match judge, the plausibility judge, and the spend they
// share. Assembled here so the command handler reads as a sequence and the
// judge's independence from the reviewer stays stated in one place.
import {
  createProviderUsageRecorder,
  summarizeRunCost,
  type RunCostSummary
} from '../domains/costs/index.js'
import {
  createModelPlausibilityJudge,
  createModelSemanticJudge,
  type EvalPlausibilityJudge,
  type EvalSemanticJudge
} from '../domains/evaluation/index.js'
import type { Logger } from '../domains/observability/index.js'
import {
  resolveProviderModelAlias,
  type ProviderImport
} from '../domains/provider-resolution/index.js'
import type { CodeReviewerConfig } from '../shared/contracts/index.js'
import type { LoadedCodeReviewerConfig } from './command-config.js'

export type EvalRunJudges = {
  readonly semanticJudge?: EvalSemanticJudge
  readonly plausibilityJudge?: EvalPlausibilityJudge
  readonly evaluationScoringCost?: () => RunCostSummary
  // The model the judges were built from, for the report's provenance. Equal to
  // the reviewer's on an unpinned run, and absent when no provider was
  // available to build a judge from.
  readonly judgeModelName?: string
  // Whether `evaluation.judgeModel` pinned the judge away from the reviewer's
  // model, which is the only thing the run log needs to know about the pin.
  readonly judgeModelPinned: boolean
}

export const resolveEvalRunJudges = async (
  input: {
    readonly config: CodeReviewerConfig
    readonly environment: LoadedCodeReviewerConfig['environment']
    readonly logger: Logger
    readonly providerImport?: ProviderImport
  }
): Promise<EvalRunJudges> => {
  // The reviewer's own provider config. Every case's review resolves its model
  // from this, inside `runEvalCase`, and nothing below changes that: pinning
  // the judge moves the SCORER only.
  const providerConfig = input.config.provider
  // The judge model, pinnable independently of the reviewer's
  // (`evaluation.judgeModel`, `CODEREVIEWER_JUDGE_MODEL`). Unset resolves to
  // `providerConfig` UNCHANGED -- the same object, so an unpinned run performs
  // exactly the resolution it always did.
  //
  // Why it exists: the judges used to be built from the reviewer's model, so
  // varying `CODEREVIEWER_PROVIDER_MODEL` to compare two reviewers swapped the
  // ruler along with the thing being measured, and a recall difference could
  // no longer be attributed to either. See "The Judge Must Be Pinnable
  // Independently Of The Reviewer" in
  // specs/06-evaluation-and-quality-gates.md.
  //
  // Only `model` is overridden. Provider id, credentials, base URL, retry and
  // timeout stay the run's own, because the setting names a model and a second
  // provider account is not what it promises.
  const judgeModelOverride = input.config.evaluation.judgeModel
  const judgeProviderConfig =
    providerConfig === undefined || judgeModelOverride === undefined
      ? providerConfig
      : { ...providerConfig, model: judgeModelOverride }
  // The semantic judge is the only matcher, and the plausibility judge is the
  // independent second opinion on unmatched findings. Both are constructed
  // whenever a provider is available, from the same resolved judge model
  // alias; scoring a case with expected findings without the match judge fails
  // loudly inside the eval runner instead of falling back to a heuristic.
  const modelAlias =
    judgeProviderConfig === undefined
      ? undefined
      : (
          await resolveProviderModelAlias({
            provider: judgeProviderConfig,
            environment: input.environment,
            logger: input.logger,
            ...(input.providerImport === undefined
              ? {}
              : { importProvider: input.providerImport })
          })
        ).modelAlias
  // Wraps the judge model alias in the SAME usage-recorder mechanism the
  // review path uses (`createProviderUsageRecorder`; see
  // `run/provider/provider-workflow.ts`), so every provider call the
  // semantic-match judge and the plausibility judge make -- both matching
  // AND their calibration passes inside `runEvaluation` -- is captured. This
  // spend used to be counted nowhere: judge calls are real provider calls,
  // but neither judge factory reads `response.usage`. One recorder is shared
  // by both judges (they are the same model), so `scoringUsageRecorder`
  // below reports their COMBINED spend rather than inventing a second,
  // per-judge accounting path.
  const scoringUsageRecorder =
    modelAlias === undefined
      ? undefined
      : createProviderUsageRecorder(modelAlias)
  const semanticJudge =
    scoringUsageRecorder === undefined
      ? undefined
      : createModelSemanticJudge({ modelAlias: scoringUsageRecorder.modelAlias })
  const plausibilityJudge =
    scoringUsageRecorder === undefined
      ? undefined
      : createModelPlausibilityJudge({
          modelAlias: scoringUsageRecorder.modelAlias
        })
  // Reads the FINAL judge + plausibility-judge spend, priced with the SAME
  // `summarizeRunCost` helper that prices review cost. A thunk (not called
  // here) because the recorder keeps accumulating until `runEvaluation`
  // finishes matching and calibration; `runEvaluation` calls this only once,
  // at the very end.
  // Priced against the JUDGE's model, not the reviewer's: these tokens were
  // spent by the judges, and a pinned judge on a differently-priced model
  // would otherwise be billed at the reviewer's rate. Identical to the
  // reviewer's model whenever the judge is unpinned.
  const evaluationScoringCost =
    scoringUsageRecorder === undefined || judgeProviderConfig === undefined
      ? undefined
      : () =>
          summarizeRunCost({
            providerConfigured: true,
            providerId: judgeProviderConfig.id,
            modelName: judgeProviderConfig.model,
            prices: input.config.costs,
            usage: scoringUsageRecorder.usage()
          })

  return {
    ...(semanticJudge === undefined ? {} : { semanticJudge }),
    ...(plausibilityJudge === undefined ? {} : { plausibilityJudge }),
    ...(evaluationScoringCost === undefined ? {} : { evaluationScoringCost }),
    // Recorded next to the reviewer's model, and equal to it on an unpinned
    // run. A saved report that cannot name the judge that scored it leaves a
    // model comparison unreadable after the fact, which is the whole point
    // of making the judge pinnable.
    ...(judgeProviderConfig === undefined
      ? {}
      : { judgeModelName: judgeProviderConfig.model }),
    judgeModelPinned: judgeModelOverride !== undefined
  }
}
