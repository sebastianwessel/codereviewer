import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  createBoundedRetrievalTools,
  createContextRetriever,
  type ContextRetrievalResult,
  type ContextRetriever
} from '../../context-retrieval/index.js'
import {
  mediatedRepoToolDefinitions,
  reduceActiveReadBudget,
  runWithMediatedRepoTools
} from './mediated-repo-tools.js'

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
  mediatedRepoToolDefinitions.repo_read.handler(undefined, {
    path
  }) as Promise<{ content: string }>

describe('mediated repository tools', () => {
  test('resolves the active scope and line-numbers retrieved file content', async () => {
    const bounded = createBoundedRetrievalTools({
      retriever: fakeRetriever(),
      maxToolCalls: 4
    })

    const output = await runWithMediatedRepoTools(
      { tools: bounded.tools, reduceReadBudget: () => false },
      () => runRead('src/dep.ts')
    )

    // Reads are line-numbered so the model can cite exact lines from another file,
    // matching the shape the changed files are presented in.
    expect(output.content).toBe('1: line one from src/dep.ts\n2: line two')
    expect(bounded.toolCallCount()).toBe(1)
  })

  test('rejects a tool call made outside any scope', async () => {
    // No scope bound: an unattributed, unbounded repository read must never run.
    await expect(runRead('src/dep.ts')).rejects.toThrow(
      /No active mediated repository tools/u
    )
  })

  test('enforces the per-scope tool-call budget in code and discloses the bound', async () => {
    const bounded = createBoundedRetrievalTools({
      retriever: fakeRetriever(),
      maxToolCalls: 2
    })

    const refused = await runWithMediatedRepoTools(
      { tools: bounded.tools, reduceReadBudget: () => false },
      async () => {
        await mediatedRepoToolDefinitions.repo_read.handler(undefined, {
          path: 'src/a.ts'
        })
        await mediatedRepoToolDefinitions.repo_grep.handler(undefined, {
          query: 'permission'
        })

        // Third call exceeds the budget regardless of which tool is used.
        return (await mediatedRepoToolDefinitions.repo_list.handler(undefined, {
          path: 'src'
        })) as { readonly summary: string; readonly content: string }
      }
    )

    // CODE refused it: nothing was read and the scope records its exhaustion.
    expect(bounded.toolCallCount()).toBe(2)
    expect(bounded.budgetExhausted()).toBe(true)
    // And the model is told WHY, in the channel it reads. A thrown error would be
    // normalized by the harness to "Tool execution failed." with the reason
    // dropped, leaving the model to fill the gap with the plausible assumption
    // that the code it meant to check is not there.
    expect(refused.content).toContain('TOOL-CALL BUDGET EXHAUSTED')
    expect(refused.content).toContain('repo_list')
    expect(refused.content).toContain('not evidence that anything is absent')
    expect(refused.summary).toContain('budget is exhausted')
  })

  test('never disguises a genuine failure as a disclosed refusal', async () => {
    // Only an EXPECTED condition answers in content. A fault must still propagate:
    // swallowing one would hand the model a tool result it could reason from where
    // the engine actually failed.
    const failing = {
      read: async () => {
        throw new TypeError('Path target must resolve inside the root.')
      },
      list: async () => {
        throw new TypeError('unused')
      },
      grep: async () => {
        throw new TypeError('unused')
      }
    }

    await expect(
      runWithMediatedRepoTools({ tools: failing }, () => runRead('x'))
    ).rejects.toThrow(/resolve inside the root/u)
  })

  test('gives concurrent scopes independent tools and budgets', async () => {
    const first = createBoundedRetrievalTools({
      retriever: fakeRetriever(),
      maxToolCalls: 4
    })
    const second = createBoundedRetrievalTools({
      retriever: fakeRetriever(),
      maxToolCalls: 4
    })

    // Interleave two scopes: each tool call must resolve the bounded tools of its
    // OWN scope, so concurrent tasks and batches never consume each other's budget.
    const [firstOutput, secondOutput] = await Promise.all([
      runWithMediatedRepoTools({ tools: first.tools }, async () => {
        const output = await runRead('src/first.ts')
        await runRead('src/first-again.ts')
        return output
      }),
      runWithMediatedRepoTools({ tools: second.tools }, () =>
        runRead('src/second.ts')
      )
    ])

    expect(firstOutput.content).toContain('src/first.ts')
    expect(secondOutput.content).toContain('src/second.ts')
    expect(first.toolCallCount()).toBe(2)
    expect(second.toolCallCount()).toBe(1)
  })
})

// Specs 12 and 16 both promise the model that a path may be reported as not found
// or not eligible and a budget as spent. The harness normalizes a thrown error to
// "Tool execution failed." and drops the message, so before this the promise was
// false and the model filled the gap with the plausible assumption that the code it
// meant to check is not there. These drive the REAL retriever through the REAL tool
// handlers, so a change anywhere on that path is caught.
describe('expected retrieval conditions reach the model as content', () => {
  const createFixtureRepo = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'mediated-repo-tools-'))

    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n')
    await writeFile(join(root, '.env'), 'API_SECRET=never-served\n')

    return root
  }

  const runInScope = async <T>(
    root: string,
    budget: { readonly maxReads: number; readonly maxSearches: number },
    operation: () => Promise<T>
  ): Promise<T> => {
    const bounded = createBoundedRetrievalTools({
      retriever: createContextRetriever({ repositoryRoot: root, budget }),
      maxToolCalls: 10
    })

    return runWithMediatedRepoTools({ tools: bounded.tools }, operation)
  }

  test('an ineligible path is disclosed, naming the reason and the path', async () => {
    const root = await createFixtureRepo()

    try {
      const output = await runInScope(
        root,
        { maxReads: 4, maxSearches: 2 },
        () => runRead('.env')
      )

      expect(output.content).toContain('PATH NOT ELIGIBLE')
      expect(output.content).toContain('.env')
      expect(output.content).toContain(
        'not evidence that anything is absent, correct, or safe'
      )
      // The refusal is not a back door to the file it refused.
      expect(output.content).not.toContain('never-served')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a missing path is disclosed as a wrong path, not as absent code', async () => {
    const root = await createFixtureRepo()

    try {
      const output = await runInScope(
        root,
        { maxReads: 4, maxSearches: 2 },
        () => runRead('src/missing.ts')
      )

      expect(output.content).toContain('PATH NOT FOUND')
      expect(output.content).toContain('src/missing.ts')
      expect(output.content).toContain(
        'not evidence that anything is absent, correct, or safe'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('an exhausted read budget is disclosed rather than thrown', async () => {
    const root = await createFixtureRepo()

    try {
      const output = await runInScope(
        root,
        { maxReads: 1, maxSearches: 2 },
        async () => {
          await runRead('src/app.ts')

          return (await mediatedRepoToolDefinitions.repo_list.handler(undefined, {
            path: 'src'
          })) as { readonly summary: string; readonly content: string }
        }
      )

      expect(output.content).toContain('READ BUDGET EXHAUSTED')
      expect(output.content).toContain('repo_list')
      expect(output.content).toContain(
        'not evidence that anything is absent, correct, or safe'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('an exhausted search budget is disclosed rather than thrown', async () => {
    const root = await createFixtureRepo()

    try {
      const output = await runInScope(
        root,
        { maxReads: 4, maxSearches: 1 },
        async () => {
          await mediatedRepoToolDefinitions.repo_grep.handler(undefined, {
            query: 'value'
          })

          return (await mediatedRepoToolDefinitions.repo_grep.handler(undefined, {
            query: 'value'
          })) as { readonly summary: string; readonly content: string }
        }
      )

      expect(output.content).toContain('SEARCH BUDGET EXHAUSTED')
      expect(output.content).toContain(
        'not evidence that anything is absent, correct, or safe'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a containment violation still throws instead of being disclosed', async () => {
    const root = await createFixtureRepo()
    const outside = await mkdtemp(join(tmpdir(), 'mediated-repo-tools-outside-'))

    try {
      await writeFile(join(outside, 'secret.ts'), 'export const leaked = 1\n')
      // An eligible, existing in-repo name whose real target is outside the root.
      await symlink(join(outside, 'secret.ts'), join(root, 'src', 'escape.ts'))

      await expect(
        runInScope(root, { maxReads: 4, maxSearches: 2 }, () =>
          runRead('src/escape.ts')
        )
      ).rejects.toThrow(/resolve inside the root/iu)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})

describe('read-budget reduction on context overflow (spec 28)', () => {
  test('reduces the ACTIVE scope’s read budget, and reports when it cannot', async () => {
    // Proves the hook is reachable from inside a scope. An unwired hook is the
    // failure this project keeps hitting: the schema says one thing, the engine does
    // another, and nothing fails.
    let reductions = 0
    const result = await runWithMediatedRepoTools(
      {
        tools: {
          read: async () => {
            throw new Error('unused')
          },
          list: async () => {
            throw new Error('unused')
          },
          grep: async () => {
            throw new Error('unused')
          }
        },
        reduceReadBudget: () => {
          reductions += 1
          return reductions <= 2
        }
      },
      async () => [
        reduceActiveReadBudget(),
        reduceActiveReadBudget(),
        reduceActiveReadBudget()
      ]
    )

    expect(result).toEqual([true, true, false])
  })

  test('reports false in a scope that declared no reduction', async () => {
    // A refutation batch has no reads-first retry: its overflow degrades to a
    // recorded provider issue, not to a smaller re-read.
    expect(
      await runWithMediatedRepoTools(
        {
          tools: {
            read: async () => {
              throw new Error('unused')
            },
            list: async () => {
              throw new Error('unused')
            },
            grep: async () => {
              throw new Error('unused')
            }
          }
        },
        async () => reduceActiveReadBudget()
      )
    ).toBe(false)
  })

  test('reports false outside any scope, so an overflow goes to splitting', async () => {
    // A call with no tools has no reads to shrink; its overflow is about the packet.
    expect(reduceActiveReadBudget()).toBe(false)
  })
})
