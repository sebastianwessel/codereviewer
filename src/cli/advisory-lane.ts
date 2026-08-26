// The two advisory reference stages (specs 22 and 23) as DATA.
//
// `impact check` and `intent check` are two independently runnable advisory
// stages built from ONE command shape, and that shape was written twice: two
// check commands, two `review`-stage wrappers, two artifact writers. Sixty-nine
// of eighty-six lines were identical between the two command modules alone. Every
// one of those copies was correct on its own, which is exactly why the drift went
// unnoticed — a fix applied to the impact copy had no way of reaching the intent
// copy, and nothing failed when it did not.
//
// So the differences are stated here, once, as one value per stage, and the shape
// they share is written once in `advisory-check-command.ts` (the command) and
// `advisory-lanes.ts` (the in-process `review` stage). WHAT BELONGS IN A
// DESCRIPTOR is a difference between the two stages that a reader can see without
// leaving this file: a noun, an artifact name, a config switch, a report
// predicate. What does not belong is a branch on which stage is running — an
// `if (name === 'impact')` inside the shared path would be the duplication back
// again, hidden.
//
// It lives in `src/cli/` rather than in a domain for the reason `advisory-lanes.ts`
// records: it composes two independent advisory domains, and composing domains is
// what the CLI layer is for. Spec 01 forbids `change-impact` and
// `intent-fulfilment` reaching each other or `review-workflow`, so no domain may
// hold this.
import type { CodeReviewerConfig } from '../shared/contracts/index.js'
import {
  createChangeImpactLane,
  renderChangeImpactMarkdown,
  runChangeImpact,
  type ChangeImpactAgents,
  type ChangeImpactReferenceReport
} from '../domains/change-impact/index.js'
import {
  createIntentFulfilmentLane,
  renderIntentFulfilmentMarkdown,
  runIntentFulfilment,
  type IntentFulfilmentAgents,
  type IntentFulfilmentReport
} from '../domains/intent-fulfilment/index.js'
import type { LaneUsage } from '../domains/costs/index.js'
import type { Logger } from '../domains/observability/index.js'
import type { ProviderImport } from '../domains/provider-resolution/index.js'
import type { RunContext } from '../domains/run-context/index.js'
import {
  IMPACT_JSON_ARTIFACT_NAME,
  IMPACT_MARKDOWN_ARTIFACT_NAME,
  INTENT_JSON_ARTIFACT_NAME,
  INTENT_MARKDOWN_ARTIFACT_NAME
} from './run-artifacts.js'

// Both stages resolve a model lane with the same two run-scoped concerns: what it
// spent, and when it is finished. The agents differ — one reliance judge against
// three intent agents — and that is the only part a descriptor has to name.
export type AdvisoryModelLane = {
  readonly usage: () => LaneUsage | undefined
  readonly shutdown: () => Promise<void>
}

// The one field the shared code reads off an advisory report: what the stage
// spent, so `review` can measure the next stage against it. Everything else about
// a report belongs to the stage that produced it.
export type AdvisoryStageReport = {
  readonly usage?: LaneUsage | undefined
}

// What both `runChangeImpact` and `runIntentFulfilment` accept. They are the same
// input type apart from the agents block, which is what `TAgents` carries.
export type AdvisoryRunInput<TAgents> = {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly baseRef?: string
  readonly headRef?: string
  readonly generatedAt?: Date
  readonly agents?: TAgents
  readonly usage?: () => LaneUsage | undefined
  readonly readChangedFile: RunContext['readChangedFile']
  readonly runGit?: RunContext['runGit']
}

export type AdvisoryLaneDescriptor<
  TReport extends AdvisoryStageReport,
  TLane extends AdvisoryModelLane,
  TAgents
> = {
  // The stage's name as a reader sees it in a warning: `change-impact`,
  // `intent-fulfilment`.
  readonly name: string
  // The CLI command that runs this stage on its own — `impact`, `intent`. It is
  // the subcommand word (`Expected command: impact check`), the remedy named in
  // every skip warning, and the prefix on the run directory this stage writes.
  // Each stage names ITS OWN, because both warnings appear together on a default
  // `review` run and a reader following one must not be sent to the other's
  // answer.
  readonly command: string
  // The stderr line naming the written artifact. Kept per stage rather than
  // derived from `name`, because the two are prose a reader reads and not an
  // identifier: "Change-impact report", "Intent-fulfilment report".
  readonly reportLabel: string
  readonly jsonArtifactName: string
  readonly markdownArtifactName: string
  // The operator's switch for this stage. Checked before anything else runs, so a
  // stage that is off resolves no provider and issues no git subprocess.
  readonly isEnabled: (config: CodeReviewerConfig) => boolean
  readonly createLane: (input: {
    readonly config: CodeReviewerConfig
    readonly environment: Readonly<Record<string, string | undefined>>
    readonly providerImport?: ProviderImport | undefined
    readonly logger?: Logger | undefined
  }) => Promise<TLane | undefined>
  // The only structural difference between the two run calls.
  readonly agentsFrom: (lane: TLane) => TAgents
  readonly run: (input: AdvisoryRunInput<TAgents>) => Promise<TReport>
  readonly renderMarkdown: (report: TReport) => string
  // Whether this report is worth leaving on disk. A run that analysed nothing
  // leaves nothing behind: writing a run directory per invocation would
  // accumulate empty runs in a repository whose owner may never have asked for
  // the stage, and those directories are not in the run index, so nothing would
  // ever enumerate them again.
  //
  // THE TWO STAGES DRAW THIS LINE IN GENUINELY DIFFERENT PLACES, which is why it
  // is a predicate and not a shared status check. Change-impact writes for every
  // status but `disabled` — its reference list is real work even when nothing was
  // adjudicated. Intent writes only for `completed`: `no-intent` is the ORDINARY
  // outcome for most changes, and four of its five statuses mapped nothing.
  readonly leavesArtifacts: (report: TReport) => boolean
}

/**
 * Resolves this stage's model lane, runs the stage, and shuts the lane down.
 *
 * The lane is created here rather than by the caller so that its lifetime is
 * exactly the stage's: `finally` runs whether the stage returned a report or
 * threw, and no caller can forget it. An absent lane is not a failure — both
 * stages report their own no-model status and still produce a report.
 */
export const runAdvisoryStageReport = async <
  TReport extends AdvisoryStageReport,
  TLane extends AdvisoryModelLane,
  TAgents
>(input: {
  readonly descriptor: AdvisoryLaneDescriptor<TReport, TLane, TAgents>
  readonly runContext: RunContext
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly baseRef: string | undefined
  readonly headRef: string | undefined
  readonly generatedAt: Date | undefined
  readonly providerImport: ProviderImport | undefined
  readonly logger: Logger
}): Promise<TReport> => {
  const lane = await input.descriptor.createLane({
    config: input.runContext.config,
    environment: input.environment,
    ...(input.providerImport === undefined
      ? {}
      : { providerImport: input.providerImport }),
    logger: input.logger
  })

  try {
    return await input.descriptor.run({
      repositoryRoot: input.runContext.repositoryRoot,
      config: input.runContext.config,
      ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
      ...(input.headRef === undefined ? {} : { headRef: input.headRef }),
      ...(input.generatedAt === undefined
        ? {}
        : { generatedAt: input.generatedAt }),
      ...(lane === undefined
        ? {}
        : {
            agents: input.descriptor.agentsFrom(lane),
            usage: lane.usage
          }),
      readChangedFile: input.runContext.readChangedFile,
      runGit: input.runContext.runGit
    })
  } finally {
    await lane?.shutdown()
  }
}

export const changeImpactLaneDescriptor: AdvisoryLaneDescriptor<
  ChangeImpactReferenceReport,
  Exclude<Awaited<ReturnType<typeof createChangeImpactLane>>, undefined>,
  ChangeImpactAgents
> = {
  name: 'change-impact',
  command: 'impact',
  reportLabel: 'Change-impact report',
  jsonArtifactName: IMPACT_JSON_ARTIFACT_NAME,
  markdownArtifactName: IMPACT_MARKDOWN_ARTIFACT_NAME,
  isEnabled: (config) => config.changeImpact.enabled,
  // Absent unless adjudication is enabled AND a provider resolves. Every other
  // outcome reports `adjudicationStatus: "no-model"`, still emits the findings
  // that need no model, and still exits 0.
  createLane: createChangeImpactLane,
  agentsFrom: (lane) => ({ judgeReliance: lane.judgeReliance }),
  run: runChangeImpact,
  renderMarkdown: renderChangeImpactMarkdown,
  leavesArtifacts: (report) => report.status !== 'disabled'
}

export const intentFulfilmentLaneDescriptor: AdvisoryLaneDescriptor<
  IntentFulfilmentReport,
  Exclude<Awaited<ReturnType<typeof createIntentFulfilmentLane>>, undefined>,
  IntentFulfilmentAgents
> = {
  name: 'intent-fulfilment',
  command: 'intent',
  reportLabel: 'Intent-fulfilment report',
  jsonArtifactName: INTENT_JSON_ARTIFACT_NAME,
  markdownArtifactName: INTENT_MARKDOWN_ARTIFACT_NAME,
  isEnabled: (config) => config.intentFulfilment.enabled,
  // Absent unless the capability is enabled AND a provider resolves. Every other
  // outcome reports `provider-unavailable` with a warning and still exits 0.
  //
  // Change-intent sources are read by spec 11's ingestion, not through the run
  // context's mediated reader, which owns its own bounds and redaction.
  createLane: createIntentFulfilmentLane,
  agentsFrom: (lane) => ({
    extractObligations: lane.extractObligations,
    judge: lane.judge,
    explain: lane.explain
  }),
  run: runIntentFulfilment,
  renderMarkdown: renderIntentFulfilmentMarkdown,
  leavesArtifacts: (report) => report.status === 'completed'
}
