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
//
// The procedure it follows is `runAdvisoryEvalCommand`, shared with `eval impact`.
// Sharing the procedure does not pool the corpora: everything below that could
// reach another corpus — the option set, the manifest parser, the answer-key
// digests, the artefact root — is stated here and nowhere else.
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
  renderIntentEvalSummary,
  runIntentEvalCase,
  scoreIntentCases,
  type IntentCaseInput,
  type IntentCorpusCase,
  type IntentEvalReport
} from '../../domains/evaluation/index.js'
import { createIntentFulfilmentLane } from '../../domains/intent-fulfilment/index.js'
import {
  runAdvisoryEvalCommand,
  type AdvisoryEvalCommandDescriptor
} from '../advisory-eval-command.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'

// This corpus has no options of its own: every case runs at its declared
// obligation limit and there is no arm to switch off.
type IntentEvalRunOptions = Record<string, never>

const intentEvalDescriptor: AdvisoryEvalCommandDescriptor<
  IntentCorpusCase,
  IntentCaseInput,
  Exclude<Awaited<ReturnType<typeof createIntentFulfilmentLane>>, undefined>,
  IntentEvalReport,
  IntentEvalRunOptions
> = {
  name: 'intent',
  loggerCommand: 'eval-intent',
  commandOptions: [],
  defaultCaseRoot: defaultIntentOutputRoot,
  defaultManifestPath: defaultIntentManifestPath,
  parseRunOptions: () => ({}),
  capabilityConfig: () => ({ intentFulfilment: { enabled: true } }),
  parseManifest: parseIntentCorpusManifestJson,
  // Absent when no provider is configured or none can be resolved, which leaves
  // every case `provider-unavailable` — a coverage fact, never a measured zero.
  createLane: createIntentFulfilmentLane,
  laneUnavailableWarning: () =>
    'No model lane could be created, so no case could be scored. Configure a provider: this corpus has no zero-spend arm, because a lane that reads nothing reports nothing.',
  startedMessage: 'Intent-fulfilment eval run started.',
  startedFields: ({ laneAvailable }) => ({ lane_available: laneAvailable }),
  runCase: async ({ repositoryRoot, caseRoot, corpusCase, config, lane, logger }) =>
    await runIntentEvalCase({
      repositoryRoot,
      caseRoot,
      corpusCase,
      config,
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
    }),
  buildReport: (input) =>
    buildIntentEvalReport({
      score: scoreIntentCases(input.caseInputs),
      generatedAt: input.generatedAt,
      datasetId: input.datasetId,
      selection: input.selection,
      engine: input.engine,
      provenance: {
        answerKeyDigest: computeIntentAnswerKeyDigest(input.selectedCases),
        answerKeyDigestByCase: computeIntentAnswerKeyDigestByCase(
          input.selectedCases
        ),
        ...input.provenance
      },
      ...(input.usage === undefined ? {} : { usage: input.usage }),
      warnings: input.warnings
    }),
  renderSummary: renderIntentEvalSummary,
  artifactRoot: INTENT_EVAL_ARTIFACT_ROOT,
  reportArtifactName: INTENT_EVAL_REPORT_ARTIFACT_NAME,
  summaryArtifactName: INTENT_EVAL_SUMMARY_ARTIFACT_NAME,
  completedMessage: 'Intent-fulfilment eval run completed.',
  completedFields: ({ report, archiveRoot }) => ({
    scored_case_count: report.coverage.scoredCaseCount,
    refused_case_count: report.coverage.refusedCaseCount,
    unmeasured_case_count: report.coverage.unmeasuredCaseCount,
    false_satisfied_claim_count:
      report.arms.prewritten.falseSatisfied.claimCount,
    intent_eval_archive_root: archiveRoot
  }),
  noScoredCaseStderr:
    'No intent case could be scored. Run npm run eval:intent-corpus:hydrate, and check that a provider is configured.\n'
}

export const runEvalIntent = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> =>
  runAdvisoryEvalCommand(intentEvalDescriptor, args, options)
