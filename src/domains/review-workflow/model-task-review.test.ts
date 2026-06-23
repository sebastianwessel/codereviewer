import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  type ContextRequest,
  type EvidenceRecord,
  type ReviewIntent
} from '../../shared/contracts/index.js'
import { createContextRetriever } from '../context-retrieval/index.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from './workflow-contracts.js'
import {
  TaskReviewInputSchema,
  type FindingInvestigationInput,
  type FindingInvestigationResult,
  type ModelTaskSuggestions,
  type SiblingSweepInput,
  type TaskReviewInput,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { runModelBackedTaskReview } from './model-task-review.js'

const configHash =
  '3333333333333333333333333333333333333333333333333333333333333333'

const evidenceFor = (index: number): EvidenceRecord => ({
  id: `ev_task${index}`,
  kind: 'diff',
  summary: `Changed branch ${index} can lose data.`,
  location: {
    path: `src/task${index}.ts`,
    startLine: 9,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
})

const task = (
  paths: readonly string[] = ['src/task1.ts']
): WorkflowReviewTask => ({
  id: 'task_modelreview',
  kind: 'file',
  round: 1,
  paths: [...paths],
  factIds: [],
  evidenceIds: paths.map((_path, index) => `ev_task${index + 1}`),
  candidateIds: [],
  contextEntryIds: [],
  objective: 'Review changed task files.',
  priority: 1,
  reviewContext: paths.map((path, index) => ({
    kind: 'file',
    path,
    content: `export const value${index + 1} = ${index + 1}\n`,
    ledgerEntryId: `ctx_${'a'.repeat(7)}${index + 1}`
  }))
})

const reviewIntent: ReviewIntent = {
  id: 'intent_task',
  title: 'Verify task execution',
  objective: 'Verify changed task behavior.',
  taskIds: ['task_modelreview'],
  paths: ['src/task1.ts', 'src/task2.ts'],
  focusAreas: ['data flow'],
  riskAreas: ['data loss'],
  verificationQuestions: ['Does the changed path preserve data?'],
  source: 'model'
}

const workflowInput = (
  input: {
    readonly judgeFindings?: boolean
    readonly maxSuspicionsPerTask?: number
  } = {}
): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-model-task-review',
    reviewedPaths: ['src/task1.ts', 'src/task2.ts'],
    reviewedDiffRanges: [
      { path: 'src/task1.ts', startLine: 1, endLine: 20 },
      { path: 'src/task2.ts', startLine: 1, endLine: 20 }
    ],
    evidence: [evidenceFor(1), evidenceFor(2)],
    candidates: [],
    instructions: [],
    skills: [],
    judgeFindings: input.judgeFindings ?? true,
    ...(input.maxSuspicionsPerTask === undefined
      ? {}
      : { maxSuspicionsPerTask: input.maxSuspicionsPerTask }),
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

const taskInput = (
  paths: readonly string[] = ['src/task1.ts'],
  workflow: ReviewWorkflowInput = workflowInput()
): TaskReviewInput =>
  TaskReviewInputSchema.parse({
    runId: workflow.runId,
    task: task(paths),
    reviewIntents: [reviewIntent],
    reviewedDiffRanges: workflow.reviewedDiffRanges,
    evidence: workflow.evidence,
    candidates: [],
    instructions: [],
    skills: [],
    sharedDigest: '(no admitted shared context yet)',
    provenance: workflow.provenance
  })

const suspicionFor = (
  index: number,
  path = `src/task${index}.ts`,
  contextRequests: readonly ContextRequest[] = [],
  requestedContext: readonly string[] = []
): ModelTaskSuggestions['suspicions'][number] => ({
  category: 'bug',
  severity: 'high',
  title: `Changed branch ${index} loses data`,
  description: `The changed branch ${index} can lose data.`,
  path,
  startLine: 9,
  evidenceIds: [`ev_task${index}`],
  contextRequests: [...contextRequests],
  requestedContext: [...requestedContext]
})

const provedInvestigation = (
  input: FindingInvestigationInput
): FindingInvestigationResult => ({
  verdict: 'proved',
  rationaleSummary: 'The changed path is reachable and the evidence is exact.',
  evidenceIds: input.evidence.map((record) => record.id),
  contextRequests: [],
  requestedContext: [],
  changedBehavior: 'The changed branch loses data.',
  executionOrDataPath: 'The changed branch bypasses persistence.',
  violatedInvariant: 'Payload data must be preserved.',
  impact: 'Callers can lose data.',
  introducedByChange: 'The reviewed branch changed persistence behavior.',
  contradictionChecks: ['No alternate path preserves the payload.'],
  fixDirection: 'Persist the payload before returning.'
})

const logger = {
  debug: () => undefined
}

const createTempRepo = async (): Promise<string> => {
  const root = join(tmpdir(), `codereviewer-model-task-${crypto.randomUUID()}`)

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src', 'task1.ts'),
    [
      'export const shared = (input: string) => input.trim()',
      'export const first = (input: string) => shared(input)'
    ].join('\n')
  )
  await writeFile(
    join(root, 'src', 'task2.ts'),
    [
      'import { shared } from "./task1"',
      'export const second = (input: string) => shared(input)'
    ].join('\n')
  )

  return root
}

describe('model-backed task review execution', () => {
  test('deduplicates repeated model suspicions before investigation', async () => {
    let investigationCalls = 0
    const workflow = workflowInput({ maxSuspicionsPerTask: 4 })
    const duplicateSuspicion = suspicionFor(1)
    const result = await runModelBackedTaskReview({
      workflowInput: workflow,
      taskInput: taskInput(['src/task1.ts'], workflow),
      task: task(['src/task1.ts']),
      reserveModelInvestigationSlots: (requested) => requested,
      runners: {
        reviewTask: async () => ({
          suspicions: [duplicateSuspicion, duplicateSuspicion]
        }),
        investigateSuspicion: async (input) => {
          investigationCalls += 1
          return provedInvestigation(input)
        },
        sweepSiblingSuspicions: async () => ({ suspicions: [] })
      },
      logger
    })

    expect(investigationCalls).toBe(1)
    expect(result.candidates).toHaveLength(1)
    expect(result.modelSuspicions).toHaveLength(1)
    expect(result.proofPackets).toHaveLength(1)
  })

  test('records model discovery diagnostics for selected and dropped suspicions', async () => {
    const workflow = workflowInput({ maxSuspicionsPerTask: 4 })
    const result = await runModelBackedTaskReview({
      workflowInput: workflow,
      taskInput: taskInput(['src/task1.ts'], workflow),
      task: task(['src/task1.ts']),
      reserveModelInvestigationSlots: (requested) => requested,
      runners: {
        reviewTask: async () => ({
          suspicions: [
            suspicionFor(1),
            {
              category: 'bug',
              severity: 'high',
              description: 'The model omitted a title, so this is unusable.',
              path: 'src/task1.ts',
              startLine: 9
            } as unknown as ModelTaskSuggestions['suspicions'][number],
            suspicionFor(2, 'src/outside.ts')
          ]
        }),
        investigateSuspicion: async (input) => provedInvestigation(input),
        sweepSiblingSuspicions: async () => ({ suspicions: [] })
      },
      logger
    })

    expect(
      (
        result as {
          readonly modelTaskDiagnostics?: readonly unknown[]
        }
      ).modelTaskDiagnostics
    ).toEqual([
      {
        taskId: 'task_modelreview',
        taskKind: 'file',
        round: 1,
        paths: ['src/task1.ts'],
        evidenceCount: 2,
        reviewContextCount: 1,
        reviewIntentCount: 1,
        verificationQuestionCount: 1,
        suggestionCount: 3,
        convertedCandidateCount: 1,
        selectedCandidateCount: 1,
        budgetDroppedCandidateCount: 0,
        modelSuspicionCount: 1,
        proofPacketCount: 1,
        zeroCandidateReason: 'none',
        droppedSuspicionReasons: {
          'schema-invalid': 0,
          'missing-required-field': 1,
          'path-outside-task': 1,
          'missing-task-evidence': 0,
          'duplicate-input-candidate': 0,
          'unsupported-truncation-claim': 0
        }
      }
    ])
  })

  test('records schema-invalid model diagnostics without raw invalid values', async () => {
    const workflow = workflowInput({ maxSuspicionsPerTask: 4 })
    const result = await runModelBackedTaskReview({
      workflowInput: workflow,
      taskInput: taskInput(['src/task1.ts'], workflow),
      task: task(['src/task1.ts']),
      reserveModelInvestigationSlots: (requested) => requested,
      runners: {
        reviewTask: async () => ({
          suspicions: [
            {
              category: 'urgentish',
              severity: 'criticalish',
              title: 'Invalid suggestion shape',
              description:
                'The invalid values must not be copied into diagnostics.',
              path: '/absolute/path.ts',
              startLine: 'not-a-number'
            } as unknown as ModelTaskSuggestions['suspicions'][number]
          ]
        }),
        investigateSuspicion: async (input) => provedInvestigation(input),
        sweepSiblingSuspicions: async () => ({ suspicions: [] })
      },
      logger
    })

    expect(result.modelTaskDiagnostics).toEqual([
      expect.objectContaining({
        suggestionCount: 1,
        convertedCandidateCount: 0,
        selectedCandidateCount: 0,
        zeroCandidateReason: 'all-suggestions-dropped',
        droppedSuspicionReasons: expect.objectContaining({
          'schema-invalid': 1
        }),
        schemaInvalidSuggestionIssueCounts: {
          'category:invalid_value': 1,
          'severity:invalid_value': 1,
          'path:custom': 1,
          'startLine:invalid_type': 1
        }
      })
    ])
    expect(JSON.stringify(result.modelTaskDiagnostics)).not.toContain('urgentish')
  })

  test('diagnoses valid suspicions dropped by exhausted investigation budget', async () => {
    let investigationCalls = 0
    const workflow = workflowInput({ maxSuspicionsPerTask: 4 })
    const result = await runModelBackedTaskReview({
      workflowInput: workflow,
      taskInput: taskInput(['src/task1.ts'], workflow),
      task: task(['src/task1.ts']),
      reserveModelInvestigationSlots: () => 0,
      runners: {
        reviewTask: async () => ({
          suspicions: [suspicionFor(1)]
        }),
        investigateSuspicion: async (input) => {
          investigationCalls += 1
          return provedInvestigation(input)
        },
        sweepSiblingSuspicions: async () => ({ suspicions: [] })
      },
      logger
    })

    expect(investigationCalls).toBe(0)
    expect(result.candidates).toHaveLength(0)
    expect(result.modelTaskDiagnostics).toEqual([
      expect.objectContaining({
        suggestionCount: 1,
        convertedCandidateCount: 1,
        selectedCandidateCount: 0,
        budgetDroppedCandidateCount: 1,
        zeroCandidateReason: 'investigation-budget-exhausted'
      })
    ])
  })

  test('reuses identical context retrieval artifacts across model suspicions', async () => {
    const root = await createTempRepo()

    try {
      const workflow = workflowInput({ maxSuspicionsPerTask: 2 })
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: {
          maxReads: 1,
          maxSearches: 0
        }
      })
      const sharedContextRequest: ContextRequest = {
        tool: 'read',
        path: 'src/task1.ts',
        reason: 'Inspect the shared helper used by both changed branches.'
      }
      const contextRetrievalEvidenceByCandidate = new Map<string, number>()
      const result = await runModelBackedTaskReview({
        workflowInput: workflow,
        taskInput: taskInput(['src/task1.ts', 'src/task2.ts'], workflow),
        task: task(['src/task1.ts', 'src/task2.ts']),
        contextRetriever: retriever,
        reserveModelInvestigationSlots: (requested) => requested,
        runners: {
          reviewTask: async () => ({
            suspicions: [
              suspicionFor(1, 'src/task1.ts', [sharedContextRequest]),
              suspicionFor(2, 'src/task2.ts', [sharedContextRequest])
            ]
          }),
          investigateSuspicion: async (input) => {
            contextRetrievalEvidenceByCandidate.set(
              input.candidate.id,
              input.evidence.filter(
                (record) => record.source === 'context-retrieval'
              ).length
            )

            return provedInvestigation(input)
          },
          sweepSiblingSuspicions: async () => ({ suspicions: [] })
        },
        logger
      })

      expect(retriever.budget()).toMatchObject({
        usedReads: 1,
        usedSearches: 0
      })
      expect(result.candidates).toHaveLength(2)
      expect(result.proofPackets).toHaveLength(2)
      expect(result.providerIssues).toEqual([])
      expect([...contextRetrievalEvidenceByCandidate.values()]).toEqual([1, 1])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('records actual retrieval budget limits in investigation traces', async () => {
    const root = await createTempRepo()

    try {
      const workflow = workflowInput({ maxSuspicionsPerTask: 1 })
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: {
          maxReads: 3,
          maxSearches: 2
        }
      })
      const result = await runModelBackedTaskReview({
        workflowInput: workflow,
        taskInput: taskInput(['src/task1.ts'], workflow),
        task: task(['src/task1.ts']),
        contextRetriever: retriever,
        reserveModelInvestigationSlots: (requested) => requested,
        runners: {
          reviewTask: async () => ({
            suspicions: [
              suspicionFor(1, 'src/task1.ts', [
                {
                  tool: 'read',
                  path: 'src/task1.ts',
                  reason: 'Inspect the changed task file.'
                }
              ])
            ]
          }),
          investigateSuspicion: async (input) => provedInvestigation(input),
          sweepSiblingSuspicions: async () => ({ suspicions: [] })
        },
        logger
      })

      expect(result.investigationTraces).toEqual([
        expect.objectContaining({
          budget: expect.objectContaining({
            maxReads: 3,
            usedReads: 1,
            maxSearches: 2,
            usedSearches: 0
          })
        })
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reuses context retrieval artifacts across sibling proof loops', async () => {
    const root = await createTempRepo()

    try {
      const workflow = workflowInput({
        judgeFindings: true,
        maxSuspicionsPerTask: 2
      })
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: {
          maxReads: 1,
          maxSearches: 0
        }
      })
      const sharedContextRequest: ContextRequest = {
        tool: 'read',
        path: 'src/task1.ts',
        reason: 'Inspect the shared helper used by sibling findings.'
      }
      const contextRetrievalEvidenceByCandidate = new Map<string, number>()
      const result = await runModelBackedTaskReview({
        workflowInput: workflow,
        taskInput: taskInput(['src/task1.ts', 'src/task2.ts'], workflow),
        task: task(['src/task1.ts', 'src/task2.ts']),
        contextRetriever: retriever,
        reserveModelInvestigationSlots: (requested) => requested,
        runners: {
          reviewTask: async () => ({
            suspicions: [suspicionFor(1, 'src/task1.ts', [sharedContextRequest])]
          }),
          investigateSuspicion: async (input) => {
            contextRetrievalEvidenceByCandidate.set(
              input.candidate.id,
              input.evidence.filter(
                (record) => record.source === 'context-retrieval'
              ).length
            )

            return provedInvestigation(input)
          },
          sweepSiblingSuspicions: async () => ({
            suspicions: [suspicionFor(2, 'src/task2.ts', [sharedContextRequest])]
          })
        },
        logger
      })

      expect(retriever.budget()).toMatchObject({
        usedReads: 1,
        usedSearches: 0
      })
      expect(result.candidates.map((candidate) => candidate.location.path)).toEqual([
        'src/task1.ts',
        'src/task2.ts'
      ])
      expect(result.proofPackets).toHaveLength(2)
      expect([...contextRetrievalEvidenceByCandidate.values()]).toEqual([1, 1])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reuses context retrieval artifacts for reordered structured requests', async () => {
    const root = await createTempRepo()

    try {
      const workflow = workflowInput({ maxSuspicionsPerTask: 2 })
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: {
          maxReads: 2,
          maxSearches: 0
        }
      })
      const firstContextRequest: ContextRequest = {
        tool: 'read',
        path: 'src/task1.ts',
        reason: 'Inspect the shared helper.'
      }
      const secondContextRequest: ContextRequest = {
        tool: 'read',
        path: 'src/task2.ts',
        reason: 'Inspect the sibling helper.'
      }
      const contextRetrievalEvidenceByCandidate = new Map<string, number>()
      const result = await runModelBackedTaskReview({
        workflowInput: workflow,
        taskInput: taskInput(['src/task1.ts', 'src/task2.ts'], workflow),
        task: task(['src/task1.ts', 'src/task2.ts']),
        contextRetriever: retriever,
        reserveModelInvestigationSlots: (requested) => requested,
        runners: {
          reviewTask: async () => ({
            suspicions: [
              suspicionFor(1, 'src/task1.ts', [
                firstContextRequest,
                secondContextRequest
              ]),
              suspicionFor(2, 'src/task2.ts', [
                secondContextRequest,
                firstContextRequest
              ])
            ]
          }),
          investigateSuspicion: async (input) => {
            contextRetrievalEvidenceByCandidate.set(
              input.candidate.id,
              input.evidence.filter(
                (record) => record.source === 'context-retrieval'
              ).length
            )

            return provedInvestigation(input)
          },
          sweepSiblingSuspicions: async () => ({ suspicions: [] })
        },
        logger
      })

      expect(retriever.budget()).toMatchObject({
        usedReads: 2,
        usedSearches: 0
      })
      expect(result.candidates).toHaveLength(2)
      expect(result.proofPackets).toHaveLength(2)
      expect([...contextRetrievalEvidenceByCandidate.values()]).toEqual([2, 2])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reuses structured context artifacts despite different prose audit text', async () => {
    const root = await createTempRepo()

    try {
      const workflow = workflowInput({ maxSuspicionsPerTask: 2 })
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: {
          maxReads: 1,
          maxSearches: 0
        }
      })
      const sharedContextRequest: ContextRequest = {
        tool: 'read',
        path: 'src/task1.ts',
        reason: 'Inspect the shared helper.'
      }
      const contextRetrievalEvidenceByCandidate = new Map<string, number>()
      const result = await runModelBackedTaskReview({
        workflowInput: workflow,
        taskInput: taskInput(['src/task1.ts', 'src/task2.ts'], workflow),
        task: task(['src/task1.ts', 'src/task2.ts']),
        contextRetriever: retriever,
        reserveModelInvestigationSlots: (requested) => requested,
        runners: {
          reviewTask: async () => ({
            suspicions: [
              suspicionFor(
                1,
                'src/task1.ts',
                [sharedContextRequest],
                ['Audit note: inspect the helper for the first changed branch.']
              ),
              suspicionFor(
                2,
                'src/task2.ts',
                [sharedContextRequest],
                ['Audit note: inspect the same helper for the sibling branch.']
              )
            ]
          }),
          investigateSuspicion: async (input) => {
            contextRetrievalEvidenceByCandidate.set(
              input.candidate.id,
              input.evidence.filter(
                (record) => record.source === 'context-retrieval'
              ).length
            )

            return provedInvestigation(input)
          },
          sweepSiblingSuspicions: async () => ({ suspicions: [] })
        },
        logger
      })

      expect(retriever.budget()).toMatchObject({
        usedReads: 1,
        usedSearches: 0
      })
      expect(result.candidates).toHaveLength(2)
      expect(result.proofPackets).toHaveLength(2)
      expect([...contextRetrievalEvidenceByCandidate.values()]).toEqual([1, 1])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('caps primary model suspicions before investigation', async () => {
    const workflow = workflowInput({ maxSuspicionsPerTask: 1 })
    const result = await runModelBackedTaskReview({
      workflowInput: workflow,
      taskInput: taskInput(['src/task1.ts', 'src/task2.ts'], workflow),
      task: task(['src/task1.ts', 'src/task2.ts']),
      reserveModelInvestigationSlots: (requested) => requested,
      runners: {
        reviewTask: async () => ({
          suspicions: [suspicionFor(1), suspicionFor(2)]
        }),
        investigateSuspicion: async (input) => provedInvestigation(input),
        sweepSiblingSuspicions: async () => ({ suspicions: [] })
      },
      logger
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.modelSuspicions).toHaveLength(1)
    expect(result.proofPackets).toHaveLength(1)
  })

  test('runs sibling sweep for proved multi-path tasks when optional judging is enabled', async () => {
    let sweepCalls = 0
    const workflow = workflowInput({ judgeFindings: true })
    const result = await runModelBackedTaskReview({
      workflowInput: workflow,
      taskInput: taskInput(['src/task1.ts', 'src/task2.ts'], workflow),
      task: task(['src/task1.ts', 'src/task2.ts']),
      reserveModelInvestigationSlots: (requested) => requested,
      runners: {
        reviewTask: async () => ({ suspicions: [suspicionFor(1)] }),
        investigateSuspicion: async (input) => provedInvestigation(input),
        sweepSiblingSuspicions: async () => {
          sweepCalls += 1
          return { suspicions: [suspicionFor(2)] }
        }
      },
      logger
    })

    expect(sweepCalls).toBe(1)
    expect(result.candidates.map((candidate) => candidate.location.path)).toEqual([
      'src/task1.ts',
      'src/task2.ts'
    ])
    expect(result.proofPackets).toHaveLength(2)
  })

  test('scopes sibling sweep input to proved suspicions and traces', async () => {
    let siblingSweepInput: SiblingSweepInput | undefined
    const workflow = workflowInput({
      judgeFindings: true,
      maxSuspicionsPerTask: 2
    })
    const result = await runModelBackedTaskReview({
      workflowInput: workflow,
      taskInput: taskInput(['src/task1.ts', 'src/task2.ts'], workflow),
      task: task(['src/task1.ts', 'src/task2.ts']),
      reserveModelInvestigationSlots: (requested) => requested,
      runners: {
        reviewTask: async () => ({
          suspicions: [
            suspicionFor(1, 'src/task1.ts'),
            suspicionFor(2, 'src/task2.ts')
          ]
        }),
        investigateSuspicion: async (input) =>
          input.candidate.location.path === 'src/task1.ts'
            ? provedInvestigation(input)
            : {
                verdict: 'needs-more-evidence',
                rationaleSummary:
                  'The second suspicion is not proved enough for sibling sweep.',
                evidenceIds: [],
                contextRequests: [],
                requestedContext: [],
                contradictionChecks: []
              },
        sweepSiblingSuspicions: async (input) => {
          siblingSweepInput = input

          return { suspicions: [] }
        }
      },
      logger
    })

    expect(result.proofPackets).toHaveLength(1)
    expect(siblingSweepInput?.modelSuspicions.map((suspicion) => suspicion.status)).toEqual([
      'proved'
    ])
    expect(
      siblingSweepInput?.investigationTraces.map((trace) => trace.suspicionId)
    ).toEqual([siblingSweepInput?.proofPackets[0]?.suspicionId])
  })

  test('deduplicates sibling sweep candidates by location before proof work', async () => {
    let investigationCalls = 0
    const workflow = workflowInput({
      judgeFindings: true,
      maxSuspicionsPerTask: 3
    })
    const duplicateSiblingSuggestion: ModelTaskSuggestions['suspicions'][number] = {
      category: 'bug',
      severity: 'high',
      title: 'Same sibling branch loses payload',
      description: 'The changed branch 2 can lose data.',
      path: 'src/task2.ts',
      startLine: 9,
      evidenceIds: ['ev_task2'],
      contextRequests: [],
      requestedContext: []
    }
    const result = await runModelBackedTaskReview({
      workflowInput: workflow,
      taskInput: taskInput(['src/task1.ts', 'src/task2.ts'], workflow),
      task: task(['src/task1.ts', 'src/task2.ts']),
      reserveModelInvestigationSlots: (requested) => requested,
      runners: {
        reviewTask: async () => ({
          suspicions: [suspicionFor(1, 'src/task1.ts')]
        }),
        investigateSuspicion: async (input) => {
          investigationCalls += 1

          return provedInvestigation(input)
        },
        sweepSiblingSuspicions: async () => ({
          suspicions: [
            suspicionFor(2, 'src/task2.ts'),
            duplicateSiblingSuggestion
          ]
        })
      },
      logger
    })

    expect(investigationCalls).toBe(2)
    expect(result.candidates.map((candidate) => candidate.location.path)).toEqual([
      'src/task1.ts',
      'src/task2.ts'
    ])
    expect(result.proofPackets).toHaveLength(2)
  })

  test('skips sibling sweep when optional judging is disabled', async () => {
    let sweepCalls = 0
    const workflow = workflowInput({ judgeFindings: false })
    const result = await runModelBackedTaskReview({
      workflowInput: workflow,
      taskInput: taskInput(['src/task1.ts', 'src/task2.ts'], workflow),
      task: task(['src/task1.ts', 'src/task2.ts']),
      reserveModelInvestigationSlots: (requested) => requested,
      runners: {
        reviewTask: async () => ({ suspicions: [suspicionFor(1)] }),
        investigateSuspicion: async (input) => provedInvestigation(input),
        sweepSiblingSuspicions: async () => {
          sweepCalls += 1
          return { suspicions: [suspicionFor(2)] }
        }
      },
      logger
    })

    expect(sweepCalls).toBe(0)
    expect(result.candidates).toHaveLength(1)
    expect(result.proofPackets).toHaveLength(1)
  })

  test('records sibling sweep provider failures as recovered provider issues', async () => {
    const workflow = workflowInput({ judgeFindings: true })
    const result = await runModelBackedTaskReview({
      workflowInput: workflow,
      taskInput: taskInput(['src/task1.ts', 'src/task2.ts'], workflow),
      task: task(['src/task1.ts', 'src/task2.ts']),
      reserveModelInvestigationSlots: (requested) => requested,
      runners: {
        reviewTask: async () => ({ suspicions: [suspicionFor(1)] }),
        investigateSuspicion: async (input) => provedInvestigation(input),
        sweepSiblingSuspicions: async () => {
          throw new Error('sibling sweep timeout')
        }
      },
      logger
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.providerIssues).toEqual([
      expect.objectContaining({
        code: 'provider_error',
        stage: 'sibling-sweep',
        recovered: true
      })
    ])
  })
})
