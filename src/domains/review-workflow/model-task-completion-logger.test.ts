import { describe, expect, test } from 'vitest'
import {
  type ModelSuspicionDropReason,
  type ModelTaskSuggestions,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { logModelTaskReviewCompletion } from './model-task-completion-logger.js'

const task: WorkflowReviewTask = {
  id: 'task_completion',
  kind: 'file',
  round: 3,
  paths: ['src/task.ts'],
  factIds: [],
  evidenceIds: [],
  candidateIds: [],
  contextEntryIds: [],
  priority: 1,
  reviewContext: []
}

const droppedSuspicionReasons: Readonly<Record<ModelSuspicionDropReason, number>> = {
  'schema-invalid': 1,
  'missing-required-field': 2,
  'path-outside-task': 3,
  'missing-task-evidence': 4,
  'duplicate-input-candidate': 5,
  'unsupported-truncation-claim': 6
}

const suggestions: ModelTaskSuggestions = {
  suspicions: [
    {
      category: 'bug',
      severity: 'high',
      title: 'Primary issue',
      description: 'Primary issue description.',
      path: 'src/task.ts',
      startLine: 7
    },
    {
      category: 'security',
      severity: 'medium',
      title: 'Sibling issue',
      description: 'Sibling issue description.',
      path: 'src/task.ts',
      startLine: 12
    }
  ]
}

const selectedCandidates = {
  candidates: [{ id: 'cand_primary1' }, { id: 'cand_primary2' }],
  contextRequestsByCandidateId: {},
  requestedContextByCandidateId: {},
  droppedSuspicionReasons
}

const primaryArtifacts = {
  evidenceRecords: [],
  modelSuspicions: [{ id: 'susp_primary1' }, { id: 'susp_primary2' }],
  investigationTraces: [],
  proofPackets: [{ id: 'proof_primary1' }],
  refutationResults: [],
  promotionDecisions: [],
  providerIssues: []
}

const siblingArtifacts = {
  candidates: [{ id: 'cand_sibling1' }],
  evidenceRecords: [],
  modelSuspicions: [{ id: 'susp_sibling1' }],
  investigationTraces: [],
  proofPackets: [{ id: 'proof_sibling1' }, { id: 'proof_sibling2' }],
  refutationResults: [],
  promotionDecisions: [],
  providerIssues: []
}

describe('model task completion logger', () => {
  test('logs review task completion summary with primary and sibling artifact counts', () => {
    const logs: Array<{
      readonly message: string
      readonly metadata?: Readonly<Record<string, unknown>>
    }> = []

    logModelTaskReviewCompletion({
      task,
      suggestions,
      selectedCandidates,
      primaryArtifacts,
      siblingArtifacts,
      logger: {
        debug: (message, metadata) =>
          logs.push(metadata === undefined ? { message } : { message, metadata })
      }
    })

    expect(logs).toEqual([
      {
        message: 'Review task provider call completed.',
        metadata: {
          task_id: 'task_completion',
          task_round: 3,
          suspicion_suggestion_count: 2,
          candidate_count: 3,
          suspicion_count: 3,
          proof_packet_count: 3,
          dropped_suspicion_reasons: droppedSuspicionReasons
        }
      }
    ])
  })
})
