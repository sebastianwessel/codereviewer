import { describe, expect, test } from 'vitest'
import { type CandidateFinding } from '../admission/index.js'
import {
  type EvidenceRecord,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type FindingRefutationResult } from './model-agent-contracts.js'
import { activeRefutationResultForCandidate } from './model-admission-refutation-result.js'
import {
  admissibleRefutationOutcome,
  refutedCandidateOutcome,
  weakEvidenceRejectedOutcome
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

const refutationResultFor = (
  verdict: FindingRefutationResult['verdict']
): RefutationResult =>
  activeRefutationResultForCandidate({
    candidate: candidate(),
    refutation: refutation(verdict),
    refutationEvidence
  })

describe('model admission refutation verdict outcome', () => {
  test('creates refuted candidate outcomes', () => {
    const refutationResult = refutationResultFor('refuted')

    expect(
      refutedCandidateOutcome({
        candidate: candidate(),
        refutation: refutation('refuted'),
        refutationEvidence,
        refutationResult
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
      refutationResults: [refutationResult],
      providerIssues: []
    })
  })

  test('creates rejected weak-evidence outcomes', () => {
    const refutationResult = refutationResultFor('needs-more-evidence')

    expect(
      weakEvidenceRejectedOutcome({
        candidate: candidate(),
        refutation: refutation('needs-more-evidence'),
        refutationEvidence,
        refutationResult
      })
    ).toEqual({
      admissionCandidates: [],
      evidence: [refutationEvidence],
      rejectedFindings: [
        {
          candidateId: 'cand_model1',
          status: 'needs-more-evidence',
          reason: 'weak-evidence',
          message: 'The checked proof outcome.',
          evidenceIds: ['ev_refutation1']
        }
      ],
      admissionDecisions: [
        {
          candidateId: 'cand_model1',
          status: 'needs-more-evidence',
          rejectedReason: 'weak-evidence'
        }
      ],
      artifactOnlyCandidateIds: [],
      refutationResults: [refutationResult],
      providerIssues: []
    })
  })

  test('creates admissible proved and artifact-only weak outcomes', () => {
    expect(
      admissibleRefutationOutcome({
        candidate: candidate(),
        refutation: refutation('proved'),
        refutationEvidence,
        refutationResult: refutationResultFor('proved')
      }).artifactOnlyCandidateIds
    ).toEqual([])

    expect(
      admissibleRefutationOutcome({
        candidate: candidate(),
        refutation: refutation('needs-more-evidence'),
        refutationEvidence,
        refutationResult: refutationResultFor('needs-more-evidence')
      })
    ).toMatchObject({
      evidence: [refutationEvidence],
      artifactOnlyCandidateIds: ['cand_model1']
    })
  })
})
