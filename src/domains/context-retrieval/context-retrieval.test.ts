import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { createContextRetriever } from './index.js'
import type { ContextLedgerEntry } from '../review-planning/index.js'

const createTempRepo = async (): Promise<string> => {
  const root = join(tmpdir(), `codereviewer-context-retrieval-${crypto.randomUUID()}`)

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src', 'app.ts'),
    ['const token = "sk-proj-secret-value"', 'export const value = token'].join(
      '\n'
    )
  )
  await writeFile(join(root, 'src', 'other.ts'), 'export const other = 1\n')

  return root
}

describe('context retrieval', () => {
  test('reads repository files through path containment and records redacted ledger evidence', async () => {
    const root = await createTempRepo()
    const ledgerEntries: ContextLedgerEntry[] = []

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        ledgerEntries,
        budget: {
          maxReads: 1,
          maxBytesPerRead: 200
        }
      })
      const result = await retriever.readRepositoryFile({
        path: 'src/app.ts',
        taskId: 'task_abc'
      })

      expect(result).toMatchObject({
        tool: 'read',
        path: 'src/app.ts',
        summary: expect.stringContaining('Read src/app.ts')
      })
      expect(result.ledgerEntry).toMatchObject({
        kind: 'tool-result',
        path: 'src/app.ts',
        taskId: 'task_abc',
        reason: 'context-retrieval-read'
      })
      expect(result.evidence).toMatchObject({
        kind: 'tool-read',
        source: 'context-retrieval',
        rawContentRef: result.ledgerEntry.id,
        redactionApplied: true
      })
      expect(ledgerEntries).toEqual([result.ledgerEntry])
      expect(retriever.budget()).toMatchObject({
        usedReads: 1,
        maxReads: 1
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects traversal and enforces read budgets', async () => {
    const root = await createTempRepo()

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: {
          maxReads: 1
        }
      })

      await expect(
        retriever.readRepositoryFile({ path: '../outside.ts' })
      ).rejects.toThrow(/inside the root|traverse/iu)
      await retriever.readRepositoryFile({ path: 'src/app.ts' })
      await expect(
        retriever.readRepositoryFile({ path: 'src/other.ts' })
      ).rejects.toThrow(/read budget exceeded/iu)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('lists and greps with independent read and search budgets', async () => {
    const root = await createTempRepo()
    const ledgerEntries: ContextLedgerEntry[] = []

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        ledgerEntries,
        budget: {
          maxReads: 1,
          maxSearches: 1,
          maxMatches: 5
        }
      })
      const listed = await retriever.listRepositoryDirectory({ path: 'src' })
      const searched = await retriever.grepRepository({
        query: 'other',
        paths: ['src/other.ts']
      })

      expect(listed.summary).toContain('Listed src')
      expect(searched).toMatchObject({
        tool: 'grep',
        queryHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        ledgerEntry: expect.objectContaining({
          kind: 'tool-result'
        }),
        evidence: expect.objectContaining({
          kind: 'tool-search'
        })
      })
      expect(ledgerEntries).toHaveLength(2)
      await expect(
        retriever.grepRepository({ query: 'value', paths: ['src/app.ts'] })
      ).rejects.toThrow(/search budget exceeded/iu)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
