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
      },
      budgetExhausted: () => false
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
    // ...and the run must still be able to say that it happened. `splitCount: 0`
    // above is the whole point: before this counter, a call that narrowed its own
    // reads returned a result identical to a first-attempt success, so the run-level
    // `contextOverflowSplitCount` stayed 0 and a strained run was indistinguishable
    // from one that never strained.
    expect(result.readBudgetReductionCount).toBe(1)
    expect(result.reviewedTasks.map((reviewed) => reviewed.id)).toEqual([
      'task_reads'
    ])
  })

  test('counts every reduction when the provider refuses more than once', async () => {
    // The reduction is not free and not local: it halves `maxBytesPerRead` on the
    // ONE run-wide retriever, so a task that reduces twice leaves every later task —
    // including tasks already in flight — reading a quarter of what the first ones
    // did, and nothing restores it. One reduction and three are different runs.
    const { scope, reductions } = scopeWithReductions(3)
    let attempts = 0
    const result = await runWithCrossFileDiscoveryTools(scope, () =>
      runDiscoveryCall({
        runner: async () => {
          attempts += 1

          if (attempts <= 2) {
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

    expect(reductions()).toBe(2)
    expect(result.readBudgetReductionCount).toBe(2)
    expect(result.splitCount).toBe(0)
  })

  test('a call that never overflowed reports no reduction', async () => {
    // The counterweight: the counter has to stay 0 on an ordinary call, or the
    // report cannot distinguish the strained run from the quiet one in either
    // direction.
    const { scope } = scopeWithReductions(3)
    const result = await runWithCrossFileDiscoveryTools(scope, () =>
      runDiscoveryCall({
        runner: async () => ({ findings: [] }),
        taskInput,
        buildText: () => 'review text',
        signal: undefined,
        stage: 'holistic_review'
      })
    )

    expect(result.readBudgetReductionCount).toBe(0)
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

// Spec 05, *Truncated Discovery Responses* (2026-08-17). A response the provider
// stopped at the output-token ceiling is a property of ONE model response, so it
// costs that response and nothing more — the same disposition the policy already
// gives malformed structured-object JSON, which is what the SAME provider event
// looks like when the cut lands mid-token instead of after a complete array element.
describe('runDiscoveryCall — truncated output', () => {
  // The shape `guardTruncatedProviderOutput` throws: a plain structured error
  // object, deliberately not an `Error`, so the harness's retry classification
  // cannot buy three identical truncations at three times the price.
  const truncated = (): unknown => ({
    code: 'provider_output_truncated',
    message: 'Model stopped at the output-token limit.',
    category: 'provider',
    recoverable: true,
    exitCode: 4,
    details: {}
  })

  test('costs one call instead of failing the run, and is not reported as recovered', async () => {
    const result = await runDiscoveryCall({
      runner: async () => {
        throw truncated()
      },
      taskInput,
      buildText: () => 'review text',
      signal: undefined,
      stage: 'holistic_review'
    })

    expect(result.findings).toEqual([])
    expect(result.providerIssues).toHaveLength(1)
    expect(result.providerIssues[0]?.code).toBe('provider_output_truncated')
    // NOT recovered. The quality gate fails on an unrecovered provider issue under
    // the default `failOnProviderError`, which is the whole safety argument for not
    // failing the run: the gate declines to certify a partial review rather than the
    // process dying with every other task's findings in hand. `recovered: true`
    // would let a truncated review read as a clean one.
    expect(result.providerIssues[0]?.recovered).toBe(false)
    // A call WAS issued and yielded nothing; dropping it from the denominator would
    // inflate findings-per-call exactly when the provider is degrading.
    expect(result.rawFindingsPerCall).toEqual([0])
    expect(result.splitCount).toBe(0)
  })

  test('finds the truncation through a wrapping agent-loop error', async () => {
    // Discovery runs inside an agent loop that may rewrap what it catches, so a
    // predicate reading only the top-level error would let a wrapped truncation
    // propagate and fail the run.
    const result = await runDiscoveryCall({
      runner: async () => {
        throw new Error('agent step failed', { cause: truncated() })
      },
      taskInput,
      buildText: () => 'review text',
      signal: undefined,
      stage: 'holistic_review'
    })

    expect(result.providerIssues[0]?.code).toBe('provider_output_truncated')
    expect(result.providerIssues[0]?.recovered).toBe(false)
  })

  test('a genuine provider failure still propagates', async () => {
    // The counterweight. This policy names four failures; everything else fails the
    // task and the run, because a hard provider failure is a property of the RUN and
    // continuing would review the rest of the change against a broken provider.
    await expect(
      runDiscoveryCall({
        runner: async () => {
          throw new Error('401 invalid api key')
        },
        taskInput,
        buildText: () => 'review text',
        signal: undefined,
        stage: 'holistic_review'
      })
    ).rejects.toThrow('401 invalid api key')
  })
})
