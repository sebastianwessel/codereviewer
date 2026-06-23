import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type InvestigationTrace,
  type ProofPacket,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  FindingAggregateReviewInputSchema,
  FindingJudgeInputSchema,
  FindingRefutationInputSchema,
  IntentPlanningInputSchema,
  ModelReviewIntentPlanSchema,
  ModelFindingRefutationResultSchema,
  normalizeFindingRefutationResult,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import {
  runAggregateProofReviewProviderCall,
  runIntentPlanningProviderCall,
  runJudgeProviderCall,
  runRefutationProviderCall
} from './model-provider-call-adapters.js'
import { normalizeModelReviewIntentPlan } from './workflow-task-planning.js'

const configHash =
  '4444444444444444444444444444444444444444444444444444444444444444'

const task: WorkflowReviewTask = {
  id: 'task_provider',
  kind: 'file',
  round: 1,
  paths: ['src/provider.ts'],
  factIds: [],
  evidenceIds: ['ev_provider'],
  candidateIds: ['cand_provider'],
  contextEntryIds: [],
  objective: 'Review provider call adapters.',
  priority: 1,
  reviewContext: []
}

const candidate: CandidateFinding = {
  id: 'cand_provider',
  taskId: 'task_provider',
  category: 'bug',
  severity: 'high',
  title: 'Provider adapter path loses data',
  description: 'The changed provider adapter path can lose data.',
  location: {
    path: 'src/provider.ts',
    startLine: 12,
    side: 'new'
  },
  evidenceIds: ['ev_provider'],
  proposedBy: 'review-agent'
}

const evidence: EvidenceRecord = {
  id: 'ev_provider',
  kind: 'diff',
  summary: 'The changed provider path loses data.',
  location: {
    path: 'src/provider.ts',
    startLine: 12,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const proofPacket: ProofPacket = {
  id: 'proof_provider',
  suspicionId: 'susp_provider',
  candidateId: candidate.id,
  changedBehavior: 'The provider path loses data.',
  executionOrDataPath: 'The changed branch bypasses persistence.',
  violatedInvariant: 'Payload data must be preserved.',
  impact: 'Callers can lose data.',
  introducedByChange: 'The reviewed branch changed persistence behavior.',
  evidenceIds: [evidence.id],
  contradictionChecks: ['No alternate path preserves the payload.'],
  fixDirection: 'Persist the payload before returning.'
}

const refutationResult: RefutationResult = {
  id: 'ref_provider',
  proofPacketId: proofPacket.id,
  verdict: 'proved',
  summary: 'The proof is supported.',
  evidenceIds: [evidence.id],
  checks: [
    {
      kind: 'proof-review',
      result: 'passed',
      summary: 'No contradiction was found.',
      evidenceIds: [evidence.id]
    }
  ]
}

const investigationTrace: InvestigationTrace = {
  suspicionId: 'susp_provider',
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

const provenance = {
  reviewer: 'review-agent' as const,
  signalVersions: {},
  configHash
}

const createLogger = () => {
  const entries: Array<{
    message: string
    metadata?: Readonly<Record<string, unknown>>
  }> = []

  return {
    entries,
    logger: {
      debug: (
        message: string,
        metadata?: Readonly<Record<string, unknown>>
      ) => {
        entries.push({
          message,
          ...(metadata === undefined ? {} : { metadata })
        })
      }
    }
  }
}

describe('model provider call adapters', () => {
  test('logs and normalizes intent planning output', async () => {
    const { entries, logger } = createLogger()
    const planningInput = IntentPlanningInputSchema.parse({
      runId: 'run-provider-adapters',
      reviewedPaths: ['src/provider.ts'],
      reviewedDiffRanges: [],
      tasks: [
        {
          id: task.id,
          kind: task.kind,
          paths: task.paths,
          evidenceIds: task.evidenceIds,
          candidateIds: task.candidateIds,
          focusAreas: [],
          riskAreas: [],
          verificationQuestions: []
        }
      ],
      evidenceSummaries: [],
      candidateSummaries: []
    })

    const intents = await runIntentPlanningProviderCall({
      planningInput,
      tasks: [task],
      planReviewIntents: async () => ({
        intents: [
          {
            title: 'Verify provider adapter',
            objective: 'Verify the provider adapter end to end.',
            taskIds: [task.id],
            paths: ['src/provider.ts'],
            focusAreas: ['provider adapter'],
            riskAreas: ['data loss'],
            verificationQuestions: ['Does the adapter preserve data?']
          }
        ]
      }),
      logger
    })

    expect(intents).toHaveLength(1)
    expect(intents[0]?.source).toBe('model')
    expect(entries.map((entry) => entry.message)).toEqual([
      'Intent planning provider call started.',
      'Intent planning provider call completed.'
    ])
  })

  test('accepts common model intent-plan output variants before normalization', () => {
    const parsed = ModelReviewIntentPlanSchema.parse({
      reviewIntents: [
        {
          name: 'Verify provider adapter '.repeat(20),
          summary: 'Verify the provider adapter end to end. '.repeat(80),
          task_ids: task.id,
          filePaths: ['src/provider.ts'],
          focus: 'provider adapter',
          risks: ['data loss'],
          questions: ['Does the adapter preserve data?'.repeat(20)]
        }
      ]
    })

    const intents = normalizeModelReviewIntentPlan([task], parsed)

    expect(parsed.intents[0]?.title).toHaveLength(120)
    expect(parsed.intents[0]?.objective).toHaveLength(1200)
    expect(parsed.intents[0]?.verificationQuestions[0]).toHaveLength(240)
    expect(intents).toHaveLength(1)
    expect(intents[0]?.taskIds).toEqual([task.id])
  })

  test('logs and normalizes refutation output', async () => {
    const { entries, logger } = createLogger()
    const refutationInput = FindingRefutationInputSchema.parse({
      runId: 'run-provider-adapters',
      candidate,
      reviewedDiffRanges: [],
      evidence: [evidence],
      supportSignalCandidates: [],
      reviewContext: [],
      instructions: [],
      skills: [],
      sharedDigest: '(no admitted shared context yet)',
      provenance
    })

    const result = await runRefutationProviderCall({
      refutationInput,
      refuteFinding: async () => ({
        verdict: 'proved',
        rationaleSummary: 'The proof is still valid.'
      }),
      logger
    })

    expect(result.verdict).toBe('proved')
    expect(entries.map((entry) => entry.message)).toEqual([
      'Refutation check provider call started.',
      'Refutation check provider call completed.'
    ])
  })

  test('accepts common model refutation output variants before normalization', () => {
    const parsed = ModelFindingRefutationResultSchema.parse({
      decision: 'false_positive',
      summary: 'The finding is contradicted. '.repeat(80),
      suggestedFix: 'No code change is needed. '.repeat(80)
    })

    const normalized = normalizeFindingRefutationResult(parsed)

    expect(normalized.verdict).toBe('refuted')
    expect(normalized.rationaleSummary).toHaveLength(1200)
    expect(normalized.fixSummary).toHaveLength(1200)
  })

  test('logs aggregate proof review calls', async () => {
    const { entries, logger } = createLogger()
    const aggregateInput = FindingAggregateReviewInputSchema.parse({
      runId: 'run-provider-adapters',
      reviewIntents: [],
      candidates: [candidate],
      proofPackets: [proofPacket],
      refutationResults: [refutationResult],
      investigationTraces: [investigationTrace],
      evidence: [evidence],
      sharedDigest: '(no admitted shared context yet)',
      provenance
    })

    const result = await runAggregateProofReviewProviderCall({
      aggregateInput,
      aggregateFindingProofs: async () => ({
        verdict: 'valid',
        summary: 'The aggregate proof remains valid.',
        decisions: [],
        similarIssueChecks: [],
        evidenceIds: [evidence.id]
      }),
      logger
    })

    expect(result.verdict).toBe('valid')
    expect(entries.map((entry) => entry.message)).toEqual([
      'Aggregate proof review provider call started.',
      'Aggregate proof review provider call completed.'
    ])
  })

  test('logs judge calls', async () => {
    const { entries, logger } = createLogger()
    const judgeInput = FindingJudgeInputSchema.parse({
      runId: 'run-provider-adapters',
      candidate,
      reviewedDiffRanges: [],
      evidence: [evidence],
      reviewContext: [],
      reviewIntents: [],
      proofPackets: [proofPacket],
      refutationResults: [refutationResult],
      instructions: [],
      skills: [],
      sharedDigest: '(no admitted shared context yet)',
      provenance
    })

    const result = await runJudgeProviderCall({
      judgeInput,
      judgeFinding: async () => ({
        verdict: 'valid',
        summary: 'The finding is valid.',
        challengeQuestions: ['Is the path reachable?'],
        verificationChecks: [],
        evidenceIds: [evidence.id],
        contextRequests: [],
        requestedContext: []
      }),
      logger
    })

    expect(result.verdict).toBe('valid')
    expect(entries.map((entry) => entry.message)).toEqual([
      'Judge check provider call started.',
      'Judge check provider call completed.'
    ])
  })
})
