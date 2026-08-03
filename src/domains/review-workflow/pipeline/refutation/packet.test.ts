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
import { isTaskPacketBudgetExceededError } from '../packet-budget.js'

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

    expect(packet.evidence.map((record) => record.id)).toEqual([
      'ev_diff1'
    ])
    expect(packet.supportSignalCandidates).toEqual([supportCandidate])
    expect(packet.reviewContext).toEqual([context])
    expect(packet.reviewedDiffRanges).toEqual([
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

    expect(packet.candidates.map((entry) => entry.id)).toEqual([
      'cand_bug1',
      'cand_bug2'
    ])
    expect(packet.evidence.map((record) => record.id)).toEqual([
      'ev_diff1',
      'ev_other1'
    ])
    expect(packet.reviewContext).toEqual([context])
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

    expect(packet.supportSignalCandidates).toEqual([supportCandidate])
  })

  // The packet reaches the provider as `JSON.stringify(input)` with Zod's
  // declaration key order, so the fields ahead of `reviewContext` ARE the prompt
  // prefix two refutation calls of one run share, and a provider caches only a
  // prefix it can match. Pinning the invariant here because it is invisible: a
  // per-task field moved or inserted above `reviewContext` breaks nothing a
  // functional test would notice, it just silently deletes the shared prefix.
  test('serializes every run-invariant field ahead of the first per-task field', () => {
    const input = workflowInput({
      instructions: [{ content: 'Repository review instructions.' }]
    })
    const firstBatch = JSON.stringify(
      findingRefutationBatchInput({
        workflowInput: input,
        task: task([reviewContext('first task context')]),
        candidates: [modelCandidate],
        allCandidates: [modelCandidate],
        sharedDigest: '(no admitted shared context yet)'
      })
    )
    const secondBatch = JSON.stringify(
      findingRefutationBatchInput({
        workflowInput: input,
        task: task([reviewContext('second task context')]),
        candidates: [secondModelCandidate],
        allCandidates: [secondModelCandidate],
        sharedDigest: '(no admitted shared context yet)'
      })
    )

    let sharedPrefixLength = 0
    while (
      sharedPrefixLength < firstBatch.length &&
      firstBatch[sharedPrefixLength] === secondBatch[sharedPrefixLength]
    ) {
      sharedPrefixLength += 1
    }
    const sharedPrefix = firstBatch.slice(0, sharedPrefixLength)

    // Provenance, instructions, skills, and the shared digest are constant for
    // every refutation call of a run and must all sit inside the shared prefix.
    expect(sharedPrefix).toContain('"provenance":')
    expect(sharedPrefix).toContain('Repository review instructions.')
    expect(sharedPrefix).toContain('"skills":')
    expect(sharedPrefix).toContain('"sharedDigest":')
    // The prefix reaches the first per-task field and stops inside it.
    expect(sharedPrefix).toContain('"reviewContext":')
    expect(sharedPrefix).not.toContain('first task context')
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

    expect(packet.evidence.map((record) => record.id)).toEqual([
      'ev_diff1'
    ])
    expect(packet.reviewContext).toEqual([context])
    expect(packet.supportSignalCandidates).toEqual([])
    // The support signals were shed, so the notice NAMES them. It used to say
    // only that the digest was gone, and the emptied array read to the refuter as
    // "there is no corroboration" rather than "it was withheld".
    expect(packet.sharedDigest).toContain('WITHHELD')
    expect(packet.sharedDigest).toContain('the shared digest')
    expect(packet.sharedDigest).toContain('the deterministic support signals')
    // And what the absence must NOT be read as. A candidate refuted because the
    // budget removed its support produces no output at all, so the mistake is
    // invisible downstream.
    expect(packet.sharedDigest).toContain('needs-more-evidence')
  })

  test('naming the withheld context is the last thing shed, not the first', () => {
    // Every rung of the ladder carries the notice, including the one that empties
    // the review context — the rung whose silence was most costly, because the
    // refuter's instructions treat review context as evidentiary.
    // Large enough that shedding the digest and the signals still does not fit,
    // so the ladder reaches its last rung. 10000 is the schema floor for the cap.
    const context = reviewContext('decisive context '.repeat(1200))
    const packet = findingRefutationBatchInput({
      workflowInput: workflowInput({ maxTaskInputBytes: 10000 }),
      task: task([context]),
      candidates: [modelCandidate],
      allCandidates: [modelCandidate],
      sharedDigest: 'large admitted digest '.repeat(700)
    })

    expect(packet.reviewContext).toEqual([])
    expect(packet.sharedDigest).toContain('the review context')
    expect(packet.sharedDigest).toContain('artefact of the budget')
  })
})
