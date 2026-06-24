import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../admission/index.js'
import { createNoopReviewLogger } from '../../observability/index.js'
import { TaskReviewResultSchema } from './agent-contracts.js'
import { runReviewWorkflowHandler } from './handler.js'
import { ReviewWorkflowInputSchema } from './contracts.js'

const configHash =
  '6666666666666666666666666666666666666666666666666666666666666666'

const evidence: EvidenceRecord = {
  id: 'ev_handler1',
  kind: 'diff',
  summary: 'Changed branch returns stale state.',
  location: {
    path: 'src/handler.ts',
    startLine: 12,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const candidate: CandidateFinding = {
  id: 'cand_handler1',
  taskId: 'task_handler1',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch returns stale state',
  description: 'The changed branch can return stale state to the caller.',
  location: {
    path: 'src/handler.ts',
    startLine: 12,
    side: 'new'
  },
  evidenceIds: ['ev_handler1'],
  proposedBy: 'review-agent'
}

const workflowInput = ReviewWorkflowInputSchema.parse({
  runId: 'run-handler',
  reviewedPaths: ['src/handler.ts'],
  reviewedDiffRanges: [
    { path: 'src/handler.ts', startLine: 1, endLine: 20 }
  ],
  evidence: [evidence],
  candidates: [],
  instructions: [],
  skills: [],
  baselineConfigured: false,
  provenance: {
    reviewer: 'review-agent',
    signalVersions: {},
    configHash
  },
  qualityGate: {
    maxHigh: 1
  }
})

describe('workflow handler', () => {
  test('runs task results through shared completion without harness builder wiring', async () => {
    let observedTaskPaths: readonly string[] = []
    let observedSharedDigest = ''

    const output = await runReviewWorkflowHandler({
      input: workflowInput,
      signal: undefined,
      logger: createNoopReviewLogger(),
      maxConcurrentTasks: 1,
      runTask: async (taskInput, task) => {
        observedTaskPaths = task.paths
        observedSharedDigest = taskInput.sharedDigest

        return TaskReviewResultSchema.parse({
          candidates: [candidate]
        })
      }
    })

    expect(observedTaskPaths).toEqual(['src/handler.ts'])
    expect(observedSharedDigest).toContain('(no admitted shared context yet)')
    expect(output.candidateFindings).toEqual([candidate])
    expect(output.admittedFindings).toHaveLength(1)
    expect(output.admittedFindings[0]).toMatchObject({
      title: 'Changed branch returns stale state',
      baselineStatus: 'new'
    })
    expect(output.qualityGate.passed).toBe(true)
    expect(output.taskEvents.map((event) => event.state)).toEqual([
      'planned',
      'running',
      'completed'
    ])
  })

  test('runs discovered candidates through refutation before admission', async () => {
    const proofEvidence: EvidenceRecord = {
      id: 'ev_taskproofhandler',
      kind: 'model-rationale',
      summary: 'Investigation proved the changed branch is reachable.',
      location: {
        path: 'src/handler.ts',
        startLine: 12,
        side: 'new'
      },
      source: 'model-investigation',
      redactionApplied: true
    }

    const output = await runReviewWorkflowHandler({
      input: workflowInput,
      signal: undefined,
      logger: createNoopReviewLogger(),
      maxConcurrentTasks: 1,
      runTask: async () =>
        TaskReviewResultSchema.parse({
          candidates: [
            {
              ...candidate,
              evidenceIds: ['ev_handler1', proofEvidence.id]
            }
          ],
          evidenceRecords: [proofEvidence]
        }),
      refuteFinding: async () => ({
        verdict: 'proved',
        rationaleSummary: 'The active admission critic proved the claim.',
        fixSummary: 'Return the freshly computed state.'
      })
    })

    expect(output.candidateFindings).toHaveLength(1)
    expect(output.admittedFindings).toHaveLength(1)
    expect(output.admittedFindings[0]).toMatchObject({
      title: 'Changed branch returns stale state'
    })
  })
})
