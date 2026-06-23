import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type PromotionPolicyConfig
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  TaskReviewInputSchema,
  type FindingInvestigationInput,
  type FindingInvestigationResult,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { type SelectedModelTaskCandidates } from './model-task-candidate-selection.js'
import { runModelTaskPrimaryProof } from './model-task-primary-proof-runner.js'

const configHash =
  '9797979797979797979797979797979797979797979797979797979797979797'

const evidence: EvidenceRecord = {
  id: 'ev_primaryproof',
  kind: 'diff',
  summary: 'The primary branch can lose data.',
  location: {
    path: 'src/primary.ts',
    startLine: 21,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const task: WorkflowReviewTask = {
  id: 'task_primaryproof',
  kind: 'file',
  round: 1,
  paths: ['src/primary.ts'],
  factIds: [],
  evidenceIds: ['ev_primaryproof'],
  candidateIds: [],
  contextEntryIds: [],
  objective: 'Review primary changed branch.',
  priority: 1,
  reviewContext: [
    {
      kind: 'file',
      path: 'src/primary.ts',
      content: 'export const primary = true\n',
      ledgerEntryId: 'ctx_97979797'
    }
  ]
}

const taskInput = TaskReviewInputSchema.parse({
  runId: 'run-primary-proof',
  task,
  reviewIntents: [],
  reviewedDiffRanges: [{ path: 'src/primary.ts', startLine: 1, endLine: 30 }],
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

const candidate: CandidateFinding = {
  id: 'cand_primaryproof',
  taskId: task.id,
  category: 'bug',
  severity: 'high',
  title: 'Primary branch loses data',
  description: 'The primary branch bypasses persistence.',
  location: {
    path: 'src/primary.ts',
    startLine: 21,
    side: 'file'
  },
  evidenceIds: ['ev_primaryproof'],
  proposedBy: 'review-agent'
}

const selectedCandidates: SelectedModelTaskCandidates = {
  candidates: [candidate],
  convertedCandidateCount: 1,
  requestedInvestigationSlotCount: 1,
  reservedInvestigationSlotCount: 1,
  budgetDroppedCandidateCount: 0,
  contextRequestsByCandidateId: {
    cand_primaryproof: []
  },
  requestedContextByCandidateId: {
    cand_primaryproof: ['Confirm persistence behavior.']
  },
  droppedSuspicionReasons: {
    'schema-invalid': 0,
    'missing-required-field': 0,
    'path-outside-task': 0,
    'missing-task-evidence': 0,
    'duplicate-input-candidate': 0,
    'unsupported-truncation-claim': 0
  },
  schemaInvalidSuggestionIssueCounts: {}
}

const promotionPolicy: PromotionPolicyConfig = {
  modelProof: 'actionable',
  modelSuspicion: 'artifact-only',
  modelWeakOrRefuted: 'artifact-only',
  deterministicSignalOnly: 'artifact-only',
  staticAnalysisDuplicate: 'artifact-only',
  deterministicContradiction: 'rejected'
}

const provedInvestigation = (
  input: FindingInvestigationInput
): FindingInvestigationResult => ({
  verdict: 'proved',
  rationaleSummary: 'The primary branch is reachable and evidence is exact.',
  evidenceIds: input.evidence.map((record) => record.id),
  contextRequests: [],
  requestedContext: [],
  changedBehavior: 'The primary branch loses data.',
  executionOrDataPath: 'The primary branch bypasses persistence.',
  violatedInvariant: 'Payload data must be preserved.',
  impact: 'Callers can lose data.',
  introducedByChange: 'The reviewed branch changed persistence behavior.',
  contradictionChecks: ['No alternate path preserves the payload.'],
  fixDirection: 'Persist the payload before returning.'
})

describe('model task primary proof runner', () => {
  test('runs selected primary candidates through proof loop with instrumented investigation calls', async () => {
    const logs: Array<{
      readonly message: string
      readonly metadata?: Readonly<Record<string, unknown>>
    }> = []
    const controller = new AbortController()
    let forwardedSignal: AbortSignal | undefined

    const result = await runModelTaskPrimaryProof({
      taskInput,
      selectedCandidates,
      promotionPolicy,
      maxInvestigationRounds: 1,
      contextArtifactCache: new Map(),
      investigateSuspicion: async (input, signal) => {
        forwardedSignal = signal
        expect(input.candidate.id).toBe(candidate.id)

        return provedInvestigation(input)
      },
      logger: {
        debug: (message, metadata) =>
          logs.push(metadata === undefined ? { message } : { message, metadata })
      },
      signal: controller.signal
    })

    expect(forwardedSignal).toBe(controller.signal)
    expect(result.proofPackets).toHaveLength(1)
    expect(result.providerIssues).toEqual([])
    expect(logs).toEqual([
      {
        message: 'Suspicion investigation provider call started.',
        metadata: {
          candidate_id: 'cand_primaryproof',
          suspicion_id: expect.any(String),
          path: 'src/primary.ts',
          evidence_count: 1,
          context_count: 1
        }
      },
      {
        message: 'Suspicion investigation provider call completed.',
        metadata: {
          candidate_id: 'cand_primaryproof',
          suspicion_id: expect.any(String),
          verdict: 'proved'
        }
      }
    ])
  })
})
