import { describe, expect, test } from 'vitest'
import { type CandidateFinding } from '../admission/index.js'
import { type EvidenceRecord } from '../../shared/contracts/index.js'
import {
  noRefuterAdmissionOutcome,
  outOfDiffScopeOutcome,
  supportSignalArtifactOnlyCandidateIds,
  supportSignalCandidateOutcome
} from './model-admission-preflight-outcome.js'

const evidence: EvidenceRecord = {
  id: 'ev_support1',
  kind: 'diagnostic',
  summary: 'Support signal reported a changed branch concern.',
  source: 'typescript-support-signal',
  redactionApplied: true
}

const candidate = (
  input: {
    readonly id: string
    readonly proposedBy: CandidateFinding['proposedBy']
  }
): CandidateFinding => ({
  id: input.id,
  taskId: 'task_admission',
  category: 'bug',
  severity: 'high',
  title: `Finding ${input.id}`,
  description: `Description ${input.id}`,
  location: {
    path: 'src/admission.ts',
    startLine: 12,
    side: 'new'
  },
  evidenceIds: ['ev_support1'],
  proposedBy: input.proposedBy
})

const modelCandidate = candidate({
  id: 'cand_model1',
  proposedBy: 'review-agent'
})
const supportCandidate = candidate({
  id: 'cand_support1',
  proposedBy: 'typescript-support-signal'
})
const trustedDeterministicCandidate = candidate({
  id: 'cand_trusted1',
  proposedBy: 'deterministic-trusted-rule'
})

describe('model admission preflight outcome', () => {
  test('selects support-signal artifact-only candidate IDs', () => {
    expect(
      supportSignalArtifactOnlyCandidateIds([
        modelCandidate,
        supportCandidate,
        trustedDeterministicCandidate
      ])
    ).toEqual(['cand_support1'])
  })

  test('creates no-refuter fallback outcomes', () => {
    expect(
      noRefuterAdmissionOutcome({
        candidates: [modelCandidate, supportCandidate],
        workflowEvidence: [evidence]
      })
    ).toEqual({
      admissionCandidates: [modelCandidate, supportCandidate],
      evidence: [evidence],
      rejectedFindings: [],
      admissionDecisions: [],
      artifactOnlyCandidateIds: ['cand_support1'],
      refutationResults: [],
      providerIssues: []
    })
  })

  test('creates support-signal pass-through outcomes', () => {
    expect(supportSignalCandidateOutcome(supportCandidate)).toEqual({
      admissionCandidates: [supportCandidate],
      evidence: [],
      rejectedFindings: [],
      admissionDecisions: [],
      artifactOnlyCandidateIds: ['cand_support1'],
      refutationResults: [],
      providerIssues: []
    })
  })

  test('keeps trusted deterministic rule candidates actionable', () => {
    expect(supportSignalCandidateOutcome(trustedDeterministicCandidate)).toEqual({
      admissionCandidates: [trustedDeterministicCandidate],
      evidence: [],
      rejectedFindings: [],
      admissionDecisions: [],
      artifactOnlyCandidateIds: [],
      refutationResults: [],
      providerIssues: []
    })
  })

  test('creates out-of-diff-scope outcomes', () => {
    expect(outOfDiffScopeOutcome(modelCandidate)).toEqual({
      admissionCandidates: [],
      evidence: [],
      rejectedFindings: [
        {
          candidateId: 'cand_model1',
          status: 'needs-more-evidence',
          reason: 'not-in-scope',
          message:
            'Model candidate is in a file with no reviewed changes and lacks deterministic corroboration.',
          evidenceIds: ['ev_support1']
        }
      ],
      admissionDecisions: [
        {
          candidateId: 'cand_model1',
          status: 'needs-more-evidence',
          rejectedReason: 'not-in-scope'
        }
      ],
      artifactOnlyCandidateIds: [],
      refutationResults: [],
      providerIssues: []
    })
  })
})
