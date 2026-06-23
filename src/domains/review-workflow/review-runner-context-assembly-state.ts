import type { Logger } from '@purista/harness'
import type { CodeReviewerConfig } from '../../shared/contracts/index.js'
import type { DeterministicSignalExtraction, SupportSignalSourceFile } from '../deterministic-signals/index.js'
import type { NoContentEventRecorder } from '../observability/index.js'
import type { ReviewTask } from '../review-planning/index.js'
import {
  prepareReviewRunnerContextState,
  type ReviewRunnerContextState
} from './review-runner-context.js'

type PrepareContextState = typeof prepareReviewRunnerContextState

export const prepareReviewRunnerContextAssemblyState = async (input: {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly sourceFiles: readonly SupportSignalSourceFile[]
  readonly analysis: DeterministicSignalExtraction
  readonly tasks: readonly ReviewTask[]
  readonly observability: NoContentEventRecorder
  readonly logger: Logger
  readonly prepareContextState?: PrepareContextState
}): Promise<ReviewRunnerContextState> => {
  const prepareContextState =
    input.prepareContextState ?? prepareReviewRunnerContextState

  const contextAssemblyStep = input.observability.startStep('context_assembly')
  input.logger.debug('Context assembly started.')
  const contextState = await prepareContextState({
    repositoryRoot: input.repositoryRoot,
    config: input.config,
    sourceFiles: input.sourceFiles,
    analysis: input.analysis,
    tasks: input.tasks
  })
  contextAssemblyStep.end({
    ledgerEntryCount: contextState.metrics.ledgerEntryCount
  })
  input.logger.debug('Context assembly completed.', {
    ledger_entry_count: contextState.metrics.ledgerEntryCount,
    workflow_task_count: contextState.metrics.workflowTaskCount,
    instruction_count: contextState.metrics.instructionCount,
    skill_count: contextState.metrics.skillCount
  })

  return contextState
}
