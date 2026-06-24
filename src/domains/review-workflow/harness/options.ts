import {
  type BuiltinToolName,
  type Logger,
  type ModelAlias,
  type SkillsConfig
} from '@purista/harness'
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
}
