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
    readonly instructions?: WorkflowReviewTask['instructions']
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
  instructions: [...(input.instructions ?? [])],
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

  // A large file is split into several context documents. Pinning every one to
  // line 1 pointed the evidence for a second-chunk finding at the top of the
  // file, which is the same mislocation the chunk numbering itself used to have.
  test('anchors chunk evidence at the chunk’s own origin', () => {
    const chunked: WorkflowReviewTask = {
      ...task({ id: 'task_chunked', content: 'later chunk body' }),
      reviewContext: [
        {
          kind: 'file',
          path: 'src/a.ts',
          content: 'later chunk body',
          ledgerEntryId: `ctx_${'c'.repeat(24)}`,
          startLine: 201,
          endLine: 400
        }
      ]
    }

    const [chunkEvidence] = contextEvidenceForTasks([chunked])

    expect(chunkEvidence?.location?.startLine).toBe(201)
  })

  // The configured scope has to travel WITH the workflow input, because the
  // workflow builds the cross-file discovery retriever itself (spec 16) and the
  // eligibility gate it compiles is only as narrow as what it is handed. The run
  // is the only place that holds the configuration, so a scope that stops here
  // stops everywhere: `reviewedPaths` names the changed files and says nothing
  // about which unchanged files the discovery tools may open.
  test('carries the configured paths.include/exclude into the workflow input', () => {
    const config = CodeReviewerConfigSchema.parse({
      paths: { include: ['src/**/*'], exclude: ['secrets/**'] }
    })

    const workflowInput = createWorkflowInput({
      runId: 'run-scope',
      repositoryRoot: '/repo/project',
      reviewedPaths: ['src/a.ts'],
      reviewedLineRanges: [],
      reviewedDiffRanges: [],
      reviewedDiffText: '',
      evidence: [],
      candidates: [],
      config,
      configHash: sha256('config'),
      providerId: 'openai',
      modelName: 'review-model',
      admittedAt: '2026-06-22T10:00:00.000Z',
      baselineConfigured: false,
      skills: [],
      tasks: [task({ id: 'task_a' })],
      aiReviewBudget: aiReviewBudgetFor(config)
    })

    expect(workflowInput.paths).toEqual({
      include: ['src/**/*'],
      exclude: ['secrets/**']
    })
  })

  test('creates provider workflow input with budgets, context evidence, and cloned baseline', () => {
    const evidence = EvidenceRecordSchema.parse({
      id: 'ev_alpha',
      kind: 'diagnostic',
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
      skills: [],
      tasks: [
        task({ id: 'task_a' }),
        task({ id: 'task_b', paths: ['src/b.ts'] })
      ],
      aiReviewBudget: aiReviewBudgetFor(config)
    })

    // An EXPLICIT contextMaxBytes still binds: min(120 000, 8 000 000 guard)=120 000
    expect(workflowInput.maxTaskInputBytes).toBe(120000)
    expect(workflowInput.maxConcurrentTasks).toBe(2)
    // Spec 28: no cross-file cap is configured, so NOTHING cuts a read in advance —
    // the runaway guard stands. The reviewer narrows a large file by line range
    // instead of receiving a prefix we chose for it.
    expect(workflowInput.contextRetrievalBudget).toEqual(
      expect.objectContaining({
        maxBytesPerRead: 4_000_000
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
