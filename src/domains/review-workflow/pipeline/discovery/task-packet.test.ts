import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../../../shared/contracts/index.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from '../contracts.js'
import { taskReviewInputFor } from './task-packet.js'
import { type WorkflowReviewTask } from '../agent-contracts.js'
import {
  isTaskPacketBudgetExceededError,
  serializedBytes
} from '../packet-budget.js'
import { normalizeError } from '../../../../shared/errors/error-normalizer.js'

const configHash =
  '2222222222222222222222222222222222222222222222222222222222222222'

const evidence: EvidenceRecord = {
  id: 'ev_diff1',
  kind: 'diff',
  summary: 'Changed line evidence.',
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const task: WorkflowReviewTask = {
  id: 'task_app1',
  round: 1,
  kind: 'file',
  paths: ['src/app.ts'],
  factIds: [],
  evidenceIds: ['ev_diff1'],
  candidateIds: [],
  contextEntryIds: ['ctx_aaaaaaaa'],
  instructions: [],
  reviewContext: [
    {
      kind: 'file',
      path: 'src/app.ts',
      content: 'export const value = 1',
      ledgerEntryId: 'ctx_aaaaaaaa'
    }
  ],
  priority: 0
}

const workflowInput = (): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-task-packet',
    reviewedPaths: ['src/app.ts'],
    reviewedDiffRanges: [
      {
        path: 'src/app.ts',
        startLine: 4,
        endLine: 4,
        changeKind: 'modified'
      }
    ],
    evidence: [evidence],
    candidates: [],
    skills: [],
    tasks: [task],
    maxTaskInputBytes: 10000,
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

describe('model task packet', () => {
  // The budget guards the packet a discovery call SENDS — `{taskId, paths,
  // reviewText}` — not the `TaskReviewInput` it is assembled from. The two are
  // different objects, and the fields below are on the assembly side only: no
  // discovery prompt renders the shared digest, the evidence records, the
  // candidates, the skills, or the provenance. Counting them was refusing tasks
  // over bytes that were never transmitted.
  test('counts only what a discovery call sends, not the assembly input', () => {
    const digest = 'large admitted digest '.repeat(700)
    const input = ReviewWorkflowInputSchema.parse({
      ...workflowInput(),
      // Well past the 10,000-byte budget on its own, and never sent.
      evidence: Array.from({ length: 40 }, (_, index) => ({
        ...evidence,
        id: `ev_diff${index}`,
        summary: `Changed line evidence. ${'padding '.repeat(50)}`
      })),
      tasks: [
        {
          ...task,
          evidenceIds: Array.from({ length: 40 }, (_, index) => `ev_diff${index}`)
        }
      ]
    })
    const scopedTask = input.tasks?.[0] as WorkflowReviewTask

    const packet = taskReviewInputFor(input, scopedTask, digest)

    expect(serializedBytes(packet)).toBeGreaterThan(10000)
    // Nothing was shed to get here: the digest survives verbatim, because
    // shedding it never removed a byte from any packet in the first place.
    expect(packet.sharedDigest).toBe(digest)
    expect(packet.evidence).toHaveLength(40)
  })

  // The inverse, and the reason the old measurement was a defect rather than a
  // conservative approximation: the unified diff is rendered into every discovery
  // prompt and appears nowhere in the `TaskReviewInput`. A task whose assembly
  // input is comfortably under budget can therefore send a packet far over it.
  test('refuses a packet the diff pushes over budget, which the task input never carried', () => {
    const diffBody = Array.from(
      { length: 400 },
      (_, index) => `+const generated${index} = ${index}`
    ).join('\n')
    const input = ReviewWorkflowInputSchema.parse({
      ...workflowInput(),
      reviewedDiffText: [
        'diff --git a/src/app.ts b/src/app.ts',
        '--- a/src/app.ts',
        '+++ b/src/app.ts',
        '@@ -1,1 +1,400 @@',
        diffBody
      ].join('\n')
    })

    // The same task without the diff is far inside the budget, so the refusal
    // below is caused by bytes the old measurement could not see at all.
    expect(
      serializedBytes(taskReviewInputFor(workflowInput(), task, 'digest'))
    ).toBeLessThan(10000)

    let thrown: unknown

    try {
      taskReviewInputFor(input, task, 'digest')
    } catch (error: unknown) {
      thrown = error
    }

    expect(isTaskPacketBudgetExceededError(thrown)).toBe(true)
    const details = normalizeError(thrown).details as {
      readonly serializedBytes: number
    }
    expect(details.serializedBytes).toBeGreaterThan(10000)
  })

  // Spec 04: the discovery packet carries THIS task's resolved instruction set
  // and nothing else. Two tasks in one run legitimately differ once an
  // instruction declares a `scope`, so a packet built from a run-wide list would
  // hand a task guidance that was scoped away from it.
  test('carries the reviewing task’s own instruction set, not a run-wide one', () => {
    const scoped = {
      ...task,
      id: 'task_scoped',
      instructions: [
        { path: 'BACKEND.md', content: 'Backend-only guidance.', allowed: true }
      ]
    }
    const input = ReviewWorkflowInputSchema.parse({
      ...workflowInput(),
      tasks: [task, scoped]
    })

    expect(taskReviewInputFor(input, scoped, 'digest').task.instructions).toEqual(
      scoped.instructions
    )
    expect(taskReviewInputFor(input, task, 'digest').task.instructions).toEqual([])
  })
})
