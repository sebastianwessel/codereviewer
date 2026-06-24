import { describe, expect, test } from 'vitest'
import {
  TaskReviewInputSchema,
  type ModelHolisticReviewResult,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { ReviewWorkflowInputSchema } from '../contracts.js'
import { runModelBackedHolisticTaskReview } from './holistic-task-review.js'

const configHash =
  '3333333333333333333333333333333333333333333333333333333333333333'

const task: WorkflowReviewTask = {
  id: 'task_holistic',
  kind: 'file',
  round: 1,
  paths: ['src/app.ts'],
  factIds: [],
  evidenceIds: [],
  candidateIds: [],
  contextEntryIds: [],
  priority: 1,
  reviewContext: [
    {
      kind: 'file',
      path: 'src/app.ts',
      content: 'export const value = 1\n',
      ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
    }
  ]
}

const taskInput = TaskReviewInputSchema.parse({
  runId: 'run-holistic',
  task,
  reviewedDiffRanges: [{ path: 'src/app.ts', startLine: 1, endLine: 1 }],
  evidence: [],
  candidates: [],
  instructions: [],
  skills: [],
  sharedDigest: 'digest',
  provenance: {
    reviewer: 'review-agent',
    modelProvider: 'openai',
    modelName: 'holistic-test',
    signalVersions: { typescript: '6.0.3' },
    configHash
  }
})

const workflowInput = ReviewWorkflowInputSchema.parse({
  runId: 'run-holistic',
  reviewedPaths: ['src/app.ts'],
  evidence: [],
  candidates: [],
  instructions: [],
  skills: [],
  provenance: {
    reviewer: 'review-agent',
    modelProvider: 'openai',
    modelName: 'holistic-test',
    signalVersions: { typescript: '6.0.3' },
    configHash
  }
})

const holisticResultWith = (
  findings: readonly unknown[]
): ModelHolisticReviewResult => ({ findings: [...findings] })

describe('runModelBackedHolisticTaskReview', () => {
  test('maps holistic findings in scope to candidates and drops the rest', async () => {
    const result = await runModelBackedHolisticTaskReview({
      workflowInput,
      taskInput,
      task,
      runners: {
        holisticReview: async () =>
          holisticResultWith([
            {
              category: 'bug',
              severity: 'high',
              title: 'Unconditional cache write on error path',
              description:
                'The result is assigned to the cache even when the fetch returned an error.',
              path: 'src/app.ts',
              startLine: 10
            },
            {
              // out of scope: path not in task.paths -> dropped
              category: 'bug',
              severity: 'high',
              title: 'Unrelated file defect',
              description: 'A defect in a file with no reviewed change.',
              path: 'src/other.ts',
              startLine: 3
            },
            {
              // missing required fields (no path/startLine) -> dropped
              category: 'bug',
              severity: 'medium',
              title: 'Vague concern',
              description: 'No location provided.'
            }
          ])
      },
      logger: { debug: () => {} }
    })

    // Three findings in, only the in-scope, fully-specified one becomes a
    // candidate; the others (out-of-scope path, missing location) are dropped.
    expect(result.candidates).toHaveLength(1)
    const candidate = result.candidates[0]!
    expect(candidate.proposedBy).toBe('review-agent')
    expect(candidate.location).toEqual({
      path: 'src/app.ts',
      startLine: 10,
      side: 'file'
    })
    expect(candidate.id).toMatch(/^cand_[0-9a-f]{16}$/u)
    // Discovery emits candidates directly for the shared refutation/admission
    // filter; no diagnostic artifacts are produced.
    expect(result.evidenceRecords).toEqual([])
    expect(result.providerIssues).toEqual([])
  })

  test('presents the per-path raw unified diff and full file in reviewText', async () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,1 +1,1 @@',
      '-export const value = 0',
      '+export const value = 1',
      'diff --git a/src/other.ts b/src/other.ts',
      '@@ -5,1 +5,1 @@',
      '-const x = 1',
      '+const x = 2'
    ].join('\n')
    const workflowInputWithDiff = ReviewWorkflowInputSchema.parse({
      runId: 'run-holistic',
      reviewedPaths: ['src/app.ts'],
      reviewedDiffText: diff,
      evidence: [],
      candidates: [],
      instructions: [],
      skills: [],
      provenance: {
        reviewer: 'review-agent',
        modelProvider: 'openai',
        modelName: 'holistic-test',
        signalVersions: { typescript: '6.0.3' },
        configHash
      }
    })
    let captured: { reviewText: string } | undefined
    await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithDiff,
      taskInput,
      task,
      runners: {
        holisticReview: async (holisticInput) => {
          captured = holisticInput
          return { findings: [] }
        }
      },
      logger: { debug: () => {} }
    })

    expect(captured?.reviewText).toContain('+export const value = 1')
    // Only the task's path is included, not unrelated files in the diff blob.
    expect(captured?.reviewText).not.toContain('src/other.ts')
    // Full file content is still present for context.
    expect(captured?.reviewText).toContain('1: export const value = 1')
  })

  test('includes referenced-definition context in its own section without affecting finding scope', async () => {
    const taskWithReferencedDefinition: WorkflowReviewTask = {
      ...task,
      reviewContext: [
        ...task.reviewContext,
        {
          kind: 'referenced-definition',
          path: 'src/dep.ts',
          content: '1: export const calc = (value: number): number => value * 2',
          ledgerEntryId: 'ctx_bbbbbbbbbbbbbbbbbbbbbbbb'
        }
      ]
    }
    const taskInputWithReferencedDefinition = TaskReviewInputSchema.parse({
      ...taskInput,
      task: taskWithReferencedDefinition
    })

    let captured: { reviewText: string } | undefined
    const result = await runModelBackedHolisticTaskReview({
      workflowInput,
      taskInput: taskInputWithReferencedDefinition,
      task: taskWithReferencedDefinition,
      runners: {
        holisticReview: async (holisticInput) => {
          captured = holisticInput
          return holisticResultWith([
            // A finding pointing at the referenced-definition file (NOT a changed
            // file) must still be dropped: findings are restricted to task.paths.
            {
              category: 'bug',
              severity: 'high',
              title: 'Defect in a referenced (unchanged) dependency',
              description: 'Pointed at a referenced-definition file.',
              path: 'src/dep.ts',
              startLine: 1
            }
          ])
        }
      },
      logger: { debug: () => {} }
    })

    // Referenced definition appears in its own context-only section.
    expect(captured?.reviewText).toContain(
      '## Referenced definitions (from unchanged files, for context only)'
    )
    expect(captured?.reviewText).toContain('### DEFINITION: src/dep.ts')
    expect(captured?.reviewText).toContain('export const calc')
    // The changed file remains in the changed-files section.
    expect(captured?.reviewText).toContain('### FILE: src/app.ts')
    // Findings for the referenced-definition file are dropped (not a task path).
    expect(result.candidates).toHaveLength(0)
  })

  test('pass 2 reuses the pass-1 base prefix (cacheable) and appends its findings', async () => {
    const reviewTexts: string[] = []
    await runModelBackedHolisticTaskReview({
      workflowInput,
      taskInput,
      task,
      runners: {
        holisticReview: async (holisticInput) => {
          reviewTexts.push(holisticInput.reviewText)
          return reviewTexts.length === 1
            ? holisticResultWith([
                {
                  category: 'bug',
                  severity: 'high',
                  title: 'Pass-one defect',
                  description: 'Found by the general pass.',
                  path: 'src/app.ts',
                  startLine: 1
                }
              ])
            : holisticResultWith([])
        }
      },
      logger: { debug: () => {} }
    })

    expect(reviewTexts).toHaveLength(2)
    // Pass 2 starts with the IDENTICAL pass-1 text (shared prompt-cache prefix).
    expect(reviewTexts[1]!.startsWith(reviewTexts[0]!)).toBe(true)
    // ...then appends the focused-lens section that lists pass-1's findings.
    expect(reviewTexts[1]).toContain('## Second-pass focused re-review')
    expect(reviewTexts[1]).toContain('Pass-one defect (src/app.ts:1)')
    // The base (pass 1) must NOT contain the second-pass section.
    expect(reviewTexts[0]).not.toContain('Second-pass focused re-review')
  })

  test('deduplicates identical findings and reports zero-candidate reason', async () => {
    const duplicate = {
      category: 'bug',
      severity: 'high',
      title: 'Same defect',
      description: 'Identical finding emitted twice.',
      path: 'src/app.ts',
      startLine: 5
    }
    const result = await runModelBackedHolisticTaskReview({
      workflowInput,
      taskInput,
      task,
      runners: {
        holisticReview: async () => holisticResultWith([duplicate, duplicate])
      },
      logger: { debug: () => {} }
    })

    expect(result.candidates).toHaveLength(1)

    const empty = await runModelBackedHolisticTaskReview({
      workflowInput,
      taskInput,
      task,
      runners: { holisticReview: async () => holisticResultWith([]) },
      logger: { debug: () => {} }
    })
    expect(empty.candidates).toHaveLength(0)
  })
})
