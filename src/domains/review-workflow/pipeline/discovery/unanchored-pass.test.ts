import { describe, expect, test } from 'vitest'
import {
  TaskReviewInputSchema,
  type HolisticReviewInput,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { createUnanchoredRunBudget } from './unanchored-run-budget.js'
import { runUnanchoredDiscoveryPass } from './unanchored-pass.js'

const configHash =
  '3333333333333333333333333333333333333333333333333333333333333333'

const geometry = { unitLines: 60, strideLines: 40 }

// 100 lines, each naming its own absolute line number, so a packet can be checked
// against the truth rather than against another copy of the same slicing code.
const sourceLines = Array.from(
  { length: 100 },
  (_unused, index) => `const value${index + 1} = ${index + 1} // line ${index + 1}`
)

const taskWith = (
  extraContext: WorkflowReviewTask['reviewContext'] = []
): WorkflowReviewTask => ({
  id: 'task_unanchored',
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
      startLine: 1,
      content: sourceLines.join('\n'),
      ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
    },
    ...extraContext
  ]
})

const taskInputFor = (task: WorkflowReviewTask) =>
  TaskReviewInputSchema.parse({
    task,
    reviewedDiffRanges: [
      { path: 'src/app.ts', startLine: 12, endLine: 12, changeKind: 'modified' }
    ],
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

const runPassCapturing = async (
  options: {
    readonly task?: WorkflowReviewTask
    readonly maxUnitsPerFile?: number
    readonly maxUnitsPerRun?: number
  } = {}
) => {
  const task = options.task ?? taskWith()
  const packets: HolisticReviewInput[] = []
  const budget = createUnanchoredRunBudget({
    ...geometry,
    maxUnitsPerFile: options.maxUnitsPerFile ?? 8,
    maxUnitsPerRun: options.maxUnitsPerRun ?? 40
  })
  const outcome = await runUnanchoredDiscoveryPass({
    taskInput: taskInputFor(task),
    task,
    geometry,
    budget,
    runReview: async (holisticInput) => {
      packets.push(holisticInput)

      return { findings: [] }
    }
  })

  return { packets, outcome, budget }
}

describe('un-anchored discovery pass', () => {
  test('issues one call per derived unit', async () => {
    const { packets, outcome } = await runPassCapturing()

    // 100 lines at 60/40 is two units.
    expect(packets).toHaveLength(2)
    expect(outcome.unitsDerived).toBe(2)
    expect(outcome.unitsReviewed).toBe(2)
  })

  // THE POINT OF THE WHOLE CHANGE. Withholding the diff is the intervention; a
  // packet that carries diff text makes the pass inert, which is what the
  // diff-bearing arm of the 2026-07-27 experiment measured.
  test('the packet contains no diff text of any kind', async () => {
    const { packets } = await runPassCapturing()

    for (const packet of packets) {
      expect(packet.reviewText).not.toContain('diff --git')
      expect(packet.reviewText).not.toContain('```diff')
      expect(packet.reviewText).not.toContain(
        '## Diff - exactly what this change modified'
      )
      // Nor the task's own changed-line range, which is the anchor in range form:
      // line 12 is inside the first unit, so it would be present if the task's
      // reviewedDiffRanges had leaked through.
      expect(packet.reviewText).not.toContain('lines 12-12')
      expect(packet.reviewText).not.toContain('(modified)')
    }
  })

  test('declares the unit’s own span as the reviewed range and shows exactly that span', async () => {
    const { packets } = await runPassCapturing()

    expect(packets[0]?.reviewText).toContain('src/app.ts lines 1-60')
    expect(packets[0]?.reviewText).toContain('1: const value1 = 1')
    expect(packets[0]?.reviewText).toContain('60: const value60 = 60')
    expect(packets[0]?.reviewText).not.toContain('61: const value61 = 61')

    expect(packets[1]?.reviewText).toContain('src/app.ts lines 41-100')
    // The second unit is numbered from its absolute origin, so a line the model
    // reads back is the file's real line, not an offset into the unit.
    expect(packets[1]?.reviewText).toContain('41: const value41 = 41')
    expect(packets[1]?.reviewText).toContain('100: const value100 = 100')
    expect(packets[1]?.reviewText).not.toContain('40: const value40 = 40')
  })

  // The pass differs from the primary pass in what it is SHOWN, never in what it
  // is asked. It uses the same agent and the same prompt builder, so the packet
  // must carry no framing of its own.
  test('asks nothing the primary pass does not ask', async () => {
    const { packets } = await runPassCapturing()

    for (const packet of packets) {
      expect(packet.taskId).toBe('task_unanchored')
      expect(packet.reviewText.startsWith('Review task task_unanchored.')).toBe(
        true
      )
      expect(packet.reviewText).not.toContain('SECURITY-ONLY REVIEW')
      expect(packet.reviewText).not.toContain('## Security review checklist')
      // No enumeration prompt, no "look harder", no defect-class hint: everything
      // after the frame is the standard context sections.
      expect(packet.reviewText).toContain(
        '## Changed files (full content, line-numbered, for context)'
      )
    }
  })

  test('carries non-source context through untouched', async () => {
    const task = taskWith([
      {
        kind: 'referenced-definition',
        path: 'src/dep.ts',
        content: '1: export const calc = (value: number): number => value * 2',
        ledgerEntryId: 'ctx_bbbbbbbbbbbbbbbbbbbbbbbb'
      },
      {
        kind: 'change-intent',
        content: 'Intent: raise the discount ceiling.',
        ledgerEntryId: 'ctx_cccccccccccccccccccccccc'
      }
    ])
    const { packets } = await runPassCapturing({ task })

    expect(packets[0]?.reviewText).toContain('### DEFINITION: src/dep.ts')
    expect(packets[0]?.reviewText).toContain(
      'Intent: raise the discount ceiling.'
    )
  })

  test('reviews only the granted units when the per-file bound truncates', async () => {
    const { packets, outcome, budget } = await runPassCapturing({
      maxUnitsPerFile: 1
    })

    expect(packets).toHaveLength(1)
    expect(outcome.unitsDerived).toBe(2)
    expect(outcome.unitsReviewed).toBe(1)
    expect(budget.summary().unitsWithheld).toBe(1)
  })

  test('reviews nothing once the run bound is exhausted', async () => {
    const budget = createUnanchoredRunBudget({
      ...geometry,
      maxUnitsPerFile: 8,
      maxUnitsPerRun: 1
    })
    budget.claimUnits(1)

    const task = taskWith()
    let calls = 0
    const outcome = await runUnanchoredDiscoveryPass({
      taskInput: taskInputFor(task),
      task,
      geometry,
      budget,
      runReview: async () => {
        calls += 1

        return { findings: [] }
      }
    })

    expect(calls).toBe(0)
    expect(outcome.unitsReviewed).toBe(0)
    expect(budget.summary().perRunBoundReached).toBe(true)
  })

  test('a malformed unit response costs that unit, not the pass', async () => {
    const task = taskWith()
    let calls = 0
    const outcome = await runUnanchoredDiscoveryPass({
      taskInput: taskInputFor(task),
      task,
      geometry,
      budget: createUnanchoredRunBudget({
        ...geometry,
        maxUnitsPerFile: 8,
        maxUnitsPerRun: 40
      }),
      runReview: async () => {
        calls += 1

        if (calls === 1) {
          throw new Error('Agent output validation failed')
        }

        return {
          findings: [
            {
              category: 'bug',
              severity: 'high',
              title: 'Defect in the second unit',
              description: 'Reported from the unit that answered.',
              path: 'src/app.ts',
              startLine: 90
            }
          ]
        }
      }
    })

    expect(calls).toBe(2)
    expect(outcome.findings).toHaveLength(1)
    expect(outcome.providerIssues).toHaveLength(1)
    expect(outcome.providerIssues[0]?.recovered).toBe(true)
  })

  // Spec 19: failure of the pass is recoverable and non-fatal. Discovery's own
  // policy rethrows an error it does not recognize, because losing the general
  // call loses the review; losing this one loses only the extra candidates.
  test('an unrecognised failure ends the pass without failing the task', async () => {
    const task = taskWith()
    const outcome = await runUnanchoredDiscoveryPass({
      taskInput: taskInputFor(task),
      task,
      geometry,
      budget: createUnanchoredRunBudget({
        ...geometry,
        maxUnitsPerFile: 8,
        maxUnitsPerRun: 40
      }),
      runReview: async () => {
        throw new Error('connection reset by peer')
      }
    })

    expect(outcome.findings).toEqual([])
    expect(outcome.providerIssues).toHaveLength(1)
    expect(outcome.providerIssues[0]?.recovered).toBe(true)
  })

  // A file too large for one packet becomes several chunk tasks, so a task's
  // content can start partway into its file. Units derived in the chunk's own
  // coordinates would look right and point at the wrong lines — and, because the
  // slice would then fall outside the content, would silently review nothing.
  test('reviews a chunk that starts partway into its file, in the file’s own line numbers', async () => {
    const chunkTask: WorkflowReviewTask = {
      ...taskWith(),
      reviewContext: [
        {
          kind: 'file',
          path: 'src/app.ts',
          startLine: 201,
          endLine: 300,
          content: sourceLines.join('\n'),
          ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
        }
      ]
    }
    const { packets, outcome } = await runPassCapturing({ task: chunkTask })

    expect(outcome.unitsReviewed).toBe(2)
    expect(packets[0]?.reviewText).toContain('src/app.ts lines 201-260')
    expect(packets[0]?.reviewText).toContain('201: const value1 = 1')
    expect(packets[1]?.reviewText).toContain('src/app.ts lines 241-300')
    expect(packets[1]?.reviewText).toContain('241: const value41 = 41')
  })

  test('a file the task carries no content for produces no units and no calls', async () => {
    const task: WorkflowReviewTask = { ...taskWith(), reviewContext: [] }
    let calls = 0
    const outcome = await runUnanchoredDiscoveryPass({
      taskInput: taskInputFor(task),
      task,
      geometry,
      budget: createUnanchoredRunBudget({
        ...geometry,
        maxUnitsPerFile: 8,
        maxUnitsPerRun: 40
      }),
      runReview: async () => {
        calls += 1

        return { findings: [] }
      }
    })

    expect(calls).toBe(0)
    expect(outcome.unitsDerived).toBe(0)
  })
})
