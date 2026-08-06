// Spec 28 requirement 4: an oversized-context failure on a tool-enabled call MUST
// reduce the read budget and retry BEFORE the task is split. Splitting cannot help
// when the overflow came from a tool RESULT — each half would fetch the same file
// and overflow identically — so the ordering is the requirement, not an
// optimisation. Spec 26's split remains the fallback for a packet that is oversized
// on its own, which is the case with no reads to shrink.
import { describe, expect, test } from 'vitest'
import {
  TaskReviewInputSchema,
  type TaskReviewInput,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import type { RetrievalTools } from '../../../context-retrieval/index.js'
import { runWithCrossFileDiscoveryTools } from './cross-file-tools.js'
import { runDiscoveryCall } from './discovery-call.js'

const contextOverflow = (): Error =>
  Object.assign(new Error('provider rejected the request'), {
    reason: 'context_length_exceeded'
  })

const task: WorkflowReviewTask = {
  id: 'task_reads',
  round: 1,
  kind: 'file',
  paths: ['src/a.ts', 'src/b.ts'],
  factIds: [],
  evidenceIds: [],
  candidateIds: [],
  contextEntryIds: [],
  priority: 0,
  instructions: [],
  reviewContext: [
    {
      kind: 'file',
      path: 'src/a.ts',
      content: 'a\n',
      ledgerEntryId: 'ctx_0000000000000001'
    },
    {
      kind: 'file',
      path: 'src/b.ts',
      content: 'b\n',
      ledgerEntryId: 'ctx_0000000000000002'
    }
  ]
}

const taskInput: TaskReviewInput = TaskReviewInputSchema.parse({
  task,
  evidence: [],
  candidates: [],
  skills: [],
  sharedDigest: '',
  provenance: {
    reviewer: 'review-agent',
    modelProvider: 'openai',
    modelName: 'discovery-test',
    signalVersions: {},
    configHash: 'a'.repeat(64)
  }
})

// The scope carries tools only so it is the shape a tool-enabled lane installs;
// this test drives the failure policy, and the fake runner never calls a tool.
const unusedTools: RetrievalTools = {
  read: () => Promise.reject(new Error('no tool call is expected here')),
  list: () => Promise.reject(new Error('no tool call is expected here')),
  grep: () => Promise.reject(new Error('no tool call is expected here'))
}

// A scope whose reads can be narrowed a fixed number of times, then not at all —
// the shape `ContextRetriever.reduceReadBudget` has once it reaches its floor.
const scopeWithReductions = (available: number) => {
  let used = 0

  return {
    reductions: () => used,
    scope: {
      tools: unusedTools,
      reduceReadBudget: () => {
        if (used >= available) {
          return false
        }
        used += 1

        return true
      }
    }
  }
}

describe('runDiscoveryCall — oversized context', () => {
  test('narrows the reads and retries the WHOLE task before splitting it', async () => {
    const { scope, reductions } = scopeWithReductions(1)
    const seenTaskIds: string[] = []
    const result = await runWithCrossFileDiscoveryTools(scope, () =>
      runDiscoveryCall({
        runner: async (holisticInput) => {
          seenTaskIds.push(holisticInput.taskId)

          if (seenTaskIds.length === 1) {
            throw contextOverflow()
          }

          return { findings: [] }
        },
        taskInput,
        buildText: () => 'review text',
        signal: undefined,
        stage: 'holistic_review'
      })
    )

    expect(reductions()).toBe(1)
    // The retry is the SAME task, not two halves: a split here would review each
    // file against a fraction of the packet for no reason.
    expect(seenTaskIds).toEqual(['task_reads', 'task_reads'])
    expect(result.splitCount).toBe(0)
    expect(result.reviewedTasks.map((reviewed) => reviewed.id)).toEqual([
      'task_reads'
    ])
  })

  test('splits only once the reads cannot be narrowed any further', async () => {
    const { scope } = scopeWithReductions(0)
    const seenTaskIds: string[] = []
    const result = await runWithCrossFileDiscoveryTools(scope, () =>
      runDiscoveryCall({
        runner: async (holisticInput) => {
          seenTaskIds.push(holisticInput.taskId)

          if (seenTaskIds.length === 1) {
            throw contextOverflow()
          }

          return { findings: [] }
        },
        taskInput,
        buildText: () => 'review text',
        signal: undefined,
        stage: 'holistic_review'
      })
    )

    expect(result.splitCount).toBe(1)
    expect(seenTaskIds).toHaveLength(3)
    expect(seenTaskIds.slice(1)).not.toContain('task_reads')
  })
})
