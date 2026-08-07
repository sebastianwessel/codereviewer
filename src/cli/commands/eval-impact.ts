// `eval impact` (spec 22 §Evaluation) — the change-impact dependents corpus.
//
// A SEPARATE COMMAND FROM `eval run`, AND DELIBERATELY HARD TO CONFUSE WITH IT.
// Spec 22 forbids pooling this corpus with spec 17's: different question,
// different orientation, different answer key. So this command does not accept
// `--slice-root` at all — the option is unknown to it and a typo exits 2 — its
// cases are `case.json` under a `--case-root` rather than `slice.json` under a
// slice root, and its artefact carries a `reportKind` literal no eval report can
// parse as.
//
// It runs `impact check`'s engine over each hydrated case and scores THREE ARMS:
// the deterministic reference list (the baseline spec 22's removal criterion is
// stated against), the adjudicated subset, and the difference. Both change-impact
// switches are forced on for the run, because the capability is disabled by
// default until measured and a run with either off would score an engine that
// analysed nothing — which is exactly the "absence rendered as zero" this scorer
// exists to refuse. `--adjudication off` scores the reference arm alone, with no
// provider call and no spend; the adjudicated arm then reports not-measured.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createChangeImpactLane } from '../../domains/change-impact/index.js'
import { stableJsonDigest } from '../../shared/json/stable-json-digest.js'
import {
  CHANGE_IMPACT_EVAL_ARTIFACT_ROOT,
  CHANGE_IMPACT_EVAL_REPORT_ARTIFACT_NAME,
  CHANGE_IMPACT_EVAL_SUMMARY_ARTIFACT_NAME,
  buildChangeImpactEvalReport,
  computeChangeImpactAnswerKeyDigest,
  computeChangeImpactAnswerKeyDigestByCase,
  defaultChangeImpactManifestPath,
  defaultChangeImpactOutputRoot,
  parseChangeImpactCorpusManifestJson,
  readEngineIdentity,
  renderChangeImpactEvalSummary,
  scoreChangeImpactCases,
  selectCorpusCases,
  type ChangeImpactCaseInput
} from '../../domains/evaluation/index.js'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
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
import { createEvalRunArchiveId } from '../eval-run-archive-id.js'
import {
  changeImpactAdjudicationCallBounds,
  runChangeImpactEvalCase
} from '../impact-eval-runner.js'
import {
  ensureDirectory,
  jsonResult,
  resolveArtifactWritePath
} from '../run-artifacts.js'

const changeImpactAdjudicationModes = ['on', 'off'] as const

export const runEvalImpact = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(args, [
    ...loggingCliOptions,
    '--adjudication',
    '--case',
    '--case-root',
    '--manifest',
    '--max-adjudication-calls'
  ])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  try {
    const logLevelOverride = parseLogLevelOverride(args)
    const logFileOverride = parseLogFileOverride(logLevelOverride.args)
    const impactArgs = logFileOverride.args
    const caseRoot =
      parseOptionValue(impactArgs, '--case-root') ?? defaultChangeImpactOutputRoot
    const manifestPath =
      parseOptionValue(impactArgs, '--manifest') ??
      defaultChangeImpactManifestPath
    const caseFilters = parseOptionValues(impactArgs, '--case')
    const adjudicationRequested =
      (parseEnumOption(
        impactArgs,
        '--adjudication',
        changeImpactAdjudicationModes
      ) ?? 'on') === 'on'
    // The cap is PER CASE, and when it binds the run leaves pairs unadjudicated —
    // which the scorer must then treat as undetermined rather than as a miss. It
    // is exposed here so an operator can lift it for a measurement run instead of
    // discovering afterwards that arm 2 could not be read. The bounds are the
    // config schema's own.
    const maxAdjudicationCalls = parseIntegerOption(
      impactArgs,
      '--max-adjudication-calls',
      changeImpactAdjudicationCallBounds
    )
    const loadedConfig = await loadConfigForCommand(impactArgs, options, {
      loadDotEnv: false,
      cliConfig: {
        ...(logLevelOverride.level === undefined
          ? {}
          : { observability: { logging: { level: logLevelOverride.level } } }),
        changeImpact: {
          enabled: true,
          adjudication: {
            enabled: adjudicationRequested,
            ...(maxAdjudicationCalls === undefined
              ? {}
              : { maxCalls: maxAdjudicationCalls })
          }
        }
      }
    })
    const logger = createCliLogger({
      config: loadedConfig.config,
      command: 'eval-impact',
      sink: await resolveLogSink(options, logFileOverride.logFile)
    })
    const manifest = parseChangeImpactCorpusManifestJson(
      await readFile(
        await resolveExistingPathInsideRoot(options.cwd, manifestPath),
        'utf8'
      )
    )
    const selectedCases = selectCorpusCases(manifest.cases, caseFilters)

    if (selectedCases.length === 0) {
      return usageError('eval impact selected no cases')
    }

    // One lane for the whole run: the usage recorder and the agent's lifetime are
    // per-run, not per-case. Absent when adjudication is off, when no provider is
    // configured, or when one cannot be resolved — each of which leaves the
    // adjudicated arm NOT MEASURED rather than measured at zero.
    const lane = await createChangeImpactLane({
      config: loadedConfig.config,
      environment: loadedConfig.environment,
      ...(options.providerImport === undefined
        ? {}
        : { providerImport: options.providerImport }),
      logger
    })
    const warnings: string[] = [...loadedConfig.warnings]

    if (adjudicationRequested && lane === undefined) {
      warnings.push(
        'Adjudication was requested but no model lane could be created, so the adjudicated arm is NOT MEASURED. Configure a provider, or pass --adjudication off to score the reference arm deliberately.'
      )
    }

    logger.info('Change-impact eval run started.', {
      selected_case_count: selectedCases.length,
      adjudication_requested: adjudicationRequested,
      adjudication_lane_available: lane !== undefined
    })

    const caseInputs: ChangeImpactCaseInput[] = []

    try {
      // Sequential on purpose: each case is a full repository traversal of an
      // upstream checkout, and the adjudication residue is a provider call whose
      // cap is per run.
      for (const corpusCase of selectedCases) {
        caseInputs.push(
          await runChangeImpactEvalCase({
            repositoryRoot: options.cwd,
            caseRoot,
            corpusCase,
            config: loadedConfig.config,
            ...(lane === undefined
              ? {}
              : { agents: { judgeReliance: lane.judgeReliance } }),
            logger: logger.child({ impact_case_id: corpusCase.id })
          })
        )
      }
    } finally {
      await lane?.shutdown()
    }

    // The engine's own per-case warnings, carried through with the case named.
    // Without them a case that seeded no changed symbol at all — an unsupported
    // language, or a change touching no symbol's span — scores as a genuine miss
    // with nothing on the page saying the engine never looked.
    for (const caseInput of caseInputs) {
      if (caseInput.outcome.status !== 'scored') {
        continue
      }

      for (const warning of caseInput.outcome.report.warnings) {
        warnings.push(`${caseInput.corpusCase.id}: ${warning}`)
      }
    }

    const score = scoreChangeImpactCases(caseInputs)
    const engine = await readEngineIdentity({ repositoryRoot: options.cwd })
    const providerConfig = loadedConfig.config.provider
    const report = buildChangeImpactEvalReport({
      score,
      generatedAt: (options.now ?? ((): Date => new Date()))(),
      datasetId: manifest.datasetId,
      selection: {
        manifestPath,
        caseRoot,
        caseFilters: [...caseFilters],
        selectedCaseIds: selectedCases.map((corpusCase) => corpusCase.id)
      },
      engine: { ...engine, adjudicationRequested },
      provenance: {
        answerKeyDigest: computeChangeImpactAnswerKeyDigest(selectedCases),
        answerKeyDigestByCase:
          computeChangeImpactAnswerKeyDigestByCase(selectedCases),
        configHash: stableJsonDigest(loadedConfig.config),
        ...(providerConfig === undefined
          ? {}
          : { providerId: providerConfig.id, modelName: providerConfig.model })
      },
      ...(lane?.usage() === undefined ? {} : { usage: lane?.usage() }),
      warnings
    })
    const summary = renderChangeImpactEvalSummary(report)
    const archiveRoot = path.posix.join(
      CHANGE_IMPACT_EVAL_ARTIFACT_ROOT,
      'runs',
      createEvalRunArchiveId()
    )

    for (const root of [CHANGE_IMPACT_EVAL_ARTIFACT_ROOT, archiveRoot]) {
      await ensureDirectory(await resolveArtifactWritePath(options.cwd, root))
      await writeFile(
        await resolveArtifactWritePath(
          options.cwd,
          path.posix.join(root, CHANGE_IMPACT_EVAL_REPORT_ARTIFACT_NAME)
        ),
        jsonResult(report)
      )
      await writeFile(
        await resolveArtifactWritePath(
          options.cwd,
          path.posix.join(root, CHANGE_IMPACT_EVAL_SUMMARY_ARTIFACT_NAME)
        ),
        summary
      )
    }

    logger.info('Change-impact eval run completed.', {
      scored_case_count: report.coverage.scoredCaseCount,
      unmeasured_case_count: report.coverage.unmeasuredCaseCount,
      adjudication_measured_case_count:
        report.coverage.adjudicationMeasuredCaseCount,
      change_impact_eval_archive_root: archiveRoot
    })

    // A run in which nothing could be scored is not a result. Exiting 0 with an
    // all-not-measured report would let an un-hydrated corpus look like a
    // completed measurement.
    return {
      exitCode: report.coverage.scoredCaseCount === 0 ? 1 : 0,
      stdout: `${summary}\n`,
      stderr:
        report.coverage.scoredCaseCount === 0
          ? 'No change-impact case could be scored. Run npm run eval:impact-corpus:hydrate first.\n'
          : ''
    }
  } catch (error) {
    return mapErrorResult(error, 'internal')
  }
}
