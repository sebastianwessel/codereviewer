import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type InvestigationTrace,
  type ModelSuspicion,
  type ProofPacket,
  type PromotionPolicyConfig
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  TaskReviewInputSchema,
  type FindingInvestigationInput,
  type FindingInvestigationResult,
  type ModelTaskSuggestions,
  type SiblingSweepInput,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { runModelTaskSiblingSweep } from './model-task-sibling-sweep.js'

const configHash =
  '6767676767676767676767676767676767676767676767676767676767676767'

const taskEvidence = (index: number): EvidenceRecord => ({
  id: `ev_task${index}`,
  kind: 'diff',
  summary: `Changed branch ${index} can lose data.`,
  location: {
    path: `src/task${index}.ts`,
    startLine: 9,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
})

const task: WorkflowReviewTask = {
  id: 'task_siblingsweep',
  kind: 'file',
  round: 1,
  paths: ['src/task1.ts', 'src/task2.ts'],
  factIds: [],
  evidenceIds: ['ev_task1', 'ev_task2'],
  candidateIds: [],
  contextEntryIds: [],
  objective: 'Review changed sibling task files.',
  priority: 1,
  reviewContext: [
    {
      kind: 'file',
      path: 'src/task1.ts',
      content: 'export const first = true\n',
      ledgerEntryId: 'ctx_abababab'
    },
    {
      kind: 'file',
      path: 'src/task2.ts',
      content: 'export const second = true\n',
      ledgerEntryId: 'ctx_cdcdcdcd'
    }
  ]
}

const taskInput = TaskReviewInputSchema.parse({
  runId: 'run-sibling-sweep',
  task,
  reviewIntents: [],
  reviewedDiffRanges: [
    { path: 'src/task1.ts', startLine: 1, endLine: 20 },
    { path: 'src/task2.ts', startLine: 1, endLine: 20 }
  ],
  evidence: [taskEvidence(1), taskEvidence(2)],
  candidates: [],
  instructions: [],
  skills: [],
  sharedDigest: '(no admitted shared context yet)',
  provenance: {
    reviewer: 'review-agent',
    signalVersions: {},
    configHash
  }
})

const promotionPolicy: PromotionPolicyConfig = {
  modelProof: 'actionable',
  modelSuspicion: 'artifact-only',
  modelWeakOrRefuted: 'artifact-only',
  deterministicSignalOnly: 'artifact-only',
  staticAnalysisDuplicate: 'artifact-only',
  deterministicContradiction: 'rejected'
}

const candidateFor = (index: number): CandidateFinding => ({
  id: `cand_task${index}`,
  taskId: task.id,
  category: 'bug',
  severity: 'high',
  title: `Changed branch ${index} loses data`,
  description: `The changed branch ${index} can lose data.`,
  location: {
    path: `src/task${index}.ts`,
    startLine: 9,
    side: 'file'
  },
  evidenceIds: [`ev_task${index}`],
  proposedBy: 'review-agent'
})

const suspicionFor = (
  index: number
): ModelTaskSuggestions['suspicions'][number] => ({
  category: 'bug',
  severity: 'high',
  title: `Sibling branch ${index} loses data`,
  description: `The sibling branch ${index} can lose data.`,
  path: `src/task${index}.ts`,
  startLine: 9,
  evidenceIds: [`ev_task${index}`],
  contextRequests: [],
  requestedContext: []
})

const provedInvestigation = (
  input: FindingInvestigationInput
): FindingInvestigationResult => ({
  verdict: 'proved',
  rationaleSummary: 'The sibling branch is reachable and evidence is exact.',
  evidenceIds: input.evidence.map((record) => record.id),
  contextRequests: [],
  requestedContext: [],
  changedBehavior: 'The changed branch loses data.',
  executionOrDataPath: 'The changed branch bypasses persistence.',
  violatedInvariant: 'Payload data must be preserved.',
  impact: 'Callers can lose data.',
  introducedByChange: 'The reviewed branch changed persistence behavior.',
  contradictionChecks: ['No alternate path preserves the payload.'],
  fixDirection: 'Persist the payload before returning.'
})

const primaryProofArtifacts = (): {
  readonly proofPackets: readonly ProofPacket[]
  readonly modelSuspicions: readonly ModelSuspicion[]
  readonly investigationTraces: readonly InvestigationTrace[]
} => ({
  proofPackets: [
    {
      id: 'proof_primary',
      suspicionId: 'susp_primary',
      candidateId: 'cand_task1',
      changedBehavior: 'The changed primary branch loses data.',
      executionOrDataPath: 'The primary branch bypasses persistence.',
      violatedInvariant: 'Payload data must be preserved.',
      impact: 'Callers can lose data.',
      introducedByChange: 'The reviewed branch changed persistence behavior.',
      evidenceIds: ['ev_task1'],
      contradictionChecks: ['No alternate path preserves the payload.'],
      fixDirection: 'Persist the payload before returning.'
    }
  ],
  modelSuspicions: [
    {
      id: 'susp_primary',
      taskId: task.id,
      category: 'bug',
      severityHint: 'high',
      title: 'Primary branch loses data',
      hypothesis: 'The primary branch can lose data.',
      primaryLocation: {
        path: 'src/task1.ts',
        startLine: 9,
        side: 'file'
      },
      contextRequests: [],
      requestedContext: [],
      evidenceIds: ['ev_task1'],
      status: 'proved',
      proposedBy: 'review-agent'
    }
  ],
  investigationTraces: [
    {
      suspicionId: 'susp_primary',
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
  ]
})

const logger = {
  debug: () => undefined
}

describe('model task sibling sweep helper', () => {
  test('deduplicates sibling candidates and applies remaining investigation slots before proof work', async () => {
    const investigationPaths: string[] = []
    const result = await runModelTaskSiblingSweep({
      taskInput,
      task,
      judgeFindings: true,
      maxSuspicionsPerTask: 2,
      promotionPolicy,
      maxInvestigationRounds: 1,
      primaryCandidates: [candidateFor(1)],
      proofArtifacts: primaryProofArtifacts(),
      contextArtifactCache: new Map(),
      reserveModelInvestigationSlots: (requested) => Math.min(1, requested),
      sweepSiblingSuspicions: async () => ({
        suspicions: [suspicionFor(2), suspicionFor(2)]
      }),
      investigateSuspicion: async (input) => {
        investigationPaths.push(input.candidate.location.path)

        return provedInvestigation(input)
      },
      logger
    })

    expect(investigationPaths).toEqual(['src/task2.ts'])
    expect(result.candidates.map((candidate) => candidate.location.path)).toEqual([
      'src/task2.ts'
    ])
    expect(result.proofPackets).toHaveLength(1)
    expect(result.providerIssues).toEqual([])
  })

  test('returns recovered provider issue when sibling sweep provider fails', async () => {
    let siblingSweepInput: SiblingSweepInput | undefined
    const result = await runModelTaskSiblingSweep({
      taskInput,
      task,
      judgeFindings: true,
      promotionPolicy,
      maxInvestigationRounds: 1,
      primaryCandidates: [candidateFor(1)],
      proofArtifacts: primaryProofArtifacts(),
      contextArtifactCache: new Map(),
      reserveModelInvestigationSlots: (requested) => requested,
      sweepSiblingSuspicions: async (input) => {
        siblingSweepInput = input
        throw new Error('sibling sweep timeout')
      },
      investigateSuspicion: async (input) => provedInvestigation(input),
      logger
    })

    expect(siblingSweepInput?.proofPackets).toHaveLength(1)
    expect(siblingSweepInput?.modelSuspicions).toEqual([
      expect.objectContaining({ id: 'susp_primary', status: 'proved' })
    ])
    expect(result.candidates).toEqual([])
    expect(result.providerIssues).toEqual([
      expect.objectContaining({
        code: 'provider_error',
        stage: 'sibling-sweep',
        recovered: true
      })
    ])
  })
})
