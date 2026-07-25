import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../../admission/index.js'
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
  test('passes support-signal candidates through without consuming a verdict', () => {
    const outcome = reviewCandidateForAdmission({
      workflowInput: workflowInput(),
      candidate: supportSignalCandidate,
      // A support signal is decided by deterministic preflight rules; any verdict
      // that reached it must be ignored rather than applied.
      resolution: {
        status: 'verdict',
        refutation: {
          verdict: 'refuted',
          rationaleSummary: 'A support-signal candidate is never refuted.'
        }
      }
    })

    expect(outcome.admissionCandidates).toEqual([supportSignalCandidate])
    expect(outcome.artifactOnlyCandidateIds).toEqual(['cand_supportcandidate'])
    expect(outcome.rejectedFindings).toEqual([])
  })

  test('falls back to the no-refuter outcome when no resolution exists', () => {
    const outcome = reviewCandidateForAdmission({
      workflowInput: workflowInput(),
      candidate: modelCandidate,
      resolution: undefined
    })

    expect(outcome.admissionCandidates).toEqual([modelCandidate])
    expect(outcome.refutationResults).toEqual([])
  })

  test('admits a proved model candidate with the refuter fix summary', () => {
    const outcome = reviewCandidateForAdmission({
      workflowInput: workflowInput(),
      candidate: modelCandidate,
      resolution: {
        status: 'verdict',
        refutation: {
          verdict: 'proved',
          rationaleSummary: 'The active admission critic proved the claim.',
          fixSummary: 'Preserve the existing state in the changed branch.'
        }
      }
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

  test('rejects a needs-more-evidence model candidate when policy rejects', () => {
    const outcome = reviewCandidateForAdmission({
      workflowInput: workflowInput(),
      candidate: modelCandidate,
      resolution: {
        status: 'verdict',
        refutation: {
          verdict: 'needs-more-evidence',
          rationaleSummary: 'The refuter could not prove the claim.'
        }
      }
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

  test('treats a candidate the batch never adjudicated as needs-more-evidence', () => {
    const outcome = reviewCandidateForAdmission({
      workflowInput: workflowInput(),
      candidate: modelCandidate,
      resolution: { status: 'missing-verdict' }
    })

    // The fail-safe: no verdict must never become an admitted, proved finding.
    expect(outcome.admissionCandidates).toEqual([])
    expect(outcome.rejectedFindings[0]?.reason).toBe('weak-evidence')
    expect(outcome.refutationResults).toEqual([
      expect.objectContaining({
        candidateId: 'cand_modelcandidate',
        verdict: 'needs-more-evidence'
      })
    ])
  })

  test('reports a provider-error resolution as a recovered provider issue', () => {
    const outcome = reviewCandidateForAdmission({
      workflowInput: workflowInput(),
      candidate: modelCandidate,
      resolution: {
        status: 'provider-error',
        error: new Error('provider timed out while refuting'),
        stage: 'refutation-check'
      }
    })

    expect(outcome.admissionCandidates).toEqual([])
    expect(outcome.providerIssues).toEqual([
      expect.objectContaining({ stage: 'refutation-check', recovered: true })
    ])
    expect(outcome.rejectedFindings).toEqual([
      expect.objectContaining({
        candidateId: 'cand_modelcandidate',
        reason: 'provider-error'
      })
    ])
  })
})
