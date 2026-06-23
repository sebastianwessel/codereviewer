import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import type { StructuredError } from '../../shared/errors/error-normalizer.js'
import type { ReviewSharedContextSnapshot } from '../shared-context/index.js'
import { createPartialReviewRunFailedError } from './review-runner-partial-state.js'

const config = CodeReviewerConfigSchema.parse({
  review: {
    mode: 'pr',
    depth: 'thorough',
    baseRef: 'main',
    headRef: 'feature'
  },
  provider: {
    id: 'openai',
    model: 'gpt-5.3-codex'
  },
  paths: {
    artifactDir: '.codereviewer/runs'
  }
})

const structuredError = {
  code: 'coverage_incomplete',
  message: 'Coverage incomplete.',
  category: 'quality-gate',
  recoverable: true,
  exitCode: 1,
  details: {}
} satisfies StructuredError

const sharedContext: ReviewSharedContextSnapshot = {
  sharedEntries: [],
  supportSignalFacts: [],
  taskEvents: [],
  currentTasks: [],
  contextLedgerEntries: [],
  evidenceRecords: [],
  candidateFindings: [],
  admissionDecisions: [],
  admittedFindings: [],
  rejectedFindings: []
}

describe('review runner partial state helper', () => {
  test('creates a failed run error with a complete partial state summary', () => {
    const failure = createPartialReviewRunFailedError({
      structuredError,
      artifactDir: '.codereviewer/runs',
      repositoryRoot: '/repo/project',
      config,
      baseRef: 'base',
      headRef: 'head',
      runId: 'run-123',
      startedAt: new Date('2026-06-20T00:00:00.000Z'),
      completedAt: new Date('2026-06-20T00:00:01.250Z'),
      configHash:
        '1111111111111111111111111111111111111111111111111111111111111111',
      warnings: ['partial-run'],
      contextLedger: [],
      sharedContext,
      observability: {
        events: []
      }
    })

    expect(failure.structuredError).toBe(structuredError)
    expect(failure.partialState.error).toBe(structuredError)
    expect(failure.partialState.artifactRoot).toBe(
      '.codereviewer/runs/run-123'
    )
    expect(failure.partialState.contextLedger).toEqual([])
    expect(failure.partialState.sharedContext).toBe(sharedContext)
    expect(failure.partialState.observability).toEqual({ events: [] })
    expect(failure.partialState.runSummary).toEqual(
      expect.objectContaining({
        runId: 'run-123',
        mode: 'pr',
        depth: 'thorough',
        baseRef: 'base',
        headRef: 'head',
        provider: 'openai',
        model: 'gpt-5.3-codex',
        durationMs: 1250,
        warnings: ['partial-run']
      })
    )
  })
})
