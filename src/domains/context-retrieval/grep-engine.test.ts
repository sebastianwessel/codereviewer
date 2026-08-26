import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { createRedactor } from '../../shared/redaction/redactor.js'
import { ContextRetrievalBudgetSchema } from './budget.js'
import { compileEligibilityConfig } from './eligibility.js'
import { isContextRetrievalConditionError } from './expected-conditions.js'
import { createGrepEngine, type GrepEngineDependencies } from './grep-engine.js'
import { resolveEligibleExistingPath } from './path-safety.js'
import type {
  ContextRetrievalResult,
  RetrievalResultRecord
} from './retrieval-result.js'

const createTempRepo = async (): Promise<string> => {
  const root = join(tmpdir(), `codereviewer-grep-engine-${crypto.randomUUID()}`)

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src', 'app.ts'),
    ['export const value = 1', 'export const other = value + 1'].join('\n')
  )
  await writeFile(join(root, 'src', 'lib.ts'), 'export const value = 2\n')

  return root
}

// The engine stands alone: its dependencies are handed to it, so a test builds
// them directly instead of constructing a whole retriever to reach it. The
// recorder is the only stand-in — the ledger and evidence contracts are the
// retriever's to satisfy, not the engine's.
const createDependencies = (
  root: string,
  budgetOverrides: Parameters<typeof ContextRetrievalBudgetSchema.parse>[0] = {}
): {
  readonly dependencies: GrepEngineDependencies
  readonly records: RetrievalResultRecord[]
} => {
  const records: RetrievalResultRecord[] = []
  const compiledEligibility = compileEligibilityConfig(undefined)

  return {
    records,
    dependencies: {
      budget: ContextRetrievalBudgetSchema.parse(budgetOverrides),
      redactor: createRedactor(),
      compiledEligibility,
      resolveEligibleExisting: (requestedPath, entryKind) =>
        resolveEligibleExistingPath({
          repositoryRoot: root,
          requestedPath,
          compiledEligibility,
          entryKind
        }),
      recordResult: (record): ContextRetrievalResult => {
        records.push(record)

        return {
          tool: record.tool,
          summary: record.summary,
          content: record.content,
          ...(record.queryHash === undefined
            ? {}
            : { queryHash: record.queryHash }),
          ledgerEntry: {
            id: `ctx_${records.length}`
          } as ContextRetrievalResult['ledgerEntry'],
          evidence: {
            id: `ev_${records.length}`
          } as ContextRetrievalResult['evidence']
        }
      }
    }
  }
}

describe('the mediated search engine', () => {
  test('answers every query of a batch from one traversal, in query order', async () => {
    const root = await createTempRepo()

    try {
      const { dependencies, records } = createDependencies(root)
      const results = await createGrepEngine(dependencies)({
        queries: [{ query: 'other' }, { query: 'value' }]
      })

      expect(results).toHaveLength(2)
      expect(results[0]?.content).toBe('src/app.ts:2')
      expect(results[1]?.content.split('\n').sort()).toEqual([
        'src/app.ts:1',
        'src/app.ts:2',
        'src/lib.ts:1'
      ])
      expect(results[1]?.matches?.[0]?.text).toContain('export const value')
      // Both queries are charged, and both are recorded.
      expect(dependencies.budget.usedSearches).toBe(2)
      expect(records).toHaveLength(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refuses a batch it cannot afford in full rather than serving part of it', async () => {
    const root = await createTempRepo()

    try {
      const { dependencies } = createDependencies(root, { maxSearches: 1 })

      await expect(
        createGrepEngine(dependencies)({
          queries: [{ query: 'value' }, { query: 'other' }]
        })
      ).rejects.toSatisfy(isContextRetrievalConditionError)
      // Nothing was charged for a refused batch.
      expect(dependencies.budget.usedSearches).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('discloses a cut caused by the match cap instead of implying completeness', async () => {
    const root = await createTempRepo()

    try {
      const { dependencies } = createDependencies(root, { maxMatches: 1 })
      const [result] = await createGrepEngine(dependencies)({
        queries: [{ query: 'value' }]
      })

      expect(result?.content).toContain('TRUNCATED')
      expect(result?.summary).toContain('match cap reached')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
