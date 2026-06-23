import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  type ContextRequest,
  type EvidenceRecord,
  type ProofPacket,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { createContextRetriever } from '../context-retrieval/index.js'
import {
  type FindingJudgeInput,
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
    readonly judgeFindings?: boolean
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
    judgeFindings: input.judgeFindings ?? false,
    promotionPolicy: {
      modelProof: 'actionable',
      modelWeakOrRefuted: 'rejected',
      staticAnalysisDuplicate: 'artifact-only',
      deterministicContradiction: 'rejected'
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

const createTempRepo = async (): Promise<string> => {
  const root = join(tmpdir(), `codereviewer-admission-judge-${crypto.randomUUID()}`)

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src', 'shared.ts'),
    [
      'export const preserveExistingState = true',
      'export const sharedGuard = () => preserveExistingState'
    ].join('\n')
  )

  return root
}

describe('model admission review', () => {
  test('requires refutation even when a model candidate overlaps support-signal evidence', async () => {
    let refutationCalls = 0
    const refutationInputs: FindingRefutationInput[] = []
    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput(),
      tasks: [task],
      candidates: [supportSignalCandidate, modelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [],
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

  test('runs active admission refutation for proved proof-loop artifacts under optional judging', async () => {
    let refutationCalls = 0
    let judgeCalls = 0
    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput({ judgeFindings: true }),
      tasks: [task],
      candidates: [supportSignalCandidate, modelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [],
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
      },
      judgeFinding: async () => {
        judgeCalls += 1
        return {
          verdict: 'valid',
          summary: 'The proof remains valid after optional critic review.',
          challengeQuestions: [
            'Does the proof establish reachable changed behavior?'
          ],
          verificationChecks: [
            {
              kind: 'proof-review',
              result: 'passed',
              summary: 'The proof artifact and refutation artifact agree.',
              evidenceIds: ['ev_support1']
            }
          ],
          evidenceIds: ['ev_support1'],
          contextRequests: [],
          requestedContext: []
        }
      }
    })

    expect(refutationCalls).toBe(1)
    expect(judgeCalls).toBe(1)
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

  test('passes proof-loop task evidence into the default admission refutation packet', async () => {
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
    const proofWithTaskEvidence: ProofPacket = {
      ...proofArtifact,
      evidenceIds: [proofEvidence.id]
    }
    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput(),
      tasks: [task],
      candidates: [modelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      reviewEvidence: [supportEvidence, proofEvidence],
      reviewIntents: [],
      proofPackets: [proofWithTaskEvidence],
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

  test('rejects optional judge approval when the critic cites no evidence', async () => {
    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput({ judgeFindings: true }),
      tasks: [task],
      candidates: [modelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [],
      proofPackets: [proofArtifact],
      refutationResults: [
        {
          ...refutationArtifact,
          verdict: 'proved',
          summary: 'The proof packet survived refutation.'
        }
      ],
      refuteFinding: async () => ({
        verdict: 'proved',
        rationaleSummary: 'The active admission critic proved the claim.',
        fixSummary: 'Preserve the existing state in the changed branch.'
      }),
      judgeFinding: async () => ({
        verdict: 'valid',
        summary:
          'The proof remains valid, but the critic did not cite decisive evidence.',
        challengeQuestions: ['Does the proof cite decisive evidence?'],
        verificationChecks: [
          {
            kind: 'proof-review',
            result: 'unknown',
            summary: 'No decisive evidence was cited by the critic.',
            evidenceIds: []
          }
        ],
        evidenceIds: [],
        contextRequests: [],
        requestedContext: []
      })
    })

    expect(result.judgeResults).toEqual([
      expect.objectContaining({
        verdict: 'needs-more-evidence',
        evidenceIds: [],
        verificationChecks: [
          expect.objectContaining({
            result: 'unknown',
            evidenceIds: []
          })
        ]
      })
    ])
    expect(result.rejectedFindings).toEqual([
      expect.objectContaining({
        candidateId: 'cand_model1',
        reason: 'insufficient-evidence',
        evidenceIds: []
      })
    ])
    expect(result.admissionCandidates.map((candidate) => candidate.id)).toEqual([])
  })

  test('does not refute a model candidate when the critic cites no evidence', async () => {
    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput({ judgeFindings: true }),
      tasks: [task],
      candidates: [modelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [],
      proofPackets: [proofArtifact],
      refutationResults: [
        {
          ...refutationArtifact,
          verdict: 'proved',
          summary: 'The proof packet survived refutation.'
        }
      ],
      refuteFinding: async () => ({
        verdict: 'proved',
        rationaleSummary: 'The active admission critic proved the claim.',
        fixSummary: 'Preserve the existing state in the changed branch.'
      }),
      judgeFinding: async () => ({
        verdict: 'false-positive',
        summary:
          'The critic rejected the proof but did not cite contradictory evidence.',
        challengeQuestions: ['Does the critic cite contradiction evidence?'],
        verificationChecks: [
          {
            kind: 'proof-review',
            result: 'unknown',
            summary: 'No contradiction evidence was cited by the critic.',
            evidenceIds: []
          }
        ],
        evidenceIds: [],
        contextRequests: [],
        requestedContext: []
      })
    })

    expect(result.judgeResults).toEqual([
      expect.objectContaining({
        verdict: 'needs-more-evidence',
        evidenceIds: []
      })
    ])
    expect(result.rejectedFindings).toEqual([
      expect.objectContaining({
        candidateId: 'cand_model1',
        reason: 'insufficient-evidence',
        evidenceIds: []
      })
    ])
    expect(result.admissionCandidates.map((candidate) => candidate.id)).toEqual([])
  })

  test('skips optional judge only for aggregate-covered candidates', async () => {
    let judgeCalls = 0
    const secondModelCandidate: CandidateFinding = {
      ...modelCandidate,
      id: 'cand_model2',
      location: {
        ...modelCandidate.location,
        startLine: 14
      }
    }
    const secondProof: ProofPacket = {
      ...proofArtifact,
      id: 'proof_model2',
      candidateId: 'cand_model2'
    }
    const secondRefutation: RefutationResult = {
      ...refutationArtifact,
      id: 'refute_model2',
      proofPacketId: 'proof_model2',
      verdict: 'proved',
      summary: 'The second proof packet survived refutation.'
    }

    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput({ judgeFindings: true }),
      tasks: [task],
      candidates: [modelCandidate, secondModelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [],
      proofPackets: [proofArtifact, secondProof],
      refutationResults: [
        {
          ...refutationArtifact,
          verdict: 'proved',
          summary: 'The proof packet survived refutation.'
        },
        secondRefutation
      ],
      skipJudgeCandidateIds: new Set(['cand_model1']),
      refuteFinding: async () => ({
        verdict: 'proved',
        rationaleSummary: 'The active admission critic proved the claim.',
        fixSummary: 'Preserve the existing state in the changed branch.'
      }),
      judgeFinding: async (judgeInput) => {
        judgeCalls += 1
        expect(judgeInput.candidate.id).toBe('cand_model2')
        return {
          verdict: 'valid',
          summary: 'The uncovered proof remains valid after critic review.',
          challengeQuestions: ['Does the uncovered proof remain valid?'],
          verificationChecks: [
            {
              kind: 'proof-review',
              result: 'passed',
              summary: 'The uncovered proof is still valid.',
              evidenceIds: ['ev_support1']
            }
          ],
          evidenceIds: ['ev_support1'],
          contextRequests: [],
          requestedContext: []
        }
      }
    })

    expect(judgeCalls).toBe(1)
    expect(result.admissionCandidates.map((candidate) => candidate.id)).toEqual([
      'cand_model1',
      'cand_model2'
    ])
    expect(result.judgeResults).toHaveLength(1)
  })

  test('runs independent optional judge checks concurrently without leaking per-candidate refutation evidence', async () => {
    const secondModelCandidate: CandidateFinding = {
      ...modelCandidate,
      id: 'cand_model2',
      location: {
        ...modelCandidate.location,
        startLine: 14
      }
    }
    const secondProof: ProofPacket = {
      ...proofArtifact,
      id: 'proof_model2',
      candidateId: 'cand_model2'
    }
    const secondRefutation: RefutationResult = {
      ...refutationArtifact,
      id: 'refute_model2',
      proofPacketId: 'proof_model2',
      verdict: 'proved',
      summary: 'The second proof packet survived refutation.'
    }
    let activeJudgeCalls = 0
    let maxActiveJudgeCalls = 0
    const evidenceIdsByCandidate = new Map<string, readonly string[]>()

    const result = await prepareCandidatesForAdmission({
      workflowInput: workflowInput({
        judgeFindings: true,
        maxConcurrentTasks: 2
      }),
      tasks: [task],
      candidates: [modelCandidate, secondModelCandidate],
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [],
      proofPackets: [proofArtifact, secondProof],
      refutationResults: [
        {
          ...refutationArtifact,
          verdict: 'proved',
          summary: 'The proof packet survived refutation.'
        },
        secondRefutation
      ],
      refuteFinding: async () => ({
        verdict: 'proved',
        rationaleSummary: 'The active admission critic proved the claim.',
        fixSummary: 'Preserve the existing state in the changed branch.'
      }),
      judgeFinding: async (judgeInput) => {
        activeJudgeCalls += 1
        maxActiveJudgeCalls = Math.max(maxActiveJudgeCalls, activeJudgeCalls)
        evidenceIdsByCandidate.set(
          judgeInput.candidate.id,
          judgeInput.evidence.map((record) => record.id)
        )
        await new Promise((resolve) => setTimeout(resolve, 20))
        activeJudgeCalls -= 1

        return {
          verdict: 'valid',
          summary: 'The proof remains valid after bounded critic review.',
          challengeQuestions: ['Does the proof remain valid?'],
          verificationChecks: [
            {
              kind: 'proof-review',
              result: 'passed',
              summary: 'The critic cited base evidence.',
              evidenceIds: ['ev_support1']
            }
          ],
          evidenceIds: ['ev_support1'],
          contextRequests: [],
          requestedContext: []
        }
      }
    })

    expect(maxActiveJudgeCalls).toBe(2)
    expect(result.admissionCandidates.map((candidate) => candidate.id)).toEqual([
      'cand_model1',
      'cand_model2'
    ])
    expect(
      evidenceIdsByCandidate.get('cand_model2')?.filter((id) =>
        id.startsWith('ev_') && id !== 'ev_support1'
      )
    ).toEqual([])
  })

  test('reuses identical judge follow-up context artifacts across candidates', async () => {
    const root = await createTempRepo()

    try {
      const secondModelCandidate: CandidateFinding = {
        ...modelCandidate,
        id: 'cand_model2',
        location: {
          ...modelCandidate.location,
          startLine: 14
        }
      }
      const secondProof: ProofPacket = {
        ...proofArtifact,
        id: 'proof_model2',
        candidateId: 'cand_model2'
      }
      const secondRefutation: RefutationResult = {
        ...refutationArtifact,
        id: 'refute_model2',
        proofPacketId: 'proof_model2',
        verdict: 'proved',
        summary: 'The second proof packet survived refutation.'
      }
      const sharedContextRequest: ContextRequest = {
        tool: 'read',
        path: 'src/shared.ts',
        reason: 'Inspect the shared guard used by both candidates.'
      }
      const alternateSharedContextRequest: ContextRequest = {
        ...sharedContextRequest,
        path: './src//shared.ts'
      }
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: {
          maxReads: 1,
          maxSearches: 0
        }
      })
      const followUpEvidenceByCandidate = new Map<string, number>()
      const judgeCallsByCandidate = new Map<string, number>()
      const judgeFinding = async (judgeInput: FindingJudgeInput) => {
        judgeCallsByCandidate.set(
          judgeInput.candidate.id,
          (judgeCallsByCandidate.get(judgeInput.candidate.id) ?? 0) + 1
        )

        const followUpEvidence = judgeInput.evidence.filter(
          (record) => record.source === 'context-retrieval'
        )
        followUpEvidenceByCandidate.set(
          judgeInput.candidate.id,
          followUpEvidence.length
        )

        if (followUpEvidence.length === 0) {
          return {
            verdict: 'needs-more-evidence' as const,
            summary: 'The judge needs the shared guard context.',
            challengeQuestions: ['Does the shared guard preserve existing state?'],
            verificationChecks: [],
            evidenceIds: ['ev_support1'],
            contextRequests: [
              judgeInput.candidate.id === 'cand_model1'
                ? sharedContextRequest
                : alternateSharedContextRequest
            ],
            requestedContext: []
          }
        }

        return {
          verdict: 'valid' as const,
          summary: 'The shared guard context confirms the proof remains valid.',
          challengeQuestions: ['Does the shared guard preserve existing state?'],
          verificationChecks: [
            {
              kind: 'proof-review',
              result: 'passed' as const,
              summary: 'The shared guard context was available to the judge.',
              evidenceIds: [followUpEvidence[0]?.id ?? 'ev_support1']
            }
          ],
          evidenceIds: [followUpEvidence[0]?.id ?? 'ev_support1'],
          contextRequests: [],
          requestedContext: []
        }
      }

      const result = await prepareCandidatesForAdmission({
        workflowInput: workflowInput({ judgeFindings: true }),
        tasks: [task],
        candidates: [modelCandidate, secondModelCandidate],
        sharedDigest: '(no admitted shared context yet)',
        reviewIntents: [],
        proofPackets: [proofArtifact, secondProof],
        refutationResults: [
          {
            ...refutationArtifact,
            verdict: 'proved',
            summary: 'The proof packet survived refutation.'
          },
          secondRefutation
        ],
        contextRetriever: retriever,
        refuteFinding: async () => ({
          verdict: 'proved',
          rationaleSummary: 'The active admission critic proved the claim.',
          fixSummary: 'Preserve the existing state in the changed branch.'
        }),
        judgeFinding
      })

      expect(retriever.budget()).toMatchObject({
        usedReads: 1,
        usedSearches: 0
      })
      expect(judgeCallsByCandidate).toEqual(
        new Map([
          ['cand_model1', 2],
          ['cand_model2', 2]
        ])
      )
      expect(followUpEvidenceByCandidate).toEqual(
        new Map([
          ['cand_model1', 1],
          ['cand_model2', 1]
        ])
      )
      expect(result.admissionCandidates.map((candidate) => candidate.id)).toEqual([
        'cand_model1',
        'cand_model2'
      ])
      expect(result.rejectedFindings).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
