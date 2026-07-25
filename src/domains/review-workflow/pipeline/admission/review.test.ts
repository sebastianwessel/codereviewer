import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../../admission/index.js'
import {
  type FindingRefutationBatchInput,
  type ModelFindingRefutationBatchResult,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { prepareCandidatesForAdmission } from './review.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from '../contracts.js'

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

// A second task with its own file, evidence and candidate. Batched refutation groups
// by task, so this is what proves the grouping boundary is the task and not the run.
const otherTaskEvidence: EvidenceRecord = {
  id: 'ev_support2',
  kind: 'diagnostic',
  summary: 'Support signal reported a second changed branch concern.',
  location: {
    path: 'src/admission-other.ts',
    startLine: 8,
    side: 'new'
  },
  source: 'typescript-support-signal',
  redactionApplied: true
}

const otherTaskModelCandidate: CandidateFinding = {
  id: 'cand_model2',
  taskId: 'task_admission_other',
  category: 'bug',
  severity: 'high',
  title: 'Second changed branch can lose data',
  description: 'The model claims the second changed branch can lose data.',
  location: {
    path: 'src/admission-other.ts',
    startLine: 8,
    side: 'new'
  },
  evidenceIds: ['ev_support2'],
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

const otherTask: WorkflowReviewTask = {
  ...task,
  id: 'task_admission_other',
  paths: ['src/admission-other.ts'],
  evidenceIds: ['ev_support2'],
  candidateIds: ['cand_model2'],
  contextEntryIds: ['ctx_bdbdbdbdbdbdbdbdbdbdbdbd'],
  reviewContext: [
    {
      kind: 'file',
      path: 'src/admission-other.ts',
      content: 'export const alsoChanged = true\n',
      ledgerEntryId: 'ctx_bdbdbdbdbdbdbdbdbdbdbdbd'
    }
  ]
}

const workflowInput = (
  input: {
    readonly maxConcurrentTasks?: number
  } = {}
): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-model-admission',
    reviewedPaths: ['src/admission.ts', 'src/admission-other.ts'],
    reviewedDiffRanges: [
      { path: 'src/admission.ts', startLine: 1, endLine: 30 },
      { path: 'src/admission-other.ts', startLine: 1, endLine: 30 }
    ],
    evidence: [supportEvidence, otherTaskEvidence],
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

// The refuter answers per batch: one verdict entry per candidate it was sent.
const batchVerdicts = (
  input: FindingRefutationBatchInput,
  verdict: {
    readonly verdict: string
    readonly rationaleSummary: string
    readonly fixSummary?: string
  }
): ModelFindingRefutationBatchResult => ({
  verdicts: input.candidates.map((candidate) => ({
    candidateId: candidate.id,
    ...verdict
  }))
})

describe('model admission review', () => {
  test('rejects a model candidate refuted against support-signal evidence', async () => {
    let refutationCalls = 0
    const refutationInputs: FindingRefutationBatchInput[] = []
    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput(),
      tasks: [task],
      candidates: [supportSignalCandidate, modelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      refuteFinding: async (input) => {
        refutationCalls += 1
        refutationInputs.push(input)

        return batchVerdicts(input, {
          verdict: 'refuted',
          rationaleSummary: 'The support signal does not prove the model claim.'
        })
      }
    })

    expect(refutationCalls).toBe(1)
    // The support-signal candidate is decided by preflight and never costs a call.
    expect(refutationInputs[0]?.candidates.map((entry) => entry.id)).toEqual([
      'cand_model1'
    ])
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
      refuteFinding: async (input) => {
        refutationCalls += 1

        return batchVerdicts(input, {
          verdict: 'proved',
          rationaleSummary: 'The active admission critic proved the claim.',
          fixSummary: 'Preserve the existing state in the changed branch.'
        })
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

  test('passes candidate review evidence into the admission refutation packet', async () => {
    let refutationCalls = 0
    const refutationInputs: FindingRefutationBatchInput[] = []
    const investigationEvidence: EvidenceRecord = {
      id: 'ev_taskproof',
      kind: 'model-rationale',
      summary: 'Investigation showed the changed branch reaches stale state.',
      location: {
        path: 'src/admission.ts',
        startLine: 12,
        side: 'new'
      },
      source: 'model-investigation',
      redactionApplied: true
    }
    const investigatedCandidate: CandidateFinding = {
      ...modelCandidate,
      evidenceIds: ['ev_support1', investigationEvidence.id]
    }
    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput(),
      tasks: [task],
      candidates: [investigatedCandidate],
      sharedDigest: '(no admitted shared context yet)',
      reviewEvidence: [supportEvidence, investigationEvidence],
      refuteFinding: async (input) => {
        refutationCalls += 1
        refutationInputs.push(input)

        return batchVerdicts(input, {
          verdict: 'proved',
          rationaleSummary:
            'The candidate evidence survives active admission refutation.',
          fixSummary: 'Preserve the existing state in the changed branch.'
        })
      }
    })

    expect(refutationCalls).toBe(1)
    expect(refutationInputs[0]?.evidence.map((record) => record.id)).toEqual([
      'ev_support1',
      investigationEvidence.id
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
      refuteFinding: async (input) =>
        batchVerdicts(input, {
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

  // The point of batching: N candidates of ONE task cost ONE call, because they all
  // share the same review context.
  test('sends every candidate of one task in a single refutation call', async () => {
    const siblingCandidates = Array.from({ length: 3 }, (_, index) => ({
      ...modelCandidate,
      id: `cand_model1_${index}`,
      location: {
        ...modelCandidate.location,
        startLine: 12 + index
      }
    }))
    const batchedCandidateIds: string[][] = []

    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput(),
      tasks: [task],
      candidates: siblingCandidates,
      sharedDigest: '(no admitted shared context yet)',
      refuteFinding: async (input) => {
        batchedCandidateIds.push(input.candidates.map((entry) => entry.id))

        return batchVerdicts(input, {
          verdict: 'proved',
          rationaleSummary: 'The active admission critic proved the claim.'
        })
      }
    })

    expect(batchedCandidateIds).toEqual([
      ['cand_model1_0', 'cand_model1_1', 'cand_model1_2']
    ])
    expect(result.admissionCandidates.map((candidate) => candidate.id)).toEqual([
      'cand_model1_0',
      'cand_model1_1',
      'cand_model1_2'
    ])
  })

  test('runs one refutation call per task concurrently without leaking cross-task evidence', async () => {
    let activeRefutationCalls = 0
    let maxActiveRefutationCalls = 0
    const evidenceIdsByTask = new Map<string, readonly string[]>()

    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput({ maxConcurrentTasks: 2 }),
      tasks: [task, otherTask],
      candidates: [modelCandidate, otherTaskModelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      refuteFinding: async (input) => {
        activeRefutationCalls += 1
        maxActiveRefutationCalls = Math.max(
          maxActiveRefutationCalls,
          activeRefutationCalls
        )
        evidenceIdsByTask.set(
          input.candidates[0]?.taskId ?? 'unknown-task',
          input.evidence.map((record) => record.id)
        )
        await new Promise((resolve) => setTimeout(resolve, 20))
        activeRefutationCalls -= 1

        return batchVerdicts(input, {
          verdict: 'proved',
          rationaleSummary: 'The active admission critic proved the claim.',
          fixSummary: 'Preserve the existing state in the changed branch.'
        })
      }
    })

    // Two tasks means two batches, and they overlap in time.
    expect(evidenceIdsByTask.size).toBe(2)
    expect(maxActiveRefutationCalls).toBe(2)
    expect(result.admissionCandidates.map((candidate) => candidate.id)).toEqual([
      'cand_model1',
      'cand_model2'
    ])
    // Each batch only sees the evidence its own candidates cite.
    expect(evidenceIdsByTask.get('task_admission')).toEqual(['ev_support1'])
    expect(evidenceIdsByTask.get('task_admission_other')).toEqual(['ev_support2'])
  })

  test('rejects a candidate the batch response omitted instead of admitting it', async () => {
    const secondModelCandidate: CandidateFinding = {
      ...modelCandidate,
      id: 'cand_model1b',
      location: {
        ...modelCandidate.location,
        startLine: 14
      }
    }

    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput(),
      tasks: [task],
      candidates: [modelCandidate, secondModelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      // The model adjudicated only the first candidate.
      refuteFinding: async () => ({
        verdicts: [
          {
            candidateId: 'cand_model1',
            verdict: 'proved',
            rationaleSummary: 'Only the first candidate was adjudicated.'
          }
        ]
      })
    })

    expect(result.admissionCandidates.map((candidate) => candidate.id)).toEqual([
      'cand_model1'
    ])
    // A candidate without a verdict falls back to needs-more-evidence, which this
    // policy rejects — it is never admitted on a verdict the model never gave.
    expect(result.rejectedFindings).toEqual([
      expect.objectContaining({
        candidateId: 'cand_model1b',
        reason: 'weak-evidence'
      })
    ])
  })

  test('ignores a batch verdict whose candidateId matches no sent candidate', async () => {
    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput(),
      tasks: [task],
      candidates: [modelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      refuteFinding: async () => ({
        verdicts: [
          {
            candidateId: 'cand_never_sent',
            verdict: 'proved',
            rationaleSummary: 'A verdict for a candidate that was never sent.'
          }
        ]
      })
    })

    // The stray verdict must not be bound to the only real candidate.
    expect(result.admissionCandidates).toEqual([])
    expect(result.rejectedFindings).toEqual([
      expect.objectContaining({
        candidateId: 'cand_model1',
        reason: 'weak-evidence'
      })
    ])
  })
})
