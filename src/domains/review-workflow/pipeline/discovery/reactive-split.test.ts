import { describe, expect, test } from 'vitest'
import { type WorkflowReviewTask } from '../agent-contracts.js'
import { splitTaskInHalf } from './reactive-split.js'

const document = (
  overrides: Partial<WorkflowReviewTask['reviewContext'][number]>
): WorkflowReviewTask['reviewContext'][number] => ({
  kind: 'file',
  content: 'a\nb\n',
  ledgerEntryId: 'ctx_0000000000000000',
  ...overrides
})

const taskWith = (
  reviewContext: WorkflowReviewTask['reviewContext']
): WorkflowReviewTask => ({
  id: 'task_parent',
  round: 1,
  kind: 'file',
  paths: [
    ...new Set(
      reviewContext
        .filter((entry) => entry.kind === 'file')
        .map((entry) => entry.path)
        .filter((path): path is string => path !== undefined)
    )
  ],
  factIds: [],
  evidenceIds: [],
  candidateIds: [],
  contextEntryIds: [],
  priority: 0,
  reviewContext
})

describe('reactive task splitting', () => {
  test('halves the review targets and narrows each half’s paths to what it shows', () => {
    const halves = splitTaskInHalf(
      taskWith([
        document({ path: 'src/a.ts', ledgerEntryId: 'ctx_0000000000000001' }),
        document({ path: 'src/b.ts', ledgerEntryId: 'ctx_0000000000000002' }),
        document({ path: 'src/c.ts', ledgerEntryId: 'ctx_0000000000000003' }),
        document({ path: 'src/d.ts', ledgerEntryId: 'ctx_0000000000000004' })
      ])
    )

    expect(halves?.[0].paths).toEqual(['src/a.ts', 'src/b.ts'])
    expect(halves?.[1].paths).toEqual(['src/c.ts', 'src/d.ts'])
    // A half must not keep the parent's full path list: it would let the model
    // report a finding in a file it was never shown, which admission would then
    // anchor against content that call never read.
    expect(halves?.[0].reviewContext.map((entry) => entry.path)).toEqual([
      'src/a.ts',
      'src/b.ts'
    ])
  })

  test('gives each half its own id, so their candidates cannot collide', () => {
    const halves = splitTaskInHalf(
      taskWith([
        document({ path: 'src/a.ts', ledgerEntryId: 'ctx_0000000000000001' }),
        document({ path: 'src/b.ts', ledgerEntryId: 'ctx_0000000000000002' })
      ])
    )

    expect(halves?.[0].id).not.toBe(halves?.[1].id)
    expect(halves?.[0].id).not.toBe('task_parent')
  })

  test('splits a single file by lines, keeping absolute origins', () => {
    const halves = splitTaskInHalf(
      taskWith([
        document({
          path: 'src/only.ts',
          content: 'a\nb\nc\nd\n',
          startLine: 1,
          endLine: 5
        })
      ])
    )
    const first = halves?.[0].reviewContext[0]
    const second = halves?.[1].reviewContext[0]

    expect(first).toMatchObject({ content: 'a\nb\n', startLine: 1 })
    expect(second).toMatchObject({ content: 'c\nd\n', startLine: 3 })
    // Lossless: the halves are what the model reviews, and admission anchors
    // findings against them.
    expect(`${first?.content}${second?.content}`).toBe('a\nb\nc\nd\n')
    expect(halves?.[0].paths).toEqual(['src/only.ts'])
    expect(halves?.[1].paths).toEqual(['src/only.ts'])
  })

  test('routes path-bearing context to its own half and shares path-less context', () => {
    const halves = splitTaskInHalf(
      taskWith([
        document({ path: 'src/a.ts', ledgerEntryId: 'ctx_0000000000000001' }),
        document({ path: 'src/b.ts', ledgerEntryId: 'ctx_0000000000000002' }),
        document({
          kind: 'referenced-definition',
          // An UNCHANGED dependency, as assembly always produces.
          path: 'src/lib/unchanged-dependency.ts',
          content: 'digest of a dependency',
          ledgerEntryId: 'ctx_0000000000000003'
        }),
        document({
          kind: 'change-intent',
          content: 'the brief for the whole change',
          ledgerEntryId: 'ctx_0000000000000004'
        })
      ])
    )

    const kinds = (index: 0 | 1): readonly string[] =>
      halves?.[index].reviewContext.map((entry) => entry.kind) ?? []

    // A referenced definition points OUTSIDE the reviewed files, so it belongs to
    // both halves — withholding it from either would simply lose it.
    expect(kinds(0)).toContain('referenced-definition')
    expect(kinds(1)).toContain('referenced-definition')
    // ...while context describing the whole change goes to BOTH halves, since
    // dropping it from either would silently review that half with less context
    // than the undivided task had.
    expect(kinds(0)).toContain('change-intent')
    expect(kinds(1)).toContain('change-intent')
    // Context-only documents are never review targets.
    expect(halves?.[0].paths).toEqual(['src/a.ts'])
  })

  test('reports a task that cannot be split rather than returning a useless half', () => {
    // A single indivisible line: the caller must fail loudly, not recurse.
    expect(
      splitTaskInHalf(
        taskWith([document({ path: 'src/tiny.ts', content: 'x' })])
      )
    ).toBeUndefined()

    // Context with no review target at all. Halving it would produce two tasks that
    // can raise no finding, which is worse than saying it cannot be split.
    expect(
      splitTaskInHalf(
        taskWith([
          document({
            kind: 'change-intent',
            content: 'a very long brief'.repeat(100)
          })
        ])
      )
    ).toBeUndefined()
  })
})
