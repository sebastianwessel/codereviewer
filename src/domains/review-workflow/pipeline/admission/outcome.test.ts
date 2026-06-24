import { describe, expect, test } from 'vitest'
import { type CandidateFinding } from '../../../admission/index.js'
import { type AdmissionDecisionRecord } from '../../../shared-context/index.js'
import { type EvidenceRecord, type RejectedFinding } from '../../../../shared/contracts/index.js'
import {
  emptyAdmissionCandidateOutcome,
  mergeAdmissionCandidateOutcomes,
  type AdmissionCandidateOutcome
} from './outcome.js'
import { type ProviderIssue } from '../provider-issues.js'

const candidate = (id: string): CandidateFinding => ({
  id,
  taskId: 'task_admission',
  category: 'bug',
  severity: 'high',
  title: `Finding ${id}`,
  description: `Description ${id}`,
  location: {
    path: 'src/admission.ts',
    startLine: 12,
    side: 'new'
  },
  evidenceIds: [`ev_${id}`],
  proposedBy: 'review-agent'
})

const evidence = (id: string): EvidenceRecord => ({
  id,
  kind: 'model-rationale',
  summary: `Evidence ${id}`,
  source: 'review-agent',
  redactionApplied: true
})

describe('model admission outcome', () => {
  test('creates empty admission candidate outcomes', () => {
    expect(emptyAdmissionCandidateOutcome()).toEqual({
      admissionCandidates: [],
      evidence: [],
      rejectedFindings: [],
      admissionDecisions: [],
      artifactOnlyCandidateIds: [],
      refutationResults: [],
      providerIssues: []
    })
  })

  test('merges candidate outcomes in order with workflow evidence first', () => {
    const rejectedFinding: RejectedFinding = {
      candidateId: 'cand_b',
      status: 'needs-more-evidence',
      reason: 'weak-evidence',
      message: 'Needs more proof.',
      evidenceIds: ['ev_b']
    }
    const admissionDecision: AdmissionDecisionRecord = {
      candidateId: 'cand_b',
      status: 'needs-more-evidence',
      rejectedReason: 'weak-evidence'
    }
    const providerIssue: ProviderIssue = {
      code: 'provider_error',
      stage: 'refutation-check',
      recovered: true,
      message: 'Provider timed out.'
    }
    const outcomes: readonly AdmissionCandidateOutcome[] = [
      {
        ...emptyAdmissionCandidateOutcome(),
        admissionCandidates: [candidate('cand_a')],
        evidence: [evidence('ev_a')],
        artifactOnlyCandidateIds: ['cand_a']
      },
      {
        ...emptyAdmissionCandidateOutcome(),
        rejectedFindings: [rejectedFinding],
        admissionDecisions: [admissionDecision],
        evidence: [evidence('ev_b')],
        providerIssues: [providerIssue]
      }
    ]

    expect(
      mergeAdmissionCandidateOutcomes({
        workflowEvidence: [evidence('ev_workflow')],
        outcomes
      })
    ).toEqual({
      admissionCandidates: [candidate('cand_a')],
      evidence: [evidence('ev_workflow'), evidence('ev_a'), evidence('ev_b')],
      rejectedFindings: [rejectedFinding],
      admissionDecisions: [admissionDecision],
      artifactOnlyCandidateIds: ['cand_a'],
      refutationResults: [],
      providerIssues: [providerIssue]
    })
  })
})
