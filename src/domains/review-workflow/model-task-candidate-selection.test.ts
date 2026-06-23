import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../shared/contracts/index.js'
import {
  TaskReviewInputSchema,
  type ModelTaskSuggestions,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { selectModelTaskCandidates } from './model-task-candidate-selection.js'

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

const task: WorkflowReviewTask = {
  id: 'task_selection',
  kind: 'file',
  round: 1,
  paths: ['src/task1.ts', 'src/task2.ts'],
  factIds: [],
  evidenceIds: ['ev_task1', 'ev_task2'],
  candidateIds: [],
  contextEntryIds: [],
  priority: 1,
  reviewContext: [
    {
      kind: 'file',
      path: 'src/task1.ts',
      content: 'export const one = true\n',
      ledgerEntryId: 'ctx_aaaaaaa1'
    },
    {
      kind: 'file',
      path: 'src/task2.ts',
      content: 'export const two = true\n',
      ledgerEntryId: 'ctx_aaaaaaa2'
    }
  ]
}

const taskInput = TaskReviewInputSchema.parse({
  runId: 'run-task-selection',
  task,
  reviewIntents: [],
  reviewedDiffRanges: [
    { path: 'src/task1.ts', startLine: 1, endLine: 20 },
    { path: 'src/task2.ts', startLine: 1, endLine: 20 }
  ],
  evidence: [evidenceFor(1), evidenceFor(2)],
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

const suggestions: ModelTaskSuggestions = {
  suspicions: [
    {
      category: 'bug',
      severity: 'high',
      title: 'First changed branch loses data',
      description: 'The first changed branch can lose data.',
      path: 'src/task1.ts',
      startLine: 9,
      evidenceIds: ['ev_task1'],
      requestedContext: ['Inspect the helper for task one.']
    },
    {
      category: 'bug',
      severity: 'high',
      title: 'Second changed branch loses data',
      description: 'The second changed branch can lose data.',
      path: 'src/task2.ts',
      startLine: 9,
      evidenceIds: ['ev_task2'],
      requestedContext: ['Inspect the helper for task two.']
    },
    {
      category: 'bug',
      severity: 'high',
      title: 'Outside branch loses data',
      description: 'The outside branch can lose data.',
      path: 'src/outside.ts',
      startLine: 9,
      evidenceIds: ['ev_task1']
    }
  ]
}

describe('model task candidate selection', () => {
  test('applies suspicion caps and investigation slot reservations after conversion', () => {
    const reservationRequests: number[] = []

    const result = selectModelTaskCandidates({
      taskInput,
      suggestions,
      maxSuspicionsPerTask: 2,
      reserveModelInvestigationSlots: (requested) => {
        reservationRequests.push(requested)

        return 1
      }
    })

    expect(reservationRequests).toEqual([2])
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.location.path).toBe('src/task1.ts')
    expect(Object.keys(result.contextRequestsByCandidateId)).toEqual([
      result.candidates[0]?.id
    ])
    expect(result.requestedContextByCandidateId[result.candidates[0]?.id ?? '']).toEqual([
      'Inspect the helper for task one.'
    ])
    expect(result.droppedSuspicionReasons).toEqual(
      expect.objectContaining({
        'path-outside-task': 1
      })
    )
  })

  test('does not drop a suspicion when optional context hints use common model variants', () => {
    const result = selectModelTaskCandidates({
      taskInput,
      suggestions: {
        suspicions: [
          {
            category: 'bug',
            severityHint: 'high',
            title: 'Missing-session branch allows access',
            hypothesis:
              'The changed branch grants access when the session lookup returns undefined.',
            primaryLocation: {
              path: 'src/task1.ts',
              line: 9
            },
            evidenceIds: ['ev_task1'],
            contextRequests: [
              {
                tool: 'read_file',
                path: 'src/task1.ts',
                reason: 'Inspect the complete authorization helper.'
              }
            ],
            requestedContext: 'Inspect the session lookup contract.'
          }
        ]
      } as unknown as ModelTaskSuggestions,
      maxSuspicionsPerTask: 2,
      reserveModelInvestigationSlots: (requested) => requested
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.location).toEqual({
      path: 'src/task1.ts',
      startLine: 9,
      side: 'file'
    })
    expect(result.contextRequestsByCandidateId[result.candidates[0]?.id ?? '']).toEqual(
      []
    )
    expect(result.requestedContextByCandidateId[result.candidates[0]?.id ?? '']).toEqual(
      ['Inspect the session lookup contract.']
    )
    expect(result.droppedSuspicionReasons['schema-invalid']).toBe(0)
  })

  test('accepts nested location and common category variants from model output', () => {
    const result = selectModelTaskCandidates({
      taskInput,
      suggestions: {
        suspicions: [
          {
            category: 'logic',
            severity: 'high',
            summary: 'Missing-session branch allows access',
            rationale:
              'The changed branch grants access when the session lookup returns undefined.',
            location: {
              file: 'src/task1.ts',
              start_line: '9'
            },
            evidenceIds: 'ev_task1'
          }
        ]
      } as unknown as ModelTaskSuggestions,
      maxSuspicionsPerTask: 2,
      reserveModelInvestigationSlots: (requested) => requested
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.category).toBe('bug')
    expect(result.candidates[0]?.location).toEqual({
      path: 'src/task1.ts',
      startLine: 9,
      side: 'file'
    })
    expect(result.candidates[0]?.evidenceIds).toEqual(['ev_task1'])
    expect(result.droppedSuspicionReasons['schema-invalid']).toBe(0)
  })

  test('accepts domain-specific correctness category variants from model output', () => {
    const categoryVariants = [
      'billing logic',
      'functional correctness',
      'business correctness',
      'billing correctness issue',
      'business logic bug',
      'discount calculation regression',
      'billing/correctness',
      'business-rule violation'
    ]

    const result = selectModelTaskCandidates({
      taskInput,
      suggestions: {
        suspicions: categoryVariants.map((category, index) => ({
          category,
          severity: 'medium',
          title: `Discounted prorated items are overcharged ${index}`,
          description:
            'The changed branch omits the discount adjustment used by the sibling branch.',
          path: 'src/task1.ts',
          startLine: 9,
          evidenceIds: 'ev_task1'
        }))
      } as unknown as ModelTaskSuggestions,
      maxSuspicionsPerTask: categoryVariants.length,
      reserveModelInvestigationSlots: (requested) => requested
    })

    expect(result.candidates).toHaveLength(categoryVariants.length)
    expect(result.candidates.map((candidate) => candidate.category)).toEqual(
      categoryVariants.map(() => 'bug')
    )
    expect(result.droppedSuspicionReasons['schema-invalid']).toBe(0)
  })

  test('does not recover style-only model categories as bug findings', () => {
    const result = selectModelTaskCandidates({
      taskInput,
      suggestions: {
        suspicions: [
          {
            category: 'style',
            severity: 'low',
            title: 'Prefer shorter helper name',
            description:
              'The helper name could be shorter and the formatting could be cleaner.',
            path: 'src/task1.ts',
            startLine: 9,
            evidenceIds: 'ev_task1'
          }
        ]
      } as unknown as ModelTaskSuggestions,
      maxSuspicionsPerTask: 2,
      reserveModelInvestigationSlots: (requested) => requested
    })

    expect(result.candidates).toHaveLength(0)
    expect(result.droppedSuspicionReasons['schema-invalid']).toBe(1)
    expect(result.schemaInvalidSuggestionIssueCounts).toEqual({
      'category:invalid_value': 1
    })
  })

  test('recovers unknown model categories when the suspicion text proves bug semantics', () => {
    const result = selectModelTaskCandidates({
      taskInput,
      suggestions: {
        suspicions: [
          {
            category: 'customer-impact',
            severity: 'medium',
            title: 'Discounted prorated items are overcharged',
            description:
              'The changed prorated branch omits the discount adjustment used by the sibling branch.',
            path: 'src/task1.ts',
            startLine: 9,
            evidenceIds: 'ev_task1'
          }
        ]
      } as unknown as ModelTaskSuggestions,
      maxSuspicionsPerTask: 2,
      reserveModelInvestigationSlots: (requested) => requested
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.category).toBe('bug')
    expect(result.droppedSuspicionReasons['schema-invalid']).toBe(0)
  })

  test('records redacted schema issue counts for invalid model suggestions', () => {
    const result = selectModelTaskCandidates({
      taskInput,
      suggestions: {
        suspicions: [
          {
            category: 'urgentish',
            severity: 'criticalish',
            title: 'Invalid suggestion shape',
            description: 'The invalid values must not be copied into diagnostics.',
            path: '/absolute/path.ts',
            startLine: 'not-a-number'
          }
        ]
      } as unknown as ModelTaskSuggestions,
      maxSuspicionsPerTask: 2,
      reserveModelInvestigationSlots: (requested) => requested
    })

    expect(result.candidates).toHaveLength(0)
    expect(result.droppedSuspicionReasons['schema-invalid']).toBe(1)
    expect(result.schemaInvalidSuggestionIssueCounts).toEqual({
      'category:invalid_value': 1,
      'severity:invalid_value': 1,
      'path:custom': 1,
      'startLine:invalid_type': 1
    })
    expect(Object.keys(result.schemaInvalidSuggestionIssueCounts).join(' ')).not.toContain(
      'urgentish'
    )
  })
})
