// The rule under test: on a COMPLETED run, an absent quality gate is an internal
// inconsistency, never a pass. The CLI used to report `qualityGatePassed: true`
// with exit code 0 for it — the optimistic direction, on the surface CI branches
// on.
import { describe, expect, test } from 'vitest'
import {
  ReviewReportSchema,
  type QualityGateResult,
  type ReviewReport
} from '../shared/contracts/index.js'
import {
  normalizeError,
  type StructuredError
} from '../shared/errors/error-normalizer.js'
import { qualityGateOfCompletedRun } from './review-completion.js'

const hash = 'a'.repeat(64)

const createReport = (
  qualityGate: QualityGateResult | undefined
): ReviewReport =>
  ReviewReportSchema.parse({
    schemaVersion: '1.0',
    run: {
      runId: 'run_completion',
      startedAt: '2026-08-02T10:00:00.000Z',
      completedAt: '2026-08-02T10:00:01.000Z',
      mode: 'pr',
      depth: 'balanced',
      repositoryRootHash: hash,
      configHash: hash,
      durationMs: 1000,
      warnings: []
    },
    coverage: {
      status: 'complete',
      reviewableFileCount: 0,
      coveredFileCount: 0,
      reviewableBytes: 0,
      coveredBytes: 0,
      incompleteReasons: [],
      files: []
    },
    admittedFindings: [],
    rejectedFindings: [],
    evidence: [],
    skippedFiles: [],
    ...(qualityGate === undefined ? {} : { qualityGate }),
    refutationResults: [],
    providerIssues: [],
    artifacts: []
  })

const structuredErrorFrom = (report: ReviewReport): StructuredError => {
  try {
    qualityGateOfCompletedRun(report)
  } catch (error) {
    // The CLI's own catch normalizes with a `repository` fallback source; an
    // already-structured error must keep its own category and exit code, so this
    // pins the exit code the CLI actually returns rather than the one thrown.
    return normalizeError(error, { source: 'repository' })
  }

  throw new Error('Expected a missing quality gate to fail the run.')
}

describe('quality gate of a completed run', () => {
  test('returns the recorded gate result', () => {
    const passing = qualityGateOfCompletedRun(
      createReport({
        passed: true,
        failingFindingIds: [],
        thresholds: { maxHigh: 0 }
      })
    )
    const failing = qualityGateOfCompletedRun(
      createReport({
        passed: false,
        failingFindingIds: ['find_abc123'],
        thresholds: { maxHigh: 0 }
      })
    )

    expect(passing.passed).toBe(true)
    expect(failing.passed).toBe(false)
    expect(failing.failingFindingIds).toEqual(['find_abc123'])
  })

  test('fails as an internal error when the completed report carries no gate', () => {
    const error = structuredErrorFrom(createReport(undefined))

    expect(error.code).toBe('quality_gate_missing')
    expect(error.category).toBe('internal')
    expect(error.recoverable).toBe(false)
    // Exit 5, not 0: a run that cannot state its gate must not report a passing
    // one, and not 1 either, because no gate failed — nothing was evaluated.
    expect(error.exitCode).toBe(5)
    expect(error.details).toEqual({ runId: 'run_completion' })
    expect(error.message).toContain('run_completion')
  })
})
