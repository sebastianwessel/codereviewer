import { describe, expect, test } from 'vitest'
import {
  CandidateFindingSchema,
  type CandidateFinding
} from '../../../admission/index.js'
import {
  type ModelSemanticMergeResult,
  type SemanticMergeInput,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { runSemanticFindingMerge } from './semantic-merge.js'

const task: WorkflowReviewTask = {
  id: 'task_merge',
  kind: 'file',
  round: 1,
  paths: ['src/app.ts'],
  factIds: [],
  evidenceIds: [],
  candidateIds: [],
  contextEntryIds: [],
  priority: 1,
  instructions: [],
  reviewContext: []
}

const fileTextByPath = new Map([
  ['src/app.ts', '1: const value = read()\n2: return value.name']
])

// The stage takes a lookup rather than a map, so the caller can defer building
// one. These tests already have the map, so they adapt it.
const mapLookup =
  (byPath: ReadonlyMap<string, string>) =>
  (path: string): string | undefined =>
    byPath.get(path)

const candidate = (
  input: {
    readonly id: string
    readonly startLine: number
    readonly title: string
    readonly severity?: CandidateFinding['severity']
    readonly endLine?: number
  }
): CandidateFinding =>
  CandidateFindingSchema.parse({
    id: input.id,
    taskId: task.id,
    category: 'bug',
    severity: input.severity ?? 'high',
    title: input.title,
    description: `${input.title} at line ${input.startLine}.`,
    location: {
      path: 'src/app.ts',
      startLine: input.startLine,
      ...(input.endLine === undefined ? {} : { endLine: input.endLine }),
      side: 'file'
    },
    evidenceIds: [],
    proposedBy: 'review-agent'
  })

// Stands in for the merge model: it records what it was asked and answers with a
// scripted grouping, so every assertion below is about this stage's own logic.
const scriptedMerge = (
  groups: readonly unknown[],
  calls: SemanticMergeInput[] = []
) => ({
  calls,
  runMerge: async (input: SemanticMergeInput): Promise<ModelSemanticMergeResult> => {
    calls.push(input)

    return { groups: [...groups] }
  }
})

describe('runSemanticFindingMerge', () => {
  test('groups two restatements of one defect at adjacent lines into one survivor', async () => {
    const first = candidate({
      id: 'cand_1111111111111111',
      startLine: 2,
      title: 'Value dereferenced without a null guard'
    })
    const second = candidate({
      id: 'cand_2222222222222222',
      startLine: 3,
      title: 'Missing guard before the property access'
    })
    const merge = scriptedMerge([{ candidateIds: [first.id, second.id] }])

    const outcome = await runSemanticFindingMerge({
      task,
      candidates: [first, second],
      fileTextFor: mapLookup(fileTextByPath),
      runMerge: merge.runMerge
    })

    // Exactly one call, carrying both candidates and the file they sit in.
    expect(merge.calls).toHaveLength(1)
    expect(merge.calls[0]?.path).toBe('src/app.ts')
    expect(merge.calls[0]?.candidates.map((entry) => entry.id)).toEqual([
      first.id,
      second.id
    ])
    expect(merge.calls[0]?.fileText).toContain('1: const value = read()')

    // The group is reduced to one: the equal-severity, equally specific tie is
    // broken by the lowest candidate index, and the loser is RECORDED as a
    // duplicate naming the candidate it was merged into, not silently dropped.
    expect(outcome.rejectedFindings).toHaveLength(1)
    expect(outcome.rejectedFindings[0]?.candidateId).toBe(second.id)
    expect(outcome.rejectedFindings[0]?.reason).toBe('duplicate')
    expect(outcome.rejectedFindings[0]?.status).toBe('rejected')
    expect(outcome.rejectedFindings[0]?.message).toContain(first.id)
    expect(outcome.groupCount).toBe(1)
    expect(outcome.groupSizes).toEqual([2])
    expect(outcome.providerIssues).toEqual([])
  })

  test('records enough on the merged-away candidate alone to locate it and its representative', async () => {
    // Two candidates the merge model says are the same defect. The survivor is
    // the lower-indexed one (both `high`, both single-point locations), so
    // `second` is the one that gets merged away and must carry its own
    // identity — no other record in a report ever mentions a merged-away
    // candidate's title or location once this stage discards it.
    const first = candidate({
      id: 'cand_1111111111111111',
      startLine: 2,
      title: 'Value dereferenced without a null guard'
    })
    const second = candidate({
      id: 'cand_2222222222222222',
      startLine: 3,
      title: 'Missing guard before the property access'
    })
    const merge = scriptedMerge([{ candidateIds: [first.id, second.id] }])

    const outcome = await runSemanticFindingMerge({
      task,
      candidates: [first, second],
      fileTextFor: mapLookup(fileTextByPath),
      runMerge: merge.runMerge
    })

    const rejection = outcome.rejectedFindings[0]

    // The record IS the merged-away candidate: recoverable by its own id...
    expect(rejection?.candidateId).toBe(second.id)
    // ...and, from the message alone, both its own title and location...
    expect(rejection?.message).toContain(second.title)
    expect(rejection?.message).toContain('src/app.ts:3')
    // ...and the representative it was absorbed into, by id, title, and
    // location, so a human reading this ONE record (without cross-referencing
    // admitted findings, which may not even list `first` under this id) can
    // answer "what was dropped, and what does it now live inside of".
    expect(rejection?.message).toContain(first.id)
    expect(rejection?.message).toContain(first.title)
    expect(rejection?.message).toContain('src/app.ts:2')
  })

  test('redacts a secret embedded in a merged-away candidate title before it reaches the record', async () => {
    // A merged-away candidate never reaches admission's `redactedCandidate`
    // step, because it never reaches admission at all — so if the merge stage
    // does not redact before embedding the title in the rejection message,
    // this leaks into a report artifact untouched.
    const secretTitle = 'Hardcoded key sk-abcdefghijklmnopqrstuvwx1234 in config'
    const first = candidate({
      id: 'cand_1313131313131313',
      startLine: 2,
      title: 'Hardcoded credential committed to source'
    })
    const second = candidate({
      id: 'cand_1414141414141414',
      startLine: 3,
      title: secretTitle
    })
    const merge = scriptedMerge([{ candidateIds: [first.id, second.id] }])

    const outcome = await runSemanticFindingMerge({
      task,
      candidates: [first, second],
      fileTextFor: mapLookup(fileTextByPath),
      runMerge: merge.runMerge
    })

    expect(outcome.rejectedFindings[0]?.message).not.toContain('sk-abcdefghijklmnopqrstuvwx1234')
    expect(outcome.rejectedFindings[0]?.message).toContain('[REDACTED]')
  })

  test('keeps two distinct defects on the SAME line apart when the model reports no group', async () => {
    const missingGuard = candidate({
      id: 'cand_3333333333333333',
      startLine: 7,
      title: 'Value used without a guard'
    })
    const wrongOperator = candidate({
      id: 'cand_4444444444444444',
      startLine: 7,
      title: 'Comparison uses the wrong operator'
    })
    // The model returns no group. Positional identity is explicitly NOT the
    // test, so an identical location must not merge anything by itself: these
    // are two problems a reviewer needs both of.
    const merge = scriptedMerge([])

    const outcome = await runSemanticFindingMerge({
      task,
      candidates: [missingGuard, wrongOperator],
      fileTextFor: mapLookup(fileTextByPath),
      runMerge: merge.runMerge
    })

    expect(merge.calls).toHaveLength(1)
    expect(outcome.rejectedFindings).toEqual([])
    expect(outcome.groupCount).toBe(0)
  })

  test('issues no call at all for a file with a single candidate', async () => {
    const merge = scriptedMerge([])

    const outcome = await runSemanticFindingMerge({
      task,
      candidates: [
        candidate({
          id: 'cand_5555555555555555',
          startLine: 2,
          title: 'The only candidate for this file'
        })
      ],
      fileTextFor: mapLookup(fileTextByPath),
      runMerge: merge.runMerge
    })

    // A merge call that can only answer "no groups" is pure cost. With today's
    // roughly one candidate per file this is the common case.
    expect(merge.calls).toEqual([])
    expect(outcome.mergeCallCount).toBe(0)
    expect(outcome.rejectedFindings).toEqual([])
  })

  test('calls once per file and never mixes candidates from different files', async () => {
    const appCandidates = [
      candidate({ id: 'cand_6666666666666666', startLine: 2, title: 'One' }),
      candidate({ id: 'cand_7777777777777777', startLine: 3, title: 'Two' })
    ]
    const otherCandidate = CandidateFindingSchema.parse({
      ...candidate({ id: 'cand_8888888888888888', startLine: 4, title: 'Other' }),
      location: { path: 'src/other.ts', startLine: 4, side: 'file' }
    })
    const merge = scriptedMerge([])

    const outcome = await runSemanticFindingMerge({
      task,
      candidates: [...appCandidates, otherCandidate],
      fileTextFor: mapLookup(
        new Map([...fileTextByPath, ['src/other.ts', '4: const other = 1']])
      ),
      runMerge: merge.runMerge
    })

    // The single candidate in the second file never triggers a call.
    expect(merge.calls).toHaveLength(1)
    expect(merge.calls[0]?.path).toBe('src/app.ts')
    expect(outcome.mergeCallCount).toBe(1)
  })

  test('a failed merge call degrades to no grouping and an UNrecovered provider issue', async () => {
    const first = candidate({ id: 'cand_9999999999999999', startLine: 2, title: 'One' })
    const second = candidate({ id: 'cand_aaaaaaaaaaaaaaaa', startLine: 3, title: 'Two' })

    const outcome = await runSemanticFindingMerge({
      task,
      candidates: [first, second],
      fileTextFor: mapLookup(fileTextByPath),
      runMerge: async () => {
        throw new Error('connection reset by peer')
      }
    })

    // Losing this call costs at most a redundant comment, so it must never cost
    // the review: both candidates survive and the failure stays visible.
    expect(outcome.rejectedFindings).toEqual([])
    expect(outcome.providerIssues).toHaveLength(1)
    expect(outcome.providerIssues[0]?.recovered).toBe(false)
    expect(outcome.providerIssues[0]?.stage).toBe('semantic_finding_merge')
  })

  test('keeps the highest severity, then the most specific location, then the lowest index', async () => {
    const low = candidate({
      id: 'cand_bbbbbbbbbbbbbbbb',
      startLine: 2,
      title: 'Stated first, but lower severity',
      severity: 'low'
    })
    const highWideSpan = candidate({
      id: 'cand_cccccccccccccccc',
      startLine: 2,
      title: 'Higher severity, span covering ten lines',
      severity: 'high',
      endLine: 12
    })
    const highNarrowSpan = candidate({
      id: 'cand_dddddddddddddddd',
      startLine: 3,
      title: 'Higher severity, single-line span',
      severity: 'high',
      endLine: 3
    })
    const merge = scriptedMerge([
      { candidateIds: [low.id, highWideSpan.id, highNarrowSpan.id] }
    ])

    const outcome = await runSemanticFindingMerge({
      task,
      candidates: [low, highWideSpan, highNarrowSpan],
      fileTextFor: mapLookup(fileTextByPath),
      runMerge: merge.runMerge
    })

    // Severity decides first (the `low` candidate loses despite being listed
    // first), then the narrower span wins among the two `high` candidates.
    expect(
      outcome.rejectedFindings.map((finding) => finding.candidateId).sort()
    ).toEqual([low.id, highWideSpan.id].sort())
    expect(outcome.rejectedFindings[0]?.message).toContain(highNarrowSpan.id)
  })

  test('ignores invented ids, singleton groups, and a candidate claimed by two groups', async () => {
    const first = candidate({ id: 'cand_eeeeeeeeeeeeeeee', startLine: 2, title: 'One' })
    const second = candidate({ id: 'cand_ffffffffffffffff', startLine: 3, title: 'Two' })
    const third = candidate({ id: 'cand_0000000000000000', startLine: 4, title: 'Three' })
    const merge = scriptedMerge([
      { candidateIds: [first.id, 'cand_not_a_real_candidate'] },
      { candidateIds: [first.id, second.id] },
      { candidateIds: [second.id, third.id] }
    ])

    const outcome = await runSemanticFindingMerge({
      task,
      candidates: [first, second, third],
      fileTextFor: mapLookup(fileTextByPath),
      runMerge: merge.runMerge
    })

    // Group 1 collapses to one real member and merges nothing (and releases
    // `first` again); group 2 is honoured; group 3 loses `second` to group 2 and
    // is left with a single member, so `third` survives untouched. Everything
    // ambiguous resolves towards NOT merging.
    expect(outcome.groupSizes).toEqual([2])
    expect(outcome.rejectedFindings.map((finding) => finding.candidateId)).toEqual([
      second.id
    ])
  })

  test('skips a file the task carries no content for', async () => {
    const merge = scriptedMerge([])

    const outcome = await runSemanticFindingMerge({
      task,
      candidates: [
        candidate({ id: 'cand_1212121212121212', startLine: 2, title: 'One' }),
        candidate({ id: 'cand_3434343434343434', startLine: 3, title: 'Two' })
      ],
      fileTextFor: () => undefined,
      runMerge: merge.runMerge
    })

    // The spec's call receives the candidates for one file TOGETHER WITH the
    // file, so without the file there is nothing to ask.
    expect(merge.calls).toEqual([])
    expect(outcome.mergeCallCount).toBe(0)
    expect(outcome.rejectedFindings).toEqual([])
  })

  // The lookup exists so the caller can DEFER line-numbering every file in the
  // task. The engine produces roughly one candidate per file, so the common case
  // must not consult it at all — otherwise the deferral buys nothing.
  test('does not consult the file lookup when no file has two candidates', async () => {
    const consulted: string[] = []
    const merge = scriptedMerge([])

    await runSemanticFindingMerge({
      task,
      candidates: [
        candidate({ id: 'cand_5656565656565656', startLine: 2, title: 'Only one' })
      ],
      fileTextFor: (path) => {
        consulted.push(path)

        return fileTextByPath.get(path)
      },
      runMerge: merge.runMerge
    })

    expect(consulted).toEqual([])
    expect(merge.calls).toEqual([])
  })
})
