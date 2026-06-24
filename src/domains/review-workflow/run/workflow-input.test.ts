import { describe, expect, test } from 'vitest'
import {
  CodeReviewerConfigSchema,
  EvidenceRecordSchema
} from '../../../shared/contracts/index.js'
import { sha256 } from '../../../shared/hash/hash.js'
import { aiReviewBudgetFor } from './support/budgets.js'
import type { WorkflowReviewTask } from './context/context.js'
import {
  contextEvidenceForTasks,
  createWorkflowInput,
  qualityGateThresholdsFor
} from './workflow-input.js'

const contextId = `ctx_${'a'.repeat(24)}`

const task = (
  input: {
    readonly id: string
    readonly paths?: readonly string[]
    readonly content?: string
  }
): WorkflowReviewTask => ({
  id: input.id,
  round: 1,
  kind: 'file',
  paths: [...(input.paths ?? ['src/a.ts'])],
  factIds: [],
  evidenceIds: [],
  candidateIds: [],
  contextEntryIds: [contextId],
  priority: 0,
  reviewContext: [
    {
      kind: 'file',
      path: input.paths?.[0] ?? 'src/a.ts',
      content: input.content ?? 'export const a = 1',
      ledgerEntryId: contextId
    }
  ]
})

describe('review runner workflow input', () => {
  test('derives quality gate thresholds with baseline fail-on-new fallback', () => {
    const config = CodeReviewerConfigSchema.parse({
      baseline: { failOnNewOnly: false },
      qualityGate: { maxCritical: 1, maxHigh: 2, maxMedium: 3 }
    })

    expect(qualityGateThresholdsFor(config)).toEqual({
      maxCritical: 1,
      maxHigh: 2,
      maxMedium: 3,
      failOnProviderError: true,
      failOnNewOnly: false
    })
  })

  test('creates stable context evidence for file task contexts only', () => {
    const sourceTask = task({ id: 'task_a', content: 'abc' })
    const withSignalContext: WorkflowReviewTask = {
      ...sourceTask,
      reviewContext: [
        ...sourceTask.reviewContext,
        {
          kind: 'support-signal-output',
          content: '{"facts":[]}',
          ledgerEntryId: `ctx_${'b'.repeat(24)}`
        }
      ]
    }

    const evidence = contextEvidenceForTasks([withSignalContext])

    expect(evidence).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^evctx_[a-f0-9]{24}$/u),
        kind: 'file',
        source: 'review-context',
        rawContentRef: contextId,
        contentHash: sha256('abc'),
        redactionApplied: true
      })
    ])
  })

  test('creates provider workflow input with budgets, context evidence, and cloned baseline', () => {
    const evidence = EvidenceRecordSchema.parse({
      id: 'ev_alpha',
      kind: 'deterministic-signal',
      summary: 'alpha signal',
      location: { path: 'src/a.ts', startLine: 1, side: 'file' },
      source: 'deterministic-support-signal',
      redactionApplied: true
    })
    const config = CodeReviewerConfigSchema.parse({
      review: {
        mode: 'pr',
        contextMaxBytes: 120000,
        maxConcurrentTasks: 2
      },
      provider: { id: 'openai', model: 'review-model' }
    })
    const baselineFingerprints = [
      { fingerprints: [{ algorithm: 'sha256', value: 'abc123' }] }
    ]

    const workflowInput = createWorkflowInput({
      runId: 'run-1',
      repositoryRoot: '/repo/project',
      reviewedPaths: ['src/a.ts', 'src/b.ts'],
      reviewedLineRanges: [{ path: 'src/a.ts', startLine: 1, endLine: 2 }],
      reviewedDiffRanges: [
        { path: 'src/a.ts', startLine: 1, endLine: 1, changeKind: 'modified' }
      ],
      reviewedDiffText: '',
      evidence: [evidence],
      candidates: [],
      config,
      configHash: sha256('config'),
      providerId: 'openai',
      modelName: 'review-model',
      admittedAt: '2026-06-22T10:00:00.000Z',
      baselineConfigured: true,
      baselineFingerprints,
      instructions: [],
      skills: [],
      tasks: [
        task({ id: 'task_a' }),
        task({ id: 'task_b', paths: ['src/b.ts'] })
      ],
      aiReviewBudget: aiReviewBudgetFor(config)
    })

    // contextMaxBytes=120 000, input cap=360 000 → min(120 000, 360 000)=120 000
    expect(workflowInput.maxTaskInputBytes).toBe(120000)
    expect(workflowInput.maxConcurrentTasks).toBe(2)
    // contextMaxBytes=120 000, depthContextCap(balanced)=120 000
    // → maxBytesPerRead = min(120 000, 120 000) = 120 000
    expect(workflowInput.contextRetrievalBudget).toEqual(
      expect.objectContaining({
        maxBytesPerRead: 120000
      })
    )
    expect(workflowInput.evidence.map((record) => record.id)).toEqual([
      'ev_alpha',
      expect.stringMatching(/^evctx_[a-f0-9]{24}$/u),
      expect.stringMatching(/^evctx_[a-f0-9]{24}$/u)
    ])
    expect(workflowInput.reviewContext).toHaveLength(2)
    expect(workflowInput.provenance).toEqual(
      expect.objectContaining({
        reviewer: 'review-agent',
        modelProvider: 'openai',
        modelName: 'review-model',
        configHash: sha256('config')
      })
    )
    expect(workflowInput.baselineFingerprints).toEqual(baselineFingerprints)
    expect(workflowInput.baselineFingerprints).not.toBe(baselineFingerprints)
    expect(workflowInput.qualityGate).toEqual(
      expect.objectContaining({ maxCritical: 0, maxHigh: 0 })
    )
  })
})
