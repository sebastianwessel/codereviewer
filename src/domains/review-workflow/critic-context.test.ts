import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  createContextRetriever,
  type ContextRetriever
} from '../context-retrieval/index.js'
import type { CandidateFinding } from '../admission/index.js'
import { retrieveCriticContext } from './critic-context.js'

const candidate: CandidateFinding = {
  id: 'cand_bug1',
  taskId: 'task_app',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch returns wrong value',
  description: 'The changed branch can return the wrong value.',
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  evidenceIds: ['ev_diff1'],
  proposedBy: 'review-agent'
}

const createTempRepo = async (): Promise<string> => {
  const root = join(tmpdir(), `codereviewer-critic-context-${crypto.randomUUID()}`)

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src', 'app.ts'),
    [
      'const input = 1',
      'const intermediate = input + 1',
      'const expectedValue = intermediate + 1',
      'export const value = input > 0 ? intermediate : expectedValue'
    ].join('\n')
  )

  return root
}

describe('critic context retrieval', () => {
  test('executes structured requests without default candidate-file reads', async () => {
    const root = await createTempRepo()

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: {
          maxReads: 0,
          maxSearches: 1,
          maxMatches: 10
        }
      })

      const results = await retrieveCriticContext({
        candidate,
        requestedContext: ['Inspect src/app.ts near line 4.'],
        contextRequests: [
          {
            tool: 'grep',
            path: 'src/app.ts',
            query: 'expectedValue',
            reason: 'Find the expected value branch.'
          }
        ],
        contextRetriever: retriever
      })

      expect(results).toEqual([
        expect.objectContaining({
          tool: 'grep',
          evidence: expect.objectContaining({
            kind: 'tool-search',
            source: 'context-retrieval'
          })
        })
      ])
      expect(retriever.budget()).toMatchObject({
        usedReads: 0,
        usedSearches: 1
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('deduplicates repeated structured requests before spending budget', async () => {
    const root = await createTempRepo()

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: {
          maxReads: 1,
          maxSearches: 0
        }
      })

      const results = await retrieveCriticContext({
        candidate,
        requestedContext: [],
        contextRequests: [
          {
            tool: 'read',
            path: 'src/app.ts',
            reason: 'Inspect the changed branch.'
          },
          {
            tool: 'read',
            path: 'src/app.ts',
            reason: 'Inspect the same changed branch again.'
          }
        ],
        contextRetriever: retriever
      })

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual(
        expect.objectContaining({
          tool: 'read',
          path: 'src/app.ts'
        })
      )
      expect(retriever.budget()).toMatchObject({
        usedReads: 1,
        usedSearches: 0
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('deduplicates normalized structured request paths before retrieval', async () => {
    let readCalls = 0
    const readRepositoryFile: ContextRetriever['readRepositoryFile'] = async ({
      path: requestPath
    }) => {
      readCalls += 1

      return {
        tool: 'read',
        path: 'src/app.ts',
        summary: `Read ${requestPath}`,
        content: 'export const value = 1',
        ledgerEntry: {},
        evidence: {}
      } as Awaited<ReturnType<ContextRetriever['readRepositoryFile']>>
    }
    const retriever: ContextRetriever = {
      budget: () => ({
        maxReads: 10,
        usedReads: readCalls,
        maxSearches: 0,
        usedSearches: 0,
        maxBytesPerRead: 1_000,
        maxMatches: 10
      }),
      readRepositoryFile,
      listRepositoryDirectory: async () => {
        throw new Error('unexpected list request')
      },
      grepRepository: async () => {
        throw new Error('unexpected grep request')
      }
    }

    const results = await retrieveCriticContext({
      candidate,
      requestedContext: [],
      contextRequests: [
        {
          tool: 'read',
          path: 'src/app.ts',
          reason: 'Inspect the changed branch.'
        },
        {
          tool: 'read',
          path: './src//app.ts',
          reason: 'Inspect the same changed branch with equivalent path syntax.'
        }
      ],
      contextRetriever: retriever
    })

    expect(results).toHaveLength(1)
    expect(readCalls).toBe(1)
  })

  test('falls back to prose requests with the legacy candidate-file read', async () => {
    const root = await createTempRepo()

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: {
          maxReads: 1,
          maxSearches: 0
        }
      })

      const results = await retrieveCriticContext({
        candidate,
        requestedContext: ['Inspect src/app.ts near line 4.'],
        contextRetriever: retriever
      })

      expect(results).toEqual([
        expect.objectContaining({
          tool: 'read',
          path: 'src/app.ts'
        })
      ])
      expect(retriever.budget()).toMatchObject({
        usedReads: 1,
        usedSearches: 0
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
