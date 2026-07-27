import { describe, expect, test } from 'vitest'
import {
  type ContextRetrievalResult,
  type ContextRetriever
} from '../../../context-retrieval/index.js'
import { runContextScout } from './context-scout.js'
import {
  TaskReviewInputSchema,
  type WorkflowReviewTask
} from '../agent-contracts.js'

const dependencySource = [
  'export const lookupIndex = (name: string): number => {',
  '  if (name.length === 0) {',
  '    return -1',
  '  }',
  '  return names.indexOf(name)',
  '}',
  '',
  'export const unrelated = (): void => {}'
].join('\n')

const retrieverReturning = (
  content: string
): { readonly retriever: ContextRetriever; readonly reads: string[] } => {
  const reads: string[] = []

  return {
    reads,
    retriever: {
      budget: () => ({}),
      readRepositoryFile: async ({ path }: { path: string }) => {
        reads.push(path)
        return { content } as unknown as ContextRetrievalResult
      },
      listRepositoryDirectory: async () =>
        ({ content: '' }) as unknown as ContextRetrievalResult,
      grepRepository: async () =>
        ({ content: '' }) as unknown as ContextRetrievalResult
    } as unknown as ContextRetriever
  }
}

const task: WorkflowReviewTask = {
  id: 'task_scout',
  kind: 'file',
  round: 1,
  paths: ['src/app.ts'],
  factIds: [],
  evidenceIds: [],
  candidateIds: [],
  contextEntryIds: [],
  priority: 1,
  reviewContext: []
}

const taskInput = TaskReviewInputSchema.parse({
  task,
  reviewedDiffRanges: [],
  evidence: [],
  candidates: [],
  instructions: [],
  skills: [],
  sharedDigest: 'digest',
  provenance: {
    reviewer: 'review-agent',
    modelProvider: 'openai',
    modelName: 'scout-test',
    signalVersions: {},
    configHash: '3'.repeat(64)
  }
})

const bounds = { maxSymbols: 8, maxBytesPerSymbol: 4000 }

describe('context scout (spec 18)', () => {
  test('injects the body of a symbol the scout requested from an unchanged file', async () => {
    const { retriever, reads } = retrieverReturning(dependencySource)

    const outcome = await runContextScout({
      taskInput,
      task,
      reviewText: 'Review task task_scout.',
      runScout: async () => ({
        requests: [
          { name: 'lookupIndex', path: 'src/dep.ts', reason: 'caller ignores -1' }
        ]
      }),
      retriever,
      bounds
    })

    expect(reads).toEqual(['src/dep.ts'])
    expect(outcome.requestedCount).toBe(1)
    expect(outcome.resolvedCount).toBe(1)
    // The BODY is what the reviewer needs — the sentinel return is the whole point,
    // and a signature alone would not reveal it.
    expect(outcome.section).toContain('lookupIndex')
    expect(outcome.section).toContain('return -1')
    // Framed as context-only so findings stay restricted to the task's paths.
    expect(outcome.section).toContain('Do NOT review them')
  })

  test('drops a symbol that does not exist in the resolved file', async () => {
    const { retriever } = retrieverReturning(dependencySource)

    const outcome = await runContextScout({
      taskInput,
      task,
      reviewText: 'Review task task_scout.',
      runScout: async () => ({
        requests: [{ name: 'neverDefinedAnywhere', path: 'src/dep.ts' }]
      }),
      retriever,
      bounds
    })

    // A hallucinated symbol must never become context: nothing is injected and the
    // prompt is left untouched.
    expect(outcome.resolvedCount).toBe(0)
    expect(outcome.section).toBe('')
  })

  test('skips a symbol in a file the reviewer already sees in full', async () => {
    const { retriever, reads } = retrieverReturning(dependencySource)

    const outcome = await runContextScout({
      taskInput,
      task,
      reviewText: 'Review task task_scout.',
      runScout: async () => ({
        requests: [{ name: 'lookupIndex', path: 'src/app.ts' }]
      }),
      retriever,
      bounds
    })

    // src/app.ts is a task path; re-injecting it would waste packet budget.
    expect(reads).toEqual([])
    expect(outcome.section).toBe('')
  })

  test('degrades to no extra context when the scout call fails', async () => {
    const { retriever } = retrieverReturning(dependencySource)

    const outcome = await runContextScout({
      taskInput,
      task,
      reviewText: 'Review task task_scout.',
      runScout: async () => {
        throw new Error('provider exploded')
      },
      retriever,
      bounds
    })

    // The scout is an aid: its failure costs context, never the review.
    expect(outcome).toEqual({
      section: '',
      requestedCount: 0,
      resolvedCount: 0,
      bytesInjected: 0
    })
  })

  test('honours the symbol budget', async () => {
    const { retriever, reads } = retrieverReturning(dependencySource)

    await runContextScout({
      taskInput,
      task,
      reviewText: 'Review task task_scout.',
      runScout: async () => ({
        requests: [
          { name: 'lookupIndex', path: 'src/a.ts' },
          { name: 'lookupIndex', path: 'src/b.ts' },
          { name: 'lookupIndex', path: 'src/c.ts' }
        ]
      }),
      retriever,
      bounds: { maxSymbols: 2, maxBytesPerSymbol: 4000 }
    })

    // Ranked most-decisive first, so the budget keeps the leading entries.
    expect(reads).toEqual(['src/a.ts', 'src/b.ts'])
  })
})
