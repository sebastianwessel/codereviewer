import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type InvestigationTrace,
  type ProofPacket,
  type RefutationResult,
  type ReviewIntent
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from './workflow-contracts.js'
import { runModelAggregateProviderReview } from './model-aggregate-provider-runner.js'

const configHash =
  '9999999999999999999999999999999999999999999999999999999999999999'

const candidateFor = (index: number): CandidateFinding => ({
  id: `cand_aggrunner${index}`,
  taskId: `task_aggrunner${index}`,
  category: 'bug',
  severity: 'high',
  title: `Changed branch ${index} loses data`,
  description: `The changed branch ${index} can lose data.`,
  location: {
    path: `src/aggrunner${index}.ts`,
    startLine: 7,
    side: 'new'
  },
  evidenceIds: [`ev_aggrunner${index}`],
  proposedBy: 'review-agent'
})

const evidenceFor = (index: number): EvidenceRecord => ({
  id: `ev_aggrunner${index}`,
  kind: 'diff',
  summary: `Changed branch ${index} loses data.`,
  location: {
    path: `src/aggrunner${index}.ts`,
    startLine: 7,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
})

const proofPacketFor = (index: number): ProofPacket => ({
  id: `proof_aggrunner${index}`,
  suspicionId: `susp_aggrunner${index}`,
  candidateId: `cand_aggrunner${index}`,
  changedBehavior: 'Changed branch can drop the payload.',
  executionOrDataPath: 'The updated path bypasses persistence.',
  violatedInvariant: 'Payloads must be persisted.',
  impact: 'Callers can lose data.',
  introducedByChange: 'The changed branch skips persistence.',
  evidenceIds: [`ev_aggrunner${index}`],
  contradictionChecks: ['No alternate persistence path restores the payload.'],
  fixDirection: 'Persist the payload before returning.'
})

const refutationFor = (index: number): RefutationResult => ({
  id: `ref_aggrunner${index}`,
  proofPacketId: `proof_aggrunner${index}`,
  verdict: 'proved',
  summary: 'The proof is supported.',
  evidenceIds: [`ev_aggrunner${index}`],
  checks: []
})

const investigationTrace: InvestigationTrace = {
  suspicionId: 'susp_aggrunner1',
  toolCalls: [],
  contextLedgerEntryIds: [],
  budget: {
    maxReads: 0,
    usedReads: 0,
    maxSearches: 0,
    usedSearches: 0,
    maxRounds: 1,
    usedRounds: 1
  },
  result: 'proof'
}

const reviewIntent: ReviewIntent = {
  id: 'intent_aggrunner',
  title: 'Verify aggregate behavior',
  objective: 'Verify related changed branches.',
  paths: ['src/aggrunner1.ts', 'src/aggrunner2.ts'],
  taskIds: ['task_aggrunner1', 'task_aggrunner2'],
  focusAreas: ['data persistence'],
  riskAreas: ['data loss'],
  verificationQuestions: ['Do changed branches persist payloads?'],
  source: 'model'
}

const workflowInput = (): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-aggregate-provider',
    reviewedPaths: ['src/aggrunner1.ts', 'src/aggrunner2.ts'],
    evidence: [evidenceFor(1), evidenceFor(2)],
    candidates: [candidateFor(1), candidateFor(2)],
    instructions: [],
    skills: [],
    judgeFindings: true,
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

const baseInput = {
  workflowInput: workflowInput(),
  candidates: [candidateFor(1), candidateFor(2)],
  sharedDigest: '(no admitted shared context yet)',
  reviewIntents: [reviewIntent],
  proofPackets: [proofPacketFor(1), proofPacketFor(2)],
  refutationResults: [refutationFor(1), refutationFor(2)],
  investigationTraces: [investigationTrace],
  evidence: [evidenceFor(1), evidenceFor(2)]
}

describe('model aggregate provider runner', () => {
  test('builds aggregate input, forwards signal, and normalizes provider output', async () => {
    const controller = new AbortController()
    let forwardedSignal: AbortSignal | undefined

    const result = await runModelAggregateProviderReview({
      ...baseInput,
      aggregateFindingProofs: async (_input, signal) => {
        forwardedSignal = signal

        return {
          verdict: 'mixed',
          summary: 'The first proof is valid and the second needs evidence.',
          evidenceIds: ['ev_aggrunner1'],
          decisions: [
            {
              candidateId: 'cand_aggrunner1',
              verdict: 'valid',
              summary: 'This proof is valid.',
              evidenceIds: ['ev_aggrunner1'],
              relatedCandidateIds: ['cand_aggrunner2']
            },
            {
              candidateId: 'cand_aggrunner2',
              verdict: 'needs-more-evidence',
              summary: 'This proof needs confirmation.',
              evidenceIds: ['ev_aggrunner2'],
              relatedCandidateIds: ['cand_aggrunner1']
            }
          ],
          similarIssueChecks: []
        }
      },
      signal: controller.signal
    })

    expect(forwardedSignal).toBe(controller.signal)
    expect(result.providerIssues).toEqual([])
    expect(result.aggregateResults).toHaveLength(1)
    expect(result.aggregateResults[0]?.candidateIds).toEqual([
      'cand_aggrunner1',
      'cand_aggrunner2'
    ])
    expect(
      result.aggregateResults[0]?.decisions.map((decision) => decision.verdict)
    ).toEqual(['valid', 'needs-more-evidence'])
  })

  test('returns recovered provider issue when aggregate provider fails', async () => {
    const result = await runModelAggregateProviderReview({
      ...baseInput,
      aggregateFindingProofs: async () => {
        throw new Error('aggregate timeout')
      }
    })

    expect(result.aggregateResults).toEqual([])
    expect(result.providerIssues).toEqual([
      expect.objectContaining({
        code: 'provider_timeout',
        stage: 'aggregate-proof-review',
        recovered: true
      })
    ])
  })
})
