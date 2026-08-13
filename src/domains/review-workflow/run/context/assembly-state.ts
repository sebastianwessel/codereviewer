import type { Logger } from '@purista/harness'
import type { CodeReviewerConfig } from '../../../../shared/contracts/index.js'
import type { DeterministicSignalExtraction, SupportSignalSourceFile } from '../../../deterministic-signals/index.js'
import type { NoContentEventRecorder } from '../../../observability/index.js'
import type { ReviewTask } from '../../../review-planning/index.js'
import {
  prepareReviewRunnerContextState,
  type ReviewRunnerContextState
} from './context.js'

type PrepareContextState = typeof prepareReviewRunnerContextState

export const prepareReviewRunnerContextAssemblyState = async (input: {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly sourceFiles: readonly SupportSignalSourceFile[]
  readonly analysis: DeterministicSignalExtraction
  readonly tasks: readonly ReviewTask[]
  readonly reviewedDiffText: string
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
    tasks: input.tasks,
    reviewedDiffText: input.reviewedDiffText
  })
  contextAssemblyStep.end({
    ledgerEntryCount: contextState.metrics.ledgerEntryCount,
    referencedDefinitionsDroppedCount:
      contextState.metrics.referencedDefinitionsDroppedCount,
    referencedDefinitionsUnreadableCount:
      contextState.metrics.referencedDefinitionsUnreadableCount,
    redactedContextSpanCount: contextState.metrics.redactedContextSpanCount
  })
  input.logger.debug('Context assembly completed.', {
    ledger_entry_count: contextState.metrics.ledgerEntryCount,
    workflow_task_count: contextState.metrics.workflowTaskCount,
    instruction_count: contextState.metrics.instructionCount,
    skill_count: contextState.metrics.skillCount,
    referenced_definitions_dropped_count:
      contextState.metrics.referencedDefinitionsDroppedCount,
    referenced_definitions_unreadable_count:
      contextState.metrics.referencedDefinitionsUnreadableCount,
    // The run REPORTS this one (`redactedReviewMaterialWarnings`), which is why
    // there is no `logger.warn` for it below: the warning there would carry only
    // the context half of a number the report states whole, diff included.
    redacted_context_span_count:
      contextState.metrics.redactedContextSpanCount
  })

  // Warned rather than left to a debug line, because it changes what the
  // reviewer was shown: dependency digests the caps kept out are callee
  // contracts the model then reasons about without. Only when it actually
  // happened — a warning that fires on every run is one nobody reads.
  if (contextState.metrics.referencedDefinitionsDroppedCount > 0) {
    input.logger.warn(
      'Referenced-definition context was capped; some imported dependencies were not shown to the reviewer.',
      {
        referenced_definitions_dropped_count:
          contextState.metrics.referencedDefinitionsDroppedCount
      }
    )
  }

  // A dependency that resolved and then failed to read gets its own line rather
  // than joining the count above. Both end with context the reviewer never saw,
  // but only one of them is this engine's caps binding; saying "capped" about a
  // file that vanished or could not be opened points the reader at the wrong
  // knob, and the caps are what the message above exists to report.
  if (contextState.metrics.referencedDefinitionsUnreadableCount > 0) {
    input.logger.warn(
      'Referenced-definition dependencies resolved but could not be read; they were not shown to the reviewer.',
      {
        referenced_definitions_unreadable_count:
          contextState.metrics.referencedDefinitionsUnreadableCount
      }
    )
  }

  return contextState
}
