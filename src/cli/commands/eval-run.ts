// `eval run` (spec 17) — runs the review pipeline over every selected fixture
// slice, scores the outcome with the model-backed judges, and writes the eval
// report, summary and recall report both to the eval root and to a per-run
// archive. Its exit code is the regression gate's, never the review's.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { stableJsonDigest } from '../../shared/json/stable-json-digest.js'
import {
  createProviderUsageRecorder,
  summarizeRunCost
} from '../../domains/costs/index.js'
import {
  EVAL_RECALL_REPORT_ARTIFACT_NAME,
  EVAL_SUMMARY_ARTIFACT_NAME,
  assertBenchmarkSlicesHydrated,
  createModelPlausibilityJudge,
  createModelSemanticJudge,
  loadEvalCasesFromFixtures,
  renderEvalRecallReport,
  renderEvalSummary,
  runEvaluation,
  type EvalCaseFileReader
} from '../../domains/evaluation/index.js'
import { resolveProviderModelAlias } from '../../domains/provider-resolution/index.js'
import {
  resolveExistingPathInsideRoot,
  resolvePathInsideRoot
} from '../../platform/path-service.js'
import {
  EvalRegressionGateProfileSchema,
  ReviewDepthSchema,
  ReviewModeSchema,
  maxConcurrentTasksBounds
} from '../../shared/contracts/index.js'
import {
  loggingCliOptions,
  parseEnumOption,
  parseIntegerOption,
  parseLogFileOverride,
  parseLogLevelOverride,
  parseOptionValue,
  parseOptionValues,
  unknownCliOption
} from '../args.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'
import { mapErrorResult, usageError } from '../cli-error-results.js'
import { loadConfigForCommand } from '../command-config.js'
import { createCliLogger, resolveLogSink } from '../command-logging.js'
import { runEvalCase } from '../eval-case-runner.js'
import { evalReportCapabilityFlags } from '../eval-capability-flags.js'
import {
  applyEvalCapabilityPins,
  parseEvalCapabilityOverrides
} from '../eval-capability-pins.js'
import {
  evalGateExitCode,
  resolveEvalRegressionGateThresholds
} from '../eval-regression-gate-policy.js'
import { createEvalRunArchiveId } from '../eval-run-archive-id.js'
import {
  ensureDirectory,
  jsonResult,
  resolveArtifactWritePath
} from '../run-artifacts.js'

export const runEval = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(args, [
    ...loggingCliOptions,
    '--capability',
    '--case',
    '--gate-profile',
    '--max-concurrent-tasks',
    '--review-depth',
    '--review-mode',
    '--slice-root'
  ])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  // Captured before ANYTHING else so `metrics.elapsedMs` reflects the whole
  // run: fixture loading, every case's review execution (which happens in the
  // `runEvalCase` calls below, entirely outside `runEvaluation`), and the
  // judge/plausibility scoring `runEvaluation` performs. `metrics.durationMs`
  // only sums each case's own review time and cannot be compared to how long
  // the run actually took, which is exactly the gap this timer closes.
  const monotonicNow = options.monotonicNow ?? ((): number => performance.now())
  const evaluationStartedAtMs = monotonicNow()
  try {
    const logLevelOverride = parseLogLevelOverride(args)
    const logFileOverride = parseLogFileOverride(logLevelOverride.args)
    const evalArgs = logFileOverride.args
    const sliceRoot = parseOptionValue(evalArgs, '--slice-root')
    const caseFilters = parseOptionValues(evalArgs, '--case')
    // Every accepted value below comes from the config schema that will validate
    // it moments later, so a flag can never accept a value the config rejects.
    const reviewMode = parseEnumOption(
      evalArgs,
      '--review-mode',
      ReviewModeSchema.options
    )
    const reviewDepth = parseEnumOption(
      evalArgs,
      '--review-depth',
      ReviewDepthSchema.options
    )
    const maxConcurrentTasks = parseIntegerOption(
      evalArgs,
      '--max-concurrent-tasks',
      maxConcurrentTasksBounds
    )
    // Overrides `evaluation.regressionGate.profile` for this run only, without
    // touching the committed config's default. See the `stable`/`strict`
    // rationale in `eval-regression-gate-policy.ts`.
    const gateProfile = parseEnumOption(
      evalArgs,
      '--gate-profile',
      EvalRegressionGateProfileSchema.options
    )
    const cliConfig = {
      ...(logLevelOverride.level === undefined
        ? {}
        : {
            observability: {
              logging: {
                level: logLevelOverride.level
              }
            }
          }),
      ...(reviewMode === undefined &&
      reviewDepth === undefined &&
      maxConcurrentTasks === undefined
        ? {}
        : {
            review: {
              ...(reviewMode === undefined ? {} : { mode: reviewMode }),
              ...(reviewDepth === undefined ? {} : { depth: reviewDepth }),
              ...(maxConcurrentTasks === undefined
                ? {}
                : { maxConcurrentTasks })
            }
          }),
      ...(gateProfile === undefined
        ? {}
        : { evaluation: { regressionGate: { profile: gateProfile } } })
    }
    const capabilityOverrides = parseEvalCapabilityOverrides(evalArgs)
    const loadedConfig = await loadConfigForCommand(evalArgs, options, {
      loadDotEnv: false,
      ...(Object.keys(cliConfig).length === 0 ? {} : { cliConfig })
    })
    // The committed evaluation configuration, applied AFTER everything the
    // loader merged, so the pinned capability set holds against the discovered
    // config file, the environment and `--config` alike. `config` -- not
    // `loadedConfig.config` -- is what the cases run under, what `configHash` is
    // taken over, and what the capability provenance is read from: a pin nobody
    // can read back out of the report would be a belief rather than a fact.
    const pinnedCapabilities = applyEvalCapabilityPins({
      config: loadedConfig.config,
      overrides: capabilityOverrides
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
    const config = modelReviewHasNoModel
      ? {
          ...pinnedConfig,
          aiReview: { ...pinnedConfig.aiReview, enabled: false }
        }
      : pinnedConfig
    const runWarnings = [
      ...pinnedCapabilities.warnings,
      ...(modelReviewHasNoModel
        ? [
            'No provider is configured, so no model reviewed any eval case and this run measures nothing about the reviewer. The report records aiReview.enabled: false. Configure `provider` to measure a model; a case with expected findings fails with eval_semantic_judge_missing regardless, because the judge needs the same provider.'
          ]
        : [])
    ]
    const logger = createCliLogger({
      config,
      command: 'eval',
      sink: await resolveLogSink(options, logFileOverride.logFile)
    })

    // Logged AND carried to stderr below. The default logging level is `silent`,
    // so a run that only logged this would say nothing at all to the operator who
    // just had a setting overruled or who just left the pinned baseline.
    for (const warning of runWarnings) {
      logger.warn(warning)
    }

    const loadedEvalCases = await loadEvalCasesFromFixtures(options.cwd, {
      ...(sliceRoot === undefined ? {} : { sliceRoot })
    })
    const evalCases =
      caseFilters.length === 0
        ? loadedEvalCases
        : loadedEvalCases.filter((evalCase) => caseFilters.includes(evalCase.id))

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

    // The reviewer's own provider config. Every case's review resolves its model
    // from this, inside `runEvalCase`, and nothing below changes that: pinning
    // the judge moves the SCORER only.
    const providerConfig = config.provider
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
    const judgeModelOverride = config.evaluation.judgeModel
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
              environment: loadedConfig.environment,
              logger,
              ...(options.providerImport === undefined
                ? {}
                : { importProvider: options.providerImport })
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
              prices: config.costs,
              usage: scoringUsageRecorder.usage()
            })
    // Reads the new-side content of a finding's file from the case's fixture
    // repo, so the plausibility judge sees the same file the reviewer saw.
    // Returns undefined on any read failure; the judge then fails closed.
    //
    // Memoized for the run because the judge asks once per UNMATCHED FINDING and
    // several findings routinely land in one file: without this, four findings in
    // a file cost four reads and eight `realpath` syscalls over identical bytes.
    // A failure is cached alongside a success — the fixture repository does not
    // change during an eval run, so a second attempt would fail the same way, and
    // caching it keeps the judge's fail-closed verdict consistent across the
    // findings in that file.
    const findingSourceByKey = new Map<string, string | undefined>()
    const readFindingSource: EvalCaseFileReader = async ({
      evalCase,
      path: findingPath
    }) => {
      // The fixture root, not the case id: two cases pointing at one fixture read
      // the same file. A NUL separator cannot occur in a path, so no two
      // different pairs can ever collapse onto one key.
      const cacheKey = `${evalCase.repositoryFixture}\u0000${findingPath}`

      if (findingSourceByKey.has(cacheKey)) {
        return findingSourceByKey.get(cacheKey)
      }

      let content: string | undefined

      try {
        const fixtureRoot = await resolveExistingPathInsideRoot(
          options.cwd,
          evalCase.repositoryFixture
        )

        content = await readFile(
          resolvePathInsideRoot(fixtureRoot, findingPath),
          'utf8'
        )
      } catch {
        content = undefined
      }

      findingSourceByKey.set(cacheKey, content)

      return content
    }

    logger.info('Eval run started.', {
      fixture_source: sliceRoot === undefined ? 'default' : 'slice-root',
      selected_case_count: evalCases.length,
      semantic_judge_available: semanticJudge !== undefined,
      plausibility_judge_available: plausibilityJudge !== undefined,
      judge_model_pinned: judgeModelOverride !== undefined
    })

    const evalArtifactRoot = path.posix.join('.codereviewer', 'eval')
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
      ...(semanticJudge === undefined ? {} : { judge: semanticJudge }),
      ...(plausibilityJudge === undefined
        ? {}
        : { plausibilityJudge, readFindingSource }),
      judgeAgreementMinimum: config.evaluation.minJudgeAgreement,
      logger,
      selection: {
        fixtureSource:
          sliceRoot === undefined
            ? 'default' as const
            : 'slice-root' as const,
        ...(sliceRoot === undefined ? {} : { sliceRoot }),
        caseFilters,
        selectedCaseIds: evalCases.map((evalCase) => evalCase.id)
      },
      thresholds: resolveEvalRegressionGateThresholds(config),
      // Production runs stamp the real time; a test passes `options.now` to
      // keep a saved report byte-for-byte reproducible (fix for the eval
      // report's `generatedAt` being frozen to a literal committed timestamp).
      generatedAt: (options.now ?? ((): Date => new Date()))().toISOString(),
      ...(evaluationScoringCost === undefined
        ? {}
        : { evaluationScoringCost }),
      // A thunk closed over the monotonic start captured before this function
      // did anything, so `runEvaluation` measures the WHOLE run (case review
      // execution above, plus its own judge/plausibility scoring) instead of
      // only the time spent inside `runEvaluation` itself.
      evaluationElapsedMs: () => monotonicNow() - evaluationStartedAtMs,
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
        ...(providerConfig === undefined
          ? {}
          : { providerId: providerConfig.id, modelName: providerConfig.model }
        ),
        // Recorded next to the reviewer's model, and equal to it on an unpinned
        // run. A saved report that cannot name the judge that scored it leaves a
        // model comparison unreadable after the fact, which is the whole point
        // of making the judge pinnable.
        ...(judgeProviderConfig === undefined
          ? {}
          : { judgeModelName: judgeProviderConfig.model }),
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
    await ensureDirectory(evalDirectory)
    await ensureDirectory(
      await resolveArtifactWritePath(options.cwd, evalRunArchiveRoot)
    )
    const reportJson = jsonResult(result.report)
    await writeFile(
      await resolveArtifactWritePath(
        options.cwd,
        path.posix.join(evalArtifactRoot, result.artifactName)
      ),
      reportJson
    )
    await writeFile(
      await resolveArtifactWritePath(
        options.cwd,
        path.posix.join(evalRunArchiveRoot, result.artifactName)
      ),
      reportJson
    )
    const summary = renderEvalSummary({
      cases: evalCases,
      report: result.report,
      artifactRoot: evalArtifactRoot
    })

    await writeFile(
      await resolveArtifactWritePath(
        options.cwd,
        path.posix.join(evalArtifactRoot, EVAL_SUMMARY_ARTIFACT_NAME)
      ),
      summary
    )
    await writeFile(
      await resolveArtifactWritePath(
        options.cwd,
        path.posix.join(evalRunArchiveRoot, EVAL_SUMMARY_ARTIFACT_NAME)
      ),
      renderEvalSummary({
        cases: evalCases,
        report: result.report,
        artifactRoot: evalRunArchiveRoot
      })
    )
    const recallReport = renderEvalRecallReport({
      reports: [
        {
          label: result.artifactName,
          report: result.report
        }
      ]
    })

    await writeFile(
      await resolveArtifactWritePath(
        options.cwd,
        path.posix.join(evalArtifactRoot, EVAL_RECALL_REPORT_ARTIFACT_NAME)
      ),
      recallReport
    )
    await writeFile(
      await resolveArtifactWritePath(
        options.cwd,
        path.posix.join(evalRunArchiveRoot, EVAL_RECALL_REPORT_ARTIFACT_NAME)
      ),
      recallReport
    )

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
