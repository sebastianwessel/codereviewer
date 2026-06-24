import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../../admission/index.js'
import { type WorkflowReviewTask } from '../agent-contracts.js'
import { reviewCandidateForAdmission } from './candidate-review.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from '../contracts.js'

const configHash =
  '8989898989898989898989898989898989898989898989898989898989898989'

const supportEvidence: EvidenceRecord = {
  id: 'ev_admissioncandidate',
  kind: 'diagnostic',
  summary: 'Support signal reported a changed branch concern.',
  location: {
    path: 'src/admission-candidate.ts',
    startLine: 12,
    side: 'new'
  },
  source: 'typescript-support-signal',
  redactionApplied: true
}

const supportSignalCandidate: CandidateFinding = {
  id: 'cand_supportcandidate',
  taskId: 'task_admissioncandidate',
  category: 'bug',
  severity: 'high',
  title: 'Support signal seed',
  description: 'The support signal marks this location for model review.',
  location: {
    path: 'src/admission-candidate.ts',
    startLine: 12,
    side: 'new'
  },
  evidenceIds: ['ev_admissioncandidate'],
  proposedBy: 'typescript-support-signal'
}

const modelCandidate: CandidateFinding = {
  ...supportSignalCandidate,
  id: 'cand_modelcandidate',
  title: 'Changed branch can lose data',
  description: 'The model claims the changed branch can lose data.',
  proposedBy: 'review-agent'
}

const task: WorkflowReviewTask = {
  id: 'task_admissioncandidate',
  kind: 'file',
  round: 1,
  paths: ['src/admission-candidate.ts'],
  factIds: [],
  evidenceIds: ['ev_admissioncandidate'],
  candidateIds: ['cand_supportcandidate', 'cand_modelcandidate'],
  contextEntryIds: ['ctx_adadadad'],
  reviewContext: [
    {
      kind: 'file',
      path: 'src/admission-candidate.ts',
      content: 'export const changed = true\n',
      ledgerEntryId: 'ctx_adadadad'
    }
  ],
  priority: 1
}

const workflowInput = (): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-admission-candidate',
    reviewedPaths: ['src/admission-candidate.ts'],
    reviewedDiffRanges: [
      { path: 'src/admission-candidate.ts', startLine: 1, endLine: 30 }
    ],
    evidence: [supportEvidence],
    candidates: [supportSignalCandidate, modelCandidate],
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

describe('model admission candidate review', () => {
  test('passes support-signal candidates through without refutation work', async () => {
    let refutationCalls = 0
    const outcome = await reviewCandidateForAdmission({
      workflowInput: workflowInput(),
      tasks: [task],
      candidate: supportSignalCandidate,
      allCandidates: [supportSignalCandidate, modelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      reviewEvidence: [supportEvidence],
      refuteFinding: async () => {
        refutationCalls += 1
        throw new Error('support-signal candidate should not be refuted')
      }
    })

    expect(refutationCalls).toBe(0)
    expect(outcome.admissionCandidates).toEqual([supportSignalCandidate])
    expect(outcome.artifactOnlyCandidateIds).toEqual(['cand_supportcandidate'])
  })

  test('admits a proved model candidate with the refuter fix summary', async () => {
    const outcome = await reviewCandidateForAdmission({
      workflowInput: workflowInput(),
      tasks: [task],
      candidate: modelCandidate,
      allCandidates: [supportSignalCandidate, modelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      reviewEvidence: [supportEvidence],
      refuteFinding: async () => ({
        verdict: 'proved',
        rationaleSummary: 'The active admission critic proved the claim.',
        fixSummary: 'Preserve the existing state in the changed branch.'
      })
    })

    expect(outcome.admissionCandidates).toEqual([
      expect.objectContaining({
        id: 'cand_modelcandidate',
        fixProposal: expect.objectContaining({
          summary: 'Preserve the existing state in the changed branch.'
        })
      })
    ])
    expect(outcome.refutationResults).toEqual([
      expect.objectContaining({
        candidateId: 'cand_modelcandidate',
        verdict: 'proved'
      })
    ])
  })

  test('rejects a needs-more-evidence model candidate when policy rejects', async () => {
    const outcome = await reviewCandidateForAdmission({
      workflowInput: workflowInput(),
      tasks: [task],
      candidate: modelCandidate,
      allCandidates: [supportSignalCandidate, modelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      reviewEvidence: [supportEvidence],
      refuteFinding: async () => ({
        verdict: 'needs-more-evidence',
        rationaleSummary: 'The refuter could not prove the claim.'
      })
    })

    expect(outcome.admissionCandidates).toEqual([])
    expect(outcome.rejectedFindings).toHaveLength(1)
    expect(outcome.rejectedFindings[0]!.reason).toBe('weak-evidence')
    expect(outcome.refutationResults).toEqual([
      expect.objectContaining({
        candidateId: 'cand_modelcandidate',
        verdict: 'needs-more-evidence'
      })
    ])
  })
})
