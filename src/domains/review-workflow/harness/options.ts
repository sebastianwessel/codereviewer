import {
  type BuiltinToolName,
  type Logger,
  type ModelAlias,
  type SkillsConfig
} from '@purista/harness'
import {
  type CrossFileRetrievalConfig,
  type RefutationRetrievalConfig
} from '../../../shared/contracts/index.js'
import { type WorkflowTaskEvent } from '../pipeline/agent-contracts.js'

export type CreateReviewHarnessOptions = {
  readonly modelAlias: ModelAlias
  readonly skills?: SkillsConfig
  readonly skillIds?: readonly string[]
  readonly skillTools?: readonly BuiltinToolName[]
  readonly logger?: Logger
  readonly maxConcurrentTasks?: number
  readonly maxChildAgentCalls?: number
  readonly failBeforeAdmission?: 'provider-timeout' | 'cancelled'
  readonly onTaskEvent?: (event: WorkflowTaskEvent) => void
  // Spec 16. When enabled, holistic discovery is given the mediated repository
  // tools, bounded per task. Omitted/disabled leaves discovery single-shot with no
  // tools (byte-for-byte unchanged).
  readonly crossFileRetrieval?: CrossFileRetrievalConfig
  // Spec 05. When enabled, the batched refutation agent is given the same mediated
  // repository tools, bounded per adjudication call by its own budget.
  // Omitted/disabled leaves refutation single-shot with no tools (byte-for-byte
  // unchanged prompt and packet).
  readonly refutationRetrieval?: RefutationRetrievalConfig
}
