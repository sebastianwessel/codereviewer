import { describe, expect, test } from 'vitest'
import { type CandidateFinding } from '../admission/index.js'
import { type EvidenceRecord } from '../../shared/contracts/index.js'
import { type FindingRefutationResult } from './model-agent-contracts.js'
import {
  admissibleRefutationOutcome,
  refutedCandidateOutcome,
  weakSuspicionRejectedOutcome
} from './model-admission-refutation-verdict-outcome.js'

const candidate = (): CandidateFinding => ({
  id: 'cand_model1',
  taskId: 'task_admission',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch can lose data',
  description: 'The model claims the changed branch can lose data.',
  location: {
    path: 'src/admission.ts',
    startLine: 12,
    side: 'new'
  },
  evidenceIds: ['ev_support1'],
  proposedBy: 'review-agent'
})

const refutationEvidence: EvidenceRecord = {
  id: 'ev_refutation1',
  kind: 'refutation',
  summary: 'The proof was checked.',
  source: 'review-agent',
  redactionApplied: true
}

const refutation = (
  verdict: FindingRefutationResult['verdict']
): FindingRefutationResult => ({
  verdict,
  rationaleSummary: 'The checked proof outcome.'
})

describe('model admission refutation verdict outcome', () => {
  test('creates refuted candidate outcomes', () => {
    expect(
      refutedCandidateOutcome({
        candidate: candidate(),
        refutation: refutation('refuted'),
        refutationEvidence
      })
    ).toEqual({
      admissionCandidates: [],
      evidence: [refutationEvidence],
      rejectedFindings: [
        {
          candidateId: 'cand_model1',
          status: 'rejected',
          reason: 'refuted',
          message: 'The checked proof outcome.',
          evidenceIds: ['ev_refutation1']
        }
      ],
      admissionDecisions: [
        {
          candidateId: 'cand_model1',
          status: 'rejected',
          rejectedReason: 'refuted'
        }
      ],
      artifactOnlyCandidateIds: [],
      refutationResults: [],
      providerIssues: []
    })
  })

  test('creates rejected weak-suspicion outcomes', () => {
    expect(
      weakSuspicionRejectedOutcome({
        candidate: candidate(),
        refutation: refutation('needs-more-evidence'),
        refutationEvidence
      })
    ).toEqual({
      admissionCandidates: [],
      evidence: [refutationEvidence],
      rejectedFindings: [
        {
          candidateId: 'cand_model1',
          status: 'needs-more-evidence',
          reason: 'weak-suspicion',
          message: 'The checked proof outcome.',
          evidenceIds: ['ev_refutation1']
        }
      ],
      admissionDecisions: [
        {
          candidateId: 'cand_model1',
          status: 'needs-more-evidence',
          rejectedReason: 'weak-suspicion'
        }
      ],
      artifactOnlyCandidateIds: [],
      refutationResults: [],
      providerIssues: []
    })
  })

  test('creates admissible proved and artifact-only weak outcomes', () => {
    expect(
      admissibleRefutationOutcome({
        candidate: candidate(),
        refutation: refutation('proved'),
        refutationEvidence
      }).artifactOnlyCandidateIds
    ).toEqual([])

    expect(
      admissibleRefutationOutcome({
        candidate: candidate(),
        refutation: refutation('needs-more-evidence'),
        refutationEvidence
      })
    ).toMatchObject({
      evidence: [refutationEvidence],
      artifactOnlyCandidateIds: ['cand_model1']
    })
  })
})
