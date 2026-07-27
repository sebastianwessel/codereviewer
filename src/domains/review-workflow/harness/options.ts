import {
  type BuiltinToolName,
  type Logger,
  type ModelAlias,
  type SkillsConfig
} from '@purista/harness'
import {
  type CrossFileRetrievalConfig,
  type DiscoveryPosture
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
  readonly runTimeoutMs?: number
  readonly failBeforeAdmission?: 'provider-timeout' | 'cancelled'
  readonly onTaskEvent?: (event: WorkflowTaskEvent) => void
  // Spec 16. When enabled, holistic discovery is given the mediated repository
  // tools, bounded per task. Omitted/disabled leaves discovery single-shot with no
  // tools (byte-for-byte unchanged).
  readonly crossFileRetrieval?: CrossFileRetrievalConfig
  // Spec 20. Selects how much self-evidence the discovery reviewer demands of
  // itself before raising a candidate. Omitted means `precise`, the current
  // behaviour, whose prompt is byte-for-byte unchanged.
  readonly discoveryPosture?: DiscoveryPosture
}
