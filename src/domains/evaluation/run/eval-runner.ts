import type { Logger } from '@purista/harness'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { COST_UNAVAILABLE_WARNING, type RunCostSummary } from '../../costs/index.js'
import {
  EvalCaseSchema,
  parseEvalCases,
  type EvalCase
} from '../corpus/eval-fixture.schema.js'
import {
  missingSemanticJudgeError,
  type EvalSemanticJudge
} from '../judging/eval-matcher.js'
import {
  scoreJudgeCalibration,
  type EvalJudgeCalibrationResult
} from '../judging/eval-judge-calibration.js'
import {
  scorePlausibilityCalibration,
  type EvalPlausibilityCalibrationResult
} from '../judging/eval-plausibility-calibration.js'
import type {
  EvalCaseFileReader,
  EvalPlausibilityJudge
} from '../judging/eval-plausibility-judge.js'
import {
  calculateEvalMetrics,
  type EvalJudgeReliability,
  type EvalRunTotals
} from '../scoring/metrics.js'
import {
  EvalCaseOutputSchema,
  EVAL_METRICS_VERSION,
  EvalRegressionThresholdsSchema,
  EvalReportSchema,
  EvalReportSelectionSchema,
  type EvalCaseOutput,
  type EvalRegressionThresholds,
  type EvalReport,
  type EvalReportCapabilityFlags,
  type EvalReportProvenance,
  type EvalReportScoring,
  type EvalReportSelection
} from '../report/eval-report-contracts.js'
import { ENGINE_COMMIT_UNKNOWN } from '../report/engine-identity.js'
import {
  computeAnswerKeyDigest,
  computeAnswerKeyDigestByCase
} from '../report/eval-report-provenance.js'
import { EVAL_REPORT_ARTIFACT_NAME } from '../rendering/summary/eval-summary-report-rendering.js'
import { computeCaseResult, type EvalCaseComputation } from './eval-case-assembly.js'
import { buildMetricGroups, evaluateRegressionGate } from './eval-metric-evaluation.js'

export { fixLaneCaseTallies } from './eval-case-tallies.js'

type RunEvaluationInput = {
  readonly cases: unknown
  // Pre-parse case outputs. `runEvaluation` re-validates them through
  // `EvalCaseOutputSchema`, so callers may omit fields that carry a schema
  // default (e.g. `fixOutcomes`, `contextLedger`).
  readonly outputs: readonly z.input<typeof EvalCaseOutputSchema>[]
  // The sole semantic authority for expected-finding matching. Required for any
  // case that declares expected findings; omitted only for fully negative
  // fixture sets, which score offline.
  readonly judge?: EvalSemanticJudge
  // Independent plausibility judge that reclassifies unmatched findings into
  // genuine false positives vs real-but-unlisted defects. Constructed whenever a
  // provider is available (like the match judge); omitted for offline runs.
  readonly plausibilityJudge?: EvalPlausibilityJudge
  // Reads the new-side content of a finding's file from the fixture repo so the
  // plausibility judge sees the whole file the reviewer saw. Omitted for offline
  // runs, where every unmatched finding stays a genuine false positive.
  readonly readFindingSource?: EvalCaseFileReader
  // Agreement below which the run reports its own metrics as untrustworthy.
  readonly judgeAgreementMinimum?: number
  // Used only to surface run-level judge-calibration provider failures, which
  // have no per-case slot in the eval report contract.
  readonly logger?: Logger | undefined
  // Reads the judge + plausibility-judge provider spend for the WHOLE run, as a
  // thunk rather than a precomputed value. The caller wraps the judge model
  // alias once with the SAME `createProviderUsageRecorder` mechanism the
  // review path already uses (see provider-usage-recorder.ts), so the SAME
  // wrapped alias backs both `judge` and `plausibilityJudge` above; every call
  // this function makes through them -- across matching AND the judge/
  // plausibility calibration passes below -- accumulates in that one
  // recorder. Reading it only here, after all of that has happened, is the
  // only way to see the run's true total rather than whatever had
  // accumulated when the thunk was constructed. The thunk returns the SAME
  // `RunCostSummary` shape `summarizeRunCost` already produces for review
  // cost, so this is not a second cost-accounting mechanism. Omitted for an
  // offline run (no judge, so nothing was spent).
  readonly evaluationScoringCost?: () => RunCostSummary
  // Reads the monotonic elapsed time for the WHOLE evaluation -- per-case
  // review execution (which happens entirely OUTSIDE this function, before it
  // is called) plus the judge/plausibility scoring this function performs --
  // as opposed to `durationMs` in the built report, which only SUMS each
  // case's own review time and so can never be compared to how long the run
  // actually took. The CLI supplies a thunk closed over its own monotonic
  // clock and a start timestamp captured before it began running cases; a
  // test supplies a deterministic thunk so a saved report stays byte-for-byte
  // reproducible, mirroring the `now` seam `CliRunOptions` already uses for
  // `generatedAt`. When omitted, this function times only its own execution
  // (matching and calibration), so a bare call still reports a real -- if
  // partial -- number instead of a silent 0.
  readonly evaluationElapsedMs?: () => number
  readonly thresholds?: EvalRegressionThresholds
  readonly selection?: {
    readonly fixtureSource: EvalReportSelection['fixtureSource']
    readonly sliceRoot?: string
    readonly caseFilters: readonly string[]
    readonly selectedCaseIds?: readonly string[]
  }
  readonly generatedAt?: string
  // Provenance the eval domain cannot derive on its own: `answerKeyDigest` is
  // always computed internally from the selected cases (see
  // `computeAnswerKeyDigest`), but the effective config hash and provider/model
  // identity live in the configuration domain, which this module deliberately
  // does not import (see `.agent/IMPLEMENTATION.md` on avoiding cross-domain
  // coupling). The CLI resolves and hashes its own merged config and passes the
  // result through as plain data.
  readonly provenance?: {
    readonly configHash?: string
    readonly providerId?: string
    // The REVIEWER's model: the subject of the measurement.
    readonly modelName?: string
    // The model the judges scored with, which `evaluation.judgeModel` can pin
    // apart from the reviewer's. Supplied by the CLI for the same reason as the
    // two above.
    readonly judgeModelName?: string
    // Which engine build produced the review output being scored. Supplied by
    // the caller for the same reason as everything else here -- reading it
    // means running git, which this module does not do -- and read from the
    // one seam that already answers the question, `readEngineIdentity`, rather
    // than a second git call with its own idea of what "clean" means.
    readonly engine?: EvalReportProvenance['engine']
    // The run's effective optional-capability flags, resolved from the same
    // merged config `configHash` is taken over. Supplied by the CLI for the same
    // reason as everything else here: this module does not import the
    // configuration domain, so it cannot read a flag off a config itself.
    readonly capabilities?: EvalReportCapabilityFlags
  }
}

const buildEvaluationResult = (
  input: {
    readonly cases: readonly EvalCase[]
    readonly thresholds: EvalRegressionThresholds
    readonly selection?: RunEvaluationInput['selection']
    readonly scoring: EvalReportScoring
    readonly judgeReliability: EvalJudgeReliability
    // Run-level judge/plausibility spend and elapsed time (see `EvalRunTotals`),
    // computed once for the whole run and folded into both the overall
    // metrics and every metric group below.
    readonly runTotals: EvalRunTotals
    readonly generatedAt?: string
    readonly caseComputations: readonly EvalCaseComputation[]
    readonly provenance: EvalReportProvenance
  }
): {
  readonly artifactName: typeof EVAL_REPORT_ARTIFACT_NAME
  readonly report: EvalReport
} => {
  const metricCases = input.caseComputations.map(
    (computation) => computation.metricCase
  )
  const metrics = calculateEvalMetrics(
    metricCases,
    input.judgeReliability,
    input.runTotals
  )
  const selection = EvalReportSelectionSchema.parse({
    fixtureSource: input.selection?.fixtureSource ?? 'default',
    ...(input.selection?.sliceRoot === undefined
      ? {}
      : { sliceRoot: input.selection.sliceRoot }),
    caseFilters: input.selection?.caseFilters ?? [],
    selectedCaseIds: input.cases.map((evalCase) => evalCase.id)
  })
  const metricGroups = buildMetricGroups(
    input.cases,
    metricCases,
    input.judgeReliability,
    input.runTotals
  )
  const gate = evaluateRegressionGate({
    thresholds: input.thresholds,
    metrics,
    caseResults: metricCases
  })
  const report = EvalReportSchema.parse({
    schemaVersion: '1.0',
    metricsVersion: EVAL_METRICS_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    fixtureCount: input.cases.length,
    selection,
    provenance: input.provenance,
    scoring: input.scoring,
    caseResults: input.caseComputations.map((computation) => computation.reportCase),
    metrics,
    metricGroups,
    regressionGate: {
      outcome: gate.outcome,
      reasons: gate.reasons,
      notEvaluableReasons: gate.notEvaluableReasons,
      thresholds: input.thresholds,
      failingCaseIds: gate.failingCaseIds
    }
  })

  return {
    artifactName: EVAL_REPORT_ARTIFACT_NAME,
    report
  }
}

const assertOutputCoverage = (
  cases: readonly EvalCase[],
  outputs: readonly EvalCaseOutput[]
): void => {
  const caseIds = new Set(cases.map((evalCase) => evalCase.id))
  const seenOutputIds = new Set<string>()

  for (const output of outputs) {
    if (!caseIds.has(output.caseId)) {
      throw new Error(`Eval output references unknown case "${output.caseId}".`)
    }

    if (seenOutputIds.has(output.caseId)) {
      throw new Error(`Duplicate eval output for case "${output.caseId}".`)
    }

    seenOutputIds.add(output.caseId)
  }

  for (const evalCase of cases) {
    if (!seenOutputIds.has(evalCase.id)) {
      throw new Error(`Missing eval output for case "${evalCase.id}".`)
    }
  }
}

const prepareEvaluationInputs = (
  input: RunEvaluationInput
): {
  readonly cases: readonly EvalCase[]
  readonly outputs: readonly EvalCaseOutput[]
  readonly thresholds: EvalRegressionThresholds
} => {
  const cases = parseEvalCases(input.cases)
  const outputs = z.array(EvalCaseOutputSchema).parse(input.outputs)
  const thresholds = EvalRegressionThresholdsSchema.parse(
    input.thresholds ?? {}
  )

  assertOutputCoverage(cases, outputs)

  return { cases, outputs, thresholds }
}

// Judge availability is a run-level precondition. A case that declares expected
// findings cannot be scored without the semantic judge, and the engine never
// falls back to a heuristic, so the run fails with a config error (exit 2)
// before any case is scored.
const assertJudgeAvailableForExpectations = (
  cases: readonly EvalCase[],
  judge: EvalSemanticJudge | undefined
): void => {
  if (judge !== undefined) {
    return
  }

  const positiveCase = cases.find(
    (evalCase) => evalCase.expectedFindings.length > 0
  )

  if (positiveCase !== undefined) {
    throw missingSemanticJudgeError(positiveCase.id)
  }
}

export const runEvaluation = async (
  input: RunEvaluationInput
): Promise<{
  readonly artifactName: typeof EVAL_REPORT_ARTIFACT_NAME
  readonly report: EvalReport
}> => {
  // Fallback start reference for `elapsedMs` when the caller supplies no
  // `evaluationElapsedMs` thunk (e.g. a direct unit-test call). Reading it here,
  // before anything else runs, means a bare call still reports a real -- if
  // partial, since it excludes the per-case review work that happens before
  // this function is even called -- elapsed time instead of a silent 0.
  const internalStartMs = performance.now()
  const prepared = prepareEvaluationInputs(input)
  assertJudgeAvailableForExpectations(prepared.cases, input.judge)

  const outputByCaseId = new Map(
    prepared.outputs.map((output) => [output.caseId, output])
  )
  // Case computations run sequentially so judge calls stay ordered and the run
  // stays reproducible.
  const caseComputations: EvalCaseComputation[] = []
  for (const evalCase of prepared.cases) {
    const output = outputByCaseId.get(evalCase.id)

    if (output === undefined) {
      throw new Error(`Missing eval output for case "${evalCase.id}".`)
    }

    caseComputations.push(
      await computeCaseResult({
        evalCase: EvalCaseSchema.parse(evalCase),
        output,
        judge: input.judge,
        plausibilityJudge: input.plausibilityJudge,
        readFindingSource: input.readFindingSource
      })
    )
  }

  // Measure the judge itself against the committed human-labeled calibration
  // set. Calibration pairs whose judge call failed leave the agreement
  // denominator; if none could be scored, the run cannot claim trustworthiness.
  const calibration: EvalJudgeCalibrationResult | undefined =
    input.judge === undefined
      ? undefined
      : await scoreJudgeCalibration({
          judge: input.judge,
          ...(input.judgeAgreementMinimum === undefined
            ? {}
            : { minimumAgreement: input.judgeAgreementMinimum }),
          ...(input.logger === undefined ? {} : { logger: input.logger })
        })

  // Score the plausibility judge against its own committed calibration set,
  // once per run, whenever a plausibility judge exists. It reuses the same
  // minimum-agreement config key: adjusted precision is only as trustworthy as
  // the judge that produced it.
  const plausibilityCalibration:
    | EvalPlausibilityCalibrationResult
    | undefined =
    input.plausibilityJudge === undefined
      ? undefined
      : await scorePlausibilityCalibration({
          judge: input.plausibilityJudge,
          ...(input.judgeAgreementMinimum === undefined
            ? {}
            : { minimumAgreement: input.judgeAgreementMinimum }),
          ...(input.logger === undefined ? {} : { logger: input.logger })
        })

  // Read both run totals only NOW, after every judge/plausibility call this
  // function will ever make (matching above, calibration just above) has
  // already happened. Reading either earlier would under-count: the usage
  // recorder keeps accumulating through calibration, and the elapsed clock
  // must span everything this function did, not just the case-computation loop.
  const scoringCost = input.evaluationScoringCost?.()
  const elapsedMs = Math.max(
    0,
    Math.round(
      input.evaluationElapsedMs === undefined
        ? performance.now() - internalStartMs
        : input.evaluationElapsedMs()
    )
  )
  const runTotals: EvalRunTotals = {
    elapsedMs,
    scoringInputTokens: scoringCost?.inputTokens ?? 0,
    scoringCachedInputTokens: scoringCost?.cachedInputTokens ?? 0,
    scoringOutputTokens: scoringCost?.outputTokens ?? 0,
    scoringCostUsd: scoringCost?.costUsd ?? 0,
    scoringCostUnavailable:
      scoringCost?.warnings.includes(COST_UNAVAILABLE_WARNING) ?? false
  }

  return buildEvaluationResult({
    cases: prepared.cases,
    thresholds: prepared.thresholds,
    ...(input.selection === undefined ? {} : { selection: input.selection }),
    runTotals,
    scoring: {
      ...(calibration?.judgeAgreement === undefined
        ? {}
        : { judgeAgreement: calibration.judgeAgreement }),
      // With no judge in play there is no semantic authority to distrust: such a
      // run scores only cases without expected findings, fully deterministically.
      judgeTrustworthy: calibration?.judgeTrustworthy ?? true,
      ...(plausibilityCalibration?.plausibilityJudgeAgreement === undefined
        ? {}
        : {
            plausibilityJudgeAgreement:
              plausibilityCalibration.plausibilityJudgeAgreement
          }),
      // With no plausibility judge, no unmatched finding is ever credited as
      // real, so adjustedPrecision equals precision and is as trustworthy as it.
      adjustedPrecisionTrustworthy:
        plausibilityCalibration?.plausibilityJudgeTrustworthy ?? true,
      // Recorded so the precision BRACKET can be honest. Without this, a run
      // with no plausibility judge is indistinguishable from one whose judge
      // examined every unmatched finding and rejected all of them -- both report
      // `adjustedPrecision === precision`, and only one of them measured an
      // upper bound.
      plausibilityJudged: input.plausibilityJudge !== undefined
    },
    judgeReliability: {
      ...(calibration?.judgeAgreement === undefined
        ? {}
        : { judgeAgreement: calibration.judgeAgreement }),
      judgeAgreementPairCount: calibration?.judgeAgreementPairCount ?? 0,
      ...(plausibilityCalibration?.plausibilityJudgeAgreement === undefined
        ? {}
        : {
            plausibilityJudgeAgreement:
              plausibilityCalibration.plausibilityJudgeAgreement
          }),
      plausibilityJudgeAgreementPairCount:
        plausibilityCalibration?.plausibilityJudgeAgreementPairCount ?? 0
    },
    ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt }),
    caseComputations,
    // `answerKeyDigest` is always derived here, from the exact selected case
    // set this function scored -- never supplied by the caller -- so it can
    // never drift from what was actually scored. `configHash`/provider
    // identity come from the caller (see `RunEvaluationInput.provenance`)
    // because this module does not resolve or import the configuration
    // domain's merged config.
    provenance: {
      answerKeyDigest: computeAnswerKeyDigest(prepared.cases),
      answerKeyDigestByCase: computeAnswerKeyDigestByCase(prepared.cases),
      configHash: input.provenance?.configHash ?? 'unspecified',
      ...(input.provenance?.providerId === undefined
        ? {}
        : { providerId: input.provenance.providerId }),
      ...(input.provenance?.modelName === undefined
        ? {}
        : { modelName: input.provenance.modelName }),
      ...(input.provenance?.judgeModelName === undefined
        ? {}
        : { judgeModelName: input.provenance.judgeModelName }),
      // Substituted rather than omitted when the caller supplies none, which is
      // the OPPOSITE of the capability rule immediately below, and deliberately:
      // `unknown` is the value `readEngineIdentity` itself returns when git
      // cannot be read, so it states exactly what is true -- nobody can name the
      // build. Omitting the field would instead produce a report that pools
      // freely with every other silent report, and this contract's whole purpose
      // is that a run which cannot name its engine says so.
      engine: input.provenance?.engine ?? { commit: ENGINE_COMMIT_UNKNOWN },
      // Omitted rather than substituted when the caller supplies none: an
      // all-`false` stand-in would state that every capability was off, which is
      // a measurement nobody took. Absent means not recorded.
      ...(input.provenance?.capabilities === undefined
        ? {}
        : { capabilities: input.provenance.capabilities })
    }
  })
}
