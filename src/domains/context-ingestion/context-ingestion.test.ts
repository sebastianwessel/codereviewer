import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { parseFrontmatter } from './frontmatter.js'
import { truncateToUtf8Bytes, compileGlobMatchers, matchesAnyGlob } from './text.js'
import { createDigestSummarizer } from './digest-summarizer.js'
import { createInboxProvider } from './inbox-provider.js'
import { createChangedFilesProvider } from './changed-files-provider.js'
import { runContextIngestion } from './ingest.js'
import type { ContextFragment } from './contracts.js'

const identity = (value: string): string => value

const gatherInput = (repositoryRoot: string) => ({
  repositoryRoot,
  changedFiles: [] as readonly { path: string; content: string }[]
})

describe('frontmatter', () => {
  test('parses scalar frontmatter and returns the body', () => {
    const { metadata, body } = parseFrontmatter(
      '---\nsource: jira\nid: PROJ-1\ntitle: "Reject expired tokens"\n---\nBody text here\n'
    )

    expect(metadata).toEqual({
      source: 'jira',
      id: 'PROJ-1',
      title: 'Reject expired tokens'
    })
    expect(body.trim()).toBe('Body text here')
  })

  test('treats content without frontmatter as all body', () => {
    const { metadata, body } = parseFrontmatter('just markdown\n')
    expect(metadata).toEqual({})
    expect(body).toBe('just markdown\n')
  })

  test('does not throw on an unterminated frontmatter block', () => {
    const { metadata, body } = parseFrontmatter('---\nsource: jira\nno close')
    expect(metadata).toEqual({})
    expect(body).toContain('source: jira')
  })
})

describe('text utils', () => {
  test('truncates on UTF-8 byte boundaries without splitting a code point', () => {
    const emoji = '😀😀😀' // 4 bytes each
    const result = truncateToUtf8Bytes(emoji, 6)
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(6)
    expect(result).toBe('😀')
  })

  test('glob matching handles ** and extension globs', () => {
    const matchers = compileGlobMatchers(['specs/**', '**/*.md'])
    expect(matchesAnyGlob('specs/03/config.json', matchers)).toBe(true)
    expect(matchesAnyGlob('docs/readme.md', matchers)).toBe(true)
    expect(matchesAnyGlob('src/app.ts', matchers)).toBe(false)
  })
})

describe('digest summarizer', () => {
  const fragment = (origin: string, body: string): ContextFragment => ({
    origin,
    kind: 'inbox',
    title: origin,
    body,
    metadata: {}
  })

  test('emits ordered sections within the byte cap', async () => {
    const brief = await createDigestSummarizer().summarize(
      [fragment('a', 'alpha'), fragment('b', 'beta')],
      { maxBytes: 4000 }
    )
    expect(brief.mode).toBe('digest')
    expect(brief.truncated).toBe(false)
    expect(brief.origins).toEqual(['a', 'b'])
    expect(brief.text).toContain('alpha')
    expect(brief.text).toContain('beta')
  })

  test('truncates deterministically at the cap and flags it', async () => {
    const brief = await createDigestSummarizer().summarize(
      [fragment('a', 'x'.repeat(500)), fragment('b', 'y'.repeat(500))],
      { maxBytes: 120 }
    )
    expect(brief.truncated).toBe(true)
    expect(Buffer.byteLength(brief.text, 'utf8')).toBeLessThanOrEqual(120)
  })
})

describe('changed-files provider', () => {
  test('selects changed files matching the globs, bounded', async () => {
    const provider = createChangedFilesProvider({
      type: 'changed-files',
      include: ['specs/**', '**/*.md'],
      maxFiles: 10,
      maxFileBytes: 1000
    })

    const fragments = await provider.gather({
      repositoryRoot: '/repo',
      changedFiles: [
        { path: 'specs/05.md', content: 'spec body' },
        { path: 'docs/readme.md', content: 'doc body' },
        { path: 'src/app.ts', content: 'code' }
      ]
    })

    expect(fragments.map((fragment) => fragment.origin)).toEqual([
      'changed-file:specs/05.md',
      'changed-file:docs/readme.md'
    ])
  })
})

describe('inbox provider', () => {
  test('reads frontmatter-markdown files under the repository root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-inbox-'))

    try {
      await mkdir(path.join(root, '.codereviewer', 'context'), { recursive: true })
      await writeFile(
        path.join(root, '.codereviewer', 'context', 'jira-1.md'),
        '---\nsource: jira\nid: PROJ-1\ntitle: Reject tokens\n---\nAcceptance: reject tokens older than 5 minutes.\n'
      )

      const provider = createInboxProvider({
        type: 'inbox',
        dir: '.codereviewer/context',
        maxFiles: 20,
        maxFileBytes: 64_000
      })

      const fragments = await provider.gather(gatherInput(root))
      expect(fragments).toHaveLength(1)
      expect(fragments[0]).toMatchObject({
        origin: 'inbox:jira/PROJ-1',
        kind: 'inbox',
        title: 'Reject tokens'
      })
      expect(fragments[0]?.body).toContain('5 minutes')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('yields nothing when the inbox directory is absent', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-inbox-'))

    try {
      const provider = createInboxProvider({
        type: 'inbox',
        dir: '.codereviewer/context',
        maxFiles: 20,
        maxFileBytes: 64_000
      })
      expect(await provider.gather(gatherInput(root))).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('runContextIngestion', () => {
  test('redacts gathered fragments before summarizing', async () => {
    const result = await runContextIngestion({
      providers: [{ type: 'changed-files', include: ['**/*.md'], maxFiles: 10, maxFileBytes: 1000 }],
      repositoryRoot: '/repo',
      changedFiles: [{ path: 'a.md', content: 'token sk-abcdef0123456789abcdef0123' }],
      summarizer: createDigestSummarizer(),
      maxBytes: 4000,
      redact: (value) => value.replace(/sk-[A-Za-z0-9]+/gu, '[REDACTED]')
    })

    expect(result.brief?.text).toContain('[REDACTED]')
    expect(result.brief?.text).not.toContain('sk-abcdef')
  })

  test('a failing provider is non-fatal and recorded as failed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-fail-'))

    try {
      // The inbox `dir` points at a regular file, so readdir throws ENOTDIR.
      await writeFile(path.join(root, 'context-file'), 'not a directory')

      const result = await runContextIngestion({
        providers: [{ type: 'inbox', dir: 'context-file', maxFiles: 10, maxFileBytes: 1000 }],
        repositoryRoot: root,
        changedFiles: [],
        summarizer: createDigestSummarizer(),
        maxBytes: 4000,
        redact: identity
      })

      expect(result.brief).toBeUndefined()
      expect(result.providerMetrics[0]).toMatchObject({ failed: true, fragmentCount: 0 })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('no fragments yields no brief', async () => {
    const result = await runContextIngestion({
      providers: [],
      repositoryRoot: '/repo',
      changedFiles: [],
      summarizer: createDigestSummarizer(),
      maxBytes: 4000,
      redact: identity
    })
    expect(result.brief).toBeUndefined()
  })
})
