// `eval intent` (spec 23 §Evaluation) — the intent-fulfilment corpus.
//
// A SEPARATE COMMAND FROM `eval run` AND FROM `eval impact`, AND DELIBERATELY HARD
// TO CONFUSE WITH EITHER. Three corpora answer three different questions with three
// different answer keys, and spec 23 records why this one cannot borrow another's:
// "This capability cannot be measured by any existing corpus. The spec 17 corpus is
// built from upstream fix commits, which carry no pull-request description and no
// ticket." So this command does not accept `--slice-root` at all — the option is
// unknown to it and a typo exits 2 — its cases are `case.json` under a
// `--case-root`, and its artefact carries a `reportKind` no other report can parse
// as.
//
// WHY IT EXISTS AT ALL. Spec 23 ships the lane with a measured, named failure mode
// rather than a mitigation, and the lane has been on by default since 2026-08-11.
// A rate that reaches every reader of every pull request has to rest on an
// instrument in the repository; before this command the only one lived under the
// gitignored `.codereviewer/` tree and no clean checkout could reproduce it.
//
// The lane is FORCED ON for the run and every case runs at its declared obligation
// limit. Scoring an engine that read nothing would be the "absence rendered as
// zero" this scorer exists to refuse. There is no `--adjudication off` equivalent:
// this lane's cheapest honest run still spends one extraction, one judgement per
// obligation and one explanation, and a zero-spend mode would report nothing.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { stableJsonDigest } from '../../shared/json/stable-json-digest.js'
import {
  buildIntentEvalReport,
  computeIntentAnswerKeyDigest,
  computeIntentAnswerKeyDigestByCase,
  defaultIntentManifestPath,
  defaultIntentOutputRoot,
  INTENT_EVAL_ARTIFACT_ROOT,
  INTENT_EVAL_REPORT_ARTIFACT_NAME,
  INTENT_EVAL_SUMMARY_ARTIFACT_NAME,
  parseIntentCorpusManifestJson,
  readEngineIdentity,
  renderIntentEvalSummary,
  scoreIntentCases,
  selectCorpusCases,
  type IntentCaseInput
} from '../../domains/evaluation/index.js'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
import {
  loggingCliOptions,
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
import { createIntentEvalLane, runIntentEvalCase } from '../intent-eval-runner.js'
import {
  ensureDirectory,
  jsonResult,
  resolveArtifactWritePath
} from '../run-artifacts.js'

export const runEvalIntent = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(args, [
    ...loggingCliOptions,
    '--case',
    '--case-root',
    '--manifest'
  ])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  try {
    const logLevelOverride = parseLogLevelOverride(args)
    const logFileOverride = parseLogFileOverride(logLevelOverride.args)
    const intentArgs = logFileOverride.args
    const caseRoot =
      parseOptionValue(intentArgs, '--case-root') ?? defaultIntentOutputRoot
    const manifestPath =
      parseOptionValue(intentArgs, '--manifest') ?? defaultIntentManifestPath
    const caseFilters = parseOptionValues(intentArgs, '--case')
    const loadedConfig = await loadConfigForCommand(intentArgs, options, {
      loadDotEnv: false,
      cliConfig: {
        ...(logLevelOverride.level === undefined
          ? {}
          : { observability: { logging: { level: logLevelOverride.level } } }),
        intentFulfilment: { enabled: true }
      }
    })
    const logger = createCliLogger({
      config: loadedConfig.config,
      command: 'eval-intent',
      sink: await resolveLogSink(options, logFileOverride.logFile)
    })
    const manifest = parseIntentCorpusManifestJson(
      await readFile(
        await resolveExistingPathInsideRoot(options.cwd, manifestPath),
        'utf8'
      )
    )
    const selectedCases = selectCorpusCases(manifest.cases, caseFilters)

    if (selectedCases.length === 0) {
      return usageError('eval intent selected no cases')
    }

    // One lane for the whole run: the usage recorder and the agent lifetime are per
    // run, not per case. Absent when no provider is configured or none can be
    // resolved, which leaves every case `provider-unavailable` — a coverage fact,
    // never a measured zero.
    const lane = await createIntentEvalLane({
      config: loadedConfig.config,
      environment: loadedConfig.environment,
      ...(options.providerImport === undefined
        ? {}
        : { providerImport: options.providerImport }),
      logger
    })
    const warnings: string[] = [...loadedConfig.warnings]

    if (lane === undefined) {
      warnings.push(
        'No model lane could be created, so no case could be scored. Configure a provider: this corpus has no zero-spend arm, because a lane that reads nothing reports nothing.'
      )
    }

    logger.info('Intent-fulfilment eval run started.', {
      selected_case_count: selectedCases.length,
      lane_available: lane !== undefined
    })

    const caseInputs: IntentCaseInput[] = []

    try {
      // Sequential on purpose: each case checks out a full working tree and spends
      // one model call per obligation, and the usage recorder is shared.
      for (const corpusCase of selectedCases) {
        caseInputs.push(
          await runIntentEvalCase({
            repositoryRoot: options.cwd,
            caseRoot,
            corpusCase,
            config: loadedConfig.config,
            ...(lane === undefined
              ? {}
              : {
                  agents: {
                    extractObligations: lane.extractObligations,
                    judge: lane.judge,
                    explain: lane.explain
                  },
                  usage: lane.usage
                }),
            logger: logger.child({ intent_case_id: corpusCase.id })
          })
        )
      }
    } finally {
      await lane?.shutdown()
    }

    // The lane's own per-case warnings, carried through with the case named.
    // Without them a case whose stated intent arrived already cut by a
    // `contextSources` provider scores as a genuine miss with nothing on the page
    // saying part of the intent was never read.
    for (const caseInput of caseInputs) {
      if (caseInput.outcome.status !== 'scored') {
        continue
      }

      for (const warning of caseInput.outcome.report.warnings) {
        warnings.push(`${caseInput.corpusCase.id}: ${warning}`)
      }
    }

    const score = scoreIntentCases(caseInputs)
    const engine = await readEngineIdentity({ repositoryRoot: options.cwd })
    const providerConfig = loadedConfig.config.provider
    const report = buildIntentEvalReport({
      score,
      generatedAt: (options.now ?? ((): Date => new Date()))(),
      datasetId: manifest.datasetId,
      selection: {
        manifestPath,
        caseRoot,
        caseFilters: [...caseFilters],
        selectedCaseIds: selectedCases.map((corpusCase) => corpusCase.id)
      },
      engine,
      provenance: {
        answerKeyDigest: computeIntentAnswerKeyDigest(selectedCases),
        answerKeyDigestByCase:
          computeIntentAnswerKeyDigestByCase(selectedCases),
        configHash: stableJsonDigest(loadedConfig.config),
        ...(providerConfig === undefined
          ? {}
          : { providerId: providerConfig.id, modelName: providerConfig.model })
      },
      ...(lane?.usage() === undefined ? {} : { usage: lane?.usage() }),
      warnings
    })
    const summary = renderIntentEvalSummary(report)
    const archiveRoot = path.posix.join(
      INTENT_EVAL_ARTIFACT_ROOT,
      'runs',
      createEvalRunArchiveId()
    )

    for (const root of [INTENT_EVAL_ARTIFACT_ROOT, archiveRoot]) {
      await ensureDirectory(await resolveArtifactWritePath(options.cwd, root))
      await writeFile(
        await resolveArtifactWritePath(
          options.cwd,
          path.posix.join(root, INTENT_EVAL_REPORT_ARTIFACT_NAME)
        ),
        jsonResult(report)
      )
      await writeFile(
        await resolveArtifactWritePath(
          options.cwd,
          path.posix.join(root, INTENT_EVAL_SUMMARY_ARTIFACT_NAME)
        ),
        summary
      )
    }

    logger.info('Intent-fulfilment eval run completed.', {
      scored_case_count: report.coverage.scoredCaseCount,
      refused_case_count: report.coverage.refusedCaseCount,
      unmeasured_case_count: report.coverage.unmeasuredCaseCount,
      false_satisfied_claim_count:
        report.arms.prewritten.falseSatisfied.claimCount,
      intent_eval_archive_root: archiveRoot
    })

    // A run in which nothing could be scored is not a result. Exiting 0 with an
    // all-unmeasured report would let an un-hydrated corpus — or a missing provider
    // — look like a completed measurement that found no false-satisfied claim.
    return {
      exitCode: report.coverage.scoredCaseCount === 0 ? 1 : 0,
      stdout: `${summary}\n`,
      stderr:
        report.coverage.scoredCaseCount === 0
          ? 'No intent case could be scored. Run npm run eval:intent-corpus:hydrate, and check that a provider is configured.\n'
          : ''
    }
  } catch (error) {
    return mapErrorResult(error, 'internal')
  }
}
