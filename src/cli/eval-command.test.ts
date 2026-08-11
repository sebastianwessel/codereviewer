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
import { EVAL_METRICS_VERSION } from '../domains/evaluation/index.js'
import { runCli } from './index.js'

const createTempDir = async (): Promise<string> => {
  const directory = join(tmpdir(), `codereviewer-eval-cli-${crypto.randomUUID()}`)
  await mkdir(directory, { recursive: true })
  return directory
}

// The plausibility judge (schemaName 'eval_plausibility') is a distinct object
// call from review passes and the semantic-match judge. Scripted providers that
// count review passes must answer it with a valid plausibility object and must
// NOT count it as a review call.
const isPlausibilityRequest = (request: ObjectRequest): boolean =>
  request.schemaName === 'eval_plausibility'

const plausibilityObjectResponse = <T extends JsonValue>(): ObjectResponse<T> => ({
  object: {
    plausible: true,
    reason: 'The finding is present in the shown code.'
  } as unknown as T,
  finishReason: 'stop',
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2
  }
})

// Refutation is batched: one call adjudicates every candidate raised for a task and
// asks for a `verdicts` array holding one entry per candidate.
const isFindingRefutationRequest = (request: ObjectRequest): boolean => {
  const schema = request.schema

  return (
    typeof schema === 'object' &&
    schema !== null &&
    'properties' in schema &&
    typeof schema.properties === 'object' &&
    schema.properties !== null &&
    'verdicts' in schema.properties
  )
}

// Each verdict is bound back to its candidate by id, so a scripted refuter has to
// echo the candidate ids it was actually sent.
const refutationCandidateIds = (request: ObjectRequest): readonly string[] => {
  const userMessage = request.messages.find(
    (message) => message.role === 'user'
  )
  const payload = JSON.parse(String(userMessage?.content)) as {
    readonly candidates?: readonly { readonly id: string }[]
  }

  return (payload.candidates ?? []).map((candidate) => candidate.id)
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
  linePlacementRate: null,
  linePlacementCheckCount: 0,
  severityAccuracy: 1,
  // Spelled out rather than left to a default, exactly like `linePlacementRate`
  // above: a rate with an empty denominator is `null` in this contract and has
  // no default to fall back on, so a fixture that omits it is not a report.
  fixJudgmentAccuracy: null,
  fixFalsePositiveDetectionRate: null,
  fixProduceRate: null,
  fixApplyFailureRate: null,
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
    readonly outcome?: 'passed' | 'failed' | 'not-evaluable'
    readonly reasons?: readonly string[]
    readonly notEvaluableReasons?: readonly string[]
    readonly failingCaseIds?: readonly string[]
    readonly selection?: Record<string, unknown>
    readonly scoring?: Record<string, unknown>
  } = {}
): Record<string, unknown> => ({
  schemaVersion: '1.0',
  // The producer contract requires both: it carries no defaults for a report an
  // older build wrote, so a fixture that omits them is not a report this build
  // could have produced and must not stand in for one.
  metricsVersion: EVAL_METRICS_VERSION,
  provenance: {
    answerKeyDigest: 'a'.repeat(64),
    answerKeyDigestByCase: { 'case-a': 'a'.repeat(64) },
    configHash: 'b'.repeat(64)
  },
  generatedAt: '2026-06-20T00:00:00.000Z',
  fixtureCount: overrides.caseResults?.length ?? 1,
  selection: overrides.selection ?? {
    fixtureSource: 'default',
    caseFilters: [],
    selectedCaseIds: ['case-a']
  },
  scoring: overrides.scoring ?? {
    judgeAgreement: 1,
    judgeTrustworthy: true
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
            diffScope: 'undetermined',
            semanticSummary: 'incorrect return value from changed branch'
          }
        ],
        matchedFindings: [],
        unmatchedExpectedIndexes: [],
        falsePositiveFindingIds: [],
        producedFindings: [],
        noFindingZoneFalsePositiveIds: [],
        warnings: [],
        durationMs: 100,
        costUsd: 0
      }
    ],
  metrics: metricSet(overrides.metrics),
  metricGroups: [],
  regressionGate: {
    outcome: overrides.outcome ?? 'passed',
    reasons: overrides.reasons ?? [],
    notEvaluableReasons: overrides.notEvaluableReasons ?? [],
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

    if (request.schemaName === 'eval_plausibility') {
      return {
        object: {
          plausible: true,
          reason: 'The finding is present in the shown code.'
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
          verdicts: refutationCandidateIds(request).map((candidateId) => ({
            candidateId,
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
            contradictionChecks: [
              'No surrounding context completes the export.'
            ],
            fixDirection: 'Complete or remove the malformed export statement.'
          }))
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
        findings: [
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

// Records the raw text of every request the run made, whatever its stage, so a
// test can ask whether a piece of repository content reached the provider AT
// ALL. Reading the capability flag back out of provenance proves the pin was
// recorded; this proves it was obeyed — and the change-intent brief reaches the
// model through the summarizer call before it ever reaches a discovery packet,
// so a check scoped to review calls would miss half the exposure.
class RequestTextRecordingProvider extends SemanticJudgeCliProvider {
  readonly requestTexts: string[] = []

  override async object<T extends JsonValue = JsonValue>(
    request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requestTexts.push(
      request.messages.map((message) => String(message.content)).join('\n')
    )

    return super.object(request)
  }
}

// Records the model each call was made against, split by whether the call is a
// judge call (semantic match / plausibility) or a review call. That split is the
// only way to prove the scorer moved WITHOUT the subject moving with it, which
// is the entire point of pinning the judge model. Scripted answers are inherited
// unchanged so this class asserts nothing about review behaviour.
class ModelRecordingJudgeProvider extends SemanticJudgeCliProvider {
  readonly judgeModels: string[] = []
  readonly reviewModels: string[] = []

  override async object<T extends JsonValue = JsonValue>(
    request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    if (
      request.schemaName === 'eval_semantic_match' ||
      request.schemaName === 'eval_plausibility'
    ) {
      this.judgeModels.push(request.model)
    } else {
      this.reviewModels.push(request.model)
    }

    return super.object(request)
  }
}

// Like `SemanticJudgeCliProvider`, but the match and plausibility verdicts are
// script-controlled per test so a case can be driven to a specific, non-perfect
// recall/false-positive outcome (`SemanticJudgeCliProvider` always answers
// "match", so it can only ever produce a recall of 1).
class ConfigurableSemanticJudgeProvider implements ModelProvider {
  readonly id = 'configurable-semantic-judge'
  readonly genAiSystem = 'scripted'
  matchResult = true
  plausibleResult = true

  async object<T extends JsonValue = JsonValue>(
    request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    if (request.schemaName === 'eval_semantic_match') {
      return {
        object: {
          match: this.matchResult,
          reason: 'Scripted judge decision for regression-gate testing.'
        } as unknown as T,
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
      }
    }

    if (request.schemaName === 'eval_plausibility') {
      return {
        object: {
          plausible: this.plausibleResult,
          reason: 'Scripted plausibility decision for regression-gate testing.'
        } as unknown as T,
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
      }
    }

    if (isFindingRefutationRequest(request)) {
      return {
        object: {
          verdicts: refutationCandidateIds(request).map((candidateId) => ({
            candidateId,
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
            contradictionChecks: [
              'No surrounding context completes the export.'
            ],
            fixDirection: 'Complete or remove the malformed export statement.'
          }))
        } as unknown as T,
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
      }
    }

    return {
      object: {
        findings: [
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
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
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
    if (isPlausibilityRequest(request)) {
      return plausibilityObjectResponse<T>()
    }

    if (request.schemaName !== 'eval_semantic_match') {
      this.reviewCalls += 1

      if (this.reviewCalls === 1) {
        throw new Error('provider timed out while reviewing eval case')
      }
    }

    return {
      object: { findings: [] } as unknown as T,
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
    if (isPlausibilityRequest(request)) {
      return plausibilityObjectResponse<T>()
    }

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
      object: { findings: [] } as unknown as T,
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
  reviewCalls = 0

  async object<T extends JsonValue = JsonValue>(
    request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    if (isPlausibilityRequest(request)) {
      return plausibilityObjectResponse<T>()
    }

    if (request.schemaName !== 'eval_semantic_match') {
      this.reviewCalls += 1
    }

    return {
      object: { findings: [] } as unknown as T,
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

// Change-intent content that exists in exactly one place, so finding it in a
// request is proof that ingestion ran. The INBOX provider carries it rather than
// the `changed-files` one: a changed markdown file is also a reviewed source
// file, so its text would reach the packet whether ingestion ran or not, and the
// assertion would prove nothing.
const contextInboxMarker = 'INTENT-BRIEF-MARKER-9f2c'

const writeContextInboxFile = async (root: string): Promise<void> => {
  const inboxDirectory = join(
    root,
    'eval',
    'benchmarks',
    'semantic',
    'semantic-local-1',
    'repo',
    '.codereviewer',
    'context'
  )
  await mkdir(inboxDirectory, { recursive: true })
  await writeFile(
    join(inboxDirectory, 'ticket.md'),
    `---\ntitle: Ticket\n---\n\n${contextInboxMarker}\n`
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
      expect(report.regressionGate.outcome).toBe('passed')
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

      expect(report.regressionGate.outcome).toBe('passed')
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

  test('uses the configured provider as the semantic judge for benchmark evals', async () => {
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
        ['eval', 'run', '--slice-root', 'eval/benchmarks/semantic'],
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
      expect(report.caseResults[0].matchedFindings[0]).toMatchObject({
        semanticReason: provider.reasonText
      })
      // A provider that answers "match" to everything fails the calibration set,
      // so the run must declare its own quality metrics untrustworthy.
      expect(report.scoring.judgeTrustworthy).toBe(false)
      expect(report.scoring.judgeAgreement).toBeLessThan(0.9)
      expect(report.metrics.judgeAgreementPairCount).toBeGreaterThan(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The judge model is pinnable independently of the reviewer's, and UNSET must
  // stay exactly what it always was: both judges scored by the reviewer's own
  // model. This is the "nothing changed" half of that contract.
  test('scores with the reviewer model when no judge model is pinned', async () => {
    const root = await createTempDir()
    const provider = new ModelRecordingJudgeProvider()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          provider: {
            id: 'openai',
            model: 'reviewer-model',
            maxRetries: 0
          },
          review: { depth: 'fast' },
          drift: { enabled: false }
        })
      )
      await writeSemanticJudgeSliceEvalCase(root)

      const result = await runCli(
        ['eval', 'run', '--slice-root', 'eval/benchmarks/semantic'],
        {
          cwd: root,
          environment: { OPENAI_API_KEY: 'sk-test' },
          providerImport: async () => ({ openai: () => provider })
        }
      )

      expect(result.exitCode).toBe(0)
      expect(provider.judgeModels.length).toBeGreaterThan(0)
      expect(provider.reviewModels.length).toBeGreaterThan(0)
      expect([...new Set(provider.judgeModels)]).toEqual(['reviewer-model'])
      expect([...new Set(provider.reviewModels)]).toEqual(['reviewer-model'])

      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )

      expect(report.provenance.modelName).toBe('reviewer-model')
      // Recorded even when it was never pinned: a report must be able to name
      // its judge, and "same as the reviewer" is an answer, not an absence.
      expect(report.provenance.judgeModelName).toBe('reviewer-model')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Without this, setting `CODEREVIEWER_PROVIDER_MODEL` to compare two reviewer
  // models also swapped the scorer, so a recall difference had two
  // indistinguishable explanations and no model comparison was interpretable.
  test('pins the judges to their own model while the reviewer keeps its own', async () => {
    const root = await createTempDir()
    const provider = new ModelRecordingJudgeProvider()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          provider: {
            id: 'openai',
            model: 'reviewer-model',
            maxRetries: 0
          },
          evaluation: {
            judgeModel: 'pinned-judge-model'
          },
          review: { depth: 'fast' },
          drift: { enabled: false }
        })
      )
      await writeSemanticJudgeSliceEvalCase(root)

      const result = await runCli(
        ['eval', 'run', '--slice-root', 'eval/benchmarks/semantic'],
        {
          cwd: root,
          environment: { OPENAI_API_KEY: 'sk-test' },
          providerImport: async () => ({ openai: () => provider })
        }
      )

      expect(result.exitCode).toBe(0)
      expect(provider.judgeModels.length).toBeGreaterThan(0)
      expect(provider.reviewModels.length).toBeGreaterThan(0)
      expect([...new Set(provider.judgeModels)]).toEqual(['pinned-judge-model'])
      // The review under test is untouched: only the scorer moved.
      expect([...new Set(provider.reviewModels)]).toEqual(['reviewer-model'])

      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )

      expect(report.provenance.modelName).toBe('reviewer-model')
      expect(report.provenance.judgeModelName).toBe('pinned-judge-model')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The committed evaluation configuration (`eval-capability-pins.ts`). Spec 11
  // once claimed eval runs ingested no external context "as a property of the
  // committed evaluation configuration"; there was no such file, and when
  // `contextSources` went on by default on 2026-08-11 every eval run silently
  // started injecting a change-intent brief into discovery. These two tests are
  // the two halves the claim needs: the pin holds against a config that asks for
  // the opposite, and the escape from it is explicit.
  test('holds the pinned capability set against a repository config that asks for the opposite', async () => {
    const root = await createTempDir()
    const provider = new RequestTextRecordingProvider()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          provider: { id: 'openai', model: 'reviewer-model', maxRetries: 0 },
          review: { depth: 'fast' },
          drift: { enabled: false },
          // Exactly what an ordinary repository config says today, since this is
          // the shipped default.
          contextSources: { enabled: true }
        })
      )
      await writeSemanticJudgeSliceEvalCase(root)
      await writeContextInboxFile(root)

      const result = await runCli(
        ['eval', 'run', '--slice-root', 'eval/benchmarks/semantic'],
        {
          cwd: root,
          environment: { OPENAI_API_KEY: 'sk-test' },
          providerImport: async () => ({ openai: () => provider })
        }
      )

      expect(result.exitCode).toBe(0)

      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )

      // Observable in the artifact, not merely believed: the capability
      // provenance is read off the same effective config the cases ran under.
      expect(report.provenance.capabilities['contextSources.enabled']).toBe(false)
      // And obeyed. The inbox file is the only place this marker exists, so its
      // absence from every request proves no provider gathered it.
      expect(provider.requestTexts.length).toBeGreaterThan(0)
      expect(provider.requestTexts.join('\n')).not.toContain(contextInboxMarker)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The other half. A pin a maintainer cannot leave deliberately is a pin that
  // gets deleted the first time an A/B needs the other arm — and the owed
  // `contextSources` on-vs-off comparison is exactly that A/B.
  test('takes an explicit --capability override and records the overridden value', async () => {
    const root = await createTempDir()
    const provider = new RequestTextRecordingProvider()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          provider: { id: 'openai', model: 'reviewer-model', maxRetries: 0 },
          review: { depth: 'fast' },
          drift: { enabled: false }
        })
      )
      await writeSemanticJudgeSliceEvalCase(root)
      await writeContextInboxFile(root)

      const result = await runCli(
        [
          'eval',
          'run',
          '--slice-root',
          'eval/benchmarks/semantic',
          '--capability',
          'contextSources.enabled=true'
        ],
        {
          cwd: root,
          environment: { OPENAI_API_KEY: 'sk-test' },
          providerImport: async () => ({ openai: () => provider })
        }
      )

      expect(result.exitCode).toBe(0)

      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )

      expect(report.provenance.capabilities['contextSources.enabled']).toBe(true)
      expect(provider.requestTexts.join('\n')).toContain(contextInboxMarker)
      // On stderr, not only in the log: the default logging level is `silent`,
      // and a run that quietly left the pinned baseline is how an incomparable
      // number gets into the ledger.
      expect(result.stderr).toContain('not comparable to a pinned baseline')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refuses a --capability flag the eval configuration does not pin', async () => {
    const root = await createTempDir()

    try {
      await writeSampleEvalCases(root)

      const result = await runCli(
        ['eval', 'run', '--capability', 'drift.enabled=false'],
        { cwd: root, environment: {} }
      )

      // Exit 2, not a silently ignored flag: `drift` is governed by the config
      // file, and accepting it here would offer two ways to set one value.
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('does not pin')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Before this fix, the semantic-match judge and the plausibility judge made
  // real provider calls but nothing read `response.usage`, so their tokens and
  // cost were counted nowhere: every published cost figure was a floor, not a
  // total. This proves the CLI wraps the judge model alias in the same
  // usage-recorder mechanism the review path uses, so judge/plausibility spend
  // now shows up as its OWN metric, separate from (and in addition to) the
  // review-only cost/token figures.
  test('captures judge and plausibility-judge spend as a separate scoring metric', async () => {
    const root = await createTempDir()
    const provider = new SemanticJudgeCliProvider()

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
        ['eval', 'run', '--slice-root', 'eval/benchmarks/semantic'],
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
      expect(provider.judgeCalls).toBeGreaterThan(0)
      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )

      // Judge/plausibility calls each report usage of 1 input + 1 output token
      // (see `SemanticJudgeCliProvider`); at least the semantic-match call and
      // its calibration pairs ran, so scoring tokens must be strictly positive.
      expect(report.metrics.scoringInputTokens).toBeGreaterThan(0)
      expect(report.metrics.scoringOutputTokens).toBeGreaterThan(0)
      // Review-only token/cost figures come solely from the review pass and
      // must stay unaffected by judge spend: no double counting either way.
      expect(report.metrics.inputTokens).toBeGreaterThan(0)
      expect(report.metrics.scoringInputTokens).not.toBe(report.metrics.inputTokens)

      // A monotonic top-level wall-clock timer for the whole run, distinct
      // from `durationMs` (which only sums each case's own review time).
      expect(typeof report.metrics.elapsedMs).toBe('number')
      expect(report.metrics.elapsedMs).toBeGreaterThanOrEqual(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('fails with a config error when a positive case has no judge provider', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'eval', 'fixtures'), { recursive: true })
      await writeFile(join(root, 'eval', 'fixtures', 'sample-eval-cases.json'), '[]\n')
      await writeSemanticJudgeSliceEvalCase(root)

      const result = await runCli(
        ['eval', 'run', '--slice-root', 'eval/benchmarks/semantic'],
        {
          cwd: root,
          environment: {}
        }
      )

      // No provider means no semantic judge; the engine must never fall back to
      // a heuristic for a case that declares expected findings.
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('eval_semantic_judge_missing')
      expect(result.stderr).toContain('semantic-local-1')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Regression coverage for the eval regression gate defaulting to a threshold
  // set that cannot pass (hard-coded `minRecall: 1, maxFalsePositiveCount: 0`).
  // This run is scripted to miss its one expected finding (recall 0) AND raise
  // a genuine false positive, which used to fail every provider-backed run
  // regardless of actual review quality. The default `stable` profile must
  // still pass because it gates only on parse validity and provider errors.
  test('the default stable gate profile passes despite imperfect recall and a false positive', async () => {
    const root = await createTempDir()
    const provider = new ConfigurableSemanticJudgeProvider()
    provider.matchResult = false
    provider.plausibleResult = false

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
        ['eval', 'run', '--slice-root', 'eval/benchmarks/semantic'],
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

      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )

      // Sanity check that this run genuinely has imperfect recall and a real
      // false positive — otherwise the gate passing would prove nothing.
      expect(report.metrics.recall).toBeLessThan(1)
      expect(report.metrics.falsePositiveCount).toBeGreaterThan(0)
      expect(report.metrics.genuineFalsePositiveCount).toBeGreaterThan(0)

      expect(report.regressionGate.outcome).toBe('passed')
      expect(report.regressionGate.reasons).toEqual([])
      expect(report.regressionGate.thresholds).toEqual({
        minParseValidity: 1,
        failOnProviderError: true
      })
      expect(result.exitCode).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // A gate that cannot evaluate its own condition exits neither 0 nor 1.
  // Exiting 0 would report a pass nothing established; exiting 1 would report a
  // missing measurement as a quality failure. `4` is this CLI's refusal code.
  test('exits 4 when a cost threshold cannot be evaluated', async () => {
    const root = await createTempDir()
    const provider = new ConfigurableSemanticJudgeProvider()

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
          },
          evaluation: {
            regressionGate: {
              overrides: { maxCostUsd: 100 }
            }
          }
        })
      )
      await writeSemanticJudgeSliceEvalCase(root)

      const result = await runCli(
        ['eval', 'run', '--slice-root', 'eval/benchmarks/semantic'],
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

      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )

      // The premise: this run has no price for its model, so its cost total is
      // a floor sitting far below a deliberately generous threshold.
      expect(report.metrics.costUnavailableCount).toBeGreaterThan(0)
      expect(report.metrics.costUsd).toBeLessThan(100)

      expect(report.regressionGate.outcome).toBe('not-evaluable')
      expect(report.regressionGate.reasons).toEqual([])
      expect(report.regressionGate.notEvaluableReasons).toEqual([
        expect.stringContaining('costUsd not evaluable against threshold 100')
      ])
      expect(result.stdout).toContain('Gate: NOT EVALUABLE')
      expect(result.exitCode).toBe(4)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Same scripted run as above, but opting into the `strict` profile (the
  // historical hard-coded behaviour) via the CLI flag must still fail on the
  // same imperfect recall, proving the perfect-score gate remains available as
  // an explicit choice rather than having been deleted outright.
  test('--gate-profile strict restores the perfect-score gate and fails on imperfect recall', async () => {
    const root = await createTempDir()
    const provider = new ConfigurableSemanticJudgeProvider()
    provider.matchResult = false
    provider.plausibleResult = false

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
          '--gate-profile',
          'strict'
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

      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )

      expect(report.metrics.recall).toBeLessThan(1)
      expect(report.regressionGate.outcome).toBe('failed')
      expect(report.regressionGate.reasons).toEqual(
        expect.arrayContaining([expect.stringContaining('recall below threshold')])
      )
      expect(report.regressionGate.thresholds).toEqual({
        minParseValidity: 1,
        minRecall: 1,
        maxFalsePositiveCount: 0,
        failOnProviderError: true
      })
      expect(result.exitCode).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // A config-level override must layer on top of the resolved profile without
  // requiring the `strict` profile wholesale, proving
  // `evaluation.regressionGate.overrides` is actually read.
  test('evaluation.regressionGate.overrides tightens the stable profile from config alone', async () => {
    const root = await createTempDir()
    const provider = new ConfigurableSemanticJudgeProvider()
    provider.matchResult = false
    provider.plausibleResult = false

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
          },
          evaluation: {
            regressionGate: {
              overrides: {
                minRecall: 1
              }
            }
          }
        })
      )
      await writeSemanticJudgeSliceEvalCase(root)

      const result = await runCli(
        ['eval', 'run', '--slice-root', 'eval/benchmarks/semantic'],
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

      const report = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )

      expect(report.regressionGate.outcome).toBe('failed')
      // The override adds `minRecall` but the profile is still `stable`, so
      // `maxFalsePositiveCount` (never set) must NOT appear in the resolved
      // thresholds.
      expect(report.regressionGate.thresholds).toEqual({
        minParseValidity: 1,
        failOnProviderError: true,
        minRecall: 1
      })
      expect(result.exitCode).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Regression coverage for the eval report's `generatedAt` being frozen to a
  // committed literal timestamp, which made run ordering depend on directory
  // names rather than the report's own data.
  test('generatedAt reflects the injected clock, defaulting to the real clock', async () => {
    const root = await createTempDir()

    try {
      await writeSampleEvalCases(root)

      const injectedNow = new Date('2030-05-17T12:34:56.000Z')
      const injectedResult = await runCli(['eval', 'run'], {
        cwd: root,
        environment: {},
        now: () => injectedNow
      })
      expect(injectedResult.exitCode).toBe(0)
      const injectedReport = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )
      expect(injectedReport.generatedAt).toBe('2030-05-17T12:34:56.000Z')

      const beforeRealRun = Date.now()
      const realResult = await runCli(['eval', 'run'], {
        cwd: root,
        environment: {}
      })
      const afterRealRun = Date.now()
      expect(realResult.exitCode).toBe(0)
      const realReport = JSON.parse(
        await readFile(join(root, '.codereviewer/eval/eval-report.json'), 'utf8')
      )
      const realGeneratedAtMs = new Date(realReport.generatedAt as string).getTime()

      // Not the historical frozen literal, and within the window the run
      // actually executed in — proof it stamps the real wall clock rather
      // than a fixed value baked into the CLI.
      expect(realReport.generatedAt).not.toBe('2026-06-20T00:00:02.000Z')
      expect(realGeneratedAtMs).toBeGreaterThanOrEqual(beforeRealRun)
      expect(realGeneratedAtMs).toBeLessThanOrEqual(afterRealRun)
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
      // The first holistic pass fails and the case retries; the successful retry
      // runs one holistic discovery pass (1 call), so 2 total.
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

  test('overrides eval review mode, depth, and concurrency from the CLI', async () => {
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
            outcome: 'failed',
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
                    diffScope: 'undetermined',
                    semanticSummary: 'incorrect return value from changed branch'
                  }
                ],
                matchedFindings: [],
                unmatchedExpectedIndexes: [0],
                falsePositiveFindingIds: ['find-noise'],
                producedFindings: [
                  {
                    findingId: 'find-noise',
                    severity: 'high',
                    category: 'bug',
                    path: 'src/app.ts',
                    line: 1,
                    title: 'Noise',
                    proposedBy: 'review-agent',
                    evidenceCount: 1,
                    hasFixProposal: false,
                    relatedLocationCount: 0,
                    dataFlowCount: 0,
                    cweCount: 0
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

  // An arm is a SET of runs: this project's decision rule requires several runs
  // per arm, and one report against one report discards most of the evidence
  // that was paid for.
  test('compares multi-run arms from repeatable --base and --head flags', async () => {
    const root = await createTempDir()
    const caseResults = (
      matched: readonly number[]
    ): readonly Record<string, unknown>[] => [
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
            diffScope: 'in-diff',
            semanticSummary: 'incorrect return value from changed branch'
          }
        ],
        matchedFindings: matched.map((expectedIndex) => ({
          expectedIndex,
          findingId: 'find-1',
          severityMatches: true,
          lineOverlaps: true
        })),
        unmatchedExpectedIndexes: matched.length === 0 ? [0] : [],
        falsePositiveFindingIds: [],
        producedFindings: [],
        noFindingZoneFalsePositiveIds: [],
        warnings: [],
        durationMs: 100,
        costUsd: 0
      }
    ]

    try {
      for (const index of [1, 2, 3]) {
        await writeFile(
          join(root, `base-${index}.json`),
          JSON.stringify(evalReport({ caseResults: caseResults([]) }))
        )
        await writeFile(
          join(root, `head-${index}.json`),
          JSON.stringify(evalReport({ caseResults: caseResults([0]) }))
        )
      }

      const result = await runCli(
        [
          'eval',
          'compare',
          '--base',
          'base-1.json',
          '--base',
          'base-2.json',
          '--base',
          'base-3.json',
          '--head',
          'head-1.json',
          '--head',
          'head-2.json',
          '--head',
          'head-3.json'
        ],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(
        'Base arm: 3 runs — base-1.json, base-2.json, base-3.json'
      )
      expect(result.stdout).toContain('### in-diff (headline)')
      // One expectation moved in all three run pairs. That is ONE gained
      // observation, not three.
      expect(result.stdout).toContain('| Gained (head only) | 1 |')
      expect(result.stdout).toContain('| Discordant pairs | 1 |')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refuses arms of different sizes rather than comparing what lines up', async () => {
    const root = await createTempDir()

    try {
      await writeFile(join(root, 'base-1.json'), JSON.stringify(evalReport()))
      await writeFile(join(root, 'base-2.json'), JSON.stringify(evalReport()))
      await writeFile(join(root, 'head-1.json'), JSON.stringify(evalReport()))

      const result = await runCli(
        [
          'eval',
          'compare',
          '--base',
          'base-1.json',
          '--base',
          'base-2.json',
          '--head',
          'head-1.json'
        ],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain(
        'eval compare requires the same number of --base and --head reports; got 2 base and 1 head'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refuses a report whose cases errored, rather than pooling recall 0.0%', async () => {
    const root = await createTempDir()

    try {
      await writeFile(join(root, 'base-1.json'), JSON.stringify(evalReport()))
      await writeFile(
        join(root, 'head-1.json'),
        JSON.stringify(
          evalReport({ metrics: { recall: 0, providerErrorRate: 1 } })
        )
      )

      const result = await runCli(
        ['eval', 'compare', '--base', 'base-1.json', '--head', 'head-1.json'],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('refuses reports with provider errors')
      expect(result.stderr).toContain('100% errored')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refuses arms scored by different judge models', async () => {
    const root = await createTempDir()

    try {
      const withJudge = (judge: string) => ({
        ...evalReport(),
        provenance: { modelName: 'reviewer-model', judgeModelName: judge }
      })
      await writeFile(join(root, 'base-1.json'), JSON.stringify(withJudge('judge-a')))
      await writeFile(join(root, 'head-1.json'), JSON.stringify(withJudge('judge-b')))

      const result = await runCli(
        ['eval', 'compare', '--base', 'base-1.json', '--head', 'head-1.json'],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('different judge models')
      expect(result.stderr).toContain('judge-a')
      expect(result.stderr).toContain('judge-b')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // An archived report records no judge model, and on those runs the judge WAS
  // the reviewer's model. Treating that as "unknown" would refuse every
  // historical comparison; treating it as the reviewer's model is what it is.
  test('compares an archived report against a pinned one naming the same judge', async () => {
    const root = await createTempDir()

    try {
      await writeFile(
        join(root, 'base-1.json'),
        JSON.stringify({ ...evalReport(), provenance: { modelName: 'shared-model' } })
      )
      await writeFile(
        join(root, 'head-1.json'),
        JSON.stringify({
          ...evalReport(),
          provenance: { modelName: 'shared-model', judgeModelName: 'shared-model' }
        })
      )

      const result = await runCli(
        ['eval', 'compare', '--base', 'base-1.json', '--head', 'head-1.json'],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // A capability difference is WARNED about, never refused: measuring what one
  // flag does by running both sides is the comparison this command exists for.
  // Staying silent is the failure mode — the difference explains every delta
  // below it, and before provenance recorded the flags a reader had only two
  // opaque config hashes to spot it with.
  test('warns, without refusing, when the arms enabled different capabilities', async () => {
    const root = await createTempDir()

    try {
      const withCapabilities = (
        capabilities: Record<string, boolean>
      ): Record<string, unknown> => ({
        ...evalReport(),
        provenance: { modelName: 'shared-model', capabilities }
      })
      await writeFile(
        join(root, 'base-1.json'),
        JSON.stringify(
          withCapabilities({ 'fix.enabled': false, 'skills.enabled': false })
        )
      )
      await writeFile(
        join(root, 'head-1.json'),
        JSON.stringify(
          withCapabilities({ 'fix.enabled': true, 'skills.enabled': false })
        )
      )

      const result = await runCli(
        ['eval', 'compare', '--base', 'base-1.json', '--head', 'head-1.json'],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('# Evaluation Comparison')
      expect(result.stderr).toContain('different capabilities')
      expect(result.stderr).toContain('fix.enabled (true: head-1.json; false: base-1.json)')
      // A capability both arms agree on is not a difference and must not be
      // listed, or the warning becomes a config dump nobody reads.
      expect(result.stderr).not.toContain('skills.enabled')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('says nothing when both arms enabled the same capabilities', async () => {
    const root = await createTempDir()

    try {
      const report = {
        ...evalReport(),
        provenance: {
          modelName: 'shared-model',
          capabilities: { 'fix.enabled': false }
        }
      }
      await writeFile(join(root, 'base-1.json'), JSON.stringify(report))
      await writeFile(join(root, 'head-1.json'), JSON.stringify(report))

      const result = await runCli(
        ['eval', 'compare', '--base', 'base-1.json', '--head', 'head-1.json'],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Absent capabilities mean NOT RECORDED, never "nothing was enabled". Silence
  // there would let a report archived before the field existed pass as agreeing
  // with a report that genuinely recorded every flag as off.
  test('warns that a report recording no capabilities cannot rule a difference out', async () => {
    const root = await createTempDir()

    try {
      await writeFile(
        join(root, 'base-1.json'),
        JSON.stringify({ ...evalReport(), provenance: { modelName: 'shared-model' } })
      )
      await writeFile(
        join(root, 'head-1.json'),
        JSON.stringify({
          ...evalReport(),
          provenance: {
            modelName: 'shared-model',
            capabilities: { 'fix.enabled': true }
          }
        })
      )

      const result = await runCli(
        ['eval', 'compare', '--base', 'base-1.json', '--head', 'head-1.json'],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('record no capability flags')
      expect(result.stderr).toContain('base-1.json')
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
                producedFindings: [],
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
                producedFindings: [],
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
              judgeAgreement: 0.6,
              judgeTrustworthy: false
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
                producedFindings: [],
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
                producedFindings: [],
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
      expect(result.stdout).toContain('| Judge agreement | 100.0% -> 60.0% |')
      expect(result.stdout).toContain('| Judge trustworthy | yes -> no |')
      expect(result.stdout).toContain('| Slice root | different |')
      expect(result.stdout).toContain('| Base-only cases | case-b |')
      expect(result.stdout).toContain('| Head-only cases | case-c |')
      expect(result.stdout).toContain('Warning: selected case sets differ; aggregate metric deltas are not same-dataset comparable.')
      expect(result.stdout).toContain(
        'Warning: a compared report marks its semantic judge as untrustworthy; metric deltas may reflect judge error rather than review quality.'
      )
      expect(result.stdout).toContain(
        'Warning: judge agreement differs materially (100.0% vs 60.0%); metric deltas may reflect judge variance rather than review quality.'
      )
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
                    diffScope: 'undetermined',
                    semanticSummary: 'incorrect return value from changed branch'
                  }
                ],
                matchedFindings: [
                  {
                    expectedIndex: 0,
                    findingId: 'find-a',
                    semanticReason: 'Both summaries describe the same defect.',
                    lineOverlaps: true,
                    severityMatches: true,
                    producedPath: 'src/app.ts',
                    producedStartLine: 4
                  }
                ],
                unmatchedExpectedIndexes: [],
                falsePositiveFindingIds: [],
                producedFindings: [],
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
                    diffScope: 'undetermined',
                    semanticSummary: 'incorrect return value from changed branch'
                  }
                ],
                matchedFindings: [],
                unmatchedExpectedIndexes: [0],
                falsePositiveFindingIds: [],
                producedFindings: [],
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
