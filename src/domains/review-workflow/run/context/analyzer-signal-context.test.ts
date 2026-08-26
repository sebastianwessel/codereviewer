// Wiring coverage for spec 15, Mechanism 2: ingested analyzer results reach the
// review as UNTRUSTED EVIDENCE on the task packet, and reach it by no other route.
// The two properties worth holding onto are that the disabled path changes nothing
// at all, and that the enabled path adds context and evidence but never a candidate.
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Logger } from '@purista/harness'
import { CodeReviewerConfigSchema } from '../../../../shared/contracts/index.js'
import { createNoContentEventRecorder } from '../../../observability/index.js'
import {
  TaskReviewInputSchema,
  WorkflowReviewTaskSchema
} from '../../pipeline/agent-contracts.js'
import { buildReviewText } from '../../pipeline/discovery/review-packet.js'
import type { ContextAssemblyResult } from './context.js'
import { prepareReviewRunnerAnalyzerSignalContext } from './analyzer-signal-context.js'

const silentLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => silentLogger
}

const fixturePath = (name: string): string =>
  fileURLToPath(
    new URL(`../../../analyzer-ingestion/fixtures/${name}`, import.meta.url)
  )

const orderTask = WorkflowReviewTaskSchema.parse({
  id: 'task_0a1b2c3d4e5f6071',
  round: 1,
  kind: 'file',
  paths: ['src/service/orders.ts'],
  priority: 1,
  reviewContext: [
    {
      kind: 'file',
      path: 'src/service/orders.ts',
      startLine: 1,
      endLine: 1,
      content: 'const value = 1',
      ledgerEntryId: 'ctx_0a1b2c3d4e5f6071'
    }
  ]
})

const unrelatedTask = WorkflowReviewTaskSchema.parse({
  id: 'task_1a1b2c3d4e5f6071',
  round: 1,
  kind: 'file',
  paths: ['src/service/unrelated.ts'],
  priority: 1,
  reviewContext: []
})

const assembledContextWith = (
  tasks: readonly (typeof orderTask)[]
): ContextAssemblyResult => ({
  reviewContext: [],
  tasks,
  instructions: [],
  skills: [],
  skillDefinitions: {},
  skillIds: [],
  contextLedger: [],
  referencedDefinitionsDroppedCount: 0,
  referencedDefinitionsUnreadableCount: 0,
      redactedContextSpanCount: 0
})

const changedRanges = [
  {
    path: 'src/service/orders.ts',
    startLine: 40,
    endLine: 48,
    changeKind: 'modified' as const
  }
]

const enabledConfig = CodeReviewerConfigSchema.parse({
  security: {
    signals: {
      enabled: true,
      artifacts: [{ path: 'reports/analyzer.sarif.json' }]
    }
  }
})

let repositoryRoot: string

beforeEach(async () => {
  repositoryRoot = await mkdtemp(path.join(tmpdir(), 'analyzer-signal-context-'))
  await mkdir(path.join(repositoryRoot, 'reports'), { recursive: true })
  await copyFile(
    fixturePath('analyzer-results.sarif.json'),
    path.join(repositoryRoot, 'reports', 'analyzer.sarif.json')
  )
})

afterEach(async () => {
  await rm(repositoryRoot, { recursive: true, force: true })
})

describe('prepareReviewRunnerAnalyzerSignalContext', () => {
  test('disabled, it returns the assembled context unchanged and reads no artifact', async () => {
    const assembledContext = assembledContextWith([orderTask])
    const result = await prepareReviewRunnerAnalyzerSignalContext({
      repositoryRoot,
      config: CodeReviewerConfigSchema.parse({}),
      assembledContext,
      changedRanges,
      observability: createNoContentEventRecorder(),
      logger: silentLogger
    })

    expect(result.assembledContext).toBe(assembledContext)
    expect(result.evidence).toEqual([])
    expect(result.warnings).toEqual([])
  })

  test('enabled, it attaches an analyzer-signal document to the task that owns the file', async () => {
    const result = await prepareReviewRunnerAnalyzerSignalContext({
      repositoryRoot,
      config: enabledConfig,
      assembledContext: assembledContextWith([orderTask, unrelatedTask]),
      changedRanges,
      observability: createNoContentEventRecorder(),
      logger: silentLogger
    })
    const [withAlerts, withoutAlerts] = result.assembledContext.tasks
    const document = withAlerts?.reviewContext.find(
      (entry) => entry.kind === 'analyzer-signal'
    )

    expect(document?.content).toContain('security/query-injection')
    // A task whose files no alert names gets NO section, rather than one that reads
    // as an all-clear.
    expect(
      withoutAlerts?.reviewContext.some(
        (entry) => entry.kind === 'analyzer-signal'
      )
    ).toBe(false)
  })

  test('the attached document reaches the discovery prompt', async () => {
    const result = await prepareReviewRunnerAnalyzerSignalContext({
      repositoryRoot,
      config: enabledConfig,
      assembledContext: assembledContextWith([orderTask]),
      changedRanges,
      observability: createNoContentEventRecorder(),
      logger: silentLogger
    })
    const task = result.assembledContext.tasks[0]

    if (task === undefined) {
      throw new Error('expected a task')
    }

    const reviewText = buildReviewText(
      TaskReviewInputSchema.parse({
        task,
        reviewedDiffRanges: [],
        evidence: [],
        candidates: [],
        skills: [],
        provenance: {
          reviewer: 'review-agent',
          signalVersions: {},
          configHash: 'a'.repeat(64)
        }
      }),
      ''
    )

    expect(reviewText).toContain('Analyzer results (untrusted third-party output')
    expect(reviewText).toContain('security/query-injection')
    expect(reviewText).toContain('is a CLAIM, not a proven defect')
  })

  test('it produces evidence records and no candidate', async () => {
    const result = await prepareReviewRunnerAnalyzerSignalContext({
      repositoryRoot,
      config: enabledConfig,
      assembledContext: assembledContextWith([orderTask]),
      changedRanges,
      observability: createNoContentEventRecorder(),
      logger: silentLogger
    })

    // The seed-vs-evidence decision, asserted: ingestion has an evidence output and
    // no candidate output at all, so an alert cannot become a finding without a
    // model raising it and refutation plus admission accepting it.
    expect(result.evidence.length).toBeGreaterThan(0)
    expect(result.evidence.every((record) => record.kind === 'diagnostic')).toBe(
      true
    )
    expect(Object.keys(result)).toEqual([
      'assembledContext',
      'evidence',
      'warnings'
    ])
  })

  test('it discloses what was held back', async () => {
    const result = await prepareReviewRunnerAnalyzerSignalContext({
      repositoryRoot,
      config: enabledConfig,
      assembledContext: assembledContextWith([orderTask]),
      changedRanges,
      observability: createNoContentEventRecorder(),
      logger: silentLogger
    })

    expect(result.warnings.join('\n')).toContain(
      'have no changed-side cause and are NOT reported'
    )
  })

  test('a missing artifact fails the run rather than reporting no security signals', async () => {
    await rm(path.join(repositoryRoot, 'reports', 'analyzer.sarif.json'))

    await expect(
      prepareReviewRunnerAnalyzerSignalContext({
        repositoryRoot,
        config: enabledConfig,
        assembledContext: assembledContextWith([orderTask]),
        changedRanges,
        observability: createNoContentEventRecorder(),
        logger: silentLogger
      })
    ).rejects.toMatchObject({ code: 'analyzer_artifact_unreadable' })
  })
})

// The disabled path must be byte-for-byte what it was before this feature existed
// (spec 15). An unconditional empty section entry in the packet builder would add
// one newline to EVERY prompt the engine sends, including runs that never enabled
// the block.
describe('discovery packet without analyzer signals', () => {
  test('a task carrying no analyzer-signal document renders no extra whitespace', () => {
    const taskInput = TaskReviewInputSchema.parse({
      task: orderTask,
      reviewedDiffRanges: [],
      evidence: [],
      candidates: [],
      skills: [],
      provenance: {
        reviewer: 'review-agent',
        signalVersions: {},
        configHash: 'a'.repeat(64)
      }
    })

    expect(buildReviewText(taskInput, '')).toBe(
      [
        `Review task ${orderTask.id}.`,
        '',
        '',
        '',
        '## Files under review (full content, line-numbered) - THIS is what you review',
        '### FILE: src/service/orders.ts',
        '1: const value = 1',
        '',
        ''
      ].join('\n')
    )
  })
})
