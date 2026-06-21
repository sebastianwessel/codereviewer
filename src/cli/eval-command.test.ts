import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
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
  } = {}
): Record<string, unknown> => ({
  schemaVersion: '1.0',
  generatedAt: '2026-06-20T00:00:00.000Z',
  fixtureCount: overrides.caseResults?.length ?? 1,
  caseResults:
    overrides.caseResults ?? [
      {
        caseId: 'case-a',
        parseValid: true,
        providerErrored: false,
        matchedFindings: [],
        unmatchedExpectedIndexes: [],
        falsePositiveFindingIds: [],
        noFindingZoneFalsePositiveIds: [],
        warnings: [],
        durationMs: 100,
        costUsd: 0
      }
    ],
  metrics: metricSet(overrides.metrics),
  regressionGate: {
    passed: overrides.passed ?? true,
    reasons: overrides.reasons ?? [],
    thresholds: {
      failOnProviderError: true
    },
    failingCaseIds: overrides.failingCaseIds ?? []
  }
})

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
      await expect(stat(join(root, '.review/eval/eval-report.json'))).resolves.toBeDefined()
      await expect(stat(join(root, '.review/eval/eval-summary.md'))).resolves.toBeDefined()

      const report = JSON.parse(
        await readFile(join(root, '.review/eval/eval-report.json'), 'utf8')
      )
      expect(report.schemaVersion).toBe('1.0')
      expect(report.regressionGate.passed).toBe(true)
      expect(report.metrics.recall).toBe(1)
      expect(report.metrics.falsePositiveCount).toBe(0)

      const summary = await readFile(join(root, '.review/eval/eval-summary.md'), 'utf8')
      expect(summary).toContain('| Case | Status | Expected | Matched | False positives | Notes |')
      expect(summary).toContain('| typescript-positive | PASS | 1 | 1 | 0 | - |')
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
      expect(result.stdout).toContain('| typescript-slice | PASS | 1 | 1 | 0 | - |')
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
                matchedFindings: [],
                unmatchedExpectedIndexes: [0],
                falsePositiveFindingIds: ['find-noise'],
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
      expect(result.stdout).toContain('| Recall | 50.0% | 100.0% | +50.0pp |')
      expect(result.stdout).toContain('| False positives | 1 | 0 | -1 |')
      expect(result.stdout).toContain('| case-a | FAIL | PASS | fixed |')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
