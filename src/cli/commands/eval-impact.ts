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
//
// The procedure it follows is `runAdvisoryEvalCommand`, shared with `eval intent`.
// Sharing the procedure does not pool the corpora: everything below that could
// reach the other corpus — the option set, the manifest parser, the answer-key
// digests, the artefact root — is stated here and nowhere else.
import { createChangeImpactLane } from '../../domains/change-impact/index.js'
import {
  CHANGE_IMPACT_EVAL_ARTIFACT_ROOT,
  CHANGE_IMPACT_EVAL_REPORT_ARTIFACT_NAME,
  CHANGE_IMPACT_EVAL_SUMMARY_ARTIFACT_NAME,
  buildChangeImpactEvalReport,
  changeImpactAdjudicationCallBounds,
  computeChangeImpactAnswerKeyDigest,
  computeChangeImpactAnswerKeyDigestByCase,
  defaultChangeImpactManifestPath,
  defaultChangeImpactOutputRoot,
  parseChangeImpactCorpusManifestJson,
  renderChangeImpactEvalSummary,
  runChangeImpactEvalCase,
  scoreChangeImpactCases,
  type ChangeImpactCaseInput,
  type ChangeImpactCorpusCase,
  type ChangeImpactEvalReport
} from '../../domains/evaluation/index.js'
import {
  runAdvisoryEvalCommand,
  type AdvisoryEvalCommandDescriptor
} from '../advisory-eval-command.js'
import { parseEnumOption, parseIntegerOption } from '../args.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'

const changeImpactAdjudicationModes = ['on', 'off'] as const

// Parsed once and read in three places: the forced config, the no-lane warning,
// and the report's `engine.adjudicationRequested`. A run that asked for
// adjudication and did not get it must not be indistinguishable from one that
// never asked.
type ChangeImpactEvalRunOptions = {
  readonly adjudicationRequested: boolean
  readonly maxAdjudicationCalls: number | undefined
}

const changeImpactEvalDescriptor: AdvisoryEvalCommandDescriptor<
  ChangeImpactCorpusCase,
  ChangeImpactCaseInput,
  Exclude<Awaited<ReturnType<typeof createChangeImpactLane>>, undefined>,
  ChangeImpactEvalReport,
  ChangeImpactEvalRunOptions
> = {
  name: 'impact',
  loggerCommand: 'eval-impact',
  commandOptions: ['--adjudication', '--max-adjudication-calls'],
  defaultCaseRoot: defaultChangeImpactOutputRoot,
  defaultManifestPath: defaultChangeImpactManifestPath,
  parseRunOptions: (args) => ({
    adjudicationRequested:
      (parseEnumOption(args, '--adjudication', changeImpactAdjudicationModes) ??
        'on') === 'on',
    // The cap is PER CASE, and when it binds the run leaves pairs unadjudicated —
    // which the scorer must then treat as undetermined rather than as a miss. It
    // is exposed here so an operator can lift it for a measurement run instead of
    // discovering afterwards that arm 2 could not be read. The bounds are the
    // config schema's own.
    maxAdjudicationCalls: parseIntegerOption(
      args,
      '--max-adjudication-calls',
      changeImpactAdjudicationCallBounds
    )
  }),
  capabilityConfig: (runOptions) => ({
    changeImpact: {
      enabled: true,
      adjudication: {
        enabled: runOptions.adjudicationRequested,
        ...(runOptions.maxAdjudicationCalls === undefined
          ? {}
          : { maxCalls: runOptions.maxAdjudicationCalls })
      }
    }
  }),
  parseManifest: parseChangeImpactCorpusManifestJson,
  // Absent when adjudication is off, when no provider is configured, or when one
  // cannot be resolved — each of which leaves the adjudicated arm NOT MEASURED
  // rather than measured at zero.
  createLane: createChangeImpactLane,
  laneUnavailableWarning: (runOptions) =>
    runOptions.adjudicationRequested
      ? 'Adjudication was requested but no model lane could be created, so the adjudicated arm is NOT MEASURED. Configure a provider, or pass --adjudication off to score the reference arm deliberately.'
      : undefined,
  startedMessage: 'Change-impact eval run started.',
  startedFields: ({ runOptions, laneAvailable }) => ({
    adjudication_requested: runOptions.adjudicationRequested,
    adjudication_lane_available: laneAvailable
  }),
  runCase: async ({ repositoryRoot, caseRoot, corpusCase, config, lane, logger }) =>
    await runChangeImpactEvalCase({
      repositoryRoot,
      caseRoot,
      corpusCase,
      config,
      ...(lane === undefined
        ? {}
        : { agents: { judgeReliance: lane.judgeReliance } }),
      logger: logger.child({ impact_case_id: corpusCase.id })
    }),
  buildReport: (input) =>
    buildChangeImpactEvalReport({
      score: scoreChangeImpactCases(input.caseInputs),
      generatedAt: input.generatedAt,
      datasetId: input.datasetId,
      selection: input.selection,
      engine: {
        ...input.engine,
        adjudicationRequested: input.runOptions.adjudicationRequested
      },
      provenance: {
        answerKeyDigest: computeChangeImpactAnswerKeyDigest(input.selectedCases),
        answerKeyDigestByCase: computeChangeImpactAnswerKeyDigestByCase(
          input.selectedCases
        ),
        ...input.provenance
      },
      ...(input.usage === undefined ? {} : { usage: input.usage }),
      warnings: input.warnings
    }),
  renderSummary: renderChangeImpactEvalSummary,
  artifactRoot: CHANGE_IMPACT_EVAL_ARTIFACT_ROOT,
  reportArtifactName: CHANGE_IMPACT_EVAL_REPORT_ARTIFACT_NAME,
  summaryArtifactName: CHANGE_IMPACT_EVAL_SUMMARY_ARTIFACT_NAME,
  completedMessage: 'Change-impact eval run completed.',
  completedFields: ({ report, archiveRoot }) => ({
    scored_case_count: report.coverage.scoredCaseCount,
    unmeasured_case_count: report.coverage.unmeasuredCaseCount,
    adjudication_measured_case_count:
      report.coverage.adjudicationMeasuredCaseCount,
    change_impact_eval_archive_root: archiveRoot
  }),
  noScoredCaseStderr:
    'No change-impact case could be scored. Run npm run eval:impact-corpus:hydrate first.\n'
}

export const runEvalImpact = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> =>
  runAdvisoryEvalCommand(changeImpactEvalDescriptor, args, options)
