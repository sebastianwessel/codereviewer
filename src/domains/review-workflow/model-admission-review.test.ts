import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type ProofPacket,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  type FindingRefutationInput,
  type FindingRefutationResult,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { prepareCandidatesForAdmission } from './model-admission-review.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from './workflow-contracts.js'

const configHash =
  '4444444444444444444444444444444444444444444444444444444444444444'

const supportEvidence: EvidenceRecord = {
  id: 'ev_support1',
  kind: 'diagnostic',
  summary: 'Support signal reported a changed branch concern.',
  location: {
    path: 'src/admission.ts',
    startLine: 12,
    side: 'new'
  },
  source: 'typescript-support-signal',
  redactionApplied: true
}

const supportSignalCandidate: CandidateFinding = {
  id: 'cand_support1',
  taskId: 'task_admission',
  category: 'bug',
  severity: 'high',
  title: 'Support signal seed',
  description: 'The support signal marks this location for model review.',
  location: {
    path: 'src/admission.ts',
    startLine: 12,
    side: 'new'
  },
  evidenceIds: ['ev_support1'],
  proposedBy: 'typescript-support-signal'
}

const modelCandidate: CandidateFinding = {
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
}

const task: WorkflowReviewTask = {
  id: 'task_admission',
  kind: 'file',
  round: 1,
  paths: ['src/admission.ts'],
  factIds: [],
  evidenceIds: ['ev_support1'],
  candidateIds: ['cand_support1', 'cand_model1'],
  contextEntryIds: ['ctx_adadadadadadadadadadadad'],
  reviewContext: [
    {
      kind: 'file',
      path: 'src/admission.ts',
      content: 'export const changed = true\n',
      ledgerEntryId: 'ctx_adadadadadadadadadadadad'
    }
  ],
  priority: 1
}

const workflowInput = (
  input: {
    readonly maxConcurrentTasks?: number
  } = {}
): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-model-admission',
    reviewedPaths: ['src/admission.ts'],
    reviewedDiffRanges: [
      { path: 'src/admission.ts', startLine: 1, endLine: 30 }
    ],
    evidence: [supportEvidence],
    candidates: [supportSignalCandidate, modelCandidate],
    instructions: [],
    skills: [],
    ...(input.maxConcurrentTasks === undefined
      ? {}
      : { maxConcurrentTasks: input.maxConcurrentTasks }),
    promotionPolicy: {
      modelWeakOrRefuted: 'rejected'
    },
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

const refutedResult = (): FindingRefutationResult => ({
  verdict: 'refuted',
  rationaleSummary: 'The support signal does not prove the model claim.'
})

const refutationArtifact: RefutationResult = {
  id: 'ref_model1',
  proofPacketId: 'proof_model1',
  verdict: 'refuted',
  summary: 'The support signal does not prove the model claim.',
  evidenceIds: ['ev_support1'],
  checks: [
    {
      kind: 'proof-review',
      result: 'failed',
      summary: 'No complete proof packet supports the claim.',
      evidenceIds: ['ev_support1']
    }
  ]
}

const proofArtifact: ProofPacket = {
  id: 'proof_model1',
  suspicionId: 'susp_model1',
  candidateId: 'cand_model1',
  changedBehavior: 'The changed branch can lose data.',
  executionOrDataPath: 'The reviewed branch is reachable from the changed API.',
  violatedInvariant: 'The API must preserve existing data.',
  impact: 'A user update can drop existing state.',
  introducedByChange: 'The reviewed diff changes the update branch.',
  evidenceIds: ['ev_support1'],
  contradictionChecks: ['No contradiction was found.'],
  fixDirection: 'Preserve the existing state in the changed branch.'
}

describe('model admission review', () => {
  test('rejects a model candidate refuted against support-signal evidence', async () => {
    let refutationCalls = 0
    const refutationInputs: FindingRefutationInput[] = []
    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput(),
      tasks: [task],
      candidates: [supportSignalCandidate, modelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      proofPackets: [],
      refutationResults: [refutationArtifact],
      refuteFinding: async (input) => {
        refutationCalls += 1
        refutationInputs.push(input)
        return refutedResult()
      }
    })

    expect(refutationCalls).toBe(1)
    expect(refutationInputs[0]?.candidate.id).toBe('cand_model1')
    expect(result.admissionCandidates.map((candidate) => candidate.id)).toEqual([
      'cand_support1'
    ])
    expect(result.artifactOnlyCandidateIds).toEqual(['cand_support1'])
    expect(result.rejectedFindings).toEqual([
      expect.objectContaining({
        candidateId: 'cand_model1',
        reason: 'refuted'
      })
    ])
  })

  test('admits a proved model candidate alongside the support-signal seed', async () => {
    let refutationCalls = 0
    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput(),
      tasks: [task],
      candidates: [supportSignalCandidate, modelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      proofPackets: [proofArtifact],
      refutationResults: [
        {
          ...refutationArtifact,
          verdict: 'proved',
          summary: 'The proof packet survived refutation.'
        }
      ],
      refuteFinding: async () => {
        refutationCalls += 1
        return {
          verdict: 'proved',
          rationaleSummary: 'The active admission critic proved the claim.',
          fixSummary: 'Preserve the existing state in the changed branch.'
        }
      }
    })

    expect(refutationCalls).toBe(1)
    expect(result.admissionCandidates.map((candidate) => candidate.id)).toEqual([
      'cand_support1',
      'cand_model1'
    ])
    expect(result.rejectedFindings).toEqual([])
    expect(
      result.admissionCandidates.find((candidate) => candidate.id === 'cand_model1')
        ?.fixProposal?.summary
    ).toBe('Preserve the existing state in the changed branch.')
  })

  test('passes review evidence into the admission refutation packet', async () => {
    let refutationCalls = 0
    const refutationInputs: FindingRefutationInput[] = []
    const proofEvidence: EvidenceRecord = {
      id: 'ev_taskproof',
      kind: 'model-rationale',
      summary: 'Investigation proved the changed branch reaches stale state.',
      location: {
        path: 'src/admission.ts',
        startLine: 12,
        side: 'new'
      },
      source: 'model-investigation',
      redactionApplied: true
    }
    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput(),
      tasks: [task],
      candidates: [modelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      reviewEvidence: [supportEvidence, proofEvidence],
      proofPackets: [proofArtifact],
      refutationResults: [
        {
          ...refutationArtifact,
          verdict: 'proved',
          summary: 'The proof packet survived proof-loop refutation.',
          evidenceIds: [proofEvidence.id]
        }
      ],
      refuteFinding: async (input) => {
        refutationCalls += 1
        refutationInputs.push(input)

        return {
          verdict: 'proved',
          rationaleSummary:
            'The task proof evidence survives active admission refutation.',
          fixSummary: 'Preserve the existing state in the changed branch.'
        }
      }
    })

    expect(refutationCalls).toBe(1)
    expect(refutationInputs[0]?.evidence.map((record) => record.id)).toEqual([
      'ev_support1',
      proofEvidence.id
    ])
    expect(result.rejectedFindings).toEqual([])
    expect(result.admissionCandidates.map((candidate) => candidate.id)).toEqual([
      'cand_model1'
    ])
    expect(result.admissionCandidates[0]?.fixProposal?.summary).toBe(
      'Preserve the existing state in the changed branch.'
    )
  })

  test('rejects a model candidate when refutation needs more evidence under the rejected policy', async () => {
    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput(),
      tasks: [task],
      candidates: [modelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      proofPackets: [proofArtifact],
      refutationResults: [refutationArtifact],
      refuteFinding: async () => ({
        verdict: 'needs-more-evidence',
        rationaleSummary: 'The critic could not prove the claim.'
      })
    })

    expect(result.admissionCandidates.map((candidate) => candidate.id)).toEqual([])
    expect(result.rejectedFindings).toEqual([
      expect.objectContaining({
        candidateId: 'cand_model1'
      })
    ])
  })

  test('runs independent refutation checks concurrently without leaking per-candidate evidence', async () => {
    const secondModelCandidate: CandidateFinding = {
      ...modelCandidate,
      id: 'cand_model2',
      location: {
        ...modelCandidate.location,
        startLine: 14
      }
    }
    let activeRefutationCalls = 0
    let maxActiveRefutationCalls = 0
    const evidenceIdsByCandidate = new Map<string, readonly string[]>()

    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput({ maxConcurrentTasks: 2 }),
      tasks: [task],
      candidates: [modelCandidate, secondModelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      proofPackets: [proofArtifact],
      refutationResults: [
        {
          ...refutationArtifact,
          verdict: 'proved',
          summary: 'The proof packet survived refutation.'
        }
      ],
      refuteFinding: async (input) => {
        activeRefutationCalls += 1
        maxActiveRefutationCalls = Math.max(
          maxActiveRefutationCalls,
          activeRefutationCalls
        )
        evidenceIdsByCandidate.set(
          input.candidate.id,
          input.evidence.map((record) => record.id)
        )
        await new Promise((resolve) => setTimeout(resolve, 20))
        activeRefutationCalls -= 1

        return {
          verdict: 'proved',
          rationaleSummary: 'The active admission critic proved the claim.',
          fixSummary: 'Preserve the existing state in the changed branch.'
        }
      }
    })

    expect(maxActiveRefutationCalls).toBe(2)
    expect(result.admissionCandidates.map((candidate) => candidate.id)).toEqual([
      'cand_model1',
      'cand_model2'
    ])
    expect(
      evidenceIdsByCandidate
        .get('cand_model2')
        ?.filter((id) => id.startsWith('ev_') && id !== 'ev_support1')
    ).toEqual([])
  })
})
