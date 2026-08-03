// Regression coverage for the fix-lane silent-failure bug: a fix lane that
// crashes must be reported as a `stage: 'fix'` provider issue on the scored
// review report, not scored as an empty result indistinguishable from the lane
// being disabled or having no eligible finding. See
// src/cli/eval-case-runner.ts `runFixOutcomesForCase`.
//
// `runFixRun` is deliberately resilient at every internal layer (spec 12): a
// per-claim model error degrades to an "uncertain" verdict, an unresolved
// provider yields an empty report, and a missing current file fails the
// apply-check closed -- none of these throw. Reaching the catch this test
// covers therefore means something below `runFixRun`'s own resilience broke
// outright (a real crash, not a modeled non-answer), which cannot be
// provoked through the public API surface. `runFixRun` and `runReview` are
// substituted here so the orchestration boundary this file owns -- turning a
// caught crash into a visible, attributable provider issue -- is exercised
// directly, independent of what can or cannot be coaxed out of either
// pipeline's real internals.
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AdmittedFindingSchema,
  CodeReviewerConfigSchema,
  ReviewReportSchema,
  type ReviewReport
} from '../shared/contracts/index.js'
import { EvalCaseSchema } from '../domains/evaluation/index.js'

const mocks = vi.hoisted(() => ({
  runReview: vi.fn(),
  runFixRun: vi.fn()
}))

vi.mock('../domains/review-workflow/index.js', () => ({
  runReview: mocks.runReview
}))

vi.mock('../domains/verification/index.js', () => ({
  runFixRun: mocks.runFixRun
}))

const { runEvalCase } = await import('./eval-case-runner.js')

const provenance = {
  reviewer: 'review-agent',
  instructionHashes: [],
  skillHashes: [],
  signalVersions: {},
  configHash: 'a'.repeat(64)
}

const admittedFinding = AdmittedFindingSchema.parse({
  id: 'find_defect1',
  taskId: 'task_defect1',
  category: 'bug',
  severity: 'high',
  title: 'Incorrect return branch',
  description: 'The changed branch returns an incorrect value.',
  location: { path: 'src/app.ts', startLine: 4, side: 'new' },
  evidenceIds: ['ev_defect1'],
  proposedBy: 'review-agent',
  admissionStatus: 'admitted',
  admittedAt: '2026-07-26T00:00:00.000Z',
  admissionEvidenceIds: ['ev_defect1'],
  reporterEligibility: 'inline',
  provenance,
  baselineStatus: 'new',
  fingerprints: [{ algorithm: 'v2', value: 'defect1' }]
})

const baseReviewReport: ReviewReport = ReviewReportSchema.parse({
  schemaVersion: '1.0',
  run: {
    runId: 'test-run',
    startedAt: '2026-07-26T00:00:00.000Z',
    completedAt: '2026-07-26T00:00:01.000Z',
    mode: 'ci',
    depth: 'balanced',
    repositoryRootHash: '1'.repeat(64),
    configHash: '1'.repeat(64),
    durationMs: 1,
    warnings: []
  },
  coverage: {
    status: 'complete',
    excludedFileCount: 0,
    reviewableFileCount: 1,
    coveredFileCount: 1,
    reviewableBytes: 1,
    coveredBytes: 1,
    incompleteReasons: [],
    files: [
      {
        path: 'src/app.ts',
        contentHash: '2'.repeat(64),
        status: 'complete',
        bytes: 1,
        coveredBytes: 1,
        taskIds: ['task_defect1']
      }
    ]
  },
  admittedFindings: [admittedFinding],
  rejectedFindings: [],
  evidence: [],
  refutationResults: [],
  providerIssues: [],
  skippedFiles: [],
  artifacts: []
})

const reviewResult = {
  report: baseReviewReport,
  contextLedger: [],
  sharedContext: { taskEvents: [], admittedFindings: [] },
  observability: { events: [] }
}

const evalCase = EvalCaseSchema.parse({
  id: 'fix-lane-crash-case',
  language: 'typescript',
  repositoryFixture: 'fixtures/typescript/positive',
  changedFiles: ['src/app.ts'],
  diff: [
    'diff --git a/src/app.ts b/src/app.ts',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,0 +1,1 @@',
    '+export const value = 1'
  ].join('\n'),
  expectedFindings: [],
  tags: ['fix-lane']
})

describe('runEvalCase — fix lane failure visibility', () => {
  let root: string

  beforeEach(async () => {
    root = path.join(tmpdir(), `codereviewer-eval-case-runner-${crypto.randomUUID()}`)
    await mkdir(path.join(root, 'fixtures', 'typescript', 'positive'), {
      recursive: true
    })
    mocks.runReview.mockReset().mockResolvedValue(reviewResult)
    mocks.runFixRun.mockReset()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const config = (fixEnabled: boolean) =>
    CodeReviewerConfigSchema.parse({
      provider: { id: 'openai', model: 'gpt-x' },
      fix: { enabled: fixEnabled }
    })

  test('reports a crashed fix lane as a stage:"fix" provider issue instead of a silent skip', async () => {
    mocks.runFixRun.mockRejectedValue(new Error('scripted fix-lane provider outage'))

    const output = await runEvalCase({
      root,
      config: config(true),
      configWarnings: [],
      baselineExplicitlyConfigured: false,
      environment: {},
      evalCase
    })

    expect(mocks.runFixRun).toHaveBeenCalledTimes(1)
    expect(output.result.status).toBe('ok')
    if (output.result.status !== 'ok') {
      throw new Error('expected an "ok" result')
    }

    // No fix outcomes were produced (the lane crashed before producing one),
    // but the crash itself is now visible and attributable as a provider issue
    // scoped to the `fix` stage, and the original review report's own provider
    // issues (empty here) are preserved rather than replaced.
    expect(output.fixOutcomes).toEqual([])
    expect(output.result.reviewReport.providerIssues).toEqual([
      {
        code: 'provider_error',
        stage: 'fix',
        recovered: false,
        message: 'scripted fix-lane provider outage'
      }
    ])
  })

  test('a disabled fix lane scores as a benign skip: runFixRun never runs and no provider issue appears', async () => {
    const output = await runEvalCase({
      root,
      config: config(false),
      configWarnings: [],
      baselineExplicitlyConfigured: false,
      environment: {},
      evalCase
    })

    expect(mocks.runFixRun).not.toHaveBeenCalled()
    expect(output.result.status).toBe('ok')
    if (output.result.status !== 'ok') {
      throw new Error('expected an "ok" result')
    }

    expect(output.fixOutcomes).toEqual([])
    expect(output.result.reviewReport.providerIssues).toEqual([])
  })

  test('a fix lane that legitimately produces no outcomes (no eligible finding) is also a benign skip', async () => {
    mocks.runFixRun.mockResolvedValue({
      report: { fixOutcomes: [] },
      findings: [admittedFinding]
    })

    const output = await runEvalCase({
      root,
      config: config(true),
      configWarnings: [],
      baselineExplicitlyConfigured: false,
      environment: {},
      evalCase
    })

    expect(mocks.runFixRun).toHaveBeenCalledTimes(1)
    expect(output.result.status).toBe('ok')
    if (output.result.status !== 'ok') {
      throw new Error('expected an "ok" result')
    }

    expect(output.fixOutcomes).toEqual([])
    expect(output.result.reviewReport.providerIssues).toEqual([])
  })
})
