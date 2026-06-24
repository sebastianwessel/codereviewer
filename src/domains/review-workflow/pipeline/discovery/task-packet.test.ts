import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../../../shared/contracts/index.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from '../contracts.js'
import { taskReviewInputFor } from './task-packet.js'
import { type WorkflowReviewTask } from '../agent-contracts.js'

const configHash =
  '2222222222222222222222222222222222222222222222222222222222222222'

const evidence: EvidenceRecord = {
  id: 'ev_diff1',
  kind: 'diff',
  summary: 'Changed line evidence.',
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const task: WorkflowReviewTask = {
  id: 'task_app1',
  round: 1,
  kind: 'file',
  paths: ['src/app.ts'],
  factIds: [],
  evidenceIds: ['ev_diff1'],
  candidateIds: [],
  contextEntryIds: ['ctx_aaaaaaaa'],
  reviewContext: [
    {
      kind: 'file',
      path: 'src/app.ts',
      content: 'export const value = 1',
      ledgerEntryId: 'ctx_aaaaaaaa'
    }
  ],
  priority: 0
}

const workflowInput = (): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-task-packet',
    reviewedPaths: ['src/app.ts'],
    reviewedDiffRanges: [
      {
        path: 'src/app.ts',
        startLine: 4,
        endLine: 4,
        changeKind: 'modified'
      }
    ],
    evidence: [evidence],
    candidates: [],
    instructions: [],
    skills: [],
    tasks: [task],
    maxTaskInputBytes: 10000,
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

describe('model task packet', () => {
  test('omits optional shared digest before failing the task packet budget', () => {
    const packet = taskReviewInputFor(
      workflowInput(),
      task,
      'large admitted digest '.repeat(700)
    )

    expect(packet.input.evidence.map((record) => record.id)).toEqual([
      'ev_diff1'
    ])
    expect(packet.input.task.reviewContext).toEqual(task.reviewContext)
    expect(packet.input.sharedDigest).toBe(
      '(shared digest omitted for task packet budget)'
    )
  })
})
