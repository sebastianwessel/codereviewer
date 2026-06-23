import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type ProofPacket,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  FindingJudgeInputSchema,
  type FindingJudgeInput
} from './model-agent-contracts.js'
import { judgeResultForModelOutput } from './model-judge-result.js'

const configHash =
  '1111111111111111111111111111111111111111111111111111111111111111'

const candidate: CandidateFinding = {
  id: 'cand_judgeresult',
  taskId: 'task_judgeresult',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch returns wrong value',
  description: 'The changed branch can return the wrong value.',
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  evidenceIds: ['ev_diff1'],
  proposedBy: 'review-agent'
}

const evidence = (id: string): EvidenceRecord => ({
  id,
  kind: 'diff',
  summary: 'Relevant changed code evidence.',
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  source: 'test',
  redactionApplied: true
})

const proofPacket: ProofPacket = {
  id: 'proof_judgeresult',
  suspicionId: 'susp_judgeresult',
  candidateId: 'cand_judgeresult',
  changedBehavior: 'The changed branch returns the intermediate value.',
  executionOrDataPath: 'The positive path now bypasses the expected value.',
  violatedInvariant: 'Positive input must return the expected value.',
  impact: 'Callers can receive stale data.',
  introducedByChange: 'The conditional branch changed in this diff.',
  evidenceIds: ['ev_diff1'],
  contradictionChecks: ['No guard restores the expected value.'],
  fixDirection: 'Return expectedValue for the positive path.'
}

const refutationResult: RefutationResult = {
  id: 'ref_judgeresult',
  proofPacketId: 'proof_judgeresult',
  verdict: 'proved',
  summary: 'The proof is supported.',
  evidenceIds: ['ev_refutation1'],
  checks: [
    {
      kind: 'proof-review',
      result: 'passed',
      summary: 'The refutation check found no contradiction.',
      evidenceIds: ['ev_refutation1']
    }
  ]
}

const judgeInput = (): FindingJudgeInput =>
  FindingJudgeInputSchema.parse({
    runId: 'run-judge-result',
    candidate,
    reviewedDiffRanges: [
      { path: 'src/app.ts', startLine: 1, endLine: 20 }
    ],
    evidence: [evidence('ev_diff1'), evidence('ev_refutation1')],
    reviewContext: [],
    reviewIntents: [],
    proofPackets: [proofPacket],
    refutationResults: [refutationResult],
    instructions: [],
    skills: [],
    sharedDigest: '(no admitted shared context yet)',
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

describe('model judge result', () => {
  test('filters judge evidence and verification checks to available evidence', () => {
    const result = judgeResultForModelOutput({
      candidate,
      judgeInput: judgeInput(),
      output: {
        verdict: 'valid',
        summary: 'The proof remains valid.',
        challengeQuestions: ['Does the changed branch return the right value?'],
        verificationChecks: [
          {
            kind: 'proof-review',
            result: 'passed',
            summary: 'The proof evidence supports the claim.',
            evidenceIds: ['ev_diff1', 'ev_missing1']
          }
        ],
        evidenceIds: ['ev_diff1', 'ev_refutation1', 'ev_missing1'],
        contextRequests: [],
        requestedContext: []
      }
    })

    expect(result).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^judge_[a-f0-9]{16}$/u),
        candidateId: 'cand_judgeresult',
        verdict: 'valid',
        proofPacketId: 'proof_judgeresult',
        refutationId: 'ref_judgeresult',
        evidenceIds: ['ev_diff1', 'ev_refutation1']
      })
    )
    expect(result.verificationChecks).toEqual([
      expect.objectContaining({
        evidenceIds: ['ev_diff1']
      })
    ])
  })

  test('demotes non-evidence judge approval to needs-more-evidence', () => {
    const result = judgeResultForModelOutput({
      candidate,
      judgeInput: judgeInput(),
      output: {
        verdict: 'valid',
        summary: 'The proof remains valid.',
        challengeQuestions: [],
        verificationChecks: [],
        evidenceIds: ['ev_missing1'],
        contextRequests: [],
        requestedContext: []
      }
    })

    expect(result).toEqual(
      expect.objectContaining({
        verdict: 'needs-more-evidence',
        evidenceIds: []
      })
    )
  })
})
