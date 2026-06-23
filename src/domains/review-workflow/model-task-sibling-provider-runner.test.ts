import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type InvestigationTrace,
  type ModelSuspicion,
  type ProofPacket
} from '../../shared/contracts/index.js'
import {
  TaskReviewInputSchema,
  type ModelTaskSuggestions,
  type SiblingSweepInput,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { runModelTaskSiblingProviderSweep } from './model-task-sibling-provider-runner.js'

const configHash =
  '7474747474747474747474747474747474747474747474747474747474747474'

const evidence: EvidenceRecord = {
  id: 'ev_sibling',
  kind: 'diff',
  summary: 'The changed sibling path can lose data.',
  location: {
    path: 'src/sibling.ts',
    startLine: 12,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const task: WorkflowReviewTask = {
  id: 'task_siblingprovider',
  kind: 'file',
  round: 2,
  paths: ['src/primary.ts', 'src/sibling.ts'],
  factIds: [],
  evidenceIds: ['ev_sibling'],
  candidateIds: [],
  contextEntryIds: [],
  objective: 'Review changed sibling paths.',
  priority: 1,
  reviewContext: [
    {
      kind: 'file',
      path: 'src/sibling.ts',
      content: 'export const sibling = true\n',
      ledgerEntryId: 'ctx_74747474'
    }
  ]
}

const taskInput = TaskReviewInputSchema.parse({
  runId: 'run-sibling-provider',
  task,
  reviewIntents: [],
  reviewedDiffRanges: [
    { path: 'src/primary.ts', startLine: 1, endLine: 20 },
    { path: 'src/sibling.ts', startLine: 1, endLine: 20 }
  ],
  evidence: [evidence],
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

const proofPacket: ProofPacket = {
  id: 'proof_primary',
  suspicionId: 'susp_proved',
  candidateId: 'cand_primary',
  changedBehavior: 'The primary change loses data.',
  executionOrDataPath: 'The primary branch bypasses persistence.',
  violatedInvariant: 'Payload data must be preserved.',
  impact: 'Callers can lose data.',
  introducedByChange: 'The reviewed branch changed persistence behavior.',
  evidenceIds: ['ev_sibling'],
  contradictionChecks: ['No alternate path preserves the payload.'],
  fixDirection: 'Persist the payload before returning.'
}

const provedSuspicion: ModelSuspicion = {
  id: 'susp_proved',
  taskId: task.id,
  category: 'bug',
  severityHint: 'high',
  title: 'Primary path loses data',
  hypothesis: 'The primary changed path can lose data.',
  primaryLocation: {
    path: 'src/primary.ts',
    startLine: 12,
    side: 'file'
  },
  evidenceIds: ['ev_sibling'],
  contextRequests: [],
  requestedContext: [],
  status: 'proved',
  proposedBy: 'review-agent'
}

const weakSuspicion: ModelSuspicion = {
  ...provedSuspicion,
  id: 'susp_weak',
  status: 'needs-more-evidence'
}

const provedTrace: InvestigationTrace = {
  suspicionId: 'susp_proved',
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

const weakTrace: InvestigationTrace = {
  ...provedTrace,
  suspicionId: 'susp_weak',
  result: 'needs-more-evidence'
}

describe('model task sibling provider runner', () => {
  test('builds proof-scoped sibling sweep input and forwards signal', async () => {
    const logs: Array<{
      readonly message: string
      readonly metadata?: Readonly<Record<string, unknown>>
    }> = []
    const controller = new AbortController()
    const suggestions: ModelTaskSuggestions = { suspicions: [] }
    let providerInput: SiblingSweepInput | undefined
    let providerSignal: AbortSignal | undefined

    const result = await runModelTaskSiblingProviderSweep({
      taskInput,
      proofArtifacts: {
        proofPackets: [proofPacket],
        modelSuspicions: [provedSuspicion, weakSuspicion],
        investigationTraces: [provedTrace, weakTrace]
      },
      logger: {
        debug: (message, metadata) =>
          logs.push(metadata === undefined ? { message } : { message, metadata })
      },
      sweepSiblingSuspicions: async (input, signal) => {
        providerInput = input
        providerSignal = signal

        return suggestions
      },
      signal: controller.signal
    })

    expect(result).toEqual({ suggestions, providerIssues: [] })
    expect(providerSignal).toBe(controller.signal)
    expect(providerInput?.proofPackets).toEqual([proofPacket])
    expect(providerInput?.modelSuspicions).toEqual([provedSuspicion])
    expect(providerInput?.investigationTraces).toEqual([provedTrace])
    expect(logs).toEqual([
      {
        message: 'Sibling sweep provider call started.',
        metadata: {
          task_id: 'task_siblingprovider',
          proof_packet_count: 1,
          reviewed_diff_range_count: 2,
          path_count: 2
        }
      }
    ])
  })

  test('returns recovered provider issue when provider execution fails', async () => {
    const logs: Array<{
      readonly message: string
      readonly metadata?: Readonly<Record<string, unknown>>
    }> = []

    const result = await runModelTaskSiblingProviderSweep({
      taskInput,
      proofArtifacts: {
        proofPackets: [proofPacket],
        modelSuspicions: [provedSuspicion],
        investigationTraces: [provedTrace]
      },
      logger: {
        debug: (message, metadata) =>
          logs.push(metadata === undefined ? { message } : { message, metadata })
      },
      sweepSiblingSuspicions: async () => {
        throw new Error('sibling sweep timeout')
      }
    })

    expect(result.suggestions).toBeUndefined()
    expect(result.providerIssues).toEqual([
      expect.objectContaining({
        code: 'provider_error',
        stage: 'sibling-sweep',
        recovered: true,
        message: 'Sibling sweep failed.'
      })
    ])
    expect(logs).toContainEqual({
      message: 'Sibling sweep provider call failed.',
      metadata: {
        task_id: 'task_siblingprovider',
        error_code: 'provider_timeout'
      }
    })
  })
})
