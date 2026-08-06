import { describe, expect, test } from 'vitest'
import {
  type ContextRetrievalResult,
  type ContextRetriever
} from '../../../context-retrieval/index.js'
import {
  type FindingRefutationBatchInput,
  type FindingRefutationRunner
} from '../agent-contracts.js'
import { mediatedRepoToolDefinitions } from '../mediated-repo-tools.js'
import { findingRefutationRunnerWithRetrieval } from './retrieval.js'

const fakeRetriever = (): ContextRetriever =>
  ({
    budget: () => ({}),
    reduceReadBudget: () => false,
    readRepositoryFile: async ({ path }: { path: string }) =>
      ({
        tool: 'read',
        summary: 'read summary',
        content: `contents of ${path}`,
        ledgerEntry: { id: 'ctx_read' },
        evidence: { id: 'ev_read' }
      }) as unknown as ContextRetrievalResult
  }) as unknown as ContextRetriever

const packet = (candidateCount: number): FindingRefutationBatchInput =>
  ({
    candidates: Array.from({ length: candidateCount }, (_unused, index) => ({
      id: `cand_${index}`
    }))
  }) as unknown as FindingRefutationBatchInput

const readDep = async (): Promise<string> =>
  (
    (await mediatedRepoToolDefinitions.repo_read.handler(undefined, {
      path: 'src/dep.ts'
    })) as { readonly content: string }
  ).content

// A runner that performs `reads` mediated reads before answering, recording what
// each of them returned.
const readingRunner = (
  reads: number,
  seen: string[]
): FindingRefutationRunner =>
  async () => {
    for (let attempt = 0; attempt < reads; attempt += 1) {
      seen.push(await readDep())
    }

    return { verdicts: [] } as never
  }

describe('refutation cross-file retrieval wiring (spec 05)', () => {
  test('returns the runner UNCHANGED when the capability is off', () => {
    const refuteFinding = readingRunner(0, [])

    expect(
      findingRefutationRunnerWithRetrieval({
        refuteFinding,
        contextRetriever: fakeRetriever(),
        retrieval: undefined
      })
    ).toBe(refuteFinding)
  })

  test('returns the runner UNCHANGED when the run has no repository root', () => {
    const refuteFinding = readingRunner(0, [])

    expect(
      findingRefutationRunnerWithRetrieval({
        refuteFinding,
        contextRetriever: undefined,
        retrieval: { maxToolCallsPerBatch: 4 }
      })
    ).toBe(refuteFinding)
  })

  test('binds bounded tools for the duration of one adjudication call', async () => {
    const seen: string[] = []
    const runner = findingRefutationRunnerWithRetrieval({
      refuteFinding: readingRunner(1, seen),
      contextRetriever: fakeRetriever(),
      retrieval: { maxToolCallsPerBatch: 4 }
    })

    await runner(packet(1), undefined)

    expect(seen).toEqual(['1: contents of src/dep.ts'])
    // Outside the call the tools are gone again: no unattributed, unbounded read
    // can survive the scope it was granted for.
    await expect(readDep()).rejects.toThrow(
      /No active mediated repository tools/u
    )
  })

  test('grants each call its own budget, so a split or retried batch is not starved', async () => {
    const seen: string[] = []
    const runner = findingRefutationRunnerWithRetrieval({
      refuteFinding: readingRunner(1, seen),
      contextRetriever: fakeRetriever(),
      retrieval: { maxToolCallsPerBatch: 1 }
    })

    // A batch the packet budget halves issues two calls, and the single retry over
    // a malformed response issues another. Each is its own call and must open with
    // a full allowance rather than inheriting a spent one.
    await runner(packet(1), undefined)
    await runner(packet(1), undefined)

    expect(seen).toEqual([
      '1: contents of src/dep.ts',
      '1: contents of src/dep.ts'
    ])
  })

  test('keeps concurrent batches on independent budgets', async () => {
    const seen: string[] = []
    const runner = findingRefutationRunnerWithRetrieval({
      refuteFinding: readingRunner(2, seen),
      contextRetriever: fakeRetriever(),
      retrieval: { maxToolCallsPerBatch: 2 }
    })

    await Promise.all([runner(packet(1), undefined), runner(packet(1), undefined)])

    // Four reads across two concurrent batches of two: neither batch spent the
    // other's allowance, which is what a shared counter would have caused.
    expect(seen.length).toBe(4)
    expect(
      seen.every((content) => content.includes('contents of src/dep.ts'))
    ).toBe(true)
  })

  test('records the bound it hit, even when the call then fails', async () => {
    const messages: { message: string; metadata?: Record<string, unknown> }[] = []
    const runner = findingRefutationRunnerWithRetrieval({
      refuteFinding: async () => {
        // Two reads against a budget of one: the second is refused by code, and
        // the call then fails for its own reasons.
        await readDep()
        await readDep()
        throw new Error('model failed after spending its budget')
      },
      contextRetriever: fakeRetriever(),
      retrieval: { maxToolCallsPerBatch: 1 },
      logger: {
        debug: (message, metadata) => {
          messages.push({
            message,
            ...(metadata === undefined
              ? {}
              : { metadata: { ...metadata } })
          })
        }
      }
    })

    await expect(runner(packet(3), undefined)).rejects.toThrow(
      /model failed after spending its budget/u
    )

    expect(messages).toEqual([
      {
        message: 'Refutation cross-file retrieval completed.',
        metadata: {
          candidate_count: 3,
          tool_call_count: 1,
          bytes_read: expect.any(Number) as unknown as number,
          budget_exhausted: true
        }
      }
    ])
  })
})
