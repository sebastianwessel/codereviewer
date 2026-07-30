import { describe, expect, test } from 'vitest'
import { type WorkflowReviewTask } from '../agent-contracts.js'
import { partitionTaskForDiscovery } from './discovery-partition.js'

const document = (
  overrides: Partial<WorkflowReviewTask['reviewContext'][number]>
): WorkflowReviewTask['reviewContext'][number] => ({
  kind: 'file',
  content: 'x\n',
  ledgerEntryId: 'ctx_0000000000000000',
  ...overrides
})

const fileDocuments = (count: number) =>
  Array.from({ length: count }, (_unused, index) =>
    document({
      path: `src/f${index}.ts`,
      ledgerEntryId: `ctx_00000000000000${index.toString().padStart(2, '0')}`
    })
  )

const taskWith = (
  reviewContext: WorkflowReviewTask['reviewContext']
): WorkflowReviewTask => ({
  id: 'task_parent',
  round: 1,
  kind: 'file',
  paths: reviewContext
    .filter((entry) => entry.kind === 'file')
    .map((entry) => entry.path)
    .filter((path): path is string => path !== undefined),
  factIds: [],
  evidenceIds: [],
  candidateIds: [],
  contextEntryIds: [],
  priority: 0,
  reviewContext
})

describe('discovery partitioning', () => {
  test('no configured limit leaves the task exactly as it is', () => {
    // The default must not change behaviour: shipping a chosen-by-feel limit is the
    // failure this project has corrected repeatedly.
    const task = taskWith(fileDocuments(40))

    expect(partitionTaskForDiscovery(task, undefined)).toEqual([task])
  })

  test('a task already within the limit is not partitioned', () => {
    const task = taskWith(fileDocuments(3))

    expect(partitionTaskForDiscovery(task, 4)).toEqual([task])
    expect(partitionTaskForDiscovery(task, 3)).toEqual([task])
  })

  test('splits files across calls, covering every file exactly once', () => {
    const partitions = partitionTaskForDiscovery(taskWith(fileDocuments(7)), 2)

    expect(partitions).toHaveLength(4)
    expect(partitions.map((p) => p.paths)).toEqual([
      ['src/f0.ts', 'src/f1.ts'],
      ['src/f2.ts', 'src/f3.ts'],
      ['src/f4.ts', 'src/f5.ts'],
      ['src/f6.ts']
    ])
    // Every partition gets its own id, or their candidates would collide.
    expect(new Set(partitions.map((p) => p.id)).size).toBe(4)
  })

  test('one file per call is the strongest partitioning', () => {
    const partitions = partitionTaskForDiscovery(taskWith(fileDocuments(5)), 1)

    expect(partitions).toHaveLength(5)
    for (const partition of partitions) {
      expect(partition.paths).toHaveLength(1)
    }
  })

  test('routes path-bearing context to its own call and shares path-less context', () => {
    const partitions = partitionTaskForDiscovery(
      taskWith([
        ...fileDocuments(2),
        document({
          kind: 'referenced-definition',
          path: 'src/f0.ts',
          content: 'digest',
          ledgerEntryId: 'ctx_0000000000000097'
        }),
        document({
          kind: 'change-intent',
          content: 'the brief for the whole change',
          ledgerEntryId: 'ctx_0000000000000098'
        })
      ]),
      1
    )

    const kinds = (index: number) =>
      partitions[index]?.reviewContext.map((entry) => entry.kind) ?? []

    expect(kinds(0)).toContain('referenced-definition')
    expect(kinds(1)).not.toContain('referenced-definition')
    // Context describing the whole change reaches every call: dropping it would make
    // a partition review with LESS context than the undivided task had.
    expect(kinds(0)).toContain('change-intent')
    expect(kinds(1)).toContain('change-intent')
  })

  test('a partition’s paths are only the files it was shown', () => {
    // This is what keeps admission honest — a call must not be able to report a
    // finding in a file it never read.
    const partitions = partitionTaskForDiscovery(taskWith(fileDocuments(4)), 2)

    expect(partitions[0]?.paths).toEqual(['src/f0.ts', 'src/f1.ts'])
    expect(partitions[0]?.paths).not.toContain('src/f2.ts')
  })
})
