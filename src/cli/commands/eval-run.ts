// `eval run` (spec 17) — runs the review pipeline over every selected fixture
// slice, scores the outcome with the model-backed judges, and writes the eval
// report, summary and recall report both to the eval root and to a per-run
// archive. Its exit code is the regression gate's, never the review's.
//
// The stages it composes live beside it in `src/cli/`: `eval-run-options.ts`
// (argv), `eval-run-effective-config.ts` (the configuration a run measures
// under), `eval-run-judges.ts` (the scorers), `eval-run-finding-source.ts` (the
// fixture reader the plausibility judge uses) and `eval-run-artifacts.ts` (the
// six writes). This file is the sequence, not the detail.
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { stableJsonDigest } from '../../shared/json/stable-json-digest.js'
import {
  assertBenchmarkSlicesHydrated,
  loadEvalCasesFromFixtures,
  runEvaluation
} from '../../domains/evaluation/index.js'
// By path rather than through the barrel above, deliberately: `runEvalCase`
// imports `review-workflow`, and re-exporting it from `evaluation/index.ts`
// would close an import cycle back through `drift`. Its own header says so.
import { runEvalCase } from '../../domains/evaluation/run/eval-case-runner.js'
import { unknownCliOption } from '../args.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'
import { mapErrorResult, usageError } from '../cli-error-results.js'
import { loadConfigForCommand } from '../command-config.js'
import { createCliLogger, resolveLogSink } from '../command-logging.js'
import { evalReportCapabilityFlags } from '../eval-capability-flags.js'
import {
  evalGateExitCode,
  resolveEvalRegressionGateThresholds
} from '../eval-regression-gate-policy.js'
import { writeEvalRunArtifacts } from '../eval-run-artifacts.js'
import { createEvalRunArchiveId } from '../eval-run-archive-id.js'
import { resolveEvalRunEffectiveConfig } from '../eval-run-effective-config.js'
import { createEvalFindingSourceReader } from '../eval-run-finding-source.js'
import { resolveEvalRunJudges } from '../eval-run-judges.js'
import { evalRunCliOptions, parseEvalRunOptions } from '../eval-run-options.js'
import { resolveArtifactWritePath } from '../run-artifacts.js'

export const runEval = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(args, evalRunCliOptions)

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  // Captured before ANYTHING else so `metrics.elapsedMs` reflects the whole
  // run: fixture loading, every case's review execution (which happens in the
  // `runEvalCase` calls below, entirely outside `runEvaluation`), and the
  // judge/plausibility scoring `runEvaluation` performs. `metrics.durationMs`
  // only sums each case's own review time and cannot be compared to how long
  // the run actually took, which is exactly the gap this timer closes.
  //
  // `performance.now` directly, not an injectable seam: `Date.now` is not
  // monotonic and must never be substituted here, and the determinism a saved
  // report needs is supplied one layer down, where `eval-runner` accepts an
  // `evaluationElapsedMs` thunk that its own tests pin to a fixed value.
  const evaluationStartedAtMs = performance.now()
  try {
    const evalOptions = parseEvalRunOptions(args)
    const loadedConfig = await loadConfigForCommand(evalOptions.args, options, {
      loadDotEnv: false,
      ...(Object.keys(evalOptions.cliConfig).length === 0
        ? {}
        : { cliConfig: evalOptions.cliConfig })
    })
    // The pins and the no-provider contradiction, resolved together: `config`
    // -- not `loadedConfig.config` -- is what every case runs under and what the
    // report's provenance is read from.
    const effectiveConfig = resolveEvalRunEffectiveConfig({
      loadedConfig: loadedConfig.config,
      capabilityOverrides: evalOptions.capabilityOverrides
    })
    const config = effectiveConfig.config
    const runWarnings = effectiveConfig.warnings
    const logger = createCliLogger({
      config,
      command: 'eval',
      sink: await resolveLogSink(options, evalOptions.logFile)
    })

    // Logged AND carried to stderr below. The default logging level is `silent`,
    // so a run that only logged this would say nothing at all to the operator who
    // just had a setting overruled or who just left the pinned baseline.
    for (const warning of runWarnings) {
      logger.warn(warning)
    }

    const loadedEvalCases = await loadEvalCasesFromFixtures(options.cwd, {
      ...(evalOptions.sliceRoot === undefined
        ? {}
        : { sliceRoot: evalOptions.sliceRoot })
    })
    const evalCases =
      evalOptions.caseFilters.length === 0
        ? loadedEvalCases
        : loadedEvalCases.filter((evalCase) =>
            evalOptions.caseFilters.includes(evalCase.id)
          )

    if (evalCases.length === 0) {
      return usageError('eval run selected no cases')
    }

    // Fail before scoring if any positive slice is still an un-hydrated
    // placeholder; otherwise it would be silently scored as 0 recall.
    assertBenchmarkSlicesHydrated(
      evalCases.map((evalCase) => ({
        id: evalCase.id,
        expectedFindings: evalCase.expectedFindings,
        ...(evalCase.diff === undefined ? {} : { diff: evalCase.diff })
      }))
    )

    // The scorers, built from the judge model rather than the reviewer's, and
    // the fixture reader the plausibility judge sees whole files through.
    const judges = await resolveEvalRunJudges({
      config,
      environment: loadedConfig.environment,
      logger,
      ...(options.providerImport === undefined
        ? {}
        : { providerImport: options.providerImport })
    })
    const readFindingSource = createEvalFindingSourceReader(options.cwd)

    logger.info('Eval run started.', {
      fixture_source: evalOptions.sliceRoot === undefined ? 'default' : 'slice-root',
      selected_case_count: evalCases.length,
      semantic_judge_available: judges.semanticJudge !== undefined,
      plausibility_judge_available: judges.plausibilityJudge !== undefined,
      judge_model_pinned: judges.judgeModelPinned
    })

    const evalArtifactRoot = path.posix.join('.codereviewer', 'eval')
    // Resolved before the cases run, so an eval root that cannot be written to
    // refuses the run before it spends anything on a model.
    const evalDirectory = await resolveArtifactWritePath(options.cwd, evalArtifactRoot)
    const outputs = await Promise.all(
      evalCases.map((evalCase) =>
        runEvalCase({
          root: options.cwd,
          config,
          configWarnings: loadedConfig.warnings,
          baselineExplicitlyConfigured: loadedConfig.baselineExplicitlyConfigured,
          environment: loadedConfig.environment,
          evalCase,
          logger: logger.child({
            eval_case_id: evalCase.id
          }),
          ...(options.providerImport === undefined
            ? {}
            : { providerImport: options.providerImport })
        })
      )
    )
    const evaluationInput = {
      cases: evalCases,
      outputs,
      ...(judges.semanticJudge === undefined
        ? {}
        : { judge: judges.semanticJudge }),
      ...(judges.plausibilityJudge === undefined
        ? {}
        : { plausibilityJudge: judges.plausibilityJudge, readFindingSource }),
      judgeAgreementMinimum: config.evaluation.minJudgeAgreement,
      logger,
      selection: {
        fixtureSource:
          evalOptions.sliceRoot === undefined
            ? 'default' as const
            : 'slice-root' as const,
        ...(evalOptions.sliceRoot === undefined
          ? {}
          : { sliceRoot: evalOptions.sliceRoot }),
        caseFilters: evalOptions.caseFilters,
        selectedCaseIds: evalCases.map((evalCase) => evalCase.id)
      },
      thresholds: resolveEvalRegressionGateThresholds(config),
      // Production runs stamp the real time; a test passes `options.now` to
      // keep a saved report byte-for-byte reproducible (fix for the eval
      // report's `generatedAt` being frozen to a literal committed timestamp).
      generatedAt: (options.now ?? ((): Date => new Date()))().toISOString(),
      ...(judges.evaluationScoringCost === undefined
        ? {}
        : { evaluationScoringCost: judges.evaluationScoringCost }),
      // A thunk closed over the monotonic start captured before this function
      // did anything, so `runEvaluation` measures the WHOLE run (case review
      // execution above, plus its own judge/plausibility scoring) instead of
      // only the time spent inside `runEvaluation` itself.
      evaluationElapsedMs: () => performance.now() - evaluationStartedAtMs,
      // Provenance the eval domain cannot derive on its own (it does not import
      // the configuration or provider-resolution domains): the effective,
      // fully-merged config this invocation resolved -- file + environment +
      // the CLI-only overrides (`--review-mode`, `--gate-profile`, etc.) folded
      // in above -- hashed with the SAME canonical digest the answer-key digest
      // uses, plus the provider/model identity the judge itself was built
      // from. `answerKeyDigest` is computed inside `runEvaluation` from the
      // selected cases, so it is not supplied here.
      provenance: {
        configHash: stableJsonDigest(config),
        // The reviewer's own model: what this run is a measurement OF, as
        // opposed to the judge model below, which measured it.
        ...(config.provider === undefined
          ? {}
          : { providerId: config.provider.id, modelName: config.provider.model }
        ),
        ...(judges.judgeModelName === undefined
          ? {}
          : { judgeModelName: judges.judgeModelName }),
        // The same effective config, read as VALUES rather than hashed. The
        // hash proves two runs shared a configuration; it cannot answer "was
        // the fix lane on?", because nothing can be read back out of a digest.
        capabilities: evalReportCapabilityFlags(config)
      }
    }
    const result = await runEvaluation(evaluationInput)

    const evalRunArchiveRoot = path.posix.join(
      evalArtifactRoot,
      'runs',
      createEvalRunArchiveId()
    )
    const summary = await writeEvalRunArtifacts({
      repositoryRoot: options.cwd,
      artifactRoot: evalArtifactRoot,
      artifactDirectory: evalDirectory,
      archiveRoot: evalRunArchiveRoot,
      cases: evalCases,
      artifactName: result.artifactName,
      report: result.report
    })

    logger.info('Eval run completed.', {
      fixture_count: result.report.fixtureCount,
      recall: result.report.metrics.recall,
      precision: result.report.metrics.precision,
      provider_error_rate: result.report.metrics.providerErrorRate,
      eval_run_archive_root: evalRunArchiveRoot,
      gate_outcome: result.report.regressionGate.outcome
    })

    return {
      // A gate that could not evaluate its own condition exits neither 0 nor 1.
      // `4` is this CLI's established refusal code -- the command declined to
      // judge an input it could not see whole (`intent check` uses it for the
      // same reason) -- and it keeps a provider outage from being reported as
      // a quality failure. See `EvalRegressionGateSchema`.
      exitCode: evalGateExitCode(result.report.regressionGate.outcome),
      stdout: `${summary}\n`,
      // The capability-pin warnings and the no-provider disclosure, on stderr
      // rather than folded into the summary: stdout is the artifact a comparison
      // script reads, and a pin that overruled a setting — or a run that had no
      // model — is a message for the person, not for the parse.
      stderr: runWarnings.length === 0 ? '' : `${runWarnings.join('\n')}\n`
    }
  } catch (error) {
    return mapErrorResult(error, 'internal')
  }
}
