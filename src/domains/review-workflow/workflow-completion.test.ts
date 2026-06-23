import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type FindingAggregateResult,
  type FindingJudgeResult,
  type ModelSuspicion,
  type ProofPacket,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type ContextLedgerEntry } from '../review-planning/index.js'
import { completeReviewWorkflow } from './workflow-completion.js'
import { ReviewWorkflowInputSchema } from './workflow-contracts.js'

const configHash =
  '5555555555555555555555555555555555555555555555555555555555555555'

const evidence: EvidenceRecord = {
  id: 'ev_completion1',
  kind: 'diff',
  summary: 'Changed line can lose data.',
  location: {
    path: 'src/completion.ts',
    startLine: 10,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const candidate: CandidateFinding = {
  id: 'cand_completion1',
  taskId: 'task_completion1',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch can lose data',
  description: 'The changed branch can lose data before persistence.',
  location: {
    path: 'src/completion.ts',
    startLine: 10,
    side: 'new'
  },
  evidenceIds: ['ev_completion1'],
  proposedBy: 'review-agent'
}

const contextLedgerEntry: ContextLedgerEntry = {
  id: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa',
  kind: 'file',
  path: 'src/completion.ts',
  taskId: 'task_completion1',
  decision: 'included',
  reason: 'context-retrieval-read',
  bytesConsidered: 120,
  bytesIncluded: 120
}

const modelSuspicion: ModelSuspicion = {
  id: 'susp_completion1',
  taskId: 'task_completion1',
  category: 'bug',
  severityHint: 'high',
  title: 'Changed branch can lose data',
  hypothesis: 'The changed branch can lose data before persistence.',
  primaryLocation: {
    path: 'src/completion.ts',
    startLine: 10,
    side: 'new'
  },
  contextRequests: [],
  requestedContext: [],
  evidenceIds: ['ev_completion1'],
  status: 'proved',
  proposedBy: 'review-agent'
}

const proofPacket: ProofPacket = {
  id: 'proof_completion1',
  suspicionId: 'susp_completion1',
  candidateId: 'cand_completion1',
  changedBehavior: 'The changed branch can lose data.',
  executionOrDataPath: 'The changed branch is reachable.',
  violatedInvariant: 'Persistence must retain data.',
  impact: 'A caller can lose data.',
  introducedByChange: 'The reviewed branch changed persistence behavior.',
  evidenceIds: ['ev_completion1'],
  contradictionChecks: ['No contradiction found.'],
  fixDirection: 'Preserve existing data before persistence.'
}

const refutationResult: RefutationResult = {
  id: 'refute_completion1',
  proofPacketId: 'proof_completion1',
  verdict: 'proved',
  summary: 'The proof survived refutation.',
  evidenceIds: ['ev_completion1'],
  checks: [
    {
      kind: 'proof-review',
      result: 'passed',
      summary: 'The proof evidence is sufficient.',
      evidenceIds: ['ev_completion1']
    }
  ]
}

const aggregateResult: FindingAggregateResult = {
  id: 'agg_completion1',
  scope: 'run',
  verdict: 'valid',
  summary: 'The aggregate proof remains valid.',
  candidateIds: ['cand_completion1'],
  evidenceIds: ['ev_completion1'],
  decisions: [
    {
      candidateId: 'cand_completion1',
      verdict: 'valid',
      summary: 'The candidate is valid.',
      evidenceIds: ['ev_completion1'],
      relatedCandidateIds: []
    }
  ],
  similarIssueChecks: []
}

const judgeResult: FindingJudgeResult = {
  id: 'judge_completion1',
  candidateId: 'cand_completion1',
  verdict: 'valid',
  summary: 'The judge accepted the proof.',
  challengeQuestions: ['Is the changed branch reachable?'],
  verificationChecks: [
    {
      kind: 'proof-review',
      result: 'passed',
      summary: 'The proof evidence is sufficient.',
      evidenceIds: ['ev_completion1']
    }
  ],
  contextRequests: [],
  requestedContext: [],
  evidenceIds: ['ev_completion1'],
  proofPacketId: 'proof_completion1',
  refutationId: 'refute_completion1'
}

const workflowInput = ReviewWorkflowInputSchema.parse({
  runId: 'run-completion',
  reviewedPaths: ['src/completion.ts'],
  reviewedDiffRanges: [
    { path: 'src/completion.ts', startLine: 1, endLine: 20 }
  ],
  evidence: [evidence],
  candidates: [candidate],
  instructions: [],
  skills: [],
  baselineConfigured: false,
  provenance: {
    reviewer: 'review-agent',
    signalVersions: {},
    configHash
  },
  qualityGate: {
    maxHigh: 0
  }
})

describe('workflow completion', () => {
  test('marks artifact-only admitted candidates before baseline and quality gate evaluation', () => {
    const output = completeReviewWorkflow({
      workflowInput,
      candidateFindings: [candidate],
      admissionCandidates: [candidate],
      artifactOnlyCandidateIds: ['cand_completion1'],
      modelSuspicions: [],
      investigationTraces: [],
      proofPackets: [],
      refutationResults: [],
      aggregateResults: [],
      reviewIntents: [],
      judgeResults: [],
      promotionDecisions: [],
      providerIssues: [],
      contextLedgerEntries: [],
      evidence: [evidence],
      preRejectedFindings: [],
      preAdmissionDecisions: [],
      taskEvents: [],
      instructionHashes: [configHash],
      skillHashes: []
    })

    expect(output.admittedFindings).toHaveLength(1)
    expect(output.admittedFindings[0]).toMatchObject({
      reporterEligibility: 'artifact-only',
      baselineStatus: 'new'
    })
    expect(output.admittedFindings[0]?.id).toMatch(/^find_[a-f0-9]+$/)
    expect(output.qualityGate.passed).toBe(true)
    expect(output.qualityGate.failingFindingIds).toEqual([])
    expect(output.admissionDecisions).toEqual([
      {
        candidateId: 'cand_completion1',
        status: 'admitted',
        findingId: output.admittedFindings[0]?.id
      }
    ])
  })

  test('deduplicates evidence records by id before admission and report output', () => {
    const output = completeReviewWorkflow({
      workflowInput,
      candidateFindings: [candidate],
      admissionCandidates: [candidate],
      artifactOnlyCandidateIds: [],
      modelSuspicions: [],
      investigationTraces: [],
      proofPackets: [],
      refutationResults: [],
      aggregateResults: [],
      reviewIntents: [],
      judgeResults: [],
      promotionDecisions: [],
      providerIssues: [],
      contextLedgerEntries: [],
      evidence: [evidence, { ...evidence, summary: 'Duplicate later copy.' }],
      preRejectedFindings: [],
      preAdmissionDecisions: [],
      taskEvents: [],
      instructionHashes: [configHash],
      skillHashes: []
    })

    expect(output.evidence.map((record) => record.id)).toEqual([
      'ev_completion1'
    ])
    expect(output.admittedFindings).toHaveLength(1)
  })

  test('deduplicates stable-id model artifacts before report output', () => {
    const output = completeReviewWorkflow({
      workflowInput,
      candidateFindings: [candidate],
      admissionCandidates: [candidate],
      artifactOnlyCandidateIds: [],
      modelSuspicions: [
        modelSuspicion,
        { ...modelSuspicion, hypothesis: 'Duplicate later suspicion.' }
      ],
      investigationTraces: [],
      proofPackets: [
        proofPacket,
        { ...proofPacket, changedBehavior: 'Duplicate later proof.' }
      ],
      refutationResults: [
        refutationResult,
        { ...refutationResult, summary: 'Duplicate later refutation.' }
      ],
      aggregateResults: [
        aggregateResult,
        { ...aggregateResult, summary: 'Duplicate later aggregate.' }
      ],
      reviewIntents: [],
      judgeResults: [
        judgeResult,
        { ...judgeResult, summary: 'Duplicate later judge.' }
      ],
      promotionDecisions: [],
      providerIssues: [],
      contextLedgerEntries: [],
      evidence: [evidence],
      preRejectedFindings: [],
      preAdmissionDecisions: [],
      taskEvents: [],
      instructionHashes: [configHash],
      skillHashes: []
    })

    expect(output.modelSuspicions.map((artifact) => artifact.id)).toEqual([
      'susp_completion1'
    ])
    expect(output.proofPackets.map((artifact) => artifact.id)).toEqual([
      'proof_completion1'
    ])
    expect(output.refutationResults.map((artifact) => artifact.id)).toEqual([
      'refute_completion1'
    ])
    expect(output.aggregateResults.map((artifact) => artifact.id)).toEqual([
      'agg_completion1'
    ])
    expect(output.judgeResults.map((artifact) => artifact.id)).toEqual([
      'judge_completion1'
    ])
    expect(output.modelSuspicions[0]?.hypothesis).toBe(
      'The changed branch can lose data before persistence.'
    )
  })

  test('deduplicates candidate findings by id before report output', () => {
    const output = completeReviewWorkflow({
      workflowInput,
      candidateFindings: [
        candidate,
        { ...candidate, title: 'Duplicate later candidate' }
      ],
      admissionCandidates: [candidate],
      artifactOnlyCandidateIds: [],
      modelSuspicions: [],
      investigationTraces: [],
      proofPackets: [],
      refutationResults: [],
      aggregateResults: [],
      reviewIntents: [],
      judgeResults: [],
      promotionDecisions: [],
      providerIssues: [],
      contextLedgerEntries: [],
      evidence: [evidence],
      preRejectedFindings: [],
      preAdmissionDecisions: [],
      taskEvents: [],
      instructionHashes: [configHash],
      skillHashes: []
    })

    expect(output.candidateFindings.map((finding) => finding.id)).toEqual([
      'cand_completion1'
    ])
    expect(output.candidateFindings[0]?.title).toBe(
      'Changed branch can lose data'
    )
  })

  test('deduplicates admission candidates by id before admission', () => {
    const output = completeReviewWorkflow({
      workflowInput,
      candidateFindings: [candidate],
      admissionCandidates: [
        candidate,
        { ...candidate, title: 'Duplicate later admission candidate' }
      ],
      artifactOnlyCandidateIds: [],
      modelSuspicions: [],
      investigationTraces: [],
      proofPackets: [],
      refutationResults: [],
      aggregateResults: [],
      reviewIntents: [],
      judgeResults: [],
      promotionDecisions: [],
      providerIssues: [],
      contextLedgerEntries: [],
      evidence: [evidence],
      preRejectedFindings: [],
      preAdmissionDecisions: [],
      taskEvents: [],
      instructionHashes: [configHash],
      skillHashes: []
    })

    expect(output.admittedFindings).toHaveLength(1)
    expect(output.rejectedFindings).toEqual([])
    expect(output.admissionDecisions).toEqual([
      {
        candidateId: 'cand_completion1',
        status: 'admitted',
        findingId: output.admittedFindings[0]?.id
      }
    ])
  })

  test('does not admit candidates with an existing rejected admission decision', () => {
    const output = completeReviewWorkflow({
      workflowInput,
      candidateFindings: [candidate],
      admissionCandidates: [candidate],
      artifactOnlyCandidateIds: [],
      modelSuspicions: [],
      investigationTraces: [],
      proofPackets: [],
      refutationResults: [],
      aggregateResults: [],
      reviewIntents: [],
      judgeResults: [],
      promotionDecisions: [],
      providerIssues: [],
      contextLedgerEntries: [],
      evidence: [evidence],
      preRejectedFindings: [
        {
          candidateId: 'cand_completion1',
          status: 'rejected',
          reason: 'refuted',
          message: 'The candidate was refuted before admission.',
          evidenceIds: ['ev_completion1']
        }
      ],
      preAdmissionDecisions: [
        {
          candidateId: 'cand_completion1',
          status: 'rejected',
          rejectedReason: 'refuted'
        }
      ],
      taskEvents: [],
      instructionHashes: [configHash],
      skillHashes: []
    })

    expect(output.admittedFindings).toEqual([])
    expect(output.rejectedFindings).toEqual([
      {
        candidateId: 'cand_completion1',
        status: 'rejected',
        reason: 'refuted',
        message: 'The candidate was refuted before admission.',
        evidenceIds: ['ev_completion1']
      }
    ])
    expect(output.admissionDecisions).toEqual([
      {
        candidateId: 'cand_completion1',
        status: 'rejected',
        rejectedReason: 'refuted'
      }
    ])
  })

  test('demotes proof-time promotion decisions for pre-admission rejected candidates', () => {
    const output = completeReviewWorkflow({
      workflowInput,
      candidateFindings: [candidate],
      admissionCandidates: [candidate],
      artifactOnlyCandidateIds: [],
      modelSuspicions: [],
      investigationTraces: [],
      proofPackets: [proofPacket],
      refutationResults: [
        {
          ...refutationResult,
          verdict: 'refuted',
          summary: 'The proof was refuted during active admission review.'
        }
      ],
      aggregateResults: [],
      reviewIntents: [],
      judgeResults: [],
      promotionDecisions: [
        {
          candidateId: 'cand_completion1',
          proofPacketId: 'proof_completion1',
          status: 'actionable',
          reason:
            'Proof artifacts were assembled before active admission refutation.',
          policy: 'promotion-policy-v1'
        }
      ],
      providerIssues: [],
      contextLedgerEntries: [],
      evidence: [evidence],
      preRejectedFindings: [
        {
          candidateId: 'cand_completion1',
          status: 'rejected',
          reason: 'refuted',
          message: 'The candidate was refuted before admission.',
          evidenceIds: ['ev_completion1']
        }
      ],
      preAdmissionDecisions: [
        {
          candidateId: 'cand_completion1',
          status: 'rejected',
          rejectedReason: 'refuted'
        }
      ],
      taskEvents: [],
      instructionHashes: [configHash],
      skillHashes: []
    })

    expect(output.admittedFindings).toEqual([])
    expect(output.promotionDecisions).toEqual([
      {
        candidateId: 'cand_completion1',
        proofPacketId: 'proof_completion1',
        refutationId: 'refute_completion1',
        status: 'rejected',
        reason: 'Final admission rejected this proof candidate: refuted.',
        policy: 'promotion-policy-v1'
      }
    ])
  })

  test('demotes proof-time promotion decisions for artifact-only refutation outcomes', () => {
    const output = completeReviewWorkflow({
      workflowInput,
      candidateFindings: [candidate],
      admissionCandidates: [candidate],
      artifactOnlyCandidateIds: ['cand_completion1'],
      modelSuspicions: [modelSuspicion],
      investigationTraces: [],
      proofPackets: [proofPacket],
      refutationResults: [
        {
          ...refutationResult,
          verdict: 'needs-more-evidence',
          summary:
            'The active refutation could not prove this candidate enough for inline admission.'
        }
      ],
      aggregateResults: [],
      reviewIntents: [],
      judgeResults: [],
      promotionDecisions: [
        {
          candidateId: 'cand_completion1',
          proofPacketId: 'proof_completion1',
          status: 'actionable',
          reason:
            'Proof artifacts were assembled before active admission refutation.',
          policy: 'promotion-policy-v1'
        }
      ],
      providerIssues: [],
      contextLedgerEntries: [contextLedgerEntry],
      evidence: [evidence],
      preRejectedFindings: [],
      preAdmissionDecisions: [],
      taskEvents: [],
      instructionHashes: [configHash],
      skillHashes: []
    })

    expect(output.admittedFindings).toEqual([
      expect.objectContaining({
        reporterEligibility: 'artifact-only'
      })
    ])
    expect(output.promotionDecisions).toEqual([
      {
        candidateId: 'cand_completion1',
        proofPacketId: 'proof_completion1',
        refutationId: 'refute_completion1',
        status: 'artifact-only',
        reason:
          'Final admission kept this proof candidate artifact-only: needs-more-evidence.',
        policy: 'promotion-policy-v1'
      }
    ])
  })

  test('deduplicates pre-admission rejection records by candidate id', () => {
    const rejectedFinding = {
      candidateId: 'cand_completion1',
      status: 'rejected' as const,
      reason: 'refuted' as const,
      message: 'The candidate was refuted before admission.',
      evidenceIds: ['ev_completion1']
    }
    const rejectedDecision = {
      candidateId: 'cand_completion1',
      status: 'rejected' as const,
      rejectedReason: 'refuted' as const
    }
    const output = completeReviewWorkflow({
      workflowInput,
      candidateFindings: [candidate],
      admissionCandidates: [],
      artifactOnlyCandidateIds: [],
      modelSuspicions: [],
      investigationTraces: [],
      proofPackets: [],
      refutationResults: [],
      aggregateResults: [],
      reviewIntents: [],
      judgeResults: [],
      promotionDecisions: [],
      providerIssues: [],
      contextLedgerEntries: [],
      evidence: [evidence],
      preRejectedFindings: [
        rejectedFinding,
        {
          ...rejectedFinding,
          message: 'Duplicate later rejection.'
        }
      ],
      preAdmissionDecisions: [rejectedDecision, rejectedDecision],
      taskEvents: [],
      instructionHashes: [configHash],
      skillHashes: []
    })

    expect(output.rejectedFindings).toEqual([rejectedFinding])
    expect(output.admissionDecisions).toEqual([rejectedDecision])
  })

  test('deduplicates identical provider issues before report output', () => {
    const output = completeReviewWorkflow({
      workflowInput,
      candidateFindings: [candidate],
      admissionCandidates: [candidate],
      artifactOnlyCandidateIds: [],
      modelSuspicions: [],
      investigationTraces: [],
      proofPackets: [],
      refutationResults: [],
      aggregateResults: [],
      reviewIntents: [],
      judgeResults: [],
      promotionDecisions: [],
      providerIssues: [
        {
          code: 'provider_timeout',
          stage: 'judge-finding',
          recovered: true,
          message: 'Provider timed out once.'
        },
        {
          code: 'provider_timeout',
          stage: 'judge-finding',
          recovered: true,
          message: 'Provider timed out once.'
        },
        {
          code: 'provider_timeout',
          stage: 'judge-follow-up',
          recovered: true,
          message: 'Provider timed out once.'
        }
      ],
      contextLedgerEntries: [],
      evidence: [evidence],
      preRejectedFindings: [],
      preAdmissionDecisions: [],
      taskEvents: [],
      instructionHashes: [configHash],
      skillHashes: []
    })

    expect(output.providerIssues).toEqual([
      {
        code: 'provider_timeout',
        stage: 'judge-finding',
        recovered: true,
        message: 'Provider timed out once.'
      },
      {
        code: 'provider_timeout',
        stage: 'judge-follow-up',
        recovered: true,
        message: 'Provider timed out once.'
      }
    ])
  })

  test('deduplicates context ledger entries by id before report output', () => {
    const output = completeReviewWorkflow({
      workflowInput,
      candidateFindings: [candidate],
      admissionCandidates: [candidate],
      artifactOnlyCandidateIds: [],
      modelSuspicions: [],
      investigationTraces: [],
      proofPackets: [],
      refutationResults: [],
      aggregateResults: [],
      reviewIntents: [],
      judgeResults: [],
      promotionDecisions: [],
      providerIssues: [],
      contextLedgerEntries: [
        contextLedgerEntry,
        {
          ...contextLedgerEntry,
          reason: 'duplicate later ledger entry'
        }
      ],
      evidence: [evidence],
      preRejectedFindings: [],
      preAdmissionDecisions: [],
      taskEvents: [],
      instructionHashes: [configHash],
      skillHashes: []
    })

    expect(output.contextLedgerEntries).toEqual([contextLedgerEntry])
  })
})
