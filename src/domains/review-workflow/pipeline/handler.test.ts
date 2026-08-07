import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../admission/index.js'
import { createNoopReviewLogger } from '../../observability/index.js'
import { type ContextRetriever } from '../../context-retrieval/index.js'
import { TaskReviewResultSchema } from './agent-contracts.js'
import { runReviewWorkflowHandler } from './handler.js'
import { ReviewWorkflowInputSchema } from './contracts.js'

const configHash =
  '6666666666666666666666666666666666666666666666666666666666666666'

const evidence: EvidenceRecord = {
  id: 'ev_handler1',
  kind: 'diff',
  summary: 'Changed branch returns stale state.',
  location: {
    path: 'src/handler.ts',
    startLine: 12,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const candidate: CandidateFinding = {
  id: 'cand_handler1',
  taskId: 'task_handler1',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch returns stale state',
  description: 'The changed branch can return stale state to the caller.',
  location: {
    path: 'src/handler.ts',
    startLine: 12,
    side: 'new'
  },
  evidenceIds: ['ev_handler1'],
  proposedBy: 'review-agent'
}

const workflowInput = ReviewWorkflowInputSchema.parse({
  runId: 'run-handler',
  reviewedPaths: ['src/handler.ts'],
  reviewedDiffRanges: [
    { path: 'src/handler.ts', startLine: 1, endLine: 20 }
  ],
  evidence: [evidence],
  candidates: [],
  skills: [],
  baselineConfigured: false,
  provenance: {
    reviewer: 'review-agent',
    signalVersions: {},
    configHash
  },
  qualityGate: {
    maxHigh: 1
  }
})

describe('workflow handler', () => {
  test('runs task results through shared completion without harness builder wiring', async () => {
    let observedTaskPaths: readonly string[] = []
    let observedSharedDigest = ''

    const output = await runReviewWorkflowHandler({
      input: workflowInput,
      signal: undefined,
      logger: createNoopReviewLogger(),
      maxConcurrentTasks: 1,
      runTask: async (taskInput, task) => {
        observedTaskPaths = task.paths
        observedSharedDigest = taskInput.sharedDigest

        return TaskReviewResultSchema.parse({
          candidates: [candidate]
        })
      }
    })

    expect(observedTaskPaths).toEqual(['src/handler.ts'])
    expect(observedSharedDigest).toContain('(no admitted shared context yet)')
    expect(output.candidateFindings).toEqual([candidate])
    expect(output.admittedFindings).toHaveLength(1)
    expect(output.admittedFindings[0]).toMatchObject({
      title: 'Changed branch returns stale state',
      baselineStatus: 'new'
    })
    expect(output.qualityGate.passed).toBe(true)
    expect(output.taskEvents.map((event) => event.state)).toEqual([
      'planned',
      'running',
      'completed'
    ])
  })

  test('runs discovered candidates through refutation before admission', async () => {
    const proofEvidence: EvidenceRecord = {
      id: 'ev_taskproofhandler',
      kind: 'model-rationale',
      summary: 'Investigation proved the changed branch is reachable.',
      location: {
        path: 'src/handler.ts',
        startLine: 12,
        side: 'new'
      },
      source: 'model-investigation',
      redactionApplied: true
    }

    const output = await runReviewWorkflowHandler({
      input: workflowInput,
      signal: undefined,
      logger: createNoopReviewLogger(),
      maxConcurrentTasks: 1,
      runTask: async () =>
        TaskReviewResultSchema.parse({
          candidates: [
            {
              ...candidate,
              evidenceIds: ['ev_handler1', proofEvidence.id]
            }
          ],
          evidenceRecords: [proofEvidence]
        }),
      refuteFinding: async (refutationInput) => ({
        verdicts: refutationInput.candidates.map((batched) => ({
          candidateId: batched.id,
          verdict: 'proved',
          rationaleSummary: 'The active admission critic proved the claim.',
          fixSummary: 'Return the freshly computed state.'
        }))
      })
    })

    expect(output.candidateFindings).toHaveLength(1)
    expect(output.admittedFindings).toHaveLength(1)
    expect(output.admittedFindings[0]).toMatchObject({
      title: 'Changed branch returns stale state'
    })
  })

  test('keeps a merged-away candidate out of refutation and admission, but on the record', async () => {
    const mergedAway: CandidateFinding = {
      ...candidate,
      id: 'cand_handler2',
      title: 'The same defect, stated again one line down',
      location: { ...candidate.location, startLine: 13 }
    }
    const refutedCandidateIds: string[] = []

    const output = await runReviewWorkflowHandler({
      input: workflowInput,
      signal: undefined,
      logger: createNoopReviewLogger(),
      maxConcurrentTasks: 1,
      // A task result as the semantic finding merge leaves it: both candidates
      // on the record, the non-representative one already terminal.
      runTask: async () =>
        TaskReviewResultSchema.parse({
          candidates: [candidate, mergedAway],
          rejectedFindings: [
            {
              candidateId: mergedAway.id,
              status: 'rejected',
              reason: 'duplicate',
              message: `Merged into candidate ${candidate.id}.`,
              severity: mergedAway.severity
            }
          ]
        }),
      refuteFinding: async (refutationInput) => {
        refutedCandidateIds.push(
          ...refutationInput.candidates.map((batched) => batched.id)
        )

        return {
          verdicts: refutationInput.candidates.map((batched) => ({
            candidateId: batched.id,
            verdict: 'proved',
            rationaleSummary: 'The active admission critic proved the claim.'
          }))
        }
      }
    })

    // A candidate already known to be terminal must not spend an adjudication
    // slot, and the group yields exactly one admitted finding.
    expect(refutedCandidateIds).toEqual([candidate.id])
    expect(output.admittedFindings).toHaveLength(1)
    // It is recorded, not silently dropped: still a candidate of the run, and
    // carrying a duplicate rejection that names what it was merged into.
    expect(output.candidateFindings.map((entry) => entry.id)).toEqual([
      candidate.id,
      mergedAway.id
    ])
    expect(
      output.rejectedFindings.filter((finding) => finding.reason === 'duplicate')
    ).toMatchObject([{ candidateId: mergedAway.id }])
  })

  test('carries each task’s discovery telemetry into the workflow output, summed and per task', async () => {
    // Spec 27. The handler is the only place the per-task counters can be summed,
    // and nothing downstream can recompute them: refutation and admission see what
    // survived discovery, never what discovery produced.
    const output = await runReviewWorkflowHandler({
      input: workflowInput,
      signal: undefined,
      logger: createNoopReviewLogger(),
      maxConcurrentTasks: 1,
      runTask: async (_taskInput, task) =>
        TaskReviewResultSchema.parse({
          candidates: [candidate],
          discovery: {
            taskId: task.id,
            callCount: 2,
            rawFindingCount: 5,
            rawFindingsPerCall: [4, 1],
            candidateCount: 1,
            droppedCount: 3,
            suppressedByIdCount: 1,
            suppressedByLocationCount: 0,
            cappedByLimitCount: 0,
            contextOverflowSplitCount: 0,
            mergeCallCount: 0,
            mergeGroupCount: 0,
            mergedAwayCount: 0
          }
        })
    })

    expect(output.discovery?.totals).toMatchObject({
      callCount: 2,
      rawFindingCount: 5,
      rawFindingsPerCall: [4, 1],
      candidateCount: 1,
      droppedCount: 3
    })
    expect(output.discovery?.tasks).toHaveLength(1)
    // The one admitted finding is unchanged: instrumentation must not move a
    // verdict, a candidate, or a count that already existed.
    expect(output.admittedFindings).toHaveLength(1)
  })

  // Spec 04 + spec 27. A partition (or a spec 26 reactive half) runs under a
  // synthetic sub-task id that matches nothing in the planned task list, and its
  // candidates carry that id. Refutation looks the originating task up to build
  // the packet, so the planned list alone left it with no task at all — and with
  // instructions resolved per task, that would have silently emptied the
  // operator's guidance out of the adjudication packet for exactly the runs
  // partitioning is enabled for.
  test('adjudicates a sub-task’s candidates against the sub-task’s own instructions', async () => {
    const instruction = {
      path: 'AGENTS.md',
      content: 'Repository guidance: never return stale state.',
      allowed: true
    }
    const input = ReviewWorkflowInputSchema.parse({
      ...workflowInput,
      tasks: [
        {
          id: 'task_handler1',
          round: 1,
          kind: 'file',
          paths: ['src/handler.ts'],
          factIds: [],
          evidenceIds: ['ev_handler1'],
          candidateIds: [],
          contextEntryIds: [],
          priority: 0,
          instructions: [instruction],
          reviewContext: []
        }
      ]
    })
    const observedInstructionPaths: string[][] = []

    const output = await runReviewWorkflowHandler({
      input,
      signal: undefined,
      logger: createNoopReviewLogger(),
      maxConcurrentTasks: 1,
      runTask: async (_taskInput, task) => {
        // The shape `partitionTaskForDiscovery`/`splitTaskInHalf` produce: a new
        // id, the parent's instruction set inherited through the spread.
        const subTask = { ...task, id: 'task_handler1_partition0' }

        return TaskReviewResultSchema.parse({
          candidates: [{ ...candidate, taskId: subTask.id }],
          reviewedTasks: [subTask]
        })
      },
      refuteFinding: async (refutationInput) => {
        observedInstructionPaths.push(
          refutationInput.instructions.map((entry) => entry.path)
        )

        return {
          verdicts: refutationInput.candidates.map((batched) => ({
            candidateId: batched.id,
            verdict: 'proved',
            rationaleSummary: 'The active admission critic proved the claim.'
          }))
        }
      }
    })

    expect(observedInstructionPaths).toEqual([['AGENTS.md']])
    // And the run reports the instruction it actually used, once.
    expect(output.instructionHashes).toHaveLength(1)
    expect(output.admittedFindings).toHaveLength(1)
  })

  // Spec 16 ("the mode never bypasses eligibility ... scope") and spec 07's
  // agentic-tool-abuse threat: the tools holistic discovery drives must gate on
  // the SAME configured scope every other mediated lane gates on. The workflow
  // builds its retriever itself, so this is the only place that can be proven —
  // the per-task bounded tools wrap whatever retriever they are handed, and a
  // separately constructed one proves nothing about the one discovery uses.
  describe('the cross-file retriever the workflow hands its tasks', () => {
    type ReadOutcome =
      | { readonly served: string }
      | { readonly refused: string }

    // Reads both paths through the retriever the HANDLER built and reports what
    // each attempt produced. The outcomes are asserted by the caller rather than
    // inside `runTask`, because a failed assertion there is caught by the task
    // queue and re-thrown as a generic task failure, which hides which of the
    // two reads was wrong.
    const readThroughWorkflowRetriever = async (paths: {
      readonly include: string[]
      readonly exclude: string[]
    }): Promise<Record<string, ReadOutcome>> => {
      const root = await mkdtemp(join(tmpdir(), 'workflow-scope-'))
      const outcomes: Record<string, ReadOutcome> = {}

      try {
        await mkdir(join(root, 'src'), { recursive: true })
        await mkdir(join(root, 'secrets'), { recursive: true })
        await writeFile(
          join(root, 'src/handler.ts'),
          'export const handle = () => 1\n',
          'utf8'
        )
        await writeFile(
          join(root, 'secrets/prod.yaml'),
          'apiToken: hunter2\n',
          'utf8'
        )

        const read = async (
          retriever: ContextRetriever,
          requestedPath: string
        ): Promise<void> => {
          try {
            const result = await retriever.readRepositoryFile({
              path: requestedPath
            })
            outcomes[requestedPath] = { served: result.content }
          } catch (error) {
            outcomes[requestedPath] = {
              refused: error instanceof Error ? error.message : String(error)
            }
          }
        }

        await runReviewWorkflowHandler({
          input: ReviewWorkflowInputSchema.parse({
            ...workflowInput,
            repositoryRoot: root,
            paths
          }),
          signal: undefined,
          logger: createNoopReviewLogger(),
          maxConcurrentTasks: 1,
          runTask: async (_taskInput, _task, _signal, contextRetriever) => {
            if (contextRetriever === undefined) {
              throw new TypeError(
                'The workflow built no retriever for a run that has a repository root.'
              )
            }

            await read(contextRetriever, 'secrets/prod.yaml')
            await read(contextRetriever, 'src/handler.ts')

            return TaskReviewResultSchema.parse({ candidates: [] })
          }
        })
      } finally {
        await rm(root, { recursive: true, force: true })
      }

      return outcomes
    }

    test('refuses a path the operator excluded', async () => {
      const outcomes = await readThroughWorkflowRetriever({
        include: ['**/*'],
        exclude: ['secrets/**']
      })

      expect(outcomes['secrets/prod.yaml']).toEqual({
        refused: expect.stringContaining('paths.exclude')
      })
      // The exclusion is the only thing refusing it: the same retriever still
      // serves a path inside the configured scope, so this is not a retriever
      // that refuses everything.
      expect(outcomes['src/handler.ts']).toEqual({
        served: expect.stringContaining('export const handle')
      })
    })

    test('refuses a path outside the operator’s include globs', async () => {
      const outcomes = await readThroughWorkflowRetriever({
        include: ['src/**/*'],
        exclude: []
      })

      expect(outcomes['secrets/prod.yaml']).toEqual({
        refused: expect.stringContaining('paths.include')
      })
      expect(outcomes['src/handler.ts']).toEqual({
        served: expect.stringContaining('export const handle')
      })
    })
  })

  test('records no discovery at all when no task issued a discovery call', async () => {
    const output = await runReviewWorkflowHandler({
      input: workflowInput,
      signal: undefined,
      logger: createNoopReviewLogger(),
      maxConcurrentTasks: 1,
      runTask: async () => TaskReviewResultSchema.parse({ candidates: [] })
    })

    expect(output.discovery).toBeUndefined()
  })
})
