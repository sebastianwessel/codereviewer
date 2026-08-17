// What one `eval run` asks the eval runner to do: the cases and their outputs,
// the judges that score them, the gate thresholds, and the provenance the
// evaluation domain cannot derive on its own.
import type {
  runEvaluation,
  EngineIdentity,
  EvalCase,
  EvalCaseFileReader
} from '../domains/evaluation/index.js'
import type { Logger } from '../domains/observability/index.js'
import type { CodeReviewerConfig } from '../shared/contracts/index.js'
import { stableJsonDigest } from '../shared/json/stable-json-digest.js'
import { evalReportCapabilityFlags } from './eval-capability-flags.js'
import { resolveEvalRegressionGateThresholds } from './eval-regression-gate-policy.js'
import type { EvalRunJudges } from './eval-run-judges.js'

// The runner's own input type rather than a restatement of it, so a field this
// command stops supplying — or one the runner starts requiring — fails to
// compile here instead of silently changing what a saved report records.
export type EvalRunRequest = Parameters<typeof runEvaluation>[0]

export const buildEvalRunRequest = (
  input: {
    readonly config: CodeReviewerConfig
    readonly cases: readonly EvalCase[]
    readonly outputs: EvalRunRequest['outputs']
    readonly judges: EvalRunJudges
    readonly readFindingSource: EvalCaseFileReader
    readonly sliceRoot?: string
    readonly caseFilters: readonly string[]
    readonly logger: Logger
    // The two clocks, supplied by the caller because both are seams the command
    // owns: the wall clock a test pins to keep a saved report byte-for-byte
    // reproducible, and the monotonic thunk closed over the start the command
    // captured before it did anything.
    readonly generatedAt: string
    readonly evaluationElapsedMs: () => number
    // Which engine build ran the review. Read by the command rather than here
    // because it needs a git call, and typed off `readEngineIdentity`'s own
    // return so the two facts it records -- commit, and whether the working tree
    // was clean -- cannot be re-spelled on the way into the report.
    readonly engine: EngineIdentity
  }
): EvalRunRequest => ({
  cases: input.cases,
  outputs: input.outputs,
  ...(input.judges.semanticJudge === undefined
    ? {}
    : { judge: input.judges.semanticJudge }),
  ...(input.judges.plausibilityJudge === undefined
    ? {}
    : {
        plausibilityJudge: input.judges.plausibilityJudge,
        readFindingSource: input.readFindingSource
      }),
  judgeAgreementMinimum: input.config.evaluation.minJudgeAgreement,
  logger: input.logger,
  selection: {
    fixtureSource:
      input.sliceRoot === undefined
        ? 'default' as const
        : 'slice-root' as const,
    ...(input.sliceRoot === undefined ? {} : { sliceRoot: input.sliceRoot }),
    caseFilters: input.caseFilters,
    selectedCaseIds: input.cases.map((evalCase) => evalCase.id)
  },
  thresholds: resolveEvalRegressionGateThresholds(input.config),
  generatedAt: input.generatedAt,
  ...(input.judges.evaluationScoringCost === undefined
    ? {}
    : { evaluationScoringCost: input.judges.evaluationScoringCost }),
  evaluationElapsedMs: input.evaluationElapsedMs,
  // Provenance the eval domain cannot derive on its own (it does not import
  // the configuration or provider-resolution domains): the effective,
  // fully-merged config the invocation resolved -- file + environment +
  // the CLI-only overrides (`--review-mode`, `--gate-profile`, etc.) folded
  // in by the command -- hashed with the SAME canonical digest the answer-key
  // digest uses, plus the provider/model identity the judge itself was built
  // from. `answerKeyDigest` is computed inside `runEvaluation` from the
  // selected cases, so it is not supplied here.
  provenance: {
    configHash: stableJsonDigest(input.config),
    // The reviewer's own model: what the run is a measurement OF, as opposed
    // to the judge model below, which measured it.
    ...(input.config.provider === undefined
      ? {}
      : {
          providerId: input.config.provider.id,
          modelName: input.config.provider.model
        }),
    // Recorded next to the reviewer's model, and equal to it on an unpinned
    // run. A saved report that cannot name the judge that scored it leaves a
    // model comparison unreadable after the fact, which is the whole point of
    // making the judge pinnable.
    ...(input.judges.judgeModelName === undefined
      ? {}
      : { judgeModelName: input.judges.judgeModelName }),
    // WHICH BUILD PRODUCED THE OUTPUT BEING SCORED. Every eval before
    // 2026-08-01 ran an unpinned engine and no artifact from that period can
    // say which one, so those figures cannot be pooled with anything; `eval
    // impact` and `eval intent` have stamped this since they existed and this
    // command, which produces every published recall and precision figure, did
    // not. Passed straight through: the answer comes from `readEngineIdentity`
    // and nothing here reinterprets it.
    engine: input.engine,
    // The same effective config, read as VALUES rather than hashed. The hash
    // proves two runs shared a configuration; it cannot answer "was the fix
    // lane on?", because nothing can be read back out of a digest.
    capabilities: evalReportCapabilityFlags(input.config)
  }
})
