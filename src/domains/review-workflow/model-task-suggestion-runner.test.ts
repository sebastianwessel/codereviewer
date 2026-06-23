import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../shared/contracts/index.js'
import {
  TaskReviewInputSchema,
  type ModelTaskSuggestions,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { modelTaskSuggestionRunner } from './model-task-suggestion-runner.js'

const configHash =
  '3333333333333333333333333333333333333333333333333333333333333333'

const evidence: EvidenceRecord = {
  id: 'ev_task1',
  kind: 'diff',
  summary: 'The changed branch can lose data.',
  location: {
    path: 'src/task.ts',
    startLine: 9,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const task: WorkflowReviewTask = {
  id: 'task_suggestion',
  kind: 'file',
  round: 1,
  paths: ['src/task.ts'],
  factIds: [],
  evidenceIds: ['ev_task1'],
  candidateIds: [],
  contextEntryIds: [],
  priority: 1,
  reviewContext: [
    {
      kind: 'file',
      path: 'src/task.ts',
      content: 'export const changed = true\n',
      ledgerEntryId: 'ctx_abcdef12'
    }
  ]
}

const taskInput = TaskReviewInputSchema.parse({
  runId: 'run-suggestion-runner',
  task,
  reviewIntents: [],
  reviewedDiffRanges: [
    {
      path: 'src/task.ts',
      startLine: 1,
      endLine: 20
    }
  ],
  evidence: [evidence],
  candidates: [],
  instructions: [],
  skills: [],
  sharedDigest: '(no admitted shared context yet)',
  provenance: {
    reviewer: 'review-agent',
    signalVersions: {},
    configHash
  }
})

const suggestions: ModelTaskSuggestions = {
  suspicions: [
    {
      category: 'bug',
      severity: 'high',
      title: 'Changed branch loses data',
      description: 'The changed branch can lose data.',
      path: 'src/task.ts',
      startLine: 9,
      evidenceIds: ['ev_task1']
    }
  ]
}

describe('model task suggestion runner', () => {
  test('logs provider call start while forwarding signal and suggestions', async () => {
    const logs: Array<{
      readonly message: string
      readonly metadata?: Readonly<Record<string, unknown>>
    }> = []
    const controller = new AbortController()
    const runner = modelTaskSuggestionRunner({
      logger: {
        debug: (message, metadata) =>
          logs.push(metadata === undefined ? { message } : { message, metadata })
      },
      reviewTask: async (input, signal) => {
        expect(input).toBe(taskInput)
        expect(signal).toBe(controller.signal)

        return suggestions
      }
    })

    await expect(runner(taskInput, controller.signal)).resolves.toBe(suggestions)
    expect(logs).toEqual([
      {
        message: 'Review task provider call started.',
        metadata: {
          task_id: 'task_suggestion',
          task_round: 1,
          path_count: 1,
          task_context_count: 1,
          evidence_count: 1,
          candidate_count: 0
        }
      }
    ])
  })
})
