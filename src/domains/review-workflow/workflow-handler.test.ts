import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { createNoopReviewLogger } from '../observability/index.js'
import { TaskReviewResultSchema } from './model-agent-contracts.js'
import { runReviewWorkflowHandler } from './workflow-handler.js'
import { ReviewWorkflowInputSchema } from './workflow-contracts.js'

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
    let observedIntentCount = 0
    let observedSharedDigest = ''

    const output = await runReviewWorkflowHandler({
      input: workflowInput,
      signal: undefined,
      logger: createNoopReviewLogger(),
      maxConcurrentTasks: 1,
      runTask: async (taskInput, task) => {
        observedTaskPaths = task.paths
        observedIntentCount = taskInput.reviewIntents.length
        observedSharedDigest = taskInput.sharedDigest

        return TaskReviewResultSchema.parse({
          candidates: [candidate]
        })
      }
    })

    expect(observedTaskPaths).toEqual(['src/handler.ts'])
    expect(observedIntentCount).toBe(1)
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
    expect(output.reviewIntents).toHaveLength(1)
  })

  test('passes task proof evidence into optional judge packets', async () => {
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
    const judgedEvidenceIds: string[][] = []

    const output = await runReviewWorkflowHandler({
      input: ReviewWorkflowInputSchema.parse({
        ...workflowInput,
        judgeFindings: true
      }),
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
          evidenceRecords: [proofEvidence],
          proofPackets: [
            {
              id: 'proof_handler1',
              suspicionId: 'susp_handler1',
              candidateId: 'cand_handler1',
              changedBehavior: 'The changed branch returns stale state.',
              executionOrDataPath:
                'The changed API branch reaches the stale return path.',
              violatedInvariant: 'The handler must return fresh state.',
              impact: 'Callers can observe stale state after the change.',
              introducedByChange:
                'The reviewed diff changed the branch return behavior.',
              evidenceIds: [proofEvidence.id],
              contradictionChecks: ['No contradiction was found.'],
              fixDirection: 'Return the freshly computed state.'
            }
          ],
          refutationResults: [
            {
              id: 'refute_handler1',
              proofPacketId: 'proof_handler1',
              verdict: 'proved',
              summary: 'The proof packet survived refutation.',
              evidenceIds: [proofEvidence.id],
              checks: [
                {
                  kind: 'proof-review',
                  result: 'passed',
                  summary: 'The proof evidence supports the changed path.',
                  evidenceIds: [proofEvidence.id]
                }
              ]
            }
          ]
        }),
      refuteFinding: async () => ({
        verdict: 'proved',
        rationaleSummary: 'The active admission critic proved the claim.',
        fixSummary: 'Return the freshly computed state.'
      }),
      judgeFinding: async (judgeInput) => {
        judgedEvidenceIds.push(judgeInput.evidence.map((record) => record.id))

        return {
          verdict: 'valid',
          summary: 'The proof remains valid after critic review.',
          challengeQuestions: ['Does the task proof evidence support the claim?'],
          verificationChecks: [
            {
              kind: 'proof-review',
              result: 'passed',
              summary: 'The critic cited the task proof evidence.',
              evidenceIds: [proofEvidence.id]
            }
          ],
          evidenceIds: [proofEvidence.id],
          contextRequests: [],
          requestedContext: []
        }
      }
    })

    expect(judgedEvidenceIds).toEqual([
      expect.arrayContaining([proofEvidence.id])
    ])
    expect(output.judgeResults).toEqual([
      expect.objectContaining({
        verdict: 'valid',
        evidenceIds: [proofEvidence.id]
      })
    ])
    expect(output.admittedFindings).toHaveLength(1)
  })
})
