import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
          expectedFindings: [
            {
              category: 'bug',
              severity: 'high',
              path: 'src/app.ts',
              lineRange: [1, 1],
              semanticSummary:
                'parse diagnostic blocks reliable review syntax reported typescript analyzer'
            }
          ],
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
        expectedFindings: [
          {
            category: 'bug',
            severity: 'high',
            path: 'src/app.ts',
            lineRange: [1, 1],
            semanticSummary:
              'parse diagnostic blocks reliable review syntax reported typescript analyzer'
          }
        ],
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
        expected: [
          {
            line: null,
            lineEnd: null,
            type: 'bug',
            severity: 'high',
            description:
              'parse diagnostic blocks reliable review syntax reported typescript analyzer'
          }
        ],
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
          confidence: 0.91,
          reasoning: 'Both comments describe the same syntax failure.'
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

    return {
      object: { candidates: [] } as unknown as T,
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
        expected: [
          {
            line: null,
            lineEnd: null,
            type: 'bug',
            severity: 'high',
            description:
              'compiler cannot build because the exported declaration is incomplete'
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
      expect(result.stdout).toContain('.review/eval/eval-report.json')
      expect(result.stdout).toContain('.review/eval/eval-summary.md')
      expect(result.stdout).toContain('.review/eval/eval-recall-report.md')
      await expect(stat(join(root, '.review/eval/eval-report.json'))).resolves.toBeDefined()
      await expect(stat(join(root, '.review/eval/eval-summary.md'))).resolves.toBeDefined()
      await expect(stat(join(root, '.review/eval/eval-recall-report.md'))).resolves.toBeDefined()

      const report = JSON.parse(
        await readFile(join(root, '.review/eval/eval-report.json'), 'utf8')
      )
      expect(report.schemaVersion).toBe('1.0')
      expect(report.regressionGate.passed).toBe(true)
      expect(report.metrics.recall).toBe(1)
      expect(report.metrics.falsePositiveCount).toBe(0)

      const summary = await readFile(join(root, '.review/eval/eval-summary.md'), 'utf8')
      expect(summary).toContain('| Case | Profile | Status | Expected | Matched | Inline | False positives | Notes |')
      expect(summary).toContain('| typescript-positive | project | PASS | 1 | 1 | 0 | 0 | - |')
      const recallReport = await readFile(join(root, '.review/eval/eval-recall-report.md'), 'utf8')
      expect(recallReport).toContain('# Evaluation Recall Report')
      expect(recallReport).toContain('| typescript-positive | 0 | high | src/app.ts:1 | path-line |')
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
        await readFile(join(root, '.review/eval/eval-report.json'), 'utf8')
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
      expect(result.stdout).toContain('| typescript-slice | project | PASS | 1 | 1 | 0 | 0 | - |')
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
        '| crb-local-1 | benchmark-semantic | PASS | 1 | 1 | 1 | 0 | - |'
      )
      expect(result.stdout).not.toContain('typescript-positive')
      const report = JSON.parse(
        await readFile(join(root, '.review/eval/eval-report.json'), 'utf8')
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
      expect(report.metrics.commentsPerKloc).toBe(333.333333)
      expect(report.metrics.commentsPerDiffHunk).toBe(0.5)
      expect(report.caseResults[0].inlineFindingCount).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('uses configured provider as an opt-in semantic judge for benchmark evals', async () => {
    const root = await createTempDir()
    const provider = new SemanticJudgeCliProvider()

    try {
      await mkdir(join(root, '.review'), { recursive: true })
      await writeFile(
        join(root, '.review', 'config.json'),
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
        await readFile(join(root, '.review/eval/eval-report.json'), 'utf8')
      )

      expect(report.metrics.recall).toBe(1)
      expect(report.scoring).toEqual({
        semanticMatcher: 'semantic-judge'
      })
      expect(report.caseResults[0].matchedFindings[0]).toMatchObject({
        semanticScore: 0.91
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
        expectedFindingCount: 1,
        semanticOnlyExpectedCount: 1,
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
      expect(result.stderr).toContain('.review/eval/eval-report.json')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
