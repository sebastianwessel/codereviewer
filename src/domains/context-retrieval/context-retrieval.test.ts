import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
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

// A repository with content nested several directories deep, plus dotfile,
// node_modules, and configured-exclude fixtures the eligibility gate must
// reject.
const createEligibilityFixtureRepo = async (): Promise<string> => {
  const root = join(tmpdir(), `codereviewer-context-eligibility-${crypto.randomUUID()}`)
  const nestedDir = join(root, 'src', 'level1', 'level2', 'level3')

  await mkdir(nestedDir, { recursive: true })
  await writeFile(join(nestedDir, 'deep.ts'), 'export const needle = "found-me"\n')
  await writeFile(join(root, '.env'), 'API_SECRET=needle-in-secret\n')
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(
    join(root, 'node_modules', 'pkg', 'index.js'),
    'module.exports = "needle-in-dependency"\n'
  )
  await mkdir(join(root, 'secrets'), { recursive: true })
  await writeFile(join(root, 'secrets', 'token.txt'), 'needle-in-secrets-dir\n')

  return root
}

describe('context retrieval', () => {
  test('rejects an in-repo symlink whose real target is an excluded/secret file', async () => {
    const root = await createEligibilityFixtureRepo()

    try {
      // `notes.txt` is an eligible name, but it points at the hard-floor `.env`.
      // Following it would leak the secret; eligibility must re-check the target.
      await symlink(join(root, '.env'), join(root, 'notes.txt'))
      const retriever = createContextRetriever({ repositoryRoot: root })

      await expect(
        retriever.readRepositoryFile({ path: 'notes.txt' })
      ).rejects.toThrow(/ineligible target/u)
      // The eligible sibling is still readable, proving the guard is precise.
      await expect(
        retriever.readRepositoryFile({ path: 'src/level1/level2/level3/deep.ts' })
      ).resolves.toMatchObject({ tool: 'read' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

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

  test('grep recursively finds matches in nested directories', async () => {
    const root = await createEligibilityFixtureRepo()

    try {
      const retriever = createContextRetriever({ repositoryRoot: root })
      const result = await retriever.grepRepository({
        query: 'found-me',
        paths: ['src']
      })

      expect(result.content).toBe('src/level1/level2/level3/deep.ts:1')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('grep defaults to the repository root and still finds nested matches', async () => {
    const root = await createEligibilityFixtureRepo()

    try {
      const retriever = createContextRetriever({ repositoryRoot: root })
      // No `paths` supplied: exercises the default search root ('.').
      const result = await retriever.grepRepository({ query: 'found-me' })

      expect(result.content).toBe('src/level1/level2/level3/deep.ts:1')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('grep traversal is bounded by maxDepth', async () => {
    const root = await createEligibilityFixtureRepo()

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: { maxDepth: 1 }
      })
      const result = await retriever.grepRepository({
        query: 'found-me',
        paths: ['src']
      })

      expect(result.content).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('grep silently prunes ineligible files during traversal instead of erroring', async () => {
    const root = await createEligibilityFixtureRepo()

    try {
      const retriever = createContextRetriever({ repositoryRoot: root })
      const result = await retriever.grepRepository({ query: 'needle' })
      const matchedPaths = result.content
        .split('\n')
        .map((line) => line.split(':')[0])

      // The always-excluded dotfile (.env) and node_modules dependency are
      // pruned during traversal without raising an error; the eligible
      // nested source file and an ordinary top-level directory both match.
      expect(matchedPaths).not.toContain('.env')
      expect(matchedPaths).not.toContain('node_modules/pkg/index.js')
      expect(matchedPaths).toContain('src/level1/level2/level3/deep.ts')
      expect(matchedPaths).toContain('secrets/token.txt')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('eligibility rejects an explicit request for a dotfile such as .env', async () => {
    const root = await createEligibilityFixtureRepo()

    try {
      const retriever = createContextRetriever({ repositoryRoot: root })

      await expect(
        retriever.readRepositoryFile({ path: '.env' })
      ).rejects.toThrow(/not eligible/iu)
      await expect(
        retriever.listRepositoryDirectory({ path: '.env' })
      ).rejects.toThrow(/not eligible/iu)
      await expect(
        retriever.grepRepository({ query: 'needle', paths: ['.env'] })
      ).rejects.toThrow(/not eligible/iu)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('eligibility rejects a path matched by a configured exclude glob', async () => {
    const root = await createEligibilityFixtureRepo()

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        paths: { exclude: ['secrets/**'] }
      })

      await expect(
        retriever.readRepositoryFile({ path: 'secrets/token.txt' })
      ).rejects.toThrow(/not eligible/iu)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('eligibility rejects a path excluded by node_modules, without needing configuration', async () => {
    const root = await createEligibilityFixtureRepo()

    try {
      const retriever = createContextRetriever({ repositoryRoot: root })

      await expect(
        retriever.readRepositoryFile({ path: 'node_modules/pkg/index.js' })
      ).rejects.toThrow(/not eligible/iu)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('directory listings never reveal ineligible children', async () => {
    const root = await createEligibilityFixtureRepo()

    try {
      const retriever = createContextRetriever({ repositoryRoot: root })
      const result = await retriever.listRepositoryDirectory({ path: '.' })

      expect(result.content).not.toMatch(/\.env/u)
      expect(result.content).not.toMatch(/node_modules/u)
      expect(result.content).toContain('dir src')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects a path that does not exist with an actionable not-found error', async () => {
    const root = await createTempRepo()

    try {
      const retriever = createContextRetriever({ repositoryRoot: root })

      await expect(
        retriever.readRepositoryFile({ path: 'src/missing.ts' })
      ).rejects.toThrow(/was not found in the repository/iu)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('normalizes liberal path input: leading "./" and backslash separators', async () => {
    const root = await createTempRepo()

    try {
      const retriever = createContextRetriever({ repositoryRoot: root })
      const fromDotSlash = await retriever.readRepositoryFile({
        path: './src/app.ts'
      })
      const fromBackslash = await retriever.readRepositoryFile({
        path: 'src\\other.ts'
      })

      expect(fromDotSlash.path).toBe('src/app.ts')
      expect(fromBackslash.path).toBe('src/other.ts')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
