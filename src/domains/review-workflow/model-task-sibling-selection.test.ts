import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  TaskReviewInputSchema,
  type ModelTaskSuggestions,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { selectModelTaskSiblingCandidates } from './model-task-sibling-selection.js'

const configHash =
  '6767676767676767676767676767676767676767676767676767676767676767'

const taskEvidence = (index: number): EvidenceRecord => ({
  id: `ev_task${index}`,
  kind: 'diff',
  summary: `Changed branch ${index} can lose data.`,
  location: {
    path: `src/task${index}.ts`,
    startLine: 9,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
})

const task: WorkflowReviewTask = {
  id: 'task_siblingselection',
  kind: 'file',
  round: 1,
  paths: ['src/task1.ts', 'src/task2.ts'],
  factIds: [],
  evidenceIds: ['ev_task1', 'ev_task2'],
  candidateIds: [],
  contextEntryIds: [],
  priority: 1,
  reviewContext: [
    {
      kind: 'file',
      path: 'src/task1.ts',
      content: 'export const first = true\n',
      ledgerEntryId: 'ctx_abababab'
    },
    {
      kind: 'file',
      path: 'src/task2.ts',
      content: 'export const second = true\n',
      ledgerEntryId: 'ctx_cdcdcdcd'
    }
  ]
}

const taskInput = TaskReviewInputSchema.parse({
  runId: 'run-sibling-selection',
  task,
  reviewIntents: [],
  reviewedDiffRanges: [
    { path: 'src/task1.ts', startLine: 1, endLine: 20 },
    { path: 'src/task2.ts', startLine: 1, endLine: 20 }
  ],
  evidence: [taskEvidence(1), taskEvidence(2)],
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

const primaryCandidate: CandidateFinding = {
  id: 'cand_task1',
  taskId: task.id,
  category: 'bug',
  severity: 'high',
  title: 'Primary branch loses data',
  description: 'The primary branch can lose data.',
  location: {
    path: 'src/task1.ts',
    startLine: 9,
    side: 'file'
  },
  evidenceIds: ['ev_task1'],
  proposedBy: 'review-agent'
}

const suggestions: ModelTaskSuggestions = {
  suspicions: [
    {
      category: 'bug',
      severity: 'high',
      title: 'Primary duplicate loses data',
      description: 'The already proved primary branch can lose data.',
      path: 'src/task1.ts',
      startLine: 9,
      evidenceIds: ['ev_task1']
    },
    {
      category: 'bug',
      severity: 'high',
      title: 'Sibling branch loses data',
      description: 'The sibling branch can lose data.',
      path: 'src/task2.ts',
      startLine: 9,
      evidenceIds: ['ev_task2'],
      requestedContext: ['Inspect the sibling helper.']
    },
    {
      category: 'bug',
      severity: 'high',
      title: 'Sibling branch also loses data',
      description: 'The sibling branch can also lose data.',
      path: 'src/task2.ts',
      startLine: 9,
      evidenceIds: ['ev_task2']
    }
  ]
}

describe('model task sibling selection', () => {
  test('deduplicates primary and repeated sibling locations before reserving slots', () => {
    const reservationRequests: number[] = []

    const result = selectModelTaskSiblingCandidates({
      taskInput,
      suggestions,
      primaryCandidates: [primaryCandidate],
      maxSuspicionsPerTask: 3,
      reserveModelInvestigationSlots: (requested) => {
        reservationRequests.push(requested)

        return requested
      }
    })

    expect(reservationRequests).toEqual([1])
    expect(result.candidates.map((candidate) => candidate.location.path)).toEqual([
      'src/task2.ts'
    ])
    expect(Object.keys(result.contextRequestsByCandidateId)).toEqual([
      result.candidates[0]?.id
    ])
    expect(result.requestedContextByCandidateId[result.candidates[0]?.id ?? '']).toEqual([
      'Inspect the sibling helper.'
    ])
    expect(result.droppedSuspicionReasons).toEqual(
      expect.objectContaining({
        'path-outside-task': 0
      })
    )
  })
})
