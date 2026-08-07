import { describe, expect, test } from 'vitest'
import { type WorkflowReviewTask } from '../agent-contracts.js'
import {
  declarationSplitOptionsFor,
  partitionTaskForDiscovery
} from './discovery-partition.js'

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

// Four lines per declaration, so anchors land on 1, 5, 9, … and the document is
// exactly `4 * count` lines long.
const declarationDocument = (
  path: string,
  declarationCount: number
): WorkflowReviewTask['reviewContext'][number] => {
  const content = Array.from(
    { length: declarationCount },
    (_unused, index) =>
      `export const fn${index} = (): number => {\n  return ${index}\n}\n`
  ).join('\n')

  return document({
    path,
    content,
    startLine: 1,
    endLine: content.split('\n').length,
    ledgerEntryId: `ctx_${path.replace(/[^a-z0-9]/gu, '0').padEnd(24, '0').slice(0, 24)}`
  })
}

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
  instructions: [],
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
          // An UNCHANGED dependency — which is the only thing a referenced
          // definition ever is. Never one of the changed files.
          path: 'src/lib/unchanged-dependency.ts',
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

    // A referenced definition describes an unchanged dependency of the CHANGE, not
    // of one file, so every call needs it. Dropping it is what the original code did.
    expect(kinds(0)).toContain('referenced-definition')
    expect(kinds(1)).toContain('referenced-definition')
    // Context describing the whole change reaches every call: dropping it would make
    // a partition review with LESS context than the undivided task had.
    expect(kinds(0)).toContain('change-intent')
    expect(kinds(1)).toContain('change-intent')
  })

  test('sub-file splitting stays off unless it is configured', () => {
    // The default must not change behaviour, and the group cap alone is not a
    // configuration: without a declarations-per-call value nothing splits.
    const task = taskWith([declarationDocument('src/sample.ts', 6)])

    expect(partitionTaskForDiscovery(task, 2, undefined)).toEqual([task])
    expect(
      partitionTaskForDiscovery(task, 2, undefined)[0]
    ).toBe(task)
    expect(
      declarationSplitOptionsFor({ maxDeclarationGroupsPerFile: 3 })
    ).toBeUndefined()
  })

  test('the group cap defaults when only the declaration limit is configured', () => {
    expect(
      declarationSplitOptionsFor({ maxDeclarationsPerDiscoveryCall: 16 })
    ).toEqual({ maxDeclarationsPerCall: 16, maxGroupsPerFile: 3 })
  })

  test('a single-file change is spread across calls by declaration', () => {
    // This is the whole point of the sub-file split: `maxFilesPerDiscoveryCall`
    // yields ONE call here, so the only mechanism measured as working cannot
    // engage at all.
    const task = taskWith([declarationDocument('src/sample.ts', 6)])
    const partitions = partitionTaskForDiscovery(task, 2, {
      maxDeclarationsPerCall: 3,
      maxGroupsPerFile: 3
    })

    expect(partitions).toHaveLength(3)
    expect(new Set(partitions.map((partition) => partition.id)).size).toBe(3)
    for (const partition of partitions) {
      expect(partition.paths).toEqual(['src/sample.ts'])
    }
    expect(
      partitions.map((partition) => {
        const document = partition.reviewContext.find(
          (entry) => entry.kind === 'file'
        )
        return [document?.startLine, document?.endLine]
      })
    ).toEqual([
      [1, 12],
      [9, 20],
      [17, 24]
    ])
  })

  test('the per-file group cap bounds the number of calls', () => {
    // Uncapped, 200 anchors at four per group is 50 calls for one case, which is
    // refused on cost alone.
    const partitions = partitionTaskForDiscovery(
      taskWith([declarationDocument('src/big.ts', 200)]),
      2,
      { maxDeclarationsPerCall: 4, maxGroupsPerFile: 3 }
    )

    expect(partitions).toHaveLength(3)
  })

  test('every sub-task still receives the shared context', () => {
    // The referenced-definition regression, guarded on the sub-file path too: an
    // R4 digest is by construction an UNCHANGED dependency, so matching it against
    // a sub-task's own paths never succeeds and every digest was silently dropped
    // from every partition.
    const partitions = partitionTaskForDiscovery(
      taskWith([
        declarationDocument('src/sample.ts', 6),
        document({
          kind: 'referenced-definition',
          path: 'src/lib/unchanged-dependency.ts',
          content: 'digest',
          ledgerEntryId: 'ctx_0000000000000097'
        }),
        document({
          kind: 'change-intent',
          content: 'the brief for the whole change',
          ledgerEntryId: 'ctx_0000000000000098'
        }),
        document({
          kind: 'support-signal-output',
          content: '{"facts":[]}',
          ledgerEntryId: 'ctx_0000000000000099'
        })
      ]),
      2,
      { maxDeclarationsPerCall: 3, maxGroupsPerFile: 3 }
    )

    expect(partitions).toHaveLength(3)
    for (const partition of partitions) {
      const kinds = partition.reviewContext.map((entry) => entry.kind)

      expect(kinds).toContain('referenced-definition')
      expect(kinds).toContain('change-intent')
      expect(kinds).toContain('support-signal-output')
      // A sub-task must never be a review target for its dependency digest.
      expect(partition.paths).toEqual(['src/sample.ts'])
    }
  })

  test('a file with no declaration anchors is left undivided', () => {
    const task = taskWith([
      document({
        path: 'notes/readme.txt',
        content: 'alpha\nbeta\n',
        startLine: 1,
        endLine: 3,
        ledgerEntryId: 'ctx_0000000000000042'
      })
    ])

    expect(
      partitionTaskForDiscovery(task, 2, {
        maxDeclarationsPerCall: 1,
        maxGroupsPerFile: 3
      })
    ).toEqual([task])
  })

  test('a file that yields fewer groups stops appearing rather than repeating', () => {
    // Repeating a file's last group to fill the shape would be a second look at
    // identical material, which this project measured and rejected.
    const partitions = partitionTaskForDiscovery(
      taskWith([
        declarationDocument('src/wide.ts', 6),
        declarationDocument('src/narrow.ts', 2)
      ]),
      2,
      { maxDeclarationsPerCall: 3, maxGroupsPerFile: 3 }
    )

    expect(partitions.map((partition) => partition.paths)).toEqual([
      ['src/narrow.ts', 'src/wide.ts'],
      ['src/wide.ts'],
      ['src/wide.ts']
    ])
  })

  test('a partition’s paths are only the files it was shown', () => {
    // This is what keeps admission honest — a call must not be able to report a
    // finding in a file it never read.
    const partitions = partitionTaskForDiscovery(taskWith(fileDocuments(4)), 2)

    expect(partitions[0]?.paths).toEqual(['src/f0.ts', 'src/f1.ts'])
    expect(partitions[0]?.paths).not.toContain('src/f2.ts')
  })
})
