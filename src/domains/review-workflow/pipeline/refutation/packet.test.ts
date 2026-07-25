import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../../admission/index.js'
import {
  type ReviewContextDocument,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from '../contracts.js'
import { findingRefutationBatchInput } from './packet.js'
import { isTaskPacketBudgetExceededError } from '../discovery/task-packet.js'

const configHash =
  '1111111111111111111111111111111111111111111111111111111111111111'

const modelCandidate: CandidateFinding = {
  id: 'cand_bug1',
  taskId: 'task_app1',
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

// A second model candidate raised by the SAME task. Batched refutation adjudicates
// it in the same packet, so the packet must carry the union of the batch's evidence.
const secondModelCandidate: CandidateFinding = {
  ...modelCandidate,
  id: 'cand_bug2',
  title: 'Changed branch skips validation',
  description: 'The changed branch can skip validation.',
  location: {
    path: 'src/app.ts',
    startLine: 40,
    side: 'new'
  },
  evidenceIds: ['ev_other1']
}

const supportCandidate: CandidateFinding = {
  ...modelCandidate,
  id: 'cand_support1',
  proposedBy: 'deterministic-signal'
}

const unrelatedSamePathSupportCandidate: CandidateFinding = {
  ...supportCandidate,
  id: 'cand_support2',
  location: {
    path: 'src/app.ts',
    startLine: 40,
    side: 'new'
  },
  evidenceIds: ['ev_other2']
}

const evidence = (
  id: string,
  path = 'src/app.ts'
): EvidenceRecord => ({
  id,
  kind: 'diff',
  summary: `Evidence for ${path}.`,
  location: {
    path,
    startLine: 4,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
})

const reviewContext = (
  content = 'task context'
): ReviewContextDocument => ({
  kind: 'file',
  path: 'src/app.ts',
  content,
  ledgerEntryId: 'ctx_aaaaaaaa'
})

const task = (context: readonly ReviewContextDocument[]): WorkflowReviewTask => ({
  id: 'task_app1',
  round: 1,
  kind: 'file',
  paths: ['src/app.ts'],
  factIds: [],
  evidenceIds: ['ev_diff1'],
  candidateIds: ['cand_bug1'],
  contextEntryIds: context.map((entry) => entry.ledgerEntryId),
  reviewContext: [...context],
  priority: 0
})

const workflowInput = (
  input: {
    readonly maxTaskInputBytes?: number
    readonly instructions?: readonly { readonly content: string }[]
  } = {}
): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-refutation-packet',
    reviewedPaths: ['src/app.ts'],
    reviewedDiffRanges: [
      {
        path: 'src/app.ts',
        startLine: 4,
        endLine: 4
      }
    ],
    evidence: [evidence('ev_diff1'), evidence('ev_other1', 'src/other.ts')],
    candidates: [
      modelCandidate,
      supportCandidate,
      unrelatedSamePathSupportCandidate
    ],
    instructions: (input.instructions ?? []).map((instruction, index) => ({
      path: `AGENTS-${index}.md`,
      content: instruction.content,
      allowed: true
    })),
    skills: [],
    ...(input.maxTaskInputBytes === undefined
      ? {}
      : { maxTaskInputBytes: input.maxTaskInputBytes }),
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

describe('finding refutation packet', () => {
  test('keeps candidate-scoped evidence, support signals, and task context', () => {
    const context = reviewContext()
    const packet = findingRefutationBatchInput({
      workflowInput: workflowInput(),
      task: task([context]),
      candidates: [modelCandidate],
      allCandidates: [modelCandidate, supportCandidate],
      sharedDigest: '(no admitted shared context yet)'
    })

    expect(packet.input.evidence.map((record) => record.id)).toEqual([
      'ev_diff1'
    ])
    expect(packet.input.supportSignalCandidates).toEqual([supportCandidate])
    expect(packet.input.reviewContext).toEqual([context])
    expect(packet.input.reviewedDiffRanges).toEqual([
      {
        path: 'src/app.ts',
        startLine: 4,
        endLine: 4
      }
    ])
  })

  // The point of the batch packet: every candidate of the task rides along with a
  // SINGLE copy of the task context, and the evidence is the union of the batch.
  test('carries every batched candidate and the union of their evidence once', () => {
    const context = reviewContext()
    const packet = findingRefutationBatchInput({
      workflowInput: workflowInput(),
      task: task([context]),
      candidates: [modelCandidate, secondModelCandidate],
      allCandidates: [modelCandidate, secondModelCandidate, supportCandidate],
      sharedDigest: '(no admitted shared context yet)'
    })

    expect(packet.input.candidates.map((entry) => entry.id)).toEqual([
      'cand_bug1',
      'cand_bug2'
    ])
    expect(packet.input.evidence.map((record) => record.id)).toEqual([
      'ev_diff1',
      'ev_other1'
    ])
    expect(packet.input.reviewContext).toEqual([context])
  })

  test('drops unrelated same-file support signals from the refutation packet', () => {
    const packet = findingRefutationBatchInput({
      workflowInput: workflowInput(),
      task: task([]),
      candidates: [modelCandidate],
      allCandidates: [
        modelCandidate,
        supportCandidate,
        unrelatedSamePathSupportCandidate
      ],
      sharedDigest: '(no admitted shared context yet)'
    })

    expect(packet.input.supportSignalCandidates).toEqual([supportCandidate])
  })

  test('throws the shared packet budget error when the refutation packet is too large', () => {
    let thrown: unknown

    try {
      findingRefutationBatchInput({
        workflowInput: workflowInput({
          maxTaskInputBytes: 10000,
          instructions: [{ content: 'irreducible instruction '.repeat(800) }]
        }),
        task: task([]),
        candidates: [modelCandidate],
        allCandidates: [modelCandidate],
        sharedDigest: '(no admitted shared context yet)'
      })
    } catch (error: unknown) {
      thrown = error
    }

    expect(isTaskPacketBudgetExceededError(thrown)).toBe(true)
  })

  test('compacts optional digest and support-signal context before failing the packet budget', () => {
    const context = reviewContext('decisive context')
    const supportCandidates = Array.from({ length: 40 }, (_, index) => ({
      ...supportCandidate,
      id: `cand_support${index}`
    }))
    const packet = findingRefutationBatchInput({
      workflowInput: workflowInput({
        maxTaskInputBytes: 10000
      }),
      task: task([context]),
      candidates: [modelCandidate],
      allCandidates: [modelCandidate, ...supportCandidates],
      sharedDigest: 'large admitted digest '.repeat(700)
    })

    expect(packet.input.evidence.map((record) => record.id)).toEqual([
      'ev_diff1'
    ])
    expect(packet.input.reviewContext).toEqual([context])
    expect(packet.input.supportSignalCandidates).toEqual([])
    expect(packet.input.sharedDigest).toBe(
      '(shared digest omitted for refutation packet budget)'
    )
  })
})
