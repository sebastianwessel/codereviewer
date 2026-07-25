import { describe, expect, test } from 'vitest'
import {
  createBoundedRetrievalTools,
  isToolCallBudgetExceededError,
  type ContextRetrievalResult,
  type ContextRetriever
} from '../../../context-retrieval/index.js'
import {
  crossFileDiscoveryToolDefinitions,
  runWithCrossFileDiscoveryTools
} from './cross-file-tools.js'

const retrievalResult = (
  tool: ContextRetrievalResult['tool'],
  content: string
): ContextRetrievalResult =>
  ({
    tool,
    summary: `${tool} summary`,
    content,
    ledgerEntry: { id: `ctx_${tool}` },
    evidence: { id: `ev_${tool}` }
  }) as unknown as ContextRetrievalResult

const fakeRetriever = (): ContextRetriever =>
  ({
    budget: () => ({}),
    readRepositoryFile: async ({ path }: { path: string }) =>
      retrievalResult('read', `line one from ${path}\nline two`),
    listRepositoryDirectory: async ({ path }: { path: string }) =>
      retrievalResult('list', `file ${path}/a.ts`),
    grepRepository: async ({ query }: { query: string }) =>
      retrievalResult('grep', `src/a.ts:1 ${query}`)
  }) as unknown as ContextRetriever

const runRead = (path: string): Promise<{ content: string }> =>
  crossFileDiscoveryToolDefinitions.repo_read.handler(undefined, {
    path
  }) as Promise<{ content: string }>

describe('cross-file discovery tools', () => {
  test('resolves the active task scope and line-numbers retrieved file content', async () => {
    const bounded = createBoundedRetrievalTools({
      retriever: fakeRetriever(),
      maxToolCalls: 4
    })

    const output = await runWithCrossFileDiscoveryTools(bounded.tools, () =>
      runRead('src/dep.ts')
    )

    // Reads are line-numbered so the model can cite exact lines from another file,
    // matching the shape the changed files are presented in.
    expect(output.content).toBe('1: line one from src/dep.ts\n2: line two')
    expect(bounded.toolCallCount()).toBe(1)
  })

  test('rejects a tool call made outside any task scope', async () => {
    // No scope bound: an unattributed, unbounded repository read must never run.
    await expect(runRead('src/dep.ts')).rejects.toThrow(
      /No active cross-file discovery tools/u
    )
  })

  test('enforces the per-task tool-call budget in code across all three tools', async () => {
    const bounded = createBoundedRetrievalTools({
      retriever: fakeRetriever(),
      maxToolCalls: 2
    })

    const error = await runWithCrossFileDiscoveryTools(
      bounded.tools,
      async () => {
        await crossFileDiscoveryToolDefinitions.repo_read.handler(undefined, {
          path: 'src/a.ts'
        })
        await crossFileDiscoveryToolDefinitions.repo_grep.handler(undefined, {
          query: 'permission'
        })

        // Third call exceeds the budget regardless of which tool is used.
        return crossFileDiscoveryToolDefinitions.repo_list
          .handler(undefined, { path: 'src' })
          .then(() => undefined)
          .catch((caught: unknown) => caught)
      }
    )

    expect(isToolCallBudgetExceededError(error)).toBe(true)
    expect(bounded.toolCallCount()).toBe(2)
    expect(bounded.budgetExhausted()).toBe(true)
  })

  test('gives concurrent tasks independent scopes and budgets', async () => {
    const first = createBoundedRetrievalTools({
      retriever: fakeRetriever(),
      maxToolCalls: 4
    })
    const second = createBoundedRetrievalTools({
      retriever: fakeRetriever(),
      maxToolCalls: 4
    })

    // Interleave two scopes: each tool call must resolve the bounded tools of its
    // OWN task, so concurrent discovery tasks never consume each other's budget.
    const [firstOutput, secondOutput] = await Promise.all([
      runWithCrossFileDiscoveryTools(first.tools, async () => {
        const output = await runRead('src/first.ts')
        await runRead('src/first-again.ts')
        return output
      }),
      runWithCrossFileDiscoveryTools(second.tools, () => runRead('src/second.ts'))
    ])

    expect(firstOutput.content).toContain('src/first.ts')
    expect(secondOutput.content).toContain('src/second.ts')
    expect(first.toolCallCount()).toBe(2)
    expect(second.toolCallCount()).toBe(1)
  })
})
