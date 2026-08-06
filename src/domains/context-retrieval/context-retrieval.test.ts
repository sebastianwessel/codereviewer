import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import {
  createContextRetriever,
  isContextRetrievalConditionError
} from './index.js'
import { toRepoToolOutput } from './repo-tool-contracts.js'
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

  // A batch shares ONE traversal, which is the only reason it exists: the
  // per-query shape re-walked the repository and re-read every eligible file once
  // per query. Batching must not change a single result, a single ledger entry, or
  // the budget it spends, so this pins all three against the per-query path.
  test('a batched grep matches running the same queries one at a time', async () => {
    const root = await createTempRepo()
    const batchLedger: ContextLedgerEntry[] = []
    const serialLedger: ContextLedgerEntry[] = []

    try {
      const queries = [
        { query: 'other', matchMode: 'identifier' as const },
        { query: 'value', matchMode: 'identifier' as const },
        { query: 'no-such-symbol', matchMode: 'identifier' as const }
      ]
      const batched = await createContextRetriever({
        repositoryRoot: root,
        budget: { maxSearches: 3, maxMatches: 5 },
        ledgerEntries: batchLedger
      }).grepRepositoryBatch({ queries })
      const serialRetriever = createContextRetriever({
        repositoryRoot: root,
        budget: { maxSearches: 3, maxMatches: 5 },
        ledgerEntries: serialLedger
      })
      const serial = []

      for (const query of queries) {
        serial.push(await serialRetriever.grepRepository(query))
      }

      expect(batched.map((result) => result.content)).toEqual(
        serial.map((result) => result.content)
      )
      expect(batched.map((result) => result.matches)).toEqual(
        serial.map((result) => result.matches)
      )
      expect(batched.map((result) => result.summary)).toEqual(
        serial.map((result) => result.summary)
      )
      expect(batchLedger).toHaveLength(serialLedger.length)
      expect(serialRetriever.budget().usedSearches).toBe(3)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a batched grep refuses a batch the search budget cannot afford in full', async () => {
    const root = await createTempRepo()

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: { maxSearches: 2 }
      })

      await expect(
        retriever.grepRepositoryBatch({
          queries: [{ query: 'a' }, { query: 'b' }, { query: 'c' }]
        })
      ).rejects.toThrow(/search budget exceeded/iu)
      // Refused whole: nothing was charged, so the caller can retry smaller.
      expect(retriever.budget().usedSearches).toBe(0)
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

      // No matches — and the reason is stated. A depth-pruned search used to
      // return an empty string, which reads as "there is nothing there" rather
      // than "there are places I did not look".
      expect(result.matches).toEqual([])
      expect(result.content).toContain('NOT EXHAUSTIVE')
      expect(result.content).toContain('deeper than 1 levels')
      expect(result.summary).toContain('search depth bound reached')
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

  // The four conditions a caller is EXPECTED to hit carry a type, so the lane that
  // exposes these tools to a model can disclose them without having to read an
  // error message to decide whether it may.
  test('raises the four expected conditions as typed conditions', async () => {
    const root = await createEligibilityFixtureRepo()

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: { maxReads: 1, maxSearches: 1 }
      })
      const conditionOf = async (
        operation: () => Promise<unknown>
      ): Promise<string> => {
        try {
          await operation()
        } catch (error) {
          return isContextRetrievalConditionError(error)
            ? error.condition
            : `not a condition: ${String(error)}`
        }

        return 'no error'
      }

      expect(
        await conditionOf(() => retriever.readRepositoryFile({ path: '.env' }))
      ).toBe('path-not-eligible')
      expect(
        await conditionOf(() =>
          retriever.readRepositoryFile({ path: 'src/missing.ts' })
        )
      ).toBe('path-not-found')
      await retriever.readRepositoryFile({
        path: 'src/level1/level2/level3/deep.ts'
      })
      expect(
        await conditionOf(() =>
          retriever.readRepositoryFile({
            path: 'src/level1/level2/level3/deep.ts'
          })
        )
      ).toBe('read-budget-exhausted')
      await retriever.grepRepository({ query: 'needle' })
      expect(
        await conditionOf(() => retriever.grepRepository({ query: 'needle' }))
      ).toBe('search-budget-exhausted')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Containment is the one refusal that must NOT become an expected condition: an
  // escape from the repository root is a security invariant breach, and a lane that
  // disclosed it as an ordinary tool result would let a model shrug it off. The
  // classification used to be a regex over the thrown message, so a reword in the
  // shared path helper would have silently demoted this to "not found".
  test('a symlink escaping the root stays a fault, not an expected condition', async () => {
    const root = await createTempRepo()
    const outside = await mkdtemp(join(tmpdir(), 'codereviewer-outside-'))

    try {
      await writeFile(join(outside, 'secret.ts'), 'export const leaked = 1\n')
      await symlink(join(outside, 'secret.ts'), join(root, 'src', 'escape.ts'))
      const retriever = createContextRetriever({ repositoryRoot: root })
      let thrown: unknown

      try {
        await retriever.readRepositoryFile({ path: 'src/escape.ts' })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(Error)
      expect(isContextRetrievalConditionError(thrown)).toBe(false)
      expect((thrown as Error).message).toMatch(/resolve inside the root/iu)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  // A permission failure is not absence. Reporting it as "not found" would be the
  // silent-optimism shape this surface exists to prevent, so it propagates.
  test('an unreadable path is a fault rather than a not-found condition', async () => {
    const root = await createTempRepo()

    try {
      const retriever = createContextRetriever({ repositoryRoot: root })
      // A directory read as a file: the failure is EISDIR, not ENOENT.
      let thrown: unknown

      try {
        await retriever.readRepositoryFile({ path: 'src' })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(Error)
      expect(isContextRetrievalConditionError(thrown)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

// G2 (spec 22): the identifier-aware, per-query-bounded lookup change-impact's
// symbol reference search needs. Every addition is optional and defaulted, so the
// existing call shape must keep producing exactly what it produced before.
describe('context retrieval grep modes', () => {
  const createSymbolFixtureRepo = async (): Promise<string> => {
    const root = join(tmpdir(), `codereviewer-grep-modes-${crypto.randomUUID()}`)

    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src', 'callers.ts'),
      [
        'import { get } from "./store.js"',
        'const forget = 1',
        'const widget = get()',
        'export const target = get',
        'const getter = 2'
      ].join('\n')
    )
    await writeFile(
      join(root, 'src', 'many.ts'),
      ['get()', 'get()', 'get()', 'get()'].join('\n')
    )

    return root
  }

  test('the existing call shape is byte-identical: literal default, path:line content', async () => {
    const root = await createSymbolFixtureRepo()

    try {
      const retriever = createContextRetriever({ repositoryRoot: root })
      const withoutOptions = await retriever.grepRepository({
        query: 'get',
        paths: ['src/callers.ts']
      })
      const withExplicitDefaults = createContextRetriever({
        repositoryRoot: root
      })
      const withOptions = await withExplicitDefaults.grepRepository({
        query: 'get',
        paths: ['src/callers.ts'],
        matchMode: 'literal'
      })

      // Every line containing `get` as a substring, in file order: the import,
      // `forget`, `widget`/`get()`, `target`/`get`, and `getter`.
      expect(withoutOptions.content).toBe(
        [
          'src/callers.ts:1',
          'src/callers.ts:2',
          'src/callers.ts:3',
          'src/callers.ts:4',
          'src/callers.ts:5'
        ].join('\n')
      )
      expect(withOptions.content).toBe(withoutOptions.content)
      expect(withoutOptions.summary).toBe(withOptions.summary)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('identifier mode rejects substring matches inside longer identifiers', async () => {
    const root = await createSymbolFixtureRepo()

    try {
      const retriever = createContextRetriever({ repositoryRoot: root })
      const result = await retriever.grepRepository({
        query: 'get',
        paths: ['src/callers.ts'],
        matchMode: 'identifier'
      })

      // Line 2 (`forget`) and line 5 (`getter`) are substring-only matches and
      // must not be reported. Line 3 contains both `widget` and a real `get()`
      // call, so it stays.
      expect(result.content).toBe(
        ['src/callers.ts:1', 'src/callers.ts:3', 'src/callers.ts:4'].join('\n')
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('grep returns the matched line text alongside path and line', async () => {
    const root = await createSymbolFixtureRepo()

    try {
      const retriever = createContextRetriever({ repositoryRoot: root })
      const result = await retriever.grepRepository({
        query: 'target',
        paths: ['src/callers.ts'],
        matchMode: 'identifier'
      })

      expect(result.matches).toEqual([
        {
          path: 'src/callers.ts',
          line: 4,
          text: 'export const target = get'
        }
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('matched text is redacted even though matching runs on the raw line', async () => {
    const root = await createTempRepo()

    try {
      const retriever = createContextRetriever({ repositoryRoot: root })
      const result = await retriever.grepRepository({
        query: 'sk-proj-secret-value',
        paths: ['src/app.ts']
      })

      // The raw line still matched, proving matching is unredacted...
      expect(result.content).toBe('src/app.ts:1')
      // ...but the text handed back carries no secret.
      expect(result.matches?.[0]?.text).not.toContain('sk-proj-secret-value')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('maxMatchesPerQuery tightens one query without touching the budget', async () => {
    const root = await createSymbolFixtureRepo()

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: { maxSearches: 2, maxMatches: 10 }
      })
      const tightened = await retriever.grepRepository({
        query: 'get',
        paths: ['src/many.ts'],
        matchMode: 'identifier',
        maxMatchesPerQuery: 2
      })
      const untouched = await retriever.grepRepository({
        query: 'get',
        paths: ['src/many.ts'],
        matchMode: 'identifier'
      })

      expect(tightened.matches).toHaveLength(2)
      expect(untouched.matches).toHaveLength(4)

      // The cut one says it was cut; the complete one says nothing, because
      // there is nothing to say. A notice on a complete search would train the
      // model to ignore it.
      expect(tightened.content).toContain('TRUNCATED')
      expect(tightened.content).toContain('match cap of 2 was reached')
      expect(tightened.summary).toContain('more exist')
      expect(untouched.content).not.toContain('TRUNCATED')
      expect(untouched.summary).not.toContain('more exist')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Reaching the cap exactly is not the same as being cut by it. The extra match
  // is collected precisely so the two can be told apart, rather than inferred
  // from "we returned exactly N".
  test('a search that finds exactly the cap is not reported as truncated', async () => {
    const root = await createSymbolFixtureRepo()

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: { maxSearches: 1, maxMatches: 10 }
      })
      const exact = await retriever.grepRepository({
        query: 'get',
        paths: ['src/many.ts'],
        matchMode: 'identifier',
        maxMatchesPerQuery: 4
      })

      expect(exact.matches).toHaveLength(4)
      expect(exact.content).not.toContain('TRUNCATED')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a directory listing cut at the cap names what it did not show', async () => {
    const root = await createSymbolFixtureRepo()

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: { maxReads: 2, maxMatches: 1 }
      })
      const listed = await retriever.listRepositoryDirectory({ path: 'src' })

      // Without this the model concludes a file is not in a directory it only
      // saw one entry of.
      expect(listed.content).toContain('TRUNCATED')
      expect(listed.content).toMatch(/1 of \d+ eligible entries shown/u)
      expect(listed.summary).toMatch(/1 of \d+ eligible entries returned/u)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('maxMatchesPerQuery can only tighten, never widen, the budget cap', async () => {
    const root = await createSymbolFixtureRepo()

    try {
      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: { maxMatches: 1 }
      })
      const result = await retriever.grepRepository({
        query: 'get',
        paths: ['src/many.ts'],
        matchMode: 'identifier',
        maxMatchesPerQuery: 100
      })

      expect(result.matches).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('a truncated read tells the model it was truncated', () => {
  // Cross-file retrieval was measured NET NEGATIVE and withdrawn on that
  // measurement — recall 66.7% to 44.4% at nine cases, 68.8% to 56.3% at sixteen,
  // precision holding at 100%. Silently truncated reads produce exactly that
  // signature: the model concludes something is absent when it was below the cut.
  // It was never ruled out as a cause, so the disclosure below is load-bearing.
  test('marks the content and the summary when the byte limit cuts a file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ctx-trunc-'))

    try {
      await writeFile(join(root, 'big.ts'), 'x'.repeat(5000), 'utf8')

      const retriever = createContextRetriever({
        repositoryRoot: root,
        budget: { maxBytesPerRead: 200 }
      })
      const output = toRepoToolOutput(
        await retriever.readRepositoryFile({ path: 'big.ts' }),
        false
      )

      expect(output.content).toContain('[TRUNCATED')
      expect(output.content).toContain('NOT evidence it is missing')
      expect(output.summary).toContain('TRUNCATED')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('says nothing when the whole file fits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ctx-whole-'))

    try {
      await writeFile(join(root, 'small.ts'), 'export const a = 1\n', 'utf8')

      const retriever = createContextRetriever({ repositoryRoot: root })
      const output = toRepoToolOutput(
        await retriever.readRepositoryFile({ path: 'small.ts' }),
        false
      )

      expect(output.content).not.toContain('TRUNCATED')
      expect(output.summary).not.toContain('TRUNCATED')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
