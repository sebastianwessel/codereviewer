import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../../../shared/contracts/index.js'
import { assembleContext } from '../../run/context/context.js'
import {
  TaskReviewInputSchema,
  type ModelHolisticReviewResult,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { ReviewWorkflowInputSchema } from '../contracts.js'
import {
  createBoundedRetrievalTools,
  type ContextRetriever
} from '../../../context-retrieval/index.js'
import { runWithCrossFileDiscoveryTools } from './cross-file-tools.js'
import {
  HOLISTIC_MAX_CANDIDATES,
  runModelBackedHolisticTaskReview
} from './holistic-task-review.js'

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
  instructions: [],
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
  skills: [],
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

  // The two passes' prompts are built from the task input alone, so nothing the
  // general pass produces can reach the security prompt — the passes couple only
  // where the security CALLS are collected, after the general ones have been.
  // These two cases pin both halves of that: the calls overlap when they may, and
  // never when a shared per-task budget would make the overlap a race.
  //
  // A runner that yields once is enough to tell the arrangements apart:
  // overlapping calls both enter before either leaves.
  const orderRecordingRunner = (events: string[]) => {
    let call = 0

    return async () => {
      const index = (call += 1)

      events.push(`enter:${index}`)
      await Promise.resolve()
      events.push(`exit:${index}`)

      return holisticResultWith([])
    }
  }

  test('issues the general and security passes concurrently', async () => {
    const events: string[] = []

    await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithSecurityPass,
      taskInput,
      task,
      runners: { holisticReview: orderRecordingRunner(events) },
      logger: { debug: () => {} }
    })

    expect(events).toEqual(['enter:1', 'enter:2', 'exit:1', 'exit:2'])
  })

  test('keeps the passes sequential inside a cross-file discovery scope', async () => {
    // Inside a scope both passes draw on ONE per-task tool-call budget and one read
    // allowance. Running them together would not change any prompt, but it would
    // turn the split of that budget between them into a race, and a tool result is
    // something the model sees.
    const events: string[] = []
    const bounded = createBoundedRetrievalTools({
      retriever: {
        budget: () => ({}),
        readRepositoryFile: async () => ({}),
        listRepositoryDirectory: async () => ({}),
        grepRepository: async () => ({})
      } as unknown as ContextRetriever,
      maxToolCalls: 4
    })

    await runWithCrossFileDiscoveryTools(
      { tools: bounded.tools, reduceReadBudget: () => false },
      () =>
        runModelBackedHolisticTaskReview({
          workflowInput: workflowInputWithSecurityPass,
          taskInput,
          task,
          runners: { holisticReview: orderRecordingRunner(events) },
          logger: { debug: () => {} }
        })
    )

    expect(events).toEqual(['enter:1', 'exit:1', 'enter:2', 'exit:2'])
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

// Spec 27. These numbers existed before, in a `logger.debug` line that was off for
// every paid evaluation run, so every measurement this project made was blind to
// what discovery produced as opposed to what survived it.
describe('discovery telemetry', () => {
  const threeFileTask: WorkflowReviewTask = {
    ...task,
    id: 'task_three_files',
    paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    reviewContext: ['a', 'b', 'c'].map((name, index) => ({
      kind: 'file' as const,
      path: `src/${name}.ts`,
      content: `export const ${name} = ${index}\n`,
      startLine: 1,
      endLine: 2,
      ledgerEntryId: `ctx_000000000000000${index}`
    }))
  }

  test('records raw findings BEFORE the parse, the scope filter and the cap — so raw and candidate counts differ', async () => {
    // The load-bearing assertion. A run where `rawFindingCount` always equalled
    // `candidateCount` would look like working instrumentation while hiding the
    // exact drop these counters exist to expose, so the case is pinned here: three
    // raw findings in, one candidate out, and the two causes counted apart.
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
              description: 'Assigned to the cache even when the fetch failed.',
              path: 'src/app.ts',
              startLine: 10
            },
            // Out of scope: the call was never shown this file.
            {
              category: 'bug',
              severity: 'high',
              title: 'Unrelated file defect',
              description: 'A defect in a file with no reviewed change.',
              path: 'src/other.ts',
              startLine: 3
            },
            // Unparseable: no location at all.
            {
              category: 'bug',
              severity: 'medium',
              title: 'Vague concern',
              description: 'No location provided.'
            }
          ])
      },
      logger: { debug: () => {} }
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.discovery).toMatchObject({
      taskId: 'task_holistic',
      callCount: 1,
      rawFindingCount: 3,
      rawFindingsPerCall: [3],
      candidateCount: 1,
      droppedCount: 2,
      suppressedByIdCount: 0,
      suppressedByLocationCount: 0,
      contextOverflowSplitCount: 0
    })
    expect(result.discovery?.rawFindingCount).not.toBe(
      result.discovery?.candidateCount
    )
  })

  test('counts a duplicate suppression apart from a dropped finding', async () => {
    // Two identical findings: one candidate, and the loss attributed to
    // suppression rather than to a parse or scope failure. Summing them into one
    // counter is what hid both.
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

    expect(result.discovery).toMatchObject({
      rawFindingCount: 2,
      candidateCount: 1,
      suppressedByIdCount: 1,
      droppedCount: 0
    })
  })

  test('records raw findings per CALL, so the distribution survives and not only its mean', async () => {
    // The open question is the SHAPE: whether per-file yield is capped or merely
    // averages low. A total of four over three calls is consistent with both, and
    // only the per-call array separates them.
    const yields = [3, 1, 0]
    let call = 0
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: ReviewWorkflowInputSchema.parse({
        runId: 'run-holistic',
        reviewedPaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        evidence: [],
        candidates: [],
        skills: [],
        maxFilesPerDiscoveryCall: 1,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'holistic-test',
          signalVersions: { typescript: '6.0.3' },
          configHash
        }
      }),
      taskInput: TaskReviewInputSchema.parse({
        ...taskInput,
        task: threeFileTask
      }),
      task: threeFileTask,
      runners: {
        holisticReview: async (holisticInput) => {
          const first = holisticInput.paths[0] as string
          const count = yields[call] as number
          call += 1

          return holisticResultWith(
            Array.from({ length: count }, (_unused, index) => ({
              category: 'bug',
              severity: 'high',
              title: `Defect ${index + 1} in ${first}`,
              description: 'One of several findings from a single call.',
              path: first,
              startLine: index + 1
            }))
          )
        }
      },
      logger: { debug: () => {} }
    })

    expect(result.discovery?.rawFindingsPerCall).toEqual([3, 1, 0])
    expect(result.discovery?.callCount).toBe(3)
    expect(result.discovery?.rawFindingCount).toBe(4)
  })

  test('a reactive split reports one entry per call actually issued, never for the refused packet', async () => {
    // The refused packet produced no findings because the provider never read it.
    // Counting it as a zero-yield look would understate findings-per-call exactly
    // when the provider is refusing, which is when the number matters most.
    const config = CodeReviewerConfigSchema.parse({})
    const assembled = await assembleContext({
      repositoryRoot: '/unused',
      config,
      sourceFiles: [{ path: 'src/large.ts', content: multiByteSource(200) }],
      analysis: { facts: [], evidence: [] },
      reviewedDiffText: '',
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
    const wholeTask = assembled.tasks[0] as WorkflowReviewTask
    let call = 0
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: ReviewWorkflowInputSchema.parse({
        runId: 'run-holistic',
        reviewedPaths: ['src/large.ts'],
        evidence: [],
        candidates: [],
        skills: [],
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'holistic-test',
          signalVersions: { typescript: '6.0.3' },
          configHash
        }
      }),
      taskInput: TaskReviewInputSchema.parse({
        ...taskInput,
        task: wholeTask,
        reviewedDiffRanges: [
          { path: 'src/large.ts', startLine: 1, endLine: 200 }
        ]
      }),
      task: wholeTask,
      runners: {
        holisticReview: async () => {
          call += 1

          if (call === 1) {
            throw Object.assign(new Error('provider rejected the request'), {
              reason: 'context_length_exceeded'
            })
          }

          return holisticResultWith([])
        }
      },
      logger: { debug: () => {} }
    })

    // Three model calls were made; two of them were looks at content.
    expect(call).toBe(3)
    expect(result.discovery).toMatchObject({
      callCount: 2,
      rawFindingsPerCall: [0, 0],
      contextOverflowSplitCount: 1
    })
  })
})

// The discovery packet's field ORDER is a measured property, not a style choice:
// the packet is serialized in declaration order and a provider-side prompt cache
// matches on leading tokens, so a reordered packet is a cache miss on every call.
describe('the discovery packet', () => {
  test('issues exactly one discovery call per task, with a stable packet shape', async () => {
    const inputs: { readonly taskId: string; readonly reviewText: string }[] = []
    await runModelBackedHolisticTaskReview({
      workflowInput,
      taskInput,
      task,
      runners: {
        holisticReview: async (holisticInput) => {
          inputs.push(holisticInput)

          return holisticResultWith([])
        }
      },
      logger: { debug: () => {} }
    })

    expect(inputs).toHaveLength(1)
    expect(Object.keys(inputs[0]!)).toEqual(['taskId', 'paths', 'reviewText'])
  })

  test('caps how many candidates one task may raise', async () => {
    // Every candidate costs a downstream refutation slot, so the cap is what keeps
    // a runaway response from starving the stage this engine's precision lives in.
    const result = await runModelBackedHolisticTaskReview({
      workflowInput,
      taskInput,
      task,
      runners: {
        holisticReview: async () =>
          holisticResultWith(
            Array.from({ length: HOLISTIC_MAX_CANDIDATES + 5 }, (_, index) => ({
              category: 'bug',
              severity: 'high',
              title: `Defect ${index + 1}`,
              description: `Defect ${index + 1}, reported at line ${index + 1}.`,
              path: 'src/app.ts',
              startLine: index + 1
            }))
          ),
        semanticMerge: async () => ({ groups: [] })
      },
      logger: { debug: () => {} }
    })

    expect(result.candidates).toHaveLength(HOLISTIC_MAX_CANDIDATES)
    // The five it refused are COUNTED. They were dropped by a bare `break` that
    // ran before any counter, so a defect the model actually found vanished
    // before refutation and left no trace in the report — every other loss cause
    // here has had a counter from the start.
    expect(result.discovery?.cappedByLimitCount).toBe(5)
  })

  test('a task under the cap reports nothing capped', async () => {
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
              title: 'Defect 1',
              description: 'Defect 1, reported at line 1.',
              path: 'src/app.ts',
              startLine: 1
            }
          ]),
        semanticMerge: async () => ({ groups: [] })
      },
      logger: { debug: () => {} }
    })

    expect(result.discovery?.cappedByLimitCount).toBe(0)
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
    expect(result.providerIssues[0]?.recovered).toBe(false)
  })
})

// A file whose lines carry multi-byte UTF-8 characters and where every line names
// its own absolute line number, so the rendered numbering can be checked against
// the truth. Splitting cuts on UTF-8 BYTES, so a byte-derived line origin would
// silently drift here while looking correct on pure ASCII.
const multiByteSource = (lineCount: number): string =>
  `${Array.from(
    { length: lineCount },
    (_unused, index) =>
      `const größe${index + 1} = 'Grüße 🙂 ${'ü'.repeat(30)}' // Zeile ${index + 1}`
  ).join('\n')}\n`

describe('reactive splitting when the provider refuses a packet', () => {
  test('halves a refused task and numbers the second half with the file’s absolute lines', async () => {
    // Spec 26 end to end. Assembly sends the file WHOLE; the provider refuses it as
    // too large; the task is halved and each half retried. The property that must
    // survive that is line origin: the second half is rendered from its absolute
    // start, so a finding in it carries the file's real line rather than a number
    // counted from the start of the half.
    const config = CodeReviewerConfigSchema.parse({})
    const sourceContent = multiByteSource(200)
    const assembled = await assembleContext({
      repositoryRoot: '/unused',
      config,
      sourceFiles: [{ path: 'src/large.ts', content: sourceContent }],
      analysis: { facts: [], evidence: [] },
      reviewedDiffText: '',
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

    // Assembly no longer splits: one whole-file task, whatever its size.
    expect(assembled.tasks).toHaveLength(1)
    const wholeTask = assembled.tasks[0] as WorkflowReviewTask
    const wholeTaskInput = TaskReviewInputSchema.parse({
      ...taskInput,
      task: wholeTask,
      reviewedDiffRanges: [{ path: 'src/large.ts', startLine: 1, endLine: 200 }]
    })
    const largeFileWorkflowInput = ReviewWorkflowInputSchema.parse({
      runId: 'run-holistic',
      reviewedPaths: ['src/large.ts'],
      evidence: [],
      candidates: [],
      skills: [],
      provenance: {
        reviewer: 'review-agent',
        modelProvider: 'openai',
        modelName: 'holistic-test',
        signalVersions: { typescript: '6.0.3' },
        configHash
      }
    })

    // A line comfortably inside the SECOND half of the file.
    const targetLine = 150
    const seen: string[] = []
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: largeFileWorkflowInput,
      taskInput: wholeTaskInput,
      task: wholeTask,
      runners: {
        // Refuses the first, whole packet exactly the way the harness reports a
        // provider context overflow — a normalised `reason`, never message text.
        // Then behaves like a model on each half: it reports the line number the
        // document actually showed it.
        holisticReview: async (holisticInput) => {
          seen.push(holisticInput.reviewText)

          if (seen.length === 1) {
            throw Object.assign(
              new Error('provider rejected the request'),
              { reason: 'context_length_exceeded' }
            )
          }

          const shown = new RegExp(
            `^(\\d+): const größe${targetLine} =`,
            'mu'
          ).exec(holisticInput.reviewText)

          return holisticResultWith(
            shown === null
              ? []
              : [
                  {
                    category: 'bug',
                    severity: 'high',
                    title: 'Defect in the second half of a large file',
                    description: 'Reported at the line number the document showed.',
                    path: 'src/large.ts',
                    startLine: Number(shown[1])
                  }
                ]
          )
        }
      },
      logger: { debug: () => {} }
    })

    // One refused packet, then two halves.
    expect(seen).toHaveLength(3)
    // Exactly one half contains the target line, and it renders it at its ABSOLUTE
    // number — not at the number it would have if the half were numbered from 1.
    const halvesShowingTarget = seen
      .slice(1)
      .filter((text) => text.includes(`${targetLine}: const größe${targetLine} =`))

    expect(halvesShowingTarget).toHaveLength(1)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.location.startLine).toBe(targetLine)
  })

  test('reports the sub-tasks it actually reviewed, with their real line spans', async () => {
    // Admission checks a finding's line against the span its OWN call was shown.
    // A partition or split half carries a synthetic task id that matches nothing in
    // the planned task list, so unless the sub-tasks are reported, that check finds
    // no range and silently passes — exactly where a chunk-relative line number
    // could still arise.
    const config = CodeReviewerConfigSchema.parse({})
    const sourceContent = multiByteSource(200)
    const assembled = await assembleContext({
      repositoryRoot: '/unused',
      config,
      sourceFiles: [{ path: 'src/large.ts', content: sourceContent }],
      analysis: { facts: [], evidence: [] },
      reviewedDiffText: '',
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
    const wholeTask = assembled.tasks[0] as WorkflowReviewTask
    let calls = 0
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: ReviewWorkflowInputSchema.parse({
        runId: 'run-holistic',
        reviewedPaths: ['src/large.ts'],
        evidence: [],
        candidates: [],
        skills: [],
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'holistic-test',
          signalVersions: { typescript: '6.0.3' },
          configHash
        }
      }),
      taskInput: TaskReviewInputSchema.parse({
        ...taskInput,
        task: wholeTask,
        reviewedDiffRanges: [
          { path: 'src/large.ts', startLine: 1, endLine: 200 }
        ]
      }),
      task: wholeTask,
      runners: {
        holisticReview: async () => {
          calls += 1

          if (calls === 1) {
            throw Object.assign(new Error('provider rejected the request'), {
              reason: 'context_length_exceeded'
            })
          }

          return holisticResultWith([])
        }
      },
      logger: { debug: () => {} }
    })

    // The two halves, each carrying the absolute span it was actually shown.
    expect(result.reviewedTasks).toHaveLength(2)
    const spans = result.reviewedTasks.flatMap((reviewed) =>
      reviewed.reviewContext
        .filter((entry) => entry.kind === 'file')
        .map((entry) => [entry.startLine, entry.endLine])
    )

    expect(spans).toHaveLength(2)
    expect(spans[0]?.[0]).toBe(1)
    // The second half starts partway down the file, which is the whole point: its
    // findings must be judged against ITS lines, not the file's first line.
    expect(spans[1]?.[0]).toBeGreaterThan(1)
    expect(spans[1]?.[1]).toBe(sourceContent.split('\n').length)
  })

  test('a task that cannot be split further fails loudly instead of recursing', async () => {
    // The terminal case spec 26 requires: bounded by DEPTH, and a refusal rather
    // than a truncation or a silently dropped task.
    await expect(
      runModelBackedHolisticTaskReview({
        workflowInput,
        taskInput,
        task,
        runners: {
          holisticReview: async () => {
            throw Object.assign(new Error('provider rejected the request'), {
              reason: 'context_length_exceeded'
            })
          }
        },
        logger: { debug: () => {} }
      })
    ).rejects.toThrow(/cannot be split further/u)
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
    expect(result.providerIssues[0]?.recovered).toBe(false)
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

describe('discovery partitioning end to end (spec 27)', () => {
  const threeFileTask: WorkflowReviewTask = {
    ...task,
    id: 'task_three_files',
    paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    reviewContext: ['a', 'b', 'c'].map((name, index) => ({
      kind: 'file' as const,
      path: `src/${name}.ts`,
      content: `export const ${name} = ${index}\n`,
      startLine: 1,
      endLine: 2,
      ledgerEntryId: `ctx_000000000000000${index}`
    }))
  }
  const threeFileInput = TaskReviewInputSchema.parse({
    ...taskInput,
    task: threeFileTask
  })

  const runWith = async (maxFilesPerDiscoveryCall: number | undefined) => {
    const shown: string[][] = []
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: ReviewWorkflowInputSchema.parse({
        runId: 'run-holistic',
        reviewedPaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        evidence: [],
        candidates: [],
        skills: [],
        ...(maxFilesPerDiscoveryCall === undefined
          ? {}
          : { maxFilesPerDiscoveryCall }),
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'holistic-test',
          signalVersions: { typescript: '6.0.3' },
          configHash
        }
      }),
      taskInput: threeFileInput,
      task: threeFileTask,
      runners: {
        // Reports one finding in the FIRST file it was actually shown, which is how
        // per-call yield behaves: roughly constant regardless of how much it sees.
        holisticReview: async (holisticInput) => {
          shown.push([...holisticInput.paths])
          const first = holisticInput.paths[0] as string
          return holisticResultWith([
            {
              category: 'bug',
              severity: 'high',
              title: `Defect in ${first}`,
              description: 'One finding per call, as measured.',
              path: first,
              startLine: 1
            }
          ])
        }
      },
      logger: { debug: () => {} }
    })
    return { shown, result }
  }

  test('unlimited (the default) issues ONE call and yields one finding', async () => {
    const { shown, result } = await runWith(undefined)

    expect(shown).toEqual([['src/a.ts', 'src/b.ts', 'src/c.ts']])
    // This is exactly the measured problem: three files, one look, one candidate.
    expect(result.candidates).toHaveLength(1)
  })

  test('one file per call issues three calls and yields three findings', async () => {
    const { shown, result } = await runWith(1)

    expect(shown).toEqual([['src/a.ts'], ['src/b.ts'], ['src/c.ts']])
    expect(result.candidates).toHaveLength(3)
    expect(
      result.candidates.map((candidate) => candidate.location.path).sort()
    ).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  test('a call may only report findings in the files it was shown', async () => {
    // Guards the admission-safety requirement: a partition that reports outside its
    // own paths must have that finding dropped, not anchored against unread content.
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: ReviewWorkflowInputSchema.parse({
        runId: 'run-holistic',
        reviewedPaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        evidence: [],
        candidates: [],
        skills: [],
        maxFilesPerDiscoveryCall: 1,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'holistic-test',
          signalVersions: { typescript: '6.0.3' },
          configHash
        }
      }),
      taskInput: threeFileInput,
      task: threeFileTask,
      runners: {
        holisticReview: async () =>
          holisticResultWith([
            {
              category: 'bug',
              severity: 'high',
              title: 'Reported outside this call’s scope',
              description: 'Names a file this call was never shown.',
              path: 'src/c.ts',
              startLine: 1
            }
          ])
      },
      logger: { debug: () => {} }
    })

    // Only the call that was actually shown src/c.ts may raise it.
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.location.path).toBe('src/c.ts')
  })
})

// Spec 05's `citation` evidence kind, end to end through discovery. The hard
// constraint under test throughout is the no-loss guarantee: an absent,
// malformed, or unverified citation must leave the candidate EXACTLY as it is
// with the capability off — never dropped, downgraded, or rejected for it.
describe('discovery citation evidence (spec 05)', () => {
  const citationTask: WorkflowReviewTask = {
    ...task,
    id: 'task_citation',
    reviewContext: [
      {
        kind: 'file',
        path: 'src/app.ts',
        content: [
          'export const getRate = (id: string) => {',
          '  const record = cache.get(id)',
          '  return record.rate',
          '}'
        ].join('\n'),
        ledgerEntryId: 'ctx_cccccccccccccccccccccccc'
      }
    ]
  }
  const citationTaskInput = TaskReviewInputSchema.parse({
    ...taskInput,
    task: citationTask
  })
  const workflowInputWithCitations = ReviewWorkflowInputSchema.parse({
    runId: 'run-holistic',
    reviewedPaths: ['src/app.ts'],
    citationsEnabled: true,
    evidence: [],
    candidates: [],
    skills: [],
    provenance: {
      reviewer: 'review-agent',
      modelProvider: 'openai',
      modelName: 'holistic-test',
      signalVersions: { typescript: '6.0.3' },
      configHash
    }
  })
  const findingAt = (startLine: number, citations?: unknown) => ({
    category: 'bug',
    severity: 'high',
    title: 'Dereferences record without a null guard',
    description: 'record may be undefined when the cache misses the id.',
    path: 'src/app.ts',
    startLine,
    ...(citations === undefined ? {} : { citations })
  })

  test('the flag off: citations are never read, evidenceIds stays empty, and no records are produced', async () => {
    const result = await runModelBackedHolisticTaskReview({
      workflowInput, // default-parsed: citationsEnabled is false
      taskInput: citationTaskInput,
      task: citationTask,
      runners: {
        holisticReview: async () =>
          holisticResultWith([
            findingAt(3, [{ startLine: 3, quote: 'return record.rate' }])
          ])
      },
      logger: { debug: () => {} }
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.evidenceIds).toEqual([])
    expect(result.evidenceRecords).toEqual([])
  })

  test('a quote that matches at the cited line verifies, and whitespace differences still verify', async () => {
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithCitations,
      taskInput: citationTaskInput,
      task: citationTask,
      runners: {
        holisticReview: async () =>
          holisticResultWith([
            findingAt(3, [
              // Extra internal whitespace and outer padding: still verifies.
              { startLine: 3, quote: '  return   record.rate  ' }
            ])
          ])
      },
      logger: { debug: () => {} }
    })

    expect(result.candidates).toHaveLength(1)
    const candidate = result.candidates[0]!
    // Verified citations produce records whose ids the candidate references.
    expect(result.evidenceRecords).toHaveLength(1)
    const record = result.evidenceRecords[0]!
    expect(candidate.evidenceIds).toEqual([record.id])
    expect(record.kind).toBe('citation')
    expect(record.location).toEqual({
      path: 'src/app.ts',
      startLine: 3,
      side: 'file'
    })
  })

  test('a quote that does not appear near the cited line does not verify, and the candidate is returned unchanged', async () => {
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithCitations,
      taskInput: citationTaskInput,
      task: citationTask,
      runners: {
        holisticReview: async () =>
          holisticResultWith([
            findingAt(3, [
              { startLine: 3, quote: 'this text is nowhere in the file' }
            ])
          ])
      },
      logger: { debug: () => {} }
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.evidenceIds).toEqual([])
    expect(result.evidenceRecords).toEqual([])
  })

  test('a quote that appears elsewhere in the file but outside the window does not verify', async () => {
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithCitations,
      taskInput: citationTaskInput,
      task: citationTask,
      runners: {
        holisticReview: async () =>
          holisticResultWith([
            // "export const getRate" is on line 1; cited three lines away
            // (line 4), past the +/-2 window.
            findingAt(4, [{ startLine: 4, quote: 'export const getRate' }])
          ])
      },
      logger: { debug: () => {} }
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.evidenceIds).toEqual([])
    expect(result.evidenceRecords).toEqual([])
  })

  test('a finding with no citations still verifies and returns fine with the flag on', async () => {
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithCitations,
      taskInput: citationTaskInput,
      task: citationTask,
      runners: {
        holisticReview: async () => holisticResultWith([findingAt(3)])
      },
      logger: { debug: () => {} }
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.evidenceIds).toEqual([])
    expect(result.evidenceRecords).toEqual([])
  })

  test('the citation instruction reaches the prompt only when the flag is on', async () => {
    let disabledText: string | undefined
    await runModelBackedHolisticTaskReview({
      workflowInput, // default: citationsEnabled false
      taskInput: citationTaskInput,
      task: citationTask,
      runners: {
        holisticReview: async (holisticInput) => {
          disabledText = holisticInput.reviewText
          return holisticResultWith([])
        }
      },
      logger: { debug: () => {} }
    })
    expect(disabledText).not.toContain('## Citing your evidence')

    let enabledText: string | undefined
    await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithCitations,
      taskInput: citationTaskInput,
      task: citationTask,
      runners: {
        holisticReview: async (holisticInput) => {
          enabledText = holisticInput.reviewText
          return holisticResultWith([])
        }
      },
      logger: { debug: () => {} }
    })
    expect(enabledText).toContain('## Citing your evidence')
  })
})
