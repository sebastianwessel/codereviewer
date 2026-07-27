import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../admission/index.js'
import { createNoopReviewLogger } from '../../observability/index.js'
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
  instructions: [],
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

  // Spec 19: the un-anchored pass is bounded per file AND per run, and silent
  // truncation is forbidden. The run is where the bound is created and where the
  // truncation it caused has to become visible.
  test('reports un-anchored truncation in the run warnings, naming the applied bound', async () => {
    const output = await runReviewWorkflowHandler({
      input: ReviewWorkflowInputSchema.parse({
        ...workflowInput,
        unanchoredPass: {
          unitLines: 60,
          strideLines: 40,
          maxUnitsPerFile: 2,
          maxUnitsPerRun: 5
        }
      }),
      signal: undefined,
      logger: createNoopReviewLogger(),
      maxConcurrentTasks: 1,
      // Stands in for the discovery stage: a file that derived seven units and
      // was allowed two.
      runTask: async (_taskInput, _task, _signal, _retriever, budget) => {
        budget.claimUnits(7)

        return TaskReviewResultSchema.parse({ candidates: [candidate] })
      }
    })

    expect(output.warnings).toEqual([
      'unanchored-discovery-truncated: 5 of 7 units were not reviewed across 1 file(s) (per-file bound 2)'
    ])
  })

  test('warns about nothing when the un-anchored pass is off', async () => {
    const output = await runReviewWorkflowHandler({
      input: workflowInput,
      signal: undefined,
      logger: createNoopReviewLogger(),
      maxConcurrentTasks: 1,
      runTask: async (_taskInput, _task, _signal, _retriever, budget) => {
        // A disabled pass cannot spend anything, even if a caller asks.
        expect(budget.claimUnits(7)).toBe(0)

        return TaskReviewResultSchema.parse({ candidates: [candidate] })
      }
    })

    expect(output.warnings).toEqual([])
  })
})
