// Integration test for the finding investigation-and-fix lane (spec 12 "Testing").
// It drives the real `investigate_claim` harness agent through `runFixRun` — the
// same agent verification uses — with a hermetic scripted provider that bases its
// judgment on what the mediated `repo_read` actually returned. A genuine defect
// yields `real` plus an apply-checked fix that enriches the finding's
// `fixProposal`; a planted non-defect yields `false-positive` and no fix. The lane
// is advisory: it never changes severity, admission, or the quality gate.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
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
  ReviewReportSchema,
  type AdmittedFinding,
  type CodeReviewerConfig
} from '../../shared/contracts/index.js'
import {
  ClaimSchema,
  type Claim
} from '../../shared/contracts/verification/verification.schema.js'
import { renderMarkdownReport, renderSarifReport } from '../reporting/index.js'
import { runFixRun, resolveFixMinSeverity } from './fix-run.js'

const BUG_MARKER = 'BUG_HERE'
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
    admittedAt: '2026-07-23T00:00:00.000Z',
    admissionEvidenceIds: ['ev_defect1'],
    reporterEligibility: 'inline',
    provenance,
    baselineStatus: 'new',
    fingerprints: [{ algorithm: 'v2', value: 'defect1' }],
    ...over
  })

const toolResultMessages = (messages: readonly ModelMessage[]) =>
  messages.filter((message) => message.role === 'tool')

const sawMarker = (messages: readonly ModelMessage[]): boolean =>
  toolResultMessages(messages).some(
    (message) => 'content' in message && message.content.includes(BUG_MARKER)
  )

const claimFromMessages = (messages: readonly ModelMessage[]): Claim => {
  const userMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'user')
  if (userMessage === undefined || typeof userMessage.content !== 'string') {
    throw new Error('scripted fix provider: no serialized claim in the prompt')
  }
  return ClaimSchema.parse(JSON.parse(userMessage.content))
}

// A content-aware provider: read the claim's file once, then judge. A file that
// still shows the marker is a real defect (with a scoped, line-accurate fix); a
// clean file is a false positive. The claim text is never trusted for the verdict.
class ScriptedFixProvider implements ModelProvider {
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
        toolCalls: [{ id: 'read', name: 'repo_read', arguments: { path: targetPath } }],
        finishReason: 'tool_calls',
        usage
      }
    }

    const isReal = sawMarker(request.messages)
    const startLine = claim.location?.startLine ?? 1

    return {
      object: {
        status: 'uncertain',
        findingJudgment: isReal ? 'real' : 'false-positive',
        rationale: isReal
          ? 'The changed branch still returns the wrong value.'
          : 'The code path is correct; the reported defect is not present.',
        citedEvidenceIds: [],
        ...(isReal
          ? {
              fixEdits: [
                {
                  path: targetPath,
                  startLine,
                  endLine: startLine,
                  replacement: '  return computedValue',
                  description: 'Return the computed value.'
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

const fixConfig = (over: Record<string, unknown>): CodeReviewerConfig =>
  CodeReviewerConfigSchema.parse({
    provider: { id: 'openai', model: 'gpt-x' },
    fix: { enabled: true },
    ...over
  })

describe('runFixRun', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fix-run-'))
    await mkdir(path.join(root, 'src'), { recursive: true })
    // A genuine defect: line 4 still carries the marker.
    await writeFile(
      path.join(root, 'src', 'app.ts'),
      ['function f() {', '  const computedValue = 1', '  if (cond)', `  return wrong // ${BUG_MARKER}`, '}'].join('\n')
    )
    // A clean file: the reported defect is not present.
    await writeFile(
      path.join(root, 'src', 'clean.ts'),
      ['function g() {', '  return safeValue()', '}'].join('\n')
    )
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('is disabled by default and returns findings unchanged', async () => {
    const target = finding({})
    const result = await runFixRun({
      config: CodeReviewerConfigSchema.parse({}),
      repositoryRoot: root,
      environment: {},
      admittedFindings: [target]
    })
    expect(result.findings[0]).toEqual(target)
    expect(result.report.fixOutcomes).toHaveLength(0)
  })

  test('enriches a real finding with an apply-checked fix and appears in reports', async () => {
    const defect = finding({})
    const nonDefect = finding({
      id: 'find_clean1',
      title: 'Suspected null deref',
      location: { path: 'src/clean.ts', startLine: 2, side: 'new' },
      evidenceIds: ['ev_clean1'],
      admissionEvidenceIds: ['ev_clean1'],
      fingerprints: [{ algorithm: 'v2', value: 'clean1' }]
    })

    const result = await runFixRun({
      config: fixConfig({}),
      repositoryRoot: root,
      environment: { OPENAI_API_KEY: 'sk-test' },
      admittedFindings: [defect, nonDefect],
      providerImport: async () => ({ openai: () => new ScriptedFixProvider() })
    })

    const enrichedDefect = result.findings.find((f) => f.id === 'find_defect1')!
    const enrichedNonDefect = result.findings.find((f) => f.id === 'find_clean1')!

    // Real finding: fixProposal enriched with the apply-checked edit.
    expect(enrichedDefect.fixProposal?.safety).toBe('manual-review')
    expect(enrichedDefect.fixProposal?.edits?.[0]?.replacement).toBe('  return computedValue')
    // Advisory only: severity/category/admission/fingerprints unchanged.
    expect(enrichedDefect.severity).toBe('high')
    expect(enrichedDefect.category).toBe('bug')
    expect(enrichedDefect.admissionStatus).toBe('admitted')
    expect(enrichedDefect.fingerprints).toEqual(defect.fingerprints)

    // False positive: the finding is NOT removed and NOT enriched.
    expect(enrichedNonDefect).toEqual(nonDefect)

    // Advisory outcomes are surfaced in the flow report.
    const outcomeByFinding = new Map(
      result.report.fixOutcomes.map((outcome) => [outcome.findingId, outcome])
    )
    expect(outcomeByFinding.get('find_defect1')).toMatchObject({
      findingJudgment: 'real',
      fixProduced: true,
      applyCheck: 'passed'
    })
    expect(outcomeByFinding.get('find_clean1')).toMatchObject({
      findingJudgment: 'false-positive',
      fixProduced: false,
      applyCheck: 'not-attempted'
    })

    // The enriched fix flows to the Markdown and SARIF reporters.
    const report = ReviewReportSchema.parse({
      schemaVersion: '1.0',
      run: {
        runId: 'test-fix-run',
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
      admittedFindings: [enrichedDefect],
      rejectedFindings: [],
      evidence: [
        {
          id: 'ev_defect1',
          kind: 'diff',
          summary: 'Changed branch returns an incorrect value.',
          location: { path: 'src/app.ts', startLine: 4, side: 'new' },
          source: 'typescript-support-signal',
          redactionApplied: true
        }
      ],
      refutationResults: [],
      providerIssues: [],
      skippedFiles: [],
      artifacts: []
    })

    const markdown = renderMarkdownReport(report)
    expect(markdown).toContain('return computedValue')
    const sarif = JSON.parse(
      renderSarifReport(report, {
        category: 'codereviewer',
        maxResults: 5000,
        target: 'generic'
      })
    )
    expect(JSON.stringify(sarif)).toContain('return computedValue')
  })

  test('gates findings below the resolved minSeverity (default tracks the review threshold)', async () => {
    // Default minSeverity tracks aiReview.actionableSeverityThreshold (medium), so
    // a low-severity finding is not investigated at all.
    const lowFinding = finding({
      id: 'find_low1',
      severity: 'low',
      location: { path: 'src/app.ts', startLine: 4, side: 'new' }
    })

    const result = await runFixRun({
      config: fixConfig({}),
      repositoryRoot: root,
      environment: { OPENAI_API_KEY: 'sk-test' },
      admittedFindings: [lowFinding],
      providerImport: async () => ({ openai: () => new ScriptedFixProvider() })
    })

    // No eligible finding → empty report, findings untouched.
    expect(result.findings[0]).toEqual(lowFinding)
    expect(result.report.fixOutcomes).toHaveLength(0)
  })
})

describe('resolveFixMinSeverity', () => {
  test('defaults to the AI review actionable severity threshold', () => {
    expect(
      resolveFixMinSeverity(CodeReviewerConfigSchema.parse({}))
    ).toBe('medium')
  })

  test('tracks a customised actionableSeverityThreshold when fix.minSeverity is unset', () => {
    expect(
      resolveFixMinSeverity(
        CodeReviewerConfigSchema.parse({
          aiReview: { actionableSeverityThreshold: 'high' },
          fix: { enabled: true }
        })
      )
    ).toBe('high')
  })

  test('an explicit fix.minSeverity overrides the threshold', () => {
    expect(
      resolveFixMinSeverity(
        CodeReviewerConfigSchema.parse({
          aiReview: { actionableSeverityThreshold: 'high' },
          fix: { enabled: true, minSeverity: 'info' }
        })
      )
    ).toBe('info')
  })
})
