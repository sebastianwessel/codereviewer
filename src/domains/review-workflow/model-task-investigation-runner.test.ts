import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type ModelSuspicion
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  type FindingInvestigationInput,
  type FindingInvestigationResult,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { modelTaskInvestigationRunner } from './model-task-investigation-runner.js'

const configHash =
  '3333333333333333333333333333333333333333333333333333333333333333'

const evidence: EvidenceRecord = {
  id: 'ev_task1',
  kind: 'diff',
  summary: 'The changed branch can lose data.',
  location: {
    path: 'src/task.ts',
    startLine: 9,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const task: WorkflowReviewTask = {
  id: 'task_investigation',
  kind: 'file',
  round: 1,
  paths: ['src/task.ts'],
  factIds: [],
  evidenceIds: ['ev_task1'],
  candidateIds: [],
  contextEntryIds: [],
  priority: 1,
  reviewContext: [
    {
      kind: 'file',
      path: 'src/task.ts',
      content: 'export const changed = true\n',
      ledgerEntryId: 'ctx_abcd1234'
    }
  ]
}

const candidate: CandidateFinding = {
  id: 'cand_investigation',
  taskId: 'task_investigation',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch can lose data',
  description: 'The changed branch can lose data.',
  location: {
    path: 'src/task.ts',
    startLine: 9,
    side: 'file'
  },
  evidenceIds: ['ev_task1'],
  proposedBy: 'review-agent'
}

const suspicion: ModelSuspicion = {
  id: 'susp_investigation',
  taskId: 'task_investigation',
  category: 'bug',
  severityHint: 'high',
  title: 'Changed branch can lose data',
  hypothesis: 'The changed branch can lose data.',
  primaryLocation: candidate.location,
  contextRequests: [],
  requestedContext: [],
  evidenceIds: ['ev_task1'],
  status: 'investigating',
  proposedBy: 'review-agent'
}

const investigationInput: FindingInvestigationInput = {
  runId: 'run-investigation-runner',
  task,
  candidate,
  suspicion,
  proofQuestions: [],
  reviewedDiffRanges: [
    {
      path: 'src/task.ts',
      startLine: 1,
      endLine: 20
    }
  ],
  evidence: [evidence],
  reviewContext: task.reviewContext,
  instructions: [],
  skills: [],
  sharedDigest: '(no admitted shared context yet)',
  provenance: {
    reviewer: 'review-agent',
    signalVersions: {},
    configHash
  }
}

const provedResult: FindingInvestigationResult = {
  verdict: 'proved',
  rationaleSummary: 'The changed path is reachable and the evidence is exact.',
  evidenceIds: ['ev_task1'],
  contextRequests: [],
  requestedContext: [],
  changedBehavior: 'The changed branch loses data.',
  executionOrDataPath: 'The changed branch bypasses persistence.',
  violatedInvariant: 'Payload data must be preserved.',
  impact: 'Callers can lose data.',
  introducedByChange: 'The reviewed branch changed persistence behavior.',
  contradictionChecks: ['No alternate path preserves the payload.'],
  fixDirection: 'Persist the payload before returning.'
}

describe('model task investigation runner', () => {
  test('logs start and completion while forwarding signal and result', async () => {
    const logs: Array<{
      readonly message: string
      readonly metadata?: Readonly<Record<string, unknown>>
    }> = []
    const controller = new AbortController()
    const runner = modelTaskInvestigationRunner({
      logger: {
        debug: (message, metadata) =>
          logs.push(metadata === undefined ? { message } : { message, metadata })
      },
      investigateSuspicion: async (input, signal) => {
        expect(input).toBe(investigationInput)
        expect(signal).toBe(controller.signal)

        return provedResult
      }
    })

    await expect(
      runner(investigationInput, controller.signal)
    ).resolves.toBe(provedResult)
    expect(logs).toEqual([
      {
        message: 'Suspicion investigation provider call started.',
        metadata: {
          candidate_id: 'cand_investigation',
          suspicion_id: 'susp_investigation',
          path: 'src/task.ts',
          evidence_count: 1,
          context_count: 1
        }
      },
      {
        message: 'Suspicion investigation provider call completed.',
        metadata: {
          candidate_id: 'cand_investigation',
          suspicion_id: 'susp_investigation',
          verdict: 'proved'
        }
      }
    ])
  })
})
