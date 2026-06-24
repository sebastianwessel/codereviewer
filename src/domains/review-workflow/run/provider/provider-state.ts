import type { Logger, SkillsConfig } from '@purista/harness'
import type {
  CodeReviewerConfig,
  EvidenceRecord
} from '../../../../shared/contracts/index.js'
import type { CandidateFinding } from '../../../admission/index.js'
import type { DeterministicSignalExtraction } from '../../../deterministic-signals/index.js'
import type { DriftFinding } from '../../../drift/index.js'
import type { NoContentEventRecorder } from '../../../observability/index.js'
import type { ProviderImport } from '../../../provider-resolution/index.js'
import type { ContextLedgerEntry } from '../../../review-planning/context-ledger.js'
import type { ReviewWorkflowInput, ReviewWorkflowOutput } from '../../harness/workflow.js'
import type { WorkflowReviewTask } from '../../pipeline/agent-contracts.js'
import { sharedTaskEventFromWorkflow } from '../admission.js'
import { recordObservedTaskEvents } from '../support/observability.js'
import { createProviderWorkflowFailure } from './provider-failures.js'
import { runProviderWorkflow } from './provider-workflow.js'

type RunProviderWorkflow = typeof runProviderWorkflow

export type ReviewRunnerProviderState = {
  readonly providerWorkflow: Awaited<ReturnType<RunProviderWorkflow>>
  readonly providerTaskEventsObservedLive: boolean
}

export const prepareReviewRunnerProviderState = async (input: {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly configWarnings?: readonly string[] | undefined
  readonly driftFindings: readonly DriftFinding[]
  readonly baseRef?: string | undefined
  readonly headRef?: string | undefined
  readonly runId: string
  readonly startedAt: Date
  readonly now: () => Date
  readonly configHash: string
  readonly analysis: DeterministicSignalExtraction
  readonly contextLedger: readonly ContextLedgerEntry[]
  readonly evidence: readonly EvidenceRecord[]
  readonly supportSignalCandidates: readonly CandidateFinding[]
  readonly workflowInput: ReviewWorkflowInput
  readonly tasks: readonly WorkflowReviewTask[]
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly providerImport?: ProviderImport | undefined
  readonly skillDefinitions: SkillsConfig
  readonly skillIds: readonly string[]
  readonly logger: Logger
  readonly observability: NoContentEventRecorder
  readonly signal?: AbortSignal | undefined
  readonly runTimedOut: () => boolean
  readonly runProviderWorkflow?: RunProviderWorkflow | undefined
}): Promise<ReviewRunnerProviderState> => {
  const executeProviderWorkflow =
    input.runProviderWorkflow ?? runProviderWorkflow
  let providerTaskEventsObservedLive = false
  const recordLiveProviderTaskEvent = (
    event: ReviewWorkflowOutput['taskEvents'][number]
  ): void => {
    providerTaskEventsObservedLive = true
    recordObservedTaskEvents(input.observability, [
      sharedTaskEventFromWorkflow(event)
    ])
  }

  try {
    const providerWorkflow = await executeProviderWorkflow({
      workflowInput: input.workflowInput,
      config: input.config,
      environment: input.environment,
      ...(input.providerImport === undefined
        ? {}
        : { providerImport: input.providerImport }),
      skillDefinitions: input.skillDefinitions,
      skillIds: input.skillIds,
      logger: input.logger,
      observability: input.observability,
      onTaskEvent: recordLiveProviderTaskEvent,
      ...(input.signal === undefined ? {} : { signal: input.signal })
    })

    return {
      providerWorkflow,
      providerTaskEventsObservedLive
    }
  } catch (error) {
    const providerFailure = createProviderWorkflowFailure({
      repositoryRoot: input.repositoryRoot,
      config: input.config,
      configWarnings: input.configWarnings,
      driftFindings: input.driftFindings,
      baseRef: input.baseRef,
      headRef: input.headRef,
      runId: input.runId,
      startedAt: input.startedAt,
      completedAt: input.now(),
      configHash: input.configHash,
      analysis: input.analysis,
      contextLedger: input.contextLedger,
      evidence: input.evidence,
      supportSignalCandidates: input.supportSignalCandidates,
      error,
      runTimedOut: input.runTimedOut(),
      tasks: input.tasks,
      timeoutMs: input.config.review.runTimeoutMs,
      observability: input.observability.snapshot()
    })
    if (providerFailure !== undefined) {
      throw providerFailure
    }

    throw error
  }
}
