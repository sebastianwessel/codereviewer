// End-to-end (hermetic) coverage that the committed fix-lane fixture exercises
// the spec-12 finding investigation-and-fix lane AND that its real outcomes feed
// the eval fix-lane metrics. A content-aware scripted provider reads the fixture
// file through the mediated `repo_read` tool and judges from what it read: the
// genuine defect (`discount.ts`) is judged `real` with an apply-checked fix; the
// false-positive bait (`validate.ts`, an intentional `== null` idiom) is judged
// `false-positive` with no fix. No real provider is contacted.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type {
  JsonValue,
  ModelMessage,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import {
  AdmittedFindingSchema,
  CodeReviewerConfigSchema,
  type AdmittedFinding
} from '../../shared/contracts/index.js'
import {
  ClaimSchema,
  type Claim
} from '../../shared/contracts/verification/verification.schema.js'
import { runFixRun } from '../verification/index.js'
import { parseEvalCases } from './eval-fixture.schema.js'
import { runEvaluation } from './eval-runner.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.resolve(
  here,
  '../../..',
  'eval/fixtures/typescript/fix-lane/repo'
)

const usage = { inputTokens: 4, outputTokens: 2, totalTokens: 6 }

const provenance = {
  reviewer: 'review-agent',
  instructionHashes: [],
  skillHashes: [],
  signalVersions: {},
  configHash: 'a'.repeat(64)
}

const finding = (over: Partial<AdmittedFinding>): AdmittedFinding =>
  AdmittedFindingSchema.parse({
    id: 'find_x',
    taskId: 'task_x',
    category: 'bug',
    severity: 'high',
    title: 'placeholder',
    description: 'placeholder finding description.',
    location: { path: 'src/discount.ts', startLine: 7, side: 'new' },
    evidenceIds: ['ev_x'],
    proposedBy: 'review-agent',
    admissionStatus: 'admitted',
    admittedAt: '2026-07-23T00:00:00.000Z',
    admissionEvidenceIds: ['ev_x'],
    reporterEligibility: 'inline',
    provenance,
    baselineStatus: 'new',
    fingerprints: [{ algorithm: 'v2', value: 'x' }],
    ...over
  })

const toolResultMessages = (messages: readonly ModelMessage[]) =>
  messages.filter((message) => message.role === 'tool')

const claimFromMessages = (messages: readonly ModelMessage[]): Claim => {
  const userMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'user')
  if (userMessage === undefined || typeof userMessage.content !== 'string') {
    throw new Error('scripted fix provider: no serialized claim in the prompt')
  }
  return ClaimSchema.parse(JSON.parse(userMessage.content))
}

// Reads the claim's file once, then judges from content. A file whose body still
// carries the `FIXME` marker is a real defect (with a scoped, line-accurate fix);
// a clean file is a false positive. The claim text is never trusted.
class ScriptedFixtureProvider implements ModelProvider {
  readonly id = 'openai'
  readonly genAiSystem = 'openai'

  async object<T extends JsonValue = JsonValue>(
    request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    const claim = claimFromMessages(request.messages)
    const targetPath = claim.location?.path ?? 'unknown'
    const toolResults = toolResultMessages(request.messages)

    if (toolResults.length === 0) {
      return {
        object: null as unknown as T,
        toolCalls: [
          { id: 'read', name: 'repo_read', arguments: { path: targetPath } }
        ],
        finishReason: 'tool_calls',
        usage
      }
    }

    const sawFixme = toolResults.some(
      (message) => 'content' in message && message.content.includes('FIXME')
    )
    const startLine = claim.location?.startLine ?? 1

    return {
      object: {
        status: 'uncertain',
        findingJudgment: sawFixme ? 'real' : 'false-positive',
        rationale: sawFixme
          ? 'The percentage discount is subtracted as an absolute amount.'
          : 'The == null comparison is the intended null/undefined idiom.',
        citedEvidenceIds: [],
        ...(sawFixme
          ? {
              fixEdits: [
                {
                  path: targetPath,
                  startLine,
                  endLine: startLine,
                  replacement: '  return amount - (amount * percent) / 100',
                  description: 'Apply the discount proportionally.'
                }
              ]
            }
          : {})
      } as unknown as T,
      finishReason: 'stop',
      usage
    }
  }
}

describe('fix-lane fixture', () => {
  test('judges the genuine defect real+fixed and the bait a false positive, and scores the eval fix metrics', async () => {
    const defect = finding({
      id: 'find_discount',
      title: 'Discount applied as absolute subtraction',
      description:
        'The discount percent is subtracted as an absolute amount from the total.',
      location: { path: 'src/discount.ts', startLine: 7, side: 'new' },
      evidenceIds: ['ev_discount'],
      admissionEvidenceIds: ['ev_discount'],
      fingerprints: [{ algorithm: 'v2', value: 'discount' }]
    })
    const bait = finding({
      id: 'find_validate',
      title: 'Loose equality comparison',
      description: 'The function compares with == null instead of ===.',
      location: { path: 'src/validate.ts', startLine: 7, side: 'new' },
      evidenceIds: ['ev_validate'],
      admissionEvidenceIds: ['ev_validate'],
      fingerprints: [{ algorithm: 'v2', value: 'validate' }]
    })

    const fixRun = await runFixRun({
      config: CodeReviewerConfigSchema.parse({
        provider: { id: 'openai', model: 'gpt-x' },
        fix: { enabled: true }
      }),
      repositoryRoot: fixtureRoot,
      environment: { OPENAI_API_KEY: 'sk-test' },
      admittedFindings: [defect, bait],
      providerImport: async () => ({ openai: () => new ScriptedFixtureProvider() })
    })

    const outcomeByFinding = new Map(
      fixRun.report.fixOutcomes.map((outcome) => [outcome.findingId, outcome])
    )
    expect(outcomeByFinding.get('find_discount')).toMatchObject({
      findingJudgment: 'real',
      fixProduced: true,
      applyCheck: 'passed'
    })
    expect(outcomeByFinding.get('find_validate')).toMatchObject({
      findingJudgment: 'false-positive',
      fixProduced: false,
      applyCheck: 'not-attempted'
    })

    // Feed the lane's REAL outcomes into the eval scorer with the defect as the
    // one expected finding and the bait as an unmatched false positive.
    const cases = parseEvalCases([
      {
        id: 'fix-lane',
        language: 'typescript',
        repositoryFixture: 'fixtures/typescript/fix-lane/repo',
        changedFiles: ['src/discount.ts', 'src/validate.ts'],
        expectedFindings: [
          {
            category: 'bug',
            severity: 'high',
            path: 'src/discount.ts',
            lineRange: [7, 7],
            semanticSummary:
              'discount percent subtracted as an absolute amount from the total'
          }
        ],
        expectedNoFindingZones: [],
        tags: ['fix-lane', 'typescript']
      }
    ])
    const evalResult = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'fix-lane',
          changedLineCount: 16,
          diffHunkCount: 2,
          contextLedger: [],
          fixOutcomes: fixRun.report.fixOutcomes.map((outcome) => ({
            findingId: outcome.findingId,
            ...(outcome.findingJudgment === undefined
              ? {}
              : { findingJudgment: outcome.findingJudgment }),
            fixProduced: outcome.fixProduced,
            applyCheck: outcome.applyCheck
          })),
          result: {
            status: 'ok',
            reviewReport: {
              schemaVersion: '1.0',
              run: {
                runId: 'run-fix-lane',
                startedAt: '2026-07-23T00:00:00.000Z',
                completedAt: '2026-07-23T00:00:01.000Z',
                mode: 'ci',
                depth: 'balanced',
                repositoryRootHash: '1'.repeat(64),
                configHash: '1'.repeat(64),
                durationMs: 1,
                warnings: []
              },
              coverage: {
                status: 'complete',
                reviewableFileCount: 2,
                coveredFileCount: 2,
                reviewableBytes: 2,
                coveredBytes: 2,
                incompleteReasons: [],
                files: []
              },
              admittedFindings: [defect, bait],
              rejectedFindings: [],
              evidence: [
                {
                  id: 'ev_discount',
                  kind: 'diff',
                  summary: 'Discount subtracted as an absolute amount.',
                  location: { path: 'src/discount.ts', startLine: 7, side: 'new' },
                  source: 'typescript-support-signal',
                  redactionApplied: true
                },
                {
                  id: 'ev_validate',
                  kind: 'diff',
                  summary: 'Comparison uses == null.',
                  location: { path: 'src/validate.ts', startLine: 7, side: 'new' },
                  source: 'typescript-support-signal',
                  redactionApplied: true
                }
              ],
              refutationResults: [],
              providerIssues: [],
              skippedFiles: [],
              artifacts: []
            }
          }
        }
      ],
      generatedAt: '2026-07-23T00:00:02.000Z'
    })

    expect(evalResult.report.metrics).toMatchObject({
      fixJudgmentAccuracy: 1,
      fixJudgedFindingCount: 2,
      fixFalsePositiveDetectionRate: 1,
      fixGroundTruthFalsePositiveCount: 1,
      fixProduceRate: 1,
      fixRealFindingCount: 1,
      fixApplyFailureRate: 0,
      fixAttemptedCount: 1
    })
  })
})
