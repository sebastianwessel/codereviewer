// The skeleton `eval impact` and `eval intent` are built from.
//
// The two commands score two corpora that MUST NEVER be pooled — spec 22 forbids
// it for change-impact, spec 23 records that no existing corpus can measure
// intent-fulfilment at all — and each therefore has its own manifest, its own
// answer key, its own `reportKind` and its own artefact tree. What they do NOT
// have is two different procedures: read a manifest, select cases, force the
// capability on, resolve one lane for the whole run, run each case sequentially,
// carry the engine's per-case warnings through named by case, score, stamp
// provenance, write the report and its summary to both the latest and the archive
// root, and exit non-zero when nothing could be scored.
//
// That procedure was written twice, 125 of roughly 190 lines identical. It is
// written once here, and everything the two runs differ on arrives as a
// descriptor: the option set, the corpus parser, the capability config, the lane,
// the per-case runner, the report builder, the artefact names and the log fields.
//
// SEPARATENESS IS PRESERVED, not weakened, by sharing this body. The descriptors
// keep the option sets apart — `--slice-root` is unknown to both, `--adjudication`
// is known only to impact — and each names its own artefact root, so no run can
// write into the other's tree or read the other's manifest. What is shared is the
// procedure, which is the part that must not drift; what is separate is the data,
// which is the part that must not be pooled.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { LaneUsage } from '../domains/costs/index.js'
import {
  readRunningEngineIdentity,
  selectCorpusCases
} from '../domains/evaluation/index.js'
import type { Logger } from '../domains/observability/index.js'
import type { ProviderImport } from '../domains/provider-resolution/index.js'
import { resolveExistingPathInsideRoot } from '../platform/path-service.js'
import type { CodeReviewerConfig } from '../shared/contracts/index.js'
import { stableJsonDigest } from '../shared/json/stable-json-digest.js'
import type { AdvisoryModelLane } from './advisory-lane.js'
import {
  loggingCliOptions,
  parseLogFileOverride,
  parseLogLevelOverride,
  parseOptionValue,
  parseOptionValues,
  unknownCliOption
} from './args.js'
import type { CliResult, CliRunOptions } from './cli-contract.js'
import { mapErrorResult, usageError } from './cli-error-results.js'
import {
  loadConfigForCommand,
  type LoadedCodeReviewerConfig
} from './command-config.js'
import { createCliLogger, resolveLogSink } from './command-logging.js'
import { createEvalRunArchiveId } from './eval-run-archive-id.js'
import {
  ensureDirectory,
  jsonResult,
  resolveArtifactWritePath
} from './run-artifacts.js'

// The config layer a corpus run forces on top of the operator's own. Typed off
// the loader so a descriptor cannot invent a key the config schema does not have.
type CommandCliConfig = NonNullable<
  NonNullable<Parameters<typeof loadConfigForCommand>[2]>['cliConfig']
>

type EngineIdentity = Awaited<ReturnType<typeof readRunningEngineIdentity>>

// What both report contracts record about which cases this run covered. The
// arrays are mutable because both `selection` contracts are Zod-inferred and
// mutable; nothing here writes to them.
export type AdvisoryEvalSelection = {
  readonly manifestPath: string
  readonly caseRoot: string
  readonly caseFilters: string[]
  readonly selectedCaseIds: string[]
}

// The provenance both reports share. The answer-key digests are NOT here: each
// corpus hashes its own answer key with its own function, and a shared digest
// would be the pooling both specs forbid.
export type AdvisoryEvalProvenance = {
  readonly configHash: string
  readonly providerId?: string
  readonly modelName?: string
}

// The only two things the shared body reads off a per-case result: which case it
// was, and the engine's own warnings when the case scored. Everything else about
// an outcome belongs to the corpus that defines it.
export type AdvisoryEvalCaseInput = {
  readonly corpusCase: { readonly id: string }
  readonly outcome: {
    readonly status: string
    readonly report?: { readonly warnings: readonly string[] } | undefined
  }
}

// The only field the shared body reads off an eval report: whether anything was
// scored, which decides the exit code.
export type AdvisoryEvalReport = {
  readonly coverage: { readonly scoredCaseCount: number }
}

export type AdvisoryEvalCommandDescriptor<
  TCorpusCase extends { readonly id: string },
  TCaseInput extends AdvisoryEvalCaseInput,
  TLane extends AdvisoryModelLane,
  TReport extends AdvisoryEvalReport,
  TRunOptions
> = {
  // The subcommand word, as it appears in `eval <name> selected no cases`.
  readonly name: string
  // The `command` binding on every log line this run emits.
  readonly loggerCommand: string
  // Options this corpus accepts beyond the logging flags and the three every
  // corpus run takes (`--case`, `--case-root`, `--manifest`). Kept per command
  // rather than pooled: `--slice-root` must stay unknown to both, so a typo exits
  // 2 instead of silently scoring the wrong corpus.
  readonly commandOptions: readonly string[]
  readonly defaultCaseRoot: string
  readonly defaultManifestPath: string
  // The options only this corpus has, parsed once and then threaded through the
  // run because they are read in three places: the forced config, the
  // no-lane warning, and the report's `engine` block.
  readonly parseRunOptions: (args: readonly string[]) => TRunOptions
  // The capability this corpus measures, FORCED ON for the run. Scoring an engine
  // that analysed nothing would be the "absence rendered as zero" every scorer
  // here exists to refuse.
  readonly capabilityConfig: (runOptions: TRunOptions) => CommandCliConfig
  readonly parseManifest: (json: string) => {
    readonly datasetId: string
    readonly cases: readonly TCorpusCase[]
  }
  // One lane for the whole run: the usage recorder and the agent lifetime are per
  // run, not per case.
  readonly createLane: (input: {
    readonly config: CodeReviewerConfig
    readonly environment: Readonly<Record<string, string | undefined>>
    readonly providerImport?: ProviderImport | undefined
    readonly logger?: Logger | undefined
  }) => Promise<TLane | undefined>
  // What a reader is told when no lane could be created. `undefined` when this
  // run did not want one — the change-impact corpus has a deliberate zero-spend
  // arm, the intent corpus has none.
  readonly laneUnavailableWarning: (
    runOptions: TRunOptions
  ) => string | undefined
  readonly startedMessage: string
  readonly startedFields: (input: {
    readonly runOptions: TRunOptions
    readonly laneAvailable: boolean
  }) => Record<string, unknown>
  readonly runCase: (input: {
    readonly repositoryRoot: string
    readonly caseRoot: string
    readonly corpusCase: TCorpusCase
    readonly config: CodeReviewerConfig
    readonly lane: TLane | undefined
    readonly logger: Logger
  }) => Promise<TCaseInput>
  // Scoring and report assembly in one hook, because the two are the same step
  // seen twice: the score type is this corpus's alone and never escapes it.
  readonly buildReport: (input: {
    readonly caseInputs: readonly TCaseInput[]
    readonly selectedCases: readonly TCorpusCase[]
    readonly runOptions: TRunOptions
    readonly generatedAt: Date
    readonly datasetId: string
    readonly selection: AdvisoryEvalSelection
    readonly engine: EngineIdentity
    readonly provenance: AdvisoryEvalProvenance
    readonly usage: LaneUsage | undefined
    readonly warnings: readonly string[]
  }) => TReport
  readonly renderSummary: (report: TReport) => string
  readonly artifactRoot: string
  readonly reportArtifactName: string
  readonly summaryArtifactName: string
  readonly completedMessage: string
  readonly completedFields: (input: {
    readonly report: TReport
    readonly archiveRoot: string
  }) => Record<string, unknown>
  // What a run that scored nothing tells the operator to do about it. Corpus
  // specific because the hydration script and the missing prerequisite are.
  readonly noScoredCaseStderr: string
}

/**
 * Runs one advisory corpus end to end and writes its artefacts.
 *
 * Every error inside the body maps to `internal`: by this point the arguments
 * have been accepted and the run is under way, so a failure is the harness's, not
 * the operator's.
 */
export const runAdvisoryEvalCommand = async <
  TCorpusCase extends { readonly id: string },
  TCaseInput extends AdvisoryEvalCaseInput,
  TLane extends AdvisoryModelLane,
  TReport extends AdvisoryEvalReport,
  TRunOptions
>(
  descriptor: AdvisoryEvalCommandDescriptor<
    TCorpusCase,
    TCaseInput,
    TLane,
    TReport,
    TRunOptions
  >,
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(args, [
    ...loggingCliOptions,
    '--case',
    '--case-root',
    '--manifest',
    ...descriptor.commandOptions
  ])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  try {
    const logLevelOverride = parseLogLevelOverride(args)
    const logFileOverride = parseLogFileOverride(logLevelOverride.args)
    const corpusArgs = logFileOverride.args
    const caseRoot =
      parseOptionValue(corpusArgs, '--case-root') ?? descriptor.defaultCaseRoot
    const manifestPath =
      parseOptionValue(corpusArgs, '--manifest') ??
      descriptor.defaultManifestPath
    const caseFilters = parseOptionValues(corpusArgs, '--case')
    const runOptions = descriptor.parseRunOptions(corpusArgs)
    const loadedConfig: LoadedCodeReviewerConfig = await loadConfigForCommand(
      corpusArgs,
      options,
      {
        loadDotEnv: false,
        cliConfig: {
          ...(logLevelOverride.level === undefined
            ? {}
            : { observability: { logging: { level: logLevelOverride.level } } }),
          ...descriptor.capabilityConfig(runOptions)
        }
      }
    )
    const logger = createCliLogger({
      config: loadedConfig.config,
      command: descriptor.loggerCommand,
      sink: await resolveLogSink(options, logFileOverride.logFile)
    })
    const manifest = descriptor.parseManifest(
      await readFile(
        await resolveExistingPathInsideRoot(options.cwd, manifestPath),
        'utf8'
      )
    )
    const selectedCases = selectCorpusCases(manifest.cases, caseFilters)

    if (selectedCases.length === 0) {
      return usageError(`eval ${descriptor.name} selected no cases`)
    }

    const lane = await descriptor.createLane({
      config: loadedConfig.config,
      environment: loadedConfig.environment,
      ...(options.providerImport === undefined
        ? {}
        : { providerImport: options.providerImport }),
      logger
    })
    const warnings: string[] = [...loadedConfig.warnings]

    if (lane === undefined) {
      const laneWarning = descriptor.laneUnavailableWarning(runOptions)

      if (laneWarning !== undefined) {
        warnings.push(laneWarning)
      }
    }

    logger.info(descriptor.startedMessage, {
      selected_case_count: selectedCases.length,
      ...descriptor.startedFields({
        runOptions,
        laneAvailable: lane !== undefined
      })
    })

    const caseInputs: TCaseInput[] = []

    try {
      // Sequential on purpose: each case is a full checkout of an upstream
      // repository, and the run's model spend is bounded per run rather than per
      // case.
      for (const corpusCase of selectedCases) {
        caseInputs.push(
          await descriptor.runCase({
            repositoryRoot: options.cwd,
            caseRoot,
            corpusCase,
            config: loadedConfig.config,
            lane,
            logger
          })
        )
      }
    } finally {
      await lane?.shutdown()
    }

    // The engine's own per-case warnings, carried through with the case named.
    // Without them a case the engine never really looked at — an unsupported
    // language, or a stated intent a `contextSources` provider had already cut —
    // scores as a genuine miss with nothing on the page saying so.
    for (const caseInput of caseInputs) {
      if (caseInput.outcome.status !== 'scored') {
        continue
      }

      for (const warning of caseInput.outcome.report?.warnings ?? []) {
        warnings.push(`${caseInput.corpusCase.id}: ${warning}`)
      }
    }

    // NO ARGUMENT. `eval impact` and `eval intent` are the two commands this
    // function serves, and both used to pass `options.cwd` here: the directory
    // the operator ran the CLI from, which is the engine checkout only by the
    // accident of how this repository's own evals are invoked. Pointed at a
    // corpus elsewhere it stamped that directory's commit — or `unknown` — onto
    // a report describing THIS build. The identity is resolved from the engine's
    // own module location instead; see `readRunningEngineIdentity`.
    const engine = await readRunningEngineIdentity()
    const providerConfig = loadedConfig.config.provider
    const provenance: AdvisoryEvalProvenance = {
      configHash: stableJsonDigest(loadedConfig.config),
      ...(providerConfig === undefined
        ? {}
        : { providerId: providerConfig.id, modelName: providerConfig.model })
    }
    const report = descriptor.buildReport({
      caseInputs,
      selectedCases,
      runOptions,
      generatedAt: (options.now ?? ((): Date => new Date()))(),
      datasetId: manifest.datasetId,
      selection: {
        manifestPath,
        caseRoot,
        caseFilters: [...caseFilters],
        selectedCaseIds: selectedCases.map((corpusCase) => corpusCase.id)
      },
      engine,
      provenance,
      usage: lane?.usage(),
      warnings
    })
    const summary = descriptor.renderSummary(report)
    const archiveRoot = path.posix.join(
      descriptor.artifactRoot,
      'runs',
      createEvalRunArchiveId()
    )

    for (const root of [descriptor.artifactRoot, archiveRoot]) {
      await ensureDirectory(await resolveArtifactWritePath(options.cwd, root))
      await writeFile(
        await resolveArtifactWritePath(
          options.cwd,
          path.posix.join(root, descriptor.reportArtifactName)
        ),
        jsonResult(report)
      )
      await writeFile(
        await resolveArtifactWritePath(
          options.cwd,
          path.posix.join(root, descriptor.summaryArtifactName)
        ),
        summary
      )
    }

    logger.info(
      descriptor.completedMessage,
      descriptor.completedFields({ report, archiveRoot })
    )

    // A run in which nothing could be scored is not a result. Exiting 0 with an
    // all-unmeasured report would let an un-hydrated corpus — or a missing
    // provider — look like a completed measurement.
    return {
      exitCode: report.coverage.scoredCaseCount === 0 ? 1 : 0,
      stdout: `${summary}\n`,
      stderr:
        report.coverage.scoredCaseCount === 0
          ? descriptor.noScoredCaseStderr
          : ''
    }
  } catch (error) {
    return mapErrorResult(error, 'internal')
  }
}
