import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  type FindingRefutationResult,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { executeAdmissionRefutation } from './model-admission-refutation-execution.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from './workflow-contracts.js'

const configHash =
  '4444444444444444444444444444444444444444444444444444444444444444'

const evidence: EvidenceRecord = {
  id: 'ev_refutationexecution',
  kind: 'diagnostic',
  summary: 'Changed branch was reviewed.',
  location: {
    path: 'src/admission.ts',
    startLine: 12,
    side: 'new'
  },
  source: 'review-agent',
  redactionApplied: true
}

const candidate: CandidateFinding = {
  id: 'cand_refutationexecution',
  taskId: 'task_refutationexecution',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch can lose data',
  description: 'The model claims the changed branch can lose data.',
  location: {
    path: 'src/admission.ts',
    startLine: 12,
    side: 'new'
  },
  evidenceIds: ['ev_refutationexecution'],
  proposedBy: 'review-agent'
}

const task: WorkflowReviewTask = {
  id: 'task_refutationexecution',
  kind: 'file',
  round: 1,
  paths: ['src/admission.ts'],
  factIds: [],
  evidenceIds: ['ev_refutationexecution'],
  candidateIds: ['cand_refutationexecution'],
  contextEntryIds: ['ctx_aaaaaaaaaaaaaaaa'],
  reviewContext: [
    {
      kind: 'file',
      path: 'src/admission.ts',
      content: 'export const changed = true\n',
      ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaa'
    }
  ],
  priority: 1
}

const workflowInput = (): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-refutation-execution',
    reviewedPaths: ['src/admission.ts'],
    reviewedDiffRanges: [
      { path: 'src/admission.ts', startLine: 1, endLine: 30 }
    ],
    evidence: [evidence],
    candidates: [candidate],
    instructions: [],
    skills: [],
    promotionPolicy: {
      modelWeakOrRefuted: 'rejected'
    },
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

const provedRefutation = (): FindingRefutationResult => ({
  verdict: 'proved',
  rationaleSummary: 'The active refuter proved the claim.'
})

describe('model admission refutation execution', () => {
  test('calls the active refuter with the candidate evidence', async () => {
    let refutationCalls = 0
    const result = await executeAdmissionRefutation({
      workflowInput: workflowInput(),
      tasks: [task],
      candidate,
      allCandidates: [candidate],
      sharedDigest: '(no admitted shared context yet)',
      reviewEvidence: [evidence],
      refuteFinding: async (input) => {
        refutationCalls += 1
        expect(input.evidence.map((entry) => entry.id)).toEqual([
          'ev_refutationexecution'
        ])
        return provedRefutation()
      }
    })

    expect(refutationCalls).toBe(1)
    expect(result.status).toBe('completed')
    expect(result.status === 'completed' ? result.refutation : undefined).toEqual(
      {
        verdict: 'proved',
        rationaleSummary: 'The active refuter proved the claim.'
      }
    )
  })

  test('returns a provider-error outcome when active refutation fails', async () => {
    const result = await executeAdmissionRefutation({
      workflowInput: workflowInput(),
      tasks: [task],
      candidate,
      allCandidates: [candidate],
      sharedDigest: '(no admitted shared context yet)',
      reviewEvidence: [evidence],
      refuteFinding: async () => {
        throw new Error('provider timed out while refuting')
      }
    })

    expect(result.status).toBe('provider-error')
    if (result.status !== 'provider-error') {
      return
    }
    expect(result.outcome.providerIssues).toEqual([
      expect.objectContaining({
        stage: 'refutation-check',
        recovered: true
      })
    ])
    expect(result.outcome.rejectedFindings).toEqual([
      expect.objectContaining({
        candidateId: 'cand_refutationexecution',
        reason: 'provider-error'
      })
    ])
  })
})
