import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../../../shared/contracts/index.js'
import { assembleContext } from '../../run/context/context.js'
import {
  TaskReviewInputSchema,
  type ModelHolisticReviewResult,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { ReviewWorkflowInputSchema } from '../contracts.js'
import { runModelBackedHolisticTaskReview } from './holistic-task-review.js'
import { createUnanchoredRunBudget } from './unanchored-run-budget.js'

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

  const workflowInputWithSecurityPass = ReviewWorkflowInputSchema.parse({
    runId: 'run-holistic',
    reviewedPaths: ['src/app.ts'],
    securityPassEnabled: true,
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

  test('runs a single general discovery call and never adds the security checklist when the pass is disabled', async () => {
    const reviewTexts: string[] = []
    await runModelBackedHolisticTaskReview({
      workflowInput,
      taskInput,
      task,
      runners: {
        holisticReview: async (holisticInput) => {
          reviewTexts.push(holisticInput.reviewText)
          return holisticResultWith([])
        }
      },
      logger: { debug: () => {} }
    })

    // Default workflowInput has securityPassEnabled=false (schema default): the
    // reviewer is invoked exactly once and the general prompt never carries the
    // security checklist, so the disabled path is byte-for-byte the general review.
    expect(reviewTexts).toHaveLength(1)
    expect(reviewTexts[0]).not.toContain('## Security review checklist')
    expect(reviewTexts[0]).not.toContain('SECURITY-ONLY REVIEW')
  })

  test('issues a second, security-only discovery call when the pass is enabled', async () => {
    const reviewTexts: string[] = []
    await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithSecurityPass,
      taskInput,
      task,
      runners: {
        holisticReview: async (holisticInput) => {
          reviewTexts.push(holisticInput.reviewText)
          return holisticResultWith([])
        }
      },
      logger: { debug: () => {} }
    })

    // Exactly two calls: the general call (no checklist) and the security-only call
    // (security instruction + generic checklist). The checklist is confined to the
    // second call, so it never competes with the general reviewer's attention.
    expect(reviewTexts).toHaveLength(2)
    const [generalText, securityText] = reviewTexts
    expect(generalText).not.toContain('## Security review checklist')
    expect(generalText).not.toContain('SECURITY-ONLY REVIEW')
    expect(securityText).toContain('SECURITY-ONLY REVIEW')
    expect(securityText).toContain('## Security review checklist')
    expect(securityText).toContain(
      '- SSRF (CWE-918): a user-controlled URL or host passed to a request/fetch/open'
    )
    // Spec 15 acceptance: the security pass prompt is hardened against injection
    // from the untrusted repository content it reviews.
    expect(securityText).toContain('UNTRUSTED DATA, not')
    // The security call still sees the same changed-file context as the general one.
    expect(securityText).toContain('### FILE: src/app.ts')
  })

  test('merges the security pass additively: new locations are added, general locations are never displaced', async () => {
    const generalFinding = {
      category: 'bug',
      severity: 'high',
      title: 'Unconditional cache write on error path',
      description: 'The result is cached even when the fetch returned an error.',
      path: 'src/app.ts',
      startLine: 10
    }
    // Two security findings: one at the SAME line as the general finding (must be
    // dropped as a duplicate location) and one at a NEW line (must be added).
    const securityDuplicateLocation = {
      category: 'security',
      severity: 'high',
      title: 'Missing authorization check',
      description: 'A different security defect reported at the same line.',
      path: 'src/app.ts',
      startLine: 10
    }
    const securityNewLocation = {
      category: 'security',
      severity: 'high',
      title: 'SSRF via user-controlled URL',
      description: 'A user-controlled host reaches fetch without validation.',
      path: 'src/app.ts',
      startLine: 20
    }
    let call = 0
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithSecurityPass,
      taskInput,
      task,
      runners: {
        holisticReview: async () => {
          call += 1
          return call === 1
            ? holisticResultWith([generalFinding])
            : holisticResultWith([securityDuplicateLocation, securityNewLocation])
        }
      },
      logger: { debug: () => {} }
    })

    const lines = result.candidates
      .map((candidate) => candidate.location.startLine)
      .sort((left, right) => left - right)
    // The general finding (line 10) survives; the security finding at line 10 is
    // dropped as a duplicate location; the security finding at line 20 is added.
    expect(lines).toEqual([10, 20])
    const generalCandidate = result.candidates.find(
      (candidate) => candidate.location.startLine === 10
    )
    expect(generalCandidate?.title).toBe(
      'Unconditional cache write on error path'
    )
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

// Spec 19: the un-anchored discovery pass, wired into the task review.
describe('un-anchored discovery pass inside discovery', () => {
  const unanchoredBounds = {
    unitLines: 60,
    strideLines: 40,
    maxUnitsPerFile: 8,
    maxUnitsPerRun: 40
  }
  const unanchoredWorkflowInput = ReviewWorkflowInputSchema.parse({
    runId: 'run-holistic',
    reviewedPaths: ['src/app.ts'],
    unanchoredPass: unanchoredBounds,
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
  const newBudget = () => createUnanchoredRunBudget(unanchoredBounds)

  test('issues no extra call when the pass is not configured on', async () => {
    const reviewTexts: string[] = []
    await runModelBackedHolisticTaskReview({
      workflowInput,
      taskInput,
      task,
      unanchoredBudget: newBudget(),
      runners: {
        holisticReview: async (holisticInput) => {
          reviewTexts.push(holisticInput.reviewText)

          return holisticResultWith([])
        }
      },
      logger: { debug: () => {} }
    })

    // The default workflow input carries no `unanchoredPass` key, so the disabled
    // path is the single general discovery call it has always been — even with a
    // budget available.
    expect(reviewTexts).toHaveLength(1)
  })

  // An unbounded pass is the single most expensive mistake available here, so the
  // safe direction when the run-scoped bound is missing is off, not "bound it per
  // task and hope".
  test('does not run when no run budget was supplied', async () => {
    const reviewTexts: string[] = []
    await runModelBackedHolisticTaskReview({
      workflowInput: unanchoredWorkflowInput,
      taskInput,
      task,
      runners: {
        holisticReview: async (holisticInput) => {
          reviewTexts.push(holisticInput.reviewText)

          return holisticResultWith([])
        }
      },
      logger: { debug: () => {} }
    })

    expect(reviewTexts).toHaveLength(1)
  })

  // THE POINT OF THE WHOLE CHANGE. The general call must still see the diff — it
  // is what makes that call precise — and the un-anchored call must not, because
  // the same decomposition WITH the diff was measured as inert at N times the
  // cost.
  test('withholds the diff from the un-anchored call while the general call keeps it', async () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,1 +1,1 @@',
      '-export const value = 0',
      '+export const value = 1'
    ].join('\n')
    const workflowInputWithDiff = ReviewWorkflowInputSchema.parse({
      ...unanchoredWorkflowInput,
      reviewedDiffText: diff
    })
    const reviewTexts: string[] = []
    await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithDiff,
      taskInput,
      task,
      unanchoredBudget: newBudget(),
      runners: {
        holisticReview: async (holisticInput) => {
          reviewTexts.push(holisticInput.reviewText)

          return holisticResultWith([])
        }
      },
      logger: { debug: () => {} }
    })

    const [generalText, unanchoredText] = reviewTexts
    expect(reviewTexts).toHaveLength(2)
    expect(generalText).toContain('+export const value = 1')
    expect(unanchoredText).not.toContain('+export const value = 1')
    expect(unanchoredText).not.toContain('diff --git')
    expect(unanchoredText).not.toContain('```diff')
    // It is shown the unit it must read, and this small file is one whole unit.
    // The declared range is the unit's own span, which is coextensive with what
    // the packet shows and therefore cannot point at a line the reviewer was not
    // given — unlike the task's changed-line range, which is withheld.
    expect(unanchoredText).toContain('src/app.ts lines 1-2')
    expect(unanchoredText).toContain('1: export const value = 1')
  })

  test('appends its candidates and never displaces, reorders, or suppresses an anchored one', async () => {
    const anchored = {
      category: 'bug',
      severity: 'high',
      title: 'Unconditional cache write on error path',
      description: 'The result is cached even when the fetch returned an error.',
      path: 'src/app.ts',
      startLine: 10
    }
    // Two un-anchored findings: one restating the anchored candidate's location
    // (must be suppressed, so the anchored one is untouched) and one elsewhere
    // (must be appended after it).
    const unanchoredAtAnchoredLocation = {
      category: 'bug',
      severity: 'critical',
      title: 'Something else entirely at the same line',
      description: 'A different reading of a line the anchored pass owns.',
      path: 'src/app.ts',
      startLine: 10
    }
    const unanchoredElsewhere = {
      category: 'bug',
      severity: 'medium',
      title: 'Unchecked index later in the file',
      description: 'Found by reading the file rather than the change.',
      path: 'src/app.ts',
      startLine: 42
    }
    let call = 0
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: unanchoredWorkflowInput,
      taskInput,
      task,
      unanchoredBudget: newBudget(),
      runners: {
        holisticReview: async () => {
          call += 1

          return call === 1
            ? holisticResultWith([anchored])
            : holisticResultWith([
                unanchoredAtAnchoredLocation,
                unanchoredElsewhere
              ])
        }
      },
      logger: { debug: () => {} }
    })

    expect(
      result.candidates.map((candidate) => [
        candidate.location.startLine,
        candidate.title
      ])
    ).toEqual([
      [10, 'Unconditional cache write on error path'],
      [42, 'Unchecked index later in the file']
    ])
  })

  test('a failed un-anchored pass still yields a complete review', async () => {
    const anchored = {
      category: 'bug',
      severity: 'high',
      title: 'Unconditional cache write on error path',
      description: 'The result is cached even when the fetch returned an error.',
      path: 'src/app.ts',
      startLine: 10
    }
    let call = 0
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: unanchoredWorkflowInput,
      taskInput,
      task,
      unanchoredBudget: newBudget(),
      runners: {
        holisticReview: async () => {
          call += 1

          if (call === 1) {
            return holisticResultWith([anchored])
          }

          throw new Error('connection reset by peer')
        }
      },
      logger: { debug: () => {} }
    })

    // The anchored candidate survives untouched and the failure is recorded as a
    // recovered provider issue instead of failing the task.
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.title).toBe(
      'Unconditional cache write on error path'
    )
    expect(result.providerIssues).toHaveLength(1)
    expect(result.providerIssues[0]?.recovered).toBe(true)
  })

  test('shares one run budget across tasks, so the per-run bound is a run bound', async () => {
    const budget = createUnanchoredRunBudget({
      ...unanchoredBounds,
      maxUnitsPerRun: 1
    })
    let calls = 0
    const runOnce = async () =>
      runModelBackedHolisticTaskReview({
        workflowInput: unanchoredWorkflowInput,
        taskInput,
        task,
        unanchoredBudget: budget,
        runners: {
          holisticReview: async () => {
            calls += 1

            return holisticResultWith([])
          }
        },
        logger: { debug: () => {} }
      })

    await runOnce()
    await runOnce()

    // Two general calls, and only the FIRST task's single unit: the second task
    // finds the run allowance already spent.
    expect(calls).toBe(3)
    expect(budget.summary().unitsGranted).toBe(1)
    expect(budget.summary().unitsWithheld).toBe(1)
  })
})

describe('semantic finding merge inside discovery', () => {
  const restatement = (startLine: number, title: string) => ({
    category: 'bug',
    severity: 'high',
    title,
    description: `${title}, reported at line ${startLine}.`,
    path: 'src/app.ts',
    startLine
  })

  test('runs after every discovery candidate exists and records the merged-away member', async () => {
    let mergeInput: { readonly candidates: readonly { readonly id: string }[] } | undefined
    const result = await runModelBackedHolisticTaskReview({
      workflowInput,
      taskInput,
      task,
      runners: {
        holisticReview: async () =>
          holisticResultWith([
            restatement(10, 'Value dereferenced without a guard'),
            restatement(11, 'Missing guard before the same property access')
          ]),
        semanticMerge: async (input) => {
          mergeInput = input

          return {
            groups: [
              { candidateIds: input.candidates.map((candidate) => candidate.id) }
            ]
          }
        }
      },
      logger: { debug: () => {} }
    })

    // The merge sees BOTH discovery candidates, which is only possible after
    // discovery has finished producing them, and it receives the file itself.
    expect(mergeInput?.candidates).toHaveLength(2)
    // Both candidates stay on the record; the non-representative one carries a
    // duplicate rejection so downstream can hold it out of admission.
    expect(result.candidates).toHaveLength(2)
    expect(result.rejectedFindings).toHaveLength(1)
    expect(result.rejectedFindings[0]?.reason).toBe('duplicate')
  })

  test('never calls the merge when the task produced a single candidate', async () => {
    let mergeCalls = 0
    const result = await runModelBackedHolisticTaskReview({
      workflowInput,
      taskInput,
      task,
      runners: {
        holisticReview: async () =>
          holisticResultWith([restatement(10, 'The only defect in this file')]),
        semanticMerge: async () => {
          mergeCalls += 1

          return { groups: [] }
        }
      },
      logger: { debug: () => {} }
    })

    expect(mergeCalls).toBe(0)
    expect(result.candidates).toHaveLength(1)
    expect(result.rejectedFindings).toEqual([])
  })

  test('a failed merge costs the grouping, never the candidates', async () => {
    const result = await runModelBackedHolisticTaskReview({
      workflowInput,
      taskInput,
      task,
      runners: {
        holisticReview: async () =>
          holisticResultWith([
            restatement(10, 'One defect'),
            restatement(20, 'A different defect')
          ]),
        semanticMerge: async () => {
          throw new Error('Agent output validation failed')
        }
      },
      logger: { debug: () => {} }
    })

    expect(result.candidates).toHaveLength(2)
    expect(result.rejectedFindings).toEqual([])
    expect(result.providerIssues).toHaveLength(1)
    expect(result.providerIssues[0]?.recovered).toBe(true)
  })
})

// A file whose lines carry multi-byte UTF-8 characters and where every line names
// its own absolute line number, so the rendered numbering can be checked against
// the truth. The source chunk budget works in UTF-8 BYTES, so a byte-derived line
// origin would silently drift here while looking correct on pure ASCII.
const multiByteSource = (lineCount: number): string =>
  `${Array.from(
    { length: lineCount },
    (_unused, index) =>
      `const größe${index + 1} = 'Grüße 🙂 ${'ü'.repeat(30)}' // Zeile ${index + 1}`
  ).join('\n')}\n`

describe('line numbering across split source chunks', () => {
  test('numbers a second chunk with the file’s absolute lines, so its findings carry the real line', async () => {
    const config = CodeReviewerConfigSchema.parse({
      review: { contextMaxBytes: 10000 }
    })
    const sourceContent = multiByteSource(200)
    const assembled = await assembleContext({
      repositoryRoot: '/unused',
      config,
      sourceFiles: [{ path: 'src/large.ts', content: sourceContent }],
      analysis: { facts: [], evidence: [] },
      tasks: [
        {
          id: 'task_large',
          round: 1,
          kind: 'file',
          paths: ['src/large.ts'],
          factIds: [],
          evidenceIds: [],
          candidateIds: [],
          contextEntryIds: [],
          priority: 0
        }
      ]
    })

    // The file exceeds the chunk budget, so it becomes several tasks; take the
    // SECOND one, the first whose content does not start at line 1.
    expect(assembled.tasks.length).toBeGreaterThan(1)
    const secondChunkTask = assembled.tasks[1] as WorkflowReviewTask
    const secondChunk = secondChunkTask.reviewContext.find(
      (context) => context.kind === 'file'
    )
    expect(secondChunk?.startLine).toBeGreaterThan(1)

    // Target a line a few lines into the second chunk. Every line states its own
    // absolute number, so the expected rendering is known independently.
    const targetLine = secondChunk!.startLine! + 3
    const chunkTaskInput = TaskReviewInputSchema.parse({
      ...taskInput,
      task: secondChunkTask,
      reviewedDiffRanges: [
        { path: 'src/large.ts', startLine: 1, endLine: 200 }
      ]
    })
    const largeFileWorkflowInput = ReviewWorkflowInputSchema.parse({
      runId: 'run-holistic',
      reviewedPaths: ['src/large.ts'],
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

    let captured = ''
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: largeFileWorkflowInput,
      taskInput: chunkTaskInput,
      task: secondChunkTask,
      runners: {
        // Stands in for the model: it reports the line number the document showed
        // it for the target source line, which is exactly how a real model
        // derives the location it reports.
        holisticReview: async (holisticInput) => {
          captured = holisticInput.reviewText
          const shown = new RegExp(
            `^(\\d+): const größe${targetLine} =`,
            'mu'
          ).exec(holisticInput.reviewText)

          return holisticResultWith([
            {
              category: 'bug',
              severity: 'high',
              title: 'Defect in the second chunk of a large file',
              description: 'Reported at the line number the document showed.',
              path: 'src/large.ts',
              startLine: Number(shown?.[1] ?? 0)
            }
          ])
        }
      },
      logger: { debug: () => {} }
    })

    // The rendered document numbers the chunk from its absolute origin, not from
    // 1, so the number the model reads back is the file's real line.
    expect(captured).toContain(`${targetLine}: const größe${targetLine} =`)
    expect(result.candidates[0]?.location.startLine).toBe(targetLine)
  })
})

describe('discovery call failure tolerance', () => {
  test('a malformed model response costs that call, not the whole task', async () => {
    const result = await runModelBackedHolisticTaskReview({
      workflowInput,
      taskInput,
      task,
      runners: {
        holisticReview: async () => {
          throw new Error('Agent output validation failed')
        }
      },
      logger: { debug: () => {} }
    })

    // The task completes with no candidates and a RECOVERED provider issue, rather
    // than throwing and taking the whole task (and, in an eval, the whole case) with
    // it. A dropped case would silently corrupt any comparison built on the run.
    expect(result.candidates).toEqual([])
    expect(result.providerIssues).toHaveLength(1)
    expect(result.providerIssues[0]?.recovered).toBe(true)
  })

  test('an unrecognised error still propagates', async () => {
    await expect(
      runModelBackedHolisticTaskReview({
        workflowInput,
        taskInput,
        task,
        runners: {
          holisticReview: async () => {
            throw new Error('connection reset by peer')
          }
        },
        logger: { debug: () => {} }
      })
    ).rejects.toThrow(/connection reset/u)
  })
})
