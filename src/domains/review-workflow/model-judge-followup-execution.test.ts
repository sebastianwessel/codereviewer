import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  type ContextRequest,
  type EvidenceRecord,
  type ProofPacket,
  type RefutationResult,
  type ReviewIntent
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { createContextRetriever } from '../context-retrieval/index.js'
import {
  type FindingJudgeInput,
  type FindingJudgeOutput,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { executeJudgeFollowUpReview } from './model-judge-followup-execution.js'
import { findingJudgeInputForCandidate } from './model-judge-packet.js'
import { providerIssueForError } from './model-provider-issues.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from './workflow-contracts.js'

const configHash =
  '7878787878787878787878787878787878787878787878787878787878787878'

const baseEvidence: EvidenceRecord = {
  id: 'ev_judgebase',
  kind: 'diff',
  summary: 'The changed branch can lose data.',
  location: {
    path: 'src/judge.ts',
    startLine: 12,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const candidate: CandidateFinding = {
  id: 'cand_judgefollowup',
  taskId: 'task_judgefollowup',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch can lose data',
  description: 'The changed branch can lose data.',
  location: {
    path: 'src/judge.ts',
    startLine: 12,
    side: 'new'
  },
  evidenceIds: ['ev_judgebase'],
  proposedBy: 'review-agent'
}

const task: WorkflowReviewTask = {
  id: 'task_judgefollowup',
  kind: 'file',
  round: 1,
  paths: ['src/judge.ts'],
  factIds: [],
  evidenceIds: ['ev_judgebase'],
  candidateIds: ['cand_judgefollowup'],
  contextEntryIds: [],
  priority: 1,
  reviewContext: [
    {
      kind: 'file',
      path: 'src/judge.ts',
      content: 'export const changed = true\n',
      ledgerEntryId: 'ctx_fefefefe'
    }
  ]
}

const proofPacket: ProofPacket = {
  id: 'proof_judgefollowup',
  suspicionId: 'susp_judgefollowup',
  candidateId: candidate.id,
  changedBehavior: 'The changed branch can lose data.',
  executionOrDataPath: 'The changed branch bypasses persistence.',
  violatedInvariant: 'Payload data must be preserved.',
  impact: 'Callers can lose data.',
  introducedByChange: 'The reviewed branch changed persistence behavior.',
  evidenceIds: ['ev_judgebase'],
  contradictionChecks: ['No alternate path preserves the payload.'],
  fixDirection: 'Persist the payload before returning.'
}

const refutationResult: RefutationResult = {
  id: 'ref_judgefollowup',
  proofPacketId: proofPacket.id,
  verdict: 'proved',
  summary: 'The proof survived refutation.',
  evidenceIds: ['ev_judgebase'],
  checks: [
    {
      kind: 'proof-review',
      result: 'passed',
      summary: 'No contradiction was found.',
      evidenceIds: ['ev_judgebase']
    }
  ]
}

const reviewIntent: ReviewIntent = {
  id: 'intent_judgefollowup',
  title: 'Verify changed branch',
  objective: 'Verify the changed branch preserves data.',
  paths: ['src/judge.ts'],
  taskIds: ['task_judgefollowup'],
  focusAreas: ['data persistence'],
  riskAreas: ['data loss'],
  verificationQuestions: ['Does the changed branch preserve data?'],
  source: 'model'
}

const workflowInput = (
  input: {
    readonly maxInvestigationRounds?: number
    readonly maxTaskInputBytes?: number
  } = {}
): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-judge-followup',
    reviewedPaths: ['src/judge.ts'],
    reviewedDiffRanges: [{ path: 'src/judge.ts', startLine: 1, endLine: 30 }],
    evidence: [baseEvidence],
    candidates: [candidate],
    instructions: [],
    skills: [],
    judgeFindings: true,
    ...(input.maxInvestigationRounds === undefined
      ? {}
      : { maxInvestigationRounds: input.maxInvestigationRounds }),
    ...(input.maxTaskInputBytes === undefined
      ? {}
      : { maxTaskInputBytes: input.maxTaskInputBytes }),
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

const contextRequest: ContextRequest = {
  tool: 'read',
  path: 'src/shared.ts',
  reason: 'Inspect the shared guard used by the changed branch.'
}

const initialJudgeOutput: FindingJudgeOutput = {
  verdict: 'needs-more-evidence',
  summary: 'The judge needs the shared guard context.',
  challengeQuestions: ['Does the shared guard preserve payload data?'],
  verificationChecks: [],
  evidenceIds: ['ev_judgebase'],
  contextRequests: [contextRequest],
  requestedContext: []
}

const createInitialJudgeInput = (
  input: ReviewWorkflowInput = workflowInput()
): FindingJudgeInput =>
  findingJudgeInputForCandidate({
    workflowInput: input,
    tasks: [task],
    candidate,
    sharedDigest: '(no admitted shared context yet)',
    evidence: [baseEvidence],
    reviewIntents: [reviewIntent],
    proofPackets: [proofPacket],
    refutationResults: [refutationResult]
  }).input

const createTempRepo = async (): Promise<string> => {
  const root = join(
    tmpdir(),
    `codereviewer-judge-followup-${crypto.randomUUID()}`
  )

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src', 'shared.ts'),
    [
      'export const preservePayload = true',
      'export const sharedGuard = () => preservePayload'
    ].join('\n')
  )

  return root
}

describe('model judge follow-up execution', () => {
  test('reruns judge with retrieved follow-up context and accumulates output', async () => {
    const root = await createTempRepo()

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: { maxReads: 1, maxSearches: 0 }
      })
      const judgeInputs: FindingJudgeInput[] = []
      const result = await executeJudgeFollowUpReview({
        workflowInput: workflowInput(),
        tasks: [task],
        candidate,
        sharedDigest: '(no admitted shared context yet)',
        evidence: [baseEvidence],
        reviewIntents: [reviewIntent],
        proofPackets: [proofPacket],
        refutationResults: [refutationResult],
        refutationEvidence: baseEvidence,
        judgeInput: createInitialJudgeInput(),
        judgeOutput: initialJudgeOutput,
        judgeFinding: async (judgeInput) => {
          judgeInputs.push(judgeInput)
          const followUpEvidence = judgeInput.evidence.find(
            (record) => record.source === 'context-retrieval'
          )

          return {
            verdict: 'valid',
            summary: 'The shared guard confirms the proof remains valid.',
            challengeQuestions: ['Does the shared guard preserve payload data?'],
            verificationChecks: [
              {
                kind: 'proof-review',
                result: 'passed',
                summary: 'The shared guard context was available.',
                evidenceIds: [followUpEvidence?.id ?? 'ev_judgebase']
              }
            ],
            evidenceIds: [followUpEvidence?.id ?? 'ev_judgebase'],
            contextRequests: [],
            requestedContext: []
          }
        },
        contextRetriever: retriever,
        contextArtifactCache: new Map(),
        providerIssueForError
      })

      expect(result.status).toBe('completed')
      if (result.status !== 'completed') {
        throw new Error('expected completed follow-up result')
      }
      expect(judgeInputs).toHaveLength(1)
      expect(retriever.budget()).toMatchObject({ usedReads: 1 })
      expect(result.judgeOutput.verdict).toBe('valid')
      expect(result.contextState.additionalEvidence).toEqual([
        expect.objectContaining({ source: 'context-retrieval' })
      ])
      expect(result.outputState.challengeQuestions).toEqual([
        'Does the shared guard preserve payload data?'
      ])
      expect(result.providerIssues).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('returns provider-error outcome when follow-up judge call fails', async () => {
    const root = await createTempRepo()

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: { maxReads: 1, maxSearches: 0 }
      })
      const result = await executeJudgeFollowUpReview({
        workflowInput: workflowInput(),
        tasks: [task],
        candidate,
        sharedDigest: '(no admitted shared context yet)',
        evidence: [baseEvidence],
        reviewIntents: [reviewIntent],
        proofPackets: [proofPacket],
        refutationResults: [refutationResult],
        refutationEvidence: baseEvidence,
        judgeInput: createInitialJudgeInput(),
        judgeOutput: initialJudgeOutput,
        judgeFinding: async () => {
          throw new Error('judge follow-up timeout')
        },
        contextRetriever: retriever,
        contextArtifactCache: new Map(),
        providerIssueForError
      })

      expect(result.status).toBe('provider-error')
      if (result.status !== 'provider-error') {
        throw new Error('expected provider-error follow-up result')
      }
      expect(result.outcome.evidence).toEqual([
        expect.objectContaining({ source: 'context-retrieval' })
      ])
      expect(result.outcome.providerIssues).toEqual([
        expect.objectContaining({
          code: 'provider_timeout',
          stage: 'judge-follow-up',
          recovered: true
        })
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
