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
  type ModelTaskSuggestions,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { runModelTaskSiblingProofSweep } from './model-task-sibling-proof-runner.js'
import { type SelectedModelTaskSiblingCandidates } from './model-task-sibling-selection.js'

const configHash =
  '9696969696969696969696969696969696969696969696969696969696969696'

const evidence: EvidenceRecord = {
  id: 'ev_siblingproof',
  kind: 'diff',
  summary: 'The sibling branch can lose data.',
  location: {
    path: 'src/sibling.ts',
    startLine: 18,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const task: WorkflowReviewTask = {
  id: 'task_siblingproof',
  kind: 'file',
  round: 2,
  paths: ['src/primary.ts', 'src/sibling.ts'],
  factIds: [],
  evidenceIds: ['ev_siblingproof'],
  candidateIds: [],
  contextEntryIds: [],
  objective: 'Review sibling branches.',
  priority: 1,
  reviewContext: [
    {
      kind: 'file',
      path: 'src/sibling.ts',
      content: 'export const sibling = true\n',
      ledgerEntryId: 'ctx_96969696'
    }
  ]
}

const taskInput = TaskReviewInputSchema.parse({
  runId: 'run-sibling-proof',
  task,
  reviewIntents: [],
  reviewedDiffRanges: [
    { path: 'src/primary.ts', startLine: 1, endLine: 30 },
    { path: 'src/sibling.ts', startLine: 1, endLine: 30 }
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

const candidate: CandidateFinding = {
  id: 'cand_siblingproof',
  taskId: task.id,
  category: 'bug',
  severity: 'high',
  title: 'Sibling branch loses data',
  description: 'The sibling branch bypasses persistence.',
  location: {
    path: 'src/sibling.ts',
    startLine: 18,
    side: 'file'
  },
  evidenceIds: ['ev_siblingproof'],
  proposedBy: 'review-agent'
}

const selectedSiblings: SelectedModelTaskSiblingCandidates = {
  candidates: [candidate],
  contextRequestsByCandidateId: {
    cand_siblingproof: []
  },
  requestedContextByCandidateId: {
    cand_siblingproof: ['Confirm persistence behavior.']
  },
  droppedSuspicionReasons: {
    'schema-invalid': 1,
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

const suggestions: ModelTaskSuggestions = {
  suspicions: [
    {
      category: 'bug',
      severity: 'high',
      title: 'Sibling branch loses data',
      description: 'The sibling branch bypasses persistence.',
      path: 'src/sibling.ts',
      startLine: 18,
      evidenceIds: ['ev_siblingproof']
    }
  ]
}

const provedInvestigation = (
  input: FindingInvestigationInput
): FindingInvestigationResult => ({
  verdict: 'proved',
  rationaleSummary: 'The sibling branch is reachable and evidence is exact.',
  evidenceIds: input.evidence.map((record) => record.id),
  contextRequests: [],
  requestedContext: [],
  changedBehavior: 'The sibling branch loses data.',
  executionOrDataPath: 'The sibling branch bypasses persistence.',
  violatedInvariant: 'Payload data must be preserved.',
  impact: 'Callers can lose data.',
  introducedByChange: 'The reviewed branch changed persistence behavior.',
  contradictionChecks: ['No alternate path preserves the payload.'],
  fixDirection: 'Persist the payload before returning.'
})

describe('model task sibling proof runner', () => {
  test('runs selected siblings through proof loop and logs completed sweep summary', async () => {
    const logs: Array<{
      readonly message: string
      readonly metadata?: Readonly<Record<string, unknown>>
    }> = []
    const investigatedCandidates: string[] = []

    const result = await runModelTaskSiblingProofSweep({
      taskInput,
      task,
      suggestions,
      selectedSiblings,
      promotionPolicy,
      maxInvestigationRounds: 1,
      contextArtifactCache: new Map(),
      investigateSuspicion: async (input) => {
        investigatedCandidates.push(input.candidate.id)

        return provedInvestigation(input)
      },
      logger: {
        debug: (message, metadata) =>
          logs.push(metadata === undefined ? { message } : { message, metadata })
      }
    })

    expect(investigatedCandidates).toEqual(['cand_siblingproof'])
    expect(result.candidates).toEqual([candidate])
    expect(result.proofPackets).toHaveLength(1)
    expect(result.providerIssues).toEqual([])
    expect(logs).toContainEqual({
      message: 'Sibling sweep provider call completed.',
      metadata: {
        task_id: 'task_siblingproof',
        suspicion_suggestion_count: 1,
        candidate_count: 1,
        proof_packet_count: 1,
        dropped_suspicion_reasons: selectedSiblings.droppedSuspicionReasons
      }
    })
  })
})
