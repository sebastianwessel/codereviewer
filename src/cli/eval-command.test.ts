import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import type {
  JsonValue,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import { runCli } from './index.js'

const createTempDir = async (): Promise<string> => {
  const directory = join(tmpdir(), `codereviewer-eval-cli-${crypto.randomUUID()}`)
  await mkdir(directory, { recursive: true })
  return directory
}

const isFindingRefutationRequest = (request: ObjectRequest): boolean => {
  const schema = request.schema
  const promptText = request.messages
    .map((message) => String(message.content))
    .join('\n')

  return (
    (typeof schema === 'object' &&
      schema !== null &&
      'properties' in schema &&
      typeof schema.properties === 'object' &&
      schema.properties !== null &&
      'verdict' in schema.properties) ||
    promptText.includes('Validate only the provided candidate finding.')
  )
}

const writeSampleEvalCases = async (root: string): Promise<void> => {
  const fixtureDirectory = join(root, 'eval', 'fixtures')
  await mkdir(fixtureDirectory, { recursive: true })
  await mkdir(
    join(root, 'eval', 'fixtures', 'typescript', 'positive', 'src'),
    { recursive: true }
  )
  await mkdir(
    join(root, 'eval', 'fixtures', 'typescript', 'negative', 'src'),
    { recursive: true }
  )
  await writeFile(
    join(root, 'eval', 'fixtures', 'typescript', 'positive', 'src', 'app.ts'),
    'export const value = ;\n'
  )
  await writeFile(
    join(root, 'eval', 'fixtures', 'typescript', 'negative', 'src', 'format.ts'),
    'export const format = (value: string): string => value.trim()\n'
  )
  await writeFile(
    join(fixtureDirectory, 'sample-eval-cases.json'),
    JSON.stringify(
      [
        {
          id: 'typescript-positive',
          language: 'typescript',
          repositoryFixture: 'fixtures/typescript/positive',
          baseRef: 'main',
          headRef: 'HEAD',
          changedFiles: ['src/app.ts'],
          expectedFindings: [],
          expectedNoFindingZones: [],
          tags: ['positive', 'typescript']
        },
        {
          id: 'typescript-negative',
          language: 'typescript',
          repositoryFixture: 'fixtures/typescript/negative',
          baseRef: 'main',
          headRef: 'HEAD',
          changedFiles: ['src/format.ts'],
          expectedFindings: [],
          expectedNoFindingZones: [
            {
              path: 'src/format.ts',
              lineRange: [1, 20],
              reason: 'Formatting-only changes must not produce review findings.'
            }
          ],
          tags: ['negative', 'typescript']
        }
      ],
      null,
      2
    )
  )
}

const writeSliceEvalCase = async (root: string): Promise<void> => {
  const sliceRoot = join(root, 'eval', 'fixtures', 'slices', 'typescript-slice')
  await mkdir(join(sliceRoot, 'repo', 'src'), { recursive: true })
  await writeFile(join(sliceRoot, 'repo', 'src', 'app.ts'), 'export const value = ;\n')
  await writeFile(
    join(sliceRoot, 'slice.json'),
    JSON.stringify(
      {
        id: 'typescript-slice',
        title: 'Self-contained TypeScript slice',
        language: 'typescript',
        changedFiles: ['src/app.ts'],
        expectedFindings: [],
        expectedNoFindingZones: [],
        tags: ['slice', 'typescript', 'positive']
      },
      null,
      2
    )
  )
}

const writeBenchmarkSliceEvalCase = async (root: string): Promise<void> => {
  const sliceRoot = join(root, 'eval', 'benchmarks', 'crb', 'crb-local-1')
  await mkdir(join(sliceRoot, 'repo', 'src'), { recursive: true })
  await writeFile(join(sliceRoot, 'repo', 'src', 'app.ts'), 'export const value = ;\n')
  await writeFile(
    join(sliceRoot, 'slice.json'),
    JSON.stringify(
      {
        id: 'crb-local-1',
        source: 'crb',
        sourceProfile: 'benchmark-semantic',
        prUrl: 'https://github.com/example/repo/pull/1',
        prTitle: 'Syntax regression',
        sourceRepo: 'example/repo',
        language: 'typescript',
        changedFiles: ['src/app.ts'],
        diff: [
          'diff --git a/src/app.ts b/src/app.ts',
          '--- a/src/app.ts',
          '+++ b/src/app.ts',
          '@@ -1,0 +1,2 @@',
          '+export const value = 1',
          '+export const other = 2',
          '@@ -10,0 +12,1 @@',
          '+export const third = 3'
        ].join('\n'),
        expectedFindings: [],
        tags: ['benchmark']
      },
      null,
      2
    )
  )
}

const metricSet = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  parseValidity: 1,
  recall: 1,
  precision: 1,
  f1: 1,
  severityWeightedPrecision: 1,
  severityWeightedRecall: 1,
  severityWeightedF1: 1,
  lineAccuracy: 1,
  severityAccuracy: 1,
  falsePositiveCount: 0,
  noFindingZoneFalsePositiveCount: 0,
  actionableRate: 1,
  commentsPerKloc: 0,
  commentsPerDiffHunk: 0,
  incompleteCoverageRate: 0,
  contextMutationRate: 0,
  providerErrorRate: 0,
  costUsd: 0,
  durationMs: 100,
  ...overrides
})

const evalReport = (
  overrides: {
    readonly metrics?: Record<string, unknown>
    readonly caseResults?: readonly Record<string, unknown>[]
    readonly passed?: boolean
    readonly reasons?: readonly string[]
    readonly failingCaseIds?: readonly string[]
    readonly selection?: Record<string, unknown>
    readonly scoring?: Record<string, unknown>
  } = {}
): Record<string, unknown> => ({
  schemaVersion: '1.0',
  generatedAt: '2026-06-20T00:00:00.000Z',
  fixtureCount: overrides.caseResults?.length ?? 1,
  selection: overrides.selection ?? {
    fixtureSource: 'default',
    caseFilters: [],
    selectedCaseIds: ['case-a']
  },
  scoring: overrides.scoring ?? {
    semanticMatcher: 'deterministic'
  },
  caseResults:
    overrides.caseResults ?? [
      {
        caseId: 'case-a',
        parseValid: true,
        providerErrored: false,
        expectedFindings: [
          {
            expectedIndex: 0,
            category: 'bug',
            severity: 'high',
            path: 'src/app.ts',
            lineRange: [4, 4],
            matchMode: 'path-line',
            semanticSummary: 'incorrect return value from changed branch'
          }
        ],
        matchedFindings: [],
        unmatchedExpectedIndexes: [],
        falsePositiveFindingIds: [],
        falsePositiveFindings: [],
        noFindingZoneFalsePositiveIds: [],
        warnings: [],
        durationMs: 100,
        costUsd: 0
      }
    ],
  metrics: metricSet(overrides.metrics),
  metricGroups: [],
  regressionGate: {
    passed: overrides.passed ?? true,
    reasons: overrides.reasons ?? [],
    thresholds: {
      failOnProviderError: true
    },
    failingCaseIds: overrides.failingCaseIds ?? []
  }
})

class SemanticJudgeCliProvider implements ModelProvider {
  readonly id = 'semantic-judge-cli'
  readonly genAiSystem = 'scripted'
  reasonText = 'Both comments describe the same syntax failure.'
  judgeCalls = 0
  reviewCalls = 0

  async object<T extends JsonValue = JsonValue>(
    request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    if (request.schemaName === 'eval_semantic_match') {
      this.judgeCalls += 1

      return {
        object: {
          match: true,
          reason: this.reasonText
        } as unknown as T,
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        }
      }
    }

    this.reviewCalls += 1

    if (isFindingRefutationRequest(request)) {
      return {
        object: {
          verdict: 'proved',
          rationaleSummary:
            'The reviewed context proves the incomplete export syntax breaks the file.',
          changedBehavior:
            'The changed export leaves the TypeScript file syntactically incomplete.',
          executionOrDataPath:
            'The evaluated slice parses src/app.ts and reaches the incomplete export statement.',
          violatedInvariant:
            'The file must contain valid TypeScript syntax after the review change.',
          impact: 'The project can no longer compile the changed file.',
          introducedByChange:
            'The incomplete export statement is present in the reviewed slice.',
          contradictionChecks: ['No surrounding context completes the export.'],
          fixDirection: 'Complete or remove the malformed export statement.'
        } as unknown as T,
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        }
      }
    }

    return {
      object: {
        suspicions: [
          {
            category: 'bug',
            severity: 'high',
            title: 'Incomplete export declaration breaks review',
            description:
              'The changed file contains an incomplete exported declaration that cannot be parsed.',
            path: 'src/app.ts',
            startLine: 1,
            fixSummary: 'Complete the exported declaration before review.'
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class FailFirstEvalReviewProvider implements ModelProvider {
  readonly id = 'fail-first-eval-review'
  readonly genAiSystem = 'scripted'
  reviewCalls = 0

  async object<T extends JsonValue = JsonValue>(
    request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    if (request.schemaName !== 'eval_semantic_match') {
      this.reviewCalls += 1

      if (this.reviewCalls === 1) {
        throw new Error('provider timed out while reviewing eval case')
      }
    }

    return {
      object: { suspicions: [] } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class ConcurrencyTrackingProvider implements ModelProvider {
  readonly id = 'concurrency-tracking'
  readonly genAiSystem = 'scripted'
  activeReviewCalls = 0
  maxActiveReviewCalls = 0

  async object<T extends JsonValue = JsonValue>(
    request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    if (request.schemaName !== 'eval_semantic_match') {
      this.activeReviewCalls += 1
      this.maxActiveReviewCalls = Math.max(
        this.maxActiveReviewCalls,
        this.activeReviewCalls
      )
      await new Promise((resolve) => setTimeout(resolve, 10))
      this.activeReviewCalls -= 1
    }

    return {
      object: { suspicions: [] } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class AgenticOverrideTrackingProvider implements ModelProvider {
  readonly id = 'agentic-override-tracking'
  readonly genAiSystem = 'scripted'
  intentPlanningCalls = 0
  reviewCalls = 0

  async object<T extends JsonValue = JsonValue>(
    request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    const promptText = request.messages
      .map((message) => String(message.content))
      .join('\n')

    if (promptText.includes('Create a compact review plan')) {
      this.intentPlanningCalls += 1

      return {
        object: {
          intents: []
        } as unknown as T,
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        }
      }
    }

    if (request.schemaName !== 'eval_semantic_match') {
      this.reviewCalls += 1
    }

    return {
      object: { suspicions: [] } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

const writeSemanticJudgeSliceEvalCase = async (root: string): Promise<void> => {
  const sliceRoot = join(root, 'eval', 'benchmarks', 'semantic', 'semantic-local-1')
  await mkdir(join(sliceRoot, 'repo', 'src'), { recursive: true })
  await writeFile(join(sliceRoot, 'repo', 'src', 'app.ts'), 'export const value = ;\n')
  await writeFile(
    join(sliceRoot, 'slice.json'),
    JSON.stringify(
      {
        id: 'semantic-local-1',
        source: 'benchmark',
        sourceProfile: 'benchmark-semantic',
        language: 'typescript',
        changedFiles: ['src/app.ts'],
        diff: [
          'diff --git a/src/app.ts b/src/app.ts',
          '--- a/src/app.ts',
          '+++ b/src/app.ts',
          '@@ -1,0 +1,1 @@',
          '+export const value = ;'
        ].join('\n'),
        expectedFindings: [
          {
            category: 'bug',
            severity: 'high',
            semanticSummary:
              'compiler cannot build because the exported declaration is incomplete',
            matchMode: 'semantic-only'
          }
        ],
        tags: ['benchmark']
      },
      null,
      2
    )
  )
}

describe('eval CLI', () => {
  test('runs eval cases through the product review runner', async () => {
    const root = await createTempDir()

    try {
      await writeSampleEvalCases(root)
      const result = await runCli(['eval', 'run'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('# Evaluation Summary')
      expect(result.stdout).toContain('Gate: PASS')
      expect(result.stdout).toContain('## Artifacts')
      expect(result.stdout).toContain('.codereviewer/eval/eval-report.json')
      expect(result.stdout).toContain('.codereviewer/eval/eval-summary.md')
      expect(result.stdout).toContain('.codereviewer/eval/eval-recall-report.md')
      await expect(stat(join(root, '.codereviewer/eval/eval-report.json'))).resolves.toBeDefined()
      await expect(stat(join(root, '.codereviewer/eval/eval-summary.md'))).resolves.toBeDefined()
      await expect(stat(join(root, '.codereviewer/eval/eval-recall-report.md'))).resolves.toBeDefined()

      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )
      expect(report.schemaVersion).toBe('1.0')
      expect(report.regressionGate.passed).toBe(true)
      expect(report.metrics.recall).toBe(1)
      expect(report.metrics.falsePositiveCount).toBe(0)

      const summary = await readFile(join(root, '.codereviewer/eval/eval-summary.md'), 'utf8')
      expect(summary).toContain('| Case | Profile | Status | Provider | Expected | Matched | Inline | Artifact-only | False positives | Duplicates | Notes |')
      expect(summary).toContain('| typescript-positive | project | PASS | - | 0 | 0 | 0 | 0 | 0 | 0 | - |')
      const recallReport = await readFile(join(root, '.codereviewer/eval/eval-recall-report.md'), 'utf8')
      expect(recallReport).toContain('# Evaluation Recall Report')
      expect(recallReport).toContain('| 0 | 0 | 0 | 0 |')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('archives each eval run while preserving latest artifact paths', async () => {
    const root = await createTempDir()

    try {
      await writeSampleEvalCases(root)
      const result = await runCli(['eval', 'run'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(0)
      await expect(
        stat(join(root, '.codereviewer/eval/eval-report.json'))
      ).resolves.toBeDefined()

      const runIds = await readdir(join(root, '.codereviewer/eval/runs'))
      expect(runIds).toHaveLength(1)
      expect(runIds[0]).toMatch(/^\d{8}T\d{6}[a-z0-9-]+$/u)

      const runRoot = join(root, '.codereviewer/eval/runs', runIds[0]!)
      await expect(stat(join(runRoot, 'eval-report.json'))).resolves.toBeDefined()
      await expect(stat(join(runRoot, 'eval-summary.md'))).resolves.toBeDefined()
      await expect(
        stat(join(runRoot, 'eval-recall-report.md'))
      ).resolves.toBeDefined()

      const archivedSummary = await readFile(
        join(runRoot, 'eval-summary.md'),
        'utf8'
      )
      expect(archivedSummary).toContain(
        `.codereviewer/eval/runs/${runIds[0]}/eval-report.json`
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('writes live debug logs for eval runs through the configured sink', async () => {
    const root = await createTempDir()
    let logs = ''

    try {
      await writeSampleEvalCases(root)

      const result = await runCli(['eval', 'run', '--debug'], {
        cwd: root,
        environment: {},
        logSink: {
          write: (chunk) => {
            logs += chunk
          }
        }
      })

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(logs).toContain('Eval run started.')
      expect(logs).toContain('Repository intake completed.')
      expect(logs).toContain('Eval run completed.')
      expect(logs).not.toContain('export const value')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('writes eval debug logs to an explicit JSONL file without mixing stdout', async () => {
    const root = await createTempDir()

    try {
      await writeSampleEvalCases(root)

      const result = await runCli(
        [
          'eval',
          'run',
          '--debug',
          '--log-file',
          '.codereviewer/eval/log.log'
        ],
        {
          cwd: root,
          environment: {}
        }
      )

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('# Evaluation Summary')

      const logs = await readFile(
        join(root, '.codereviewer/eval/log.log'),
        'utf8'
      )
      const logLines = logs.trim().split(/\r?\n/u)

      expect(logs).toContain('Eval run started.')
      expect(logs).toContain('Eval run completed.')
      expect(logs).not.toContain('# Evaluation Summary')
      expect(logs).not.toContain('export const value')
      expect(logLines.every((line) => JSON.parse(line))).toBe(true)
      expect(logs).toContain('"event":"log-run-start"')

      // A second run must not destroy the first run's log.
      await runCli(
        ['eval', 'run', '--debug', '--log-file', '.codereviewer/eval/log.log'],
        { cwd: root, environment: {} }
      )
      const logsAfterSecondRun = await readFile(
        join(root, '.codereviewer/eval/log.log'),
        'utf8'
      )
      const runStartCount = logsAfterSecondRun
        .trim()
        .split(/\r?\n/u)
        .filter((line) => line.includes('"event":"log-run-start"')).length

      expect(runStartCount).toBe(2)
      expect(
        logsAfterSecondRun
          .trim()
          .split(/\r?\n/u)
          .every((line) => JSON.parse(line))
      ).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('does not load root env file for eval runs', async () => {
    const root = await createTempDir()

    try {
      await writeSampleEvalCases(root)
      await writeFile(
        join(root, '.env'),
        [
          'CODEREVIEWER_PROVIDER_ID=openai',
          'CODEREVIEWER_PROVIDER_MODEL=gpt-test'
        ].join('\n')
      )

      const result = await runCli(['eval', 'run'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(0)
      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )

      expect(report.regressionGate.passed).toBe(true)
      expect(
        report.caseResults.every((caseResult: { providerErrored: boolean }) =>
          caseResult.providerErrored === false
        )
      ).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runs self-contained slice fixtures', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'eval', 'fixtures'), { recursive: true })
      await writeFile(join(root, 'eval', 'fixtures', 'sample-eval-cases.json'), '[]\n')
      await writeSliceEvalCase(root)

      const result = await runCli(['eval', 'run'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Fixtures: 1')
      expect(result.stdout).toContain('| typescript-slice | project | PASS | - | 0 | 0 | 0 | 0 | 0 | 0 | - |')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runs selected benchmark slice root cases', async () => {
    const root = await createTempDir()

    try {
      await writeSampleEvalCases(root)
      await writeBenchmarkSliceEvalCase(root)

      const result = await runCli(
        [
          'eval',
          'run',
          '--slice-root',
          'eval/benchmarks/crb',
          '--case',
          'crb-local-1'
        ],
        {
          cwd: root,
          environment: {}
        }
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Fixtures: 1')
      expect(result.stdout).toContain(
        '| crb-local-1 | benchmark-semantic | PASS | - | 0 | 0 | 0 | 0 | 0 | 0 | - |'
      )
      expect(result.stdout).not.toContain('typescript-positive')
      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )
      expect(report.selection).toEqual({
        fixtureSource: 'slice-root',
        sliceRoot: 'eval/benchmarks/crb',
        caseFilters: ['crb-local-1'],
        selectedCaseIds: ['crb-local-1']
      })
      expect(report.metricGroups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            groupBy: 'sourceProfile',
            key: 'benchmark-semantic',
            fixtureCount: 1,
            caseIds: ['crb-local-1']
          }),
          expect.objectContaining({
            groupBy: 'language',
            key: 'typescript',
            fixtureCount: 1,
            caseIds: ['crb-local-1']
          }),
          expect.objectContaining({
            groupBy: 'tag',
            key: 'benchmark',
            fixtureCount: 1,
            caseIds: ['crb-local-1']
          })
        ])
      )
      expect(report.metrics.commentsPerKloc).toBe(0)
      expect(report.metrics.commentsPerDiffHunk).toBe(0)
      expect(report.caseResults[0].inlineFindingCount).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('uses configured provider as an opt-in semantic judge for benchmark evals', async () => {
    const root = await createTempDir()
    const provider = new SemanticJudgeCliProvider()
    provider.reasonText = 'semantic match '.repeat(40)

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          provider: {
            id: 'openai',
            model: 'judge-model',
            maxRetries: 0
          },
          review: {
            depth: 'fast'
          },
          drift: {
            enabled: false
          }
        })
      )
      await writeSemanticJudgeSliceEvalCase(root)

      const result = await runCli(
        [
          'eval',
          'run',
          '--slice-root',
          'eval/benchmarks/semantic',
          '--semantic-judge'
        ],
        {
          cwd: root,
          environment: {
            OPENAI_API_KEY: 'sk-test'
          },
          ...{
            providerImport: async () => ({
              openai: () => provider
            })
          }
        }
      )

      expect(result.exitCode).toBe(0)
      expect(provider.judgeCalls).toBeGreaterThan(0)
      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )

      expect(report.metrics.recall).toBe(1)
      expect(report.metrics.artifactOnlyRecall).toBe(0)
      expect(report.scoring).toEqual({
        semanticMatcher: 'semantic-judge'
      })
      expect(report.caseResults[0].matchedFindings[0]).toMatchObject({
        semanticScore: 1,
        semanticReason: provider.reasonText
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('retries transient eval provider failures with serial task concurrency', async () => {
    const root = await createTempDir()
    const provider = new FailFirstEvalReviewProvider()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          provider: {
            id: 'openai',
            model: 'review-model',
            maxRetries: 0
          },
          review: {
            depth: 'fast',
            maxConcurrentTasks: 4
          },
          drift: {
            enabled: false
          }
        })
      )
      await mkdir(join(root, 'eval', 'benchmarks', 'retry', 'retry-local', 'repo', 'src'), {
        recursive: true
      })
      await writeFile(
        join(root, 'eval', 'benchmarks', 'retry', 'retry-local', 'repo', 'src', 'safe.ts'),
        'export const safe = 1;\n'
      )
      await writeFile(
        join(root, 'eval', 'benchmarks', 'retry', 'retry-local', 'slice.json'),
        JSON.stringify(
          {
            id: 'retry-local',
            sourceProfile: 'benchmark-semantic',
            language: 'typescript',
            changedFiles: ['src/safe.ts'],
            expectedFindings: [],
            expectedNoFindingZones: [
              {
                path: 'src/safe.ts',
                lineRange: [1, 1],
                reason: 'Safe code should not produce findings.'
              }
            ],
            tags: ['retry']
          },
          null,
          2
        )
      )

      const result = await runCli(
        ['eval', 'run', '--slice-root', 'eval/benchmarks/retry'],
        {
          cwd: root,
          environment: {
            OPENAI_API_KEY: 'sk-test'
          },
          providerImport: async () => ({
            openai: () => provider
          })
        }
      )

      expect(result.exitCode).toBe(0)
      expect(provider.reviewCalls).toBe(2)
      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )

      expect(report.caseResults[0]).toMatchObject({
        caseId: 'retry-local',
        providerErrored: false,
        providerIssues: [
          {
            code: 'provider_timeout',
            recovered: true
          }
        ]
      })
      expect(report.caseResults[0].warnings).toContain(
        'eval-provider-retry:provider_timeout'
      )
      expect(report.metrics.providerErrorRate).toBe(0)
      expect(report.metrics.providerIssueRate).toBe(1)
      expect(report.metrics.providerIssueCount).toBe(1)
      expect(result.stdout).toContain('| Provider issue rate | 100.0% (1 cases) |')
      expect(result.stdout).toContain('| retry-local | PASS | recovered:provider_timeout |')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('overrides eval review concurrency from the CLI', async () => {
    const root = await createTempDir()
    const provider = new ConcurrencyTrackingProvider()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          provider: {
            id: 'openai',
            model: 'review-model',
            maxRetries: 0
          },
          review: {
            depth: 'fast',
            maxConcurrentTasks: 4
          },
          drift: {
            enabled: false
          }
        })
      )
      await mkdir(
        join(root, 'eval', 'benchmarks', 'serial', 'serial-local', 'repo', 'src'),
        { recursive: true }
      )
      for (const fileName of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) {
        await writeFile(
          join(
            root,
            'eval',
            'benchmarks',
            'serial',
            'serial-local',
            'repo',
            'src',
            fileName
          ),
          `export const ${fileName.slice(0, 1)} = 1;\n`
        )
      }
      await writeFile(
        join(root, 'eval', 'benchmarks', 'serial', 'serial-local', 'slice.json'),
        JSON.stringify(
          {
            id: 'serial-local',
            sourceProfile: 'benchmark-semantic',
            language: 'typescript',
            changedFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
            expectedFindings: [],
            expectedNoFindingZones: [],
            tags: ['serial']
          },
          null,
          2
        )
      )

      const result = await runCli(
        [
          'eval',
          'run',
          '--slice-root',
          'eval/benchmarks/serial',
          '--max-concurrent-tasks',
          '1'
        ],
        {
          cwd: root,
          environment: {
            OPENAI_API_KEY: 'sk-test'
          },
          providerImport: async () => ({
            openai: () => provider
          })
        }
      )

      expect(result.exitCode).toBe(0)
      expect(provider.maxActiveReviewCalls).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('overrides eval review mode, depth, intent planning, and optional judge from the CLI', async () => {
    const root = await createTempDir()
    const provider = new AgenticOverrideTrackingProvider()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          provider: {
            id: 'openai',
            model: 'review-model',
            maxRetries: 0
          },
          review: {
            mode: 'local',
            depth: 'fast',
            maxConcurrentTasks: 4
          },
          aiReview: {
            intentPlanning: 'auto',
            judgeFindings: false
          },
          drift: {
            enabled: false
          }
        })
      )
      await mkdir(
        join(root, 'eval', 'benchmarks', 'agentic', 'agentic-local', 'repo', 'src'),
        { recursive: true }
      )
      // Two connected import pairs -> two dependency clusters -> a multi-task run,
      // so the model intent planner runs (it is skipped for single-task runs).
      await writeFile(
        join(root, 'eval', 'benchmarks', 'agentic', 'agentic-local', 'repo', 'src', 'a.ts'),
        "import { b } from './b.js';\nexport const a = b + 1;\n"
      )
      await writeFile(
        join(root, 'eval', 'benchmarks', 'agentic', 'agentic-local', 'repo', 'src', 'b.ts'),
        'export const b = 2;\n'
      )
      await writeFile(
        join(root, 'eval', 'benchmarks', 'agentic', 'agentic-local', 'repo', 'src', 'c.ts'),
        "import { d } from './d.js';\nexport const c = d + 1;\n"
      )
      await writeFile(
        join(root, 'eval', 'benchmarks', 'agentic', 'agentic-local', 'repo', 'src', 'd.ts'),
        'export const d = 4;\n'
      )
      await writeFile(
        join(root, 'eval', 'benchmarks', 'agentic', 'agentic-local', 'slice.json'),
        JSON.stringify(
          {
            id: 'agentic-local',
            sourceProfile: 'benchmark-semantic',
            language: 'typescript',
            changedFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
            expectedFindings: [],
            expectedNoFindingZones: [],
            tags: ['agentic']
          },
          null,
          2
        )
      )

      const result = await runCli(
        [
          'eval',
          'run',
          '--slice-root',
          'eval/benchmarks/agentic',
          '--review-mode',
          'pr',
          '--review-depth',
          'thorough',
          '--intent-planning',
          'model',
          '--judge-findings',
          '--max-concurrent-tasks',
          '1'
        ],
        {
          cwd: root,
          environment: {
            OPENAI_API_KEY: 'sk-test'
          },
          providerImport: async () => ({
            openai: () => provider
          })
        }
      )

      expect(result.exitCode).toBe(0)
      expect(provider.intentPlanningCalls).toBe(1)
      expect(provider.reviewCalls).toBeGreaterThan(0)
      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )
      expect(report.caseResults[0]).toMatchObject({
        caseId: 'agentic-local',
        providerErrored: false
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('prints a deterministic local slice manifest', async () => {
    const root = await createTempDir()

    try {
      await writeBenchmarkSliceEvalCase(root)

      const result = await runCli(
        [
          'eval',
          'slice-manifest',
          '--slice-root',
          'eval/benchmarks/crb'
        ],
        {
          cwd: root,
          environment: {}
        }
      )

      expect(result.exitCode).toBe(0)
      const manifest = JSON.parse(result.stdout)
      expect(manifest).toMatchObject({
        schemaVersion: '1.0',
        sliceRoot: 'eval/benchmarks/crb',
        caseCount: 1,
        caseIds: ['crb-local-1']
      })
      expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/u)
      expect(manifest.cases[0]).toMatchObject({
        id: 'crb-local-1',
        language: 'typescript',
        sourceProfile: 'benchmark-semantic',
        changedFileCount: 1,
        expectedFindingCount: 0,
        semanticOnlyExpectedCount: 0,
        lineBearingExpectedCount: 0,
        repositoryFileCount: 1
      })
      expect(result.stdout).not.toContain('export const value')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('requires slice root for local slice manifests', async () => {
    const root = await createTempDir()

    try {
      const result = await runCli(['eval', 'slice-manifest'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('eval slice-manifest requires --slice-root')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('fails when eval case filters select no loaded cases', async () => {
    const root = await createTempDir()

    try {
      await writeSampleEvalCases(root)

      const result = await runCli(
        ['eval', 'run', '--case', 'missing-case'],
        {
          cwd: root,
          environment: {}
        }
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('eval run selected no cases')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('compares two eval reports with metric and case deltas', async () => {
    const root = await createTempDir()

    try {
      await writeFile(
        join(root, 'base-report.json'),
        JSON.stringify(
          evalReport({
            metrics: {
              recall: 0.5,
              precision: 0.5,
              f1: 0.5,
              severityWeightedF1: 0.5,
              falsePositiveCount: 1,
              durationMs: 200,
              costUsd: 0.2
            },
            passed: false,
            reasons: ['recall below threshold: 0.5 < 1'],
            failingCaseIds: ['case-a'],
            caseResults: [
              {
                caseId: 'case-a',
                parseValid: true,
                providerErrored: false,
                expectedFindings: [
                  {
                    expectedIndex: 0,
                    category: 'bug',
                    severity: 'high',
                    path: 'src/app.ts',
                    lineRange: [4, 4],
                    matchMode: 'path-line',
                    semanticSummary: 'incorrect return value from changed branch'
                  }
                ],
                matchedFindings: [],
                unmatchedExpectedIndexes: [0],
                falsePositiveFindingIds: ['find-noise'],
                falsePositiveFindings: [
                  {
                    findingId: 'find-noise',
                    severity: 'high',
                    category: 'bug',
                    path: 'src/app.ts',
                    line: 1,
                    title: 'Noise'
                  }
                ],
                noFindingZoneFalsePositiveIds: [],
                warnings: [],
                durationMs: 200,
                costUsd: 0.2
              }
            ]
          })
        )
      )
      await writeFile(join(root, 'head-report.json'), JSON.stringify(evalReport()))

      const result = await runCli(
        ['eval', 'compare', '--base', 'base-report.json', '--head', 'head-report.json'],
        {
          cwd: root,
          environment: {}
        }
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('# Evaluation Comparison')
      expect(result.stdout).toContain('| Case set | same |')
      expect(result.stdout).toContain('| Recall | 50.0% | 100.0% | +50.0pp |')
      expect(result.stdout).toContain('| False positives | 1 | 0 | -1 |')
      expect(result.stdout).toContain('| case-a | FAIL | PASS | fixed |')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('warns when comparing eval reports with different selected case sets', async () => {
    const root = await createTempDir()

    try {
      await writeFile(
        join(root, 'base-report.json'),
        JSON.stringify(
          evalReport({
            selection: {
              fixtureSource: 'slice-root',
              sliceRoot: 'eval/benchmarks/a',
              caseFilters: [],
              selectedCaseIds: ['case-a', 'case-b']
            },
            caseResults: [
              {
                caseId: 'case-a',
                parseValid: true,
                providerErrored: false,
                expectedFindings: [],
                matchedFindings: [],
                unmatchedExpectedIndexes: [],
                falsePositiveFindingIds: [],
                falsePositiveFindings: [],
                noFindingZoneFalsePositiveIds: [],
                warnings: [],
                durationMs: 100,
                costUsd: 0
              },
              {
                caseId: 'case-b',
                parseValid: true,
                providerErrored: false,
                expectedFindings: [],
                matchedFindings: [],
                unmatchedExpectedIndexes: [],
                falsePositiveFindingIds: [],
                falsePositiveFindings: [],
                noFindingZoneFalsePositiveIds: [],
                warnings: [],
                durationMs: 100,
                costUsd: 0
              }
            ]
          })
        )
      )
      await writeFile(
        join(root, 'head-report.json'),
        JSON.stringify(
          evalReport({
            scoring: {
              semanticMatcher: 'semantic-judge'
            },
            selection: {
              fixtureSource: 'slice-root',
              sliceRoot: 'eval/benchmarks/b',
              caseFilters: [],
              selectedCaseIds: ['case-a', 'case-c']
            },
            caseResults: [
              {
                caseId: 'case-a',
                parseValid: true,
                providerErrored: false,
                expectedFindings: [],
                matchedFindings: [],
                unmatchedExpectedIndexes: [],
                falsePositiveFindingIds: [],
                falsePositiveFindings: [],
                noFindingZoneFalsePositiveIds: [],
                warnings: [],
                durationMs: 100,
                costUsd: 0
              },
              {
                caseId: 'case-c',
                parseValid: true,
                providerErrored: false,
                expectedFindings: [],
                matchedFindings: [],
                unmatchedExpectedIndexes: [],
                falsePositiveFindingIds: [],
                falsePositiveFindings: [],
                noFindingZoneFalsePositiveIds: [],
                warnings: [],
                durationMs: 100,
                costUsd: 0
              }
            ]
          })
        )
      )

      const result = await runCli(
        ['eval', 'compare', '--base', 'base-report.json', '--head', 'head-report.json'],
        {
          cwd: root,
          environment: {}
        }
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('| Case set | different |')
      expect(result.stdout).toContain('| Semantic matcher | different |')
      expect(result.stdout).toContain('| Slice root | different |')
      expect(result.stdout).toContain('| Base-only cases | case-b |')
      expect(result.stdout).toContain('| Head-only cases | case-c |')
      expect(result.stdout).toContain('Warning: selected case sets differ; aggregate metric deltas are not same-dataset comparable.')
      expect(result.stdout).toContain('Warning: semantic matcher modes differ; aggregate metric deltas are not scoring-mode comparable.')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('prints recall report for one or more saved eval reports', async () => {
    const root = await createTempDir()

    try {
      await writeFile(
        join(root, 'hit-report.json'),
        JSON.stringify(
          evalReport({
            caseResults: [
              {
                caseId: 'case-a',
                parseValid: true,
                providerErrored: false,
                expectedFindings: [
                  {
                    expectedIndex: 0,
                    category: 'bug',
                    severity: 'high',
                    path: 'src/app.ts',
                    lineRange: [4, 4],
                    matchMode: 'path-line',
                    semanticSummary: 'incorrect return value from changed branch'
                  }
                ],
                matchedFindings: [
                  {
                    expectedIndex: 0,
                    findingId: 'find-a',
                    semanticScore: 1,
                    lineOverlaps: true,
                    severityMatches: true
                  }
                ],
                unmatchedExpectedIndexes: [],
                falsePositiveFindingIds: [],
                falsePositiveFindings: [],
                noFindingZoneFalsePositiveIds: [],
                warnings: [],
                durationMs: 100,
                costUsd: 0
              }
            ]
          })
        )
      )
      await writeFile(
        join(root, 'miss-report.json'),
        JSON.stringify(
          evalReport({
            caseResults: [
              {
                caseId: 'case-a',
                parseValid: true,
                providerErrored: false,
                expectedFindings: [
                  {
                    expectedIndex: 0,
                    category: 'bug',
                    severity: 'high',
                    path: 'src/app.ts',
                    lineRange: [4, 4],
                    matchMode: 'path-line',
                    semanticSummary: 'incorrect return value from changed branch'
                  }
                ],
                matchedFindings: [],
                unmatchedExpectedIndexes: [0],
                falsePositiveFindingIds: [],
                falsePositiveFindings: [],
                noFindingZoneFalsePositiveIds: [],
                warnings: [],
                durationMs: 100,
                costUsd: 0
              }
            ]
          })
        )
      )

      const result = await runCli(
        [
          'eval',
          'recall-report',
          '--report',
          'hit-report.json',
          '--report',
          'miss-report.json'
        ],
        {
          cwd: root,
          environment: {}
        }
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('# Evaluation Recall Report')
      expect(result.stdout).toContain('Case set: same')
      expect(result.stdout).toContain('| 1 | 0 | 0 | 1 |')
      expect(result.stdout).toContain('| case-a | 0 | high | src/app.ts:4 | path-line | incorrect return value from changed branch | 1/2 | Y N |')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports missing default recall report input as a config error', async () => {
    const root = await createTempDir()

    try {
      const result = await runCli(['eval', 'recall-report'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('.codereviewer/eval/eval-report.json')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
