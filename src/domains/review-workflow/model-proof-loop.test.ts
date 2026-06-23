import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type PromotionPolicyConfig
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  TaskReviewInputSchema,
  type FindingInvestigationInput,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { proofLoopArtifactsForTaskResult } from './model-proof-loop.js'
import { providerIssueForError } from './model-provider-issues.js'

const configHash =
  '5555555555555555555555555555555555555555555555555555555555555555'

const taskEvidence: EvidenceRecord = {
  id: 'ev_task1',
  kind: 'diff',
  summary: 'The changed file contains a suspicious branch.',
  location: {
    path: 'src/task.ts',
    startLine: 9,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const task: WorkflowReviewTask = {
  id: 'task_proofloop',
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
      ledgerEntryId: 'ctx_abababab'
    }
  ]
}

const uncitedCandidate: CandidateFinding = {
  id: 'cand_uncited',
  taskId: 'task_proofloop',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch can lose data',
  description: 'The changed branch can lose data.',
  location: {
    path: 'src/task.ts',
    startLine: 9,
    side: 'file'
  },
  evidenceIds: [],
  proposedBy: 'review-agent'
}

const promotionPolicy: PromotionPolicyConfig = {
  modelProof: 'actionable',
  modelWeakOrRefuted: 'artifact-only',
  staticAnalysisDuplicate: 'artifact-only',
  deterministicContradiction: 'rejected'
}

describe('model proof loop', () => {
  test('does not backfill same-path task evidence when a candidate cites no exact evidence', async () => {
    const investigationInputs: FindingInvestigationInput[] = []
    const taskInput = TaskReviewInputSchema.parse({
      runId: 'run-proof-loop',
      task,
      reviewIntents: [],
      reviewedDiffRanges: [
        {
          path: 'src/task.ts',
          startLine: 1,
          endLine: 20
        }
      ],
      evidence: [taskEvidence],
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

    const result = await proofLoopArtifactsForTaskResult(
      taskInput,
      [uncitedCandidate],
      {},
      {},
      undefined,
      promotionPolicy,
      1,
      undefined,
      async (input) => {
        investigationInputs.push(input)

        return {
          verdict: 'proved',
          rationaleSummary: 'The model tried to prove the suspicion.',
          evidenceIds: input.evidence.map((record) => record.id),
          contextRequests: [],
          requestedContext: [],
          changedBehavior: 'The changed branch loses data.',
          executionOrDataPath: 'The changed branch is reachable.',
          violatedInvariant: 'Payload data must be preserved.',
          impact: 'Callers can lose data.',
          introducedByChange: 'The reviewed branch changed persistence.',
          contradictionChecks: ['No contradiction was found.'],
          fixDirection: 'Preserve payload data before returning.'
        }
      },
      providerIssueForError,
      undefined,
      undefined
    )

    expect(investigationInputs).toHaveLength(1)
    expect(investigationInputs[0]?.evidence).toEqual([])
    expect(result.modelSuspicions).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^susp_/u),
        status: 'needs-more-evidence',
        evidenceIds: []
      })
    ])
    expect(result.proofPackets).toEqual([])
    expect(result.refutationResults).toEqual([])
    expect(result.promotionDecisions).toEqual([
      expect.objectContaining({
        candidateId: 'cand_uncited',
        status: 'artifact-only'
      })
    ])
  })
})
