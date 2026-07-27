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

// Spec 21: independent sampling with union merge.
//
// Every test here defends a property that is invisible in a diff and expensive to
// lose: samples that can see each other stop being independent, a union that
// quietly votes deletes the rare finding the change exists to recover, and a
// second deduplication mechanism would re-create the restatement problem the
// semantic merge was built to solve.
describe('independent discovery samples', () => {
  const findingAt = (startLine: number, title: string) => ({
    category: 'bug',
    severity: 'high',
    title,
    description: `${title}, reported at line ${startLine}.`,
    path: 'src/app.ts',
    startLine
  })

  const workflowInputWithSamples = (sampleCount: number) =>
    ReviewWorkflowInputSchema.parse({
      runId: 'run-holistic',
      reviewedPaths: ['src/app.ts'],
      discoverySampleCount: sampleCount,
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

  test('defaults to one sample and issues the packet unchanged', async () => {
    const inputs: { readonly taskId: string; readonly reviewText: string }[] = []
    const result = await runModelBackedHolisticTaskReview({
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

    // The default workflow input carries no sample count, so the schema default
    // applies: exactly one call, exactly today's behaviour.
    expect(inputs).toHaveLength(1)
    // Field ORDER, not just field presence. The packet is serialized in
    // declaration order and a provider-side prompt cache matches on leading
    // tokens, so a reordered packet is a cache miss on every call.
    expect(Object.keys(inputs[0]!)).toEqual(['taskId', 'paths', 'reviewText'])
    expect(result.discoverySamples).toEqual({ requested: 1, completed: 1 })
  })

  test('k = 1 sends the identical packet whether the count is defaulted or set', async () => {
    const packetFor = async (input: typeof workflowInput): Promise<string> => {
      let captured = ''
      await runModelBackedHolisticTaskReview({
        workflowInput: input,
        taskInput,
        task,
        runners: {
          holisticReview: async (holisticInput) => {
            captured = JSON.stringify(holisticInput)

            return holisticResultWith([])
          }
        },
        logger: { debug: () => {} }
      })

      return captured
    }

    // Serializing compares content AND field order in one assertion.
    expect(await packetFor(workflowInputWithSamples(1))).toBe(
      await packetFor(workflowInput)
    )
  })

  test('issues one call per sample and hands every sample the identical packet', async () => {
    const packets: string[] = []
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithSamples(3),
      taskInput,
      task,
      runners: {
        holisticReview: async (holisticInput) => {
          packets.push(JSON.stringify(holisticInput))

          return holisticResultWith([])
        }
      },
      logger: { debug: () => {} }
    })

    expect(packets).toHaveLength(3)
    // Identical packets are the observable form of independence: a sample that
    // was told anything about another sample would carry it here.
    expect(new Set(packets).size).toBe(1)
    expect(result.discoverySamples).toEqual({ requested: 3, completed: 3 })
  })

  test('no sample receives any other sample’s findings, reasoning, or output', async () => {
    // Each sample answers with a marker no other sample could have invented, so a
    // marker appearing in a later sample's input could only have come from an
    // earlier sample's output.
    const markers = ['MARKER-ALPHA', 'MARKER-BETA', 'MARKER-GAMMA'] as const
    const seenInputs: string[] = []
    let sample = 0

    await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithSamples(markers.length),
      taskInput,
      task,
      runners: {
        holisticReview: async (holisticInput) => {
          const serialized = JSON.stringify(holisticInput)

          for (const marker of markers) {
            expect(serialized).not.toContain(marker)
          }

          seenInputs.push(serialized)
          const marker = markers[sample]!
          sample += 1

          return holisticResultWith([findingAt(10 + sample, marker)])
        }
      },
      logger: { debug: () => {} }
    })

    expect(seenInputs).toHaveLength(markers.length)
  })

  test('combines samples by union: a finding raised by exactly one sample survives', async () => {
    // Two samples agree on one defect; the third is alone in seeing another. Any
    // agreement threshold, majority vote, or consensus rule would delete the
    // lonely one — which is precisely the finding independent sampling exists to
    // recover, so its survival is the anti-consensus guarantee.
    const agreed = findingAt(10, 'Both of the first two samples saw this')
    const lonely = findingAt(40, 'Only the third sample saw this')
    const samples = [[agreed], [agreed], [agreed, lonely]]
    let sample = 0

    const result = await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithSamples(3),
      taskInput,
      task,
      runners: {
        holisticReview: async () => {
          const findings = samples[sample]!
          sample += 1

          return holisticResultWith(findings)
        },
        // The merge is the only thing allowed to collapse the union, and here it
        // finds nothing to collapse.
        semanticMerge: async () => ({ groups: [] })
      },
      logger: { debug: () => {} }
    })

    const titles = result.candidates.map((candidate) => candidate.title).sort()
    expect(titles).toEqual([agreed.title, lonely.title].sort())
    // Surviving to admission means surviving unrejected: nothing held the
    // single-sample finding back on the grounds that only one sample raised it.
    expect(result.rejectedFindings).toEqual([])
  })

  test('holds no second deduplication mechanism: distinct defects at one line both survive', async () => {
    // Positional identity is explicitly rejected as a dedup test (spec 05): two
    // candidates on the SAME line are frequently two different defects, and a
    // reviewer needs both. Sameness is the semantic merge's question alone.
    const samples = [
      [findingAt(10, 'A value is used without the guard it needs')],
      [findingAt(10, 'The operator in that same expression is wrong')]
    ]
    let sample = 0

    const result = await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithSamples(2),
      taskInput,
      task,
      runners: {
        holisticReview: async () => {
          const findings = samples[sample]!
          sample += 1

          return holisticResultWith(findings)
        },
        semanticMerge: async () => ({ groups: [] })
      },
      logger: { debug: () => {} }
    })

    expect(result.candidates).toHaveLength(2)
    expect(result.rejectedFindings).toEqual([])
  })

  test('collapses two samples that emit the same finding into one candidate identity', async () => {
    // Not deduplication of distinct findings: a candidate id is a hash of task,
    // path, line, and title, so two samples emitting the SAME finding describe one
    // candidate rather than two. That is what a union of candidates means, and it
    // predates sampling.
    const same = findingAt(10, 'The same defect, seen twice')
    const result = await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithSamples(3),
      taskInput,
      task,
      runners: {
        holisticReview: async () => holisticResultWith([same])
      },
      logger: { debug: () => {} }
    })

    expect(result.candidates).toHaveLength(1)
  })

  test('applies the candidate cap per sample so a later sample is not starved', async () => {
    const firstSample = Array.from({ length: HOLISTIC_MAX_CANDIDATES }, (_, index) =>
      findingAt(index + 1, `Defect ${index + 1} from the first sample`)
    )
    const secondSample = [findingAt(500, 'The only defect the second sample saw')]
    const samples = [firstSample, secondSample]
    let sample = 0

    const result = await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithSamples(2),
      taskInput,
      task,
      runners: {
        holisticReview: async () => {
          const findings = samples[sample]!
          sample += 1

          return holisticResultWith(findings)
        },
        semanticMerge: async () => ({ groups: [] })
      },
      logger: { debug: () => {} }
    })

    // A cap shared across the union would have been exhausted by the first sample,
    // and every later sample would have been paid for and then discarded.
    expect(result.candidates).toHaveLength(HOLISTIC_MAX_CANDIDATES + 1)
  })

  test('one failed sample leaves a complete review and a recorded reduction', async () => {
    const samples = [
      [findingAt(10, 'Seen by the first sample')],
      undefined,
      [findingAt(20, 'Seen by the third sample')]
    ]
    let sample = 0

    const result = await runModelBackedHolisticTaskReview({
      workflowInput: workflowInputWithSamples(3),
      taskInput,
      task,
      runners: {
        holisticReview: async () => {
          const findings = samples[sample]
          sample += 1

          if (findings === undefined) {
            throw new Error('connection reset by peer')
          }

          return holisticResultWith(findings)
        },
        semanticMerge: async () => ({ groups: [] })
      },
      logger: { debug: () => {} }
    })

    // The surviving samples' findings are all present, and the review says how
    // many samples actually produced it.
    expect(result.candidates).toHaveLength(2)
    expect(result.discoverySamples).toEqual({ requested: 3, completed: 2 })
    // Absorbed, not swallowed: the lost sample is still visible in the run.
    expect(result.providerIssues).toHaveLength(1)
    expect(result.providerIssues[0]?.recovered).toBe(true)
  })

  test('a review whose every sample fails still fails, with the original error', async () => {
    // Tolerating a lost sample must not become tolerating a lost review: with no
    // sample left, the task has no discovery at all and the failure is the same
    // one the single-sample path raises today.
    await expect(
      runModelBackedHolisticTaskReview({
        workflowInput: workflowInputWithSamples(3),
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
