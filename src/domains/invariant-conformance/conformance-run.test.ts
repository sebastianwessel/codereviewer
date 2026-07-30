import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import type { GitCommandRunner } from '../repository-intake/index.js'
import {
  ConformanceDivergenceSchema,
  InvariantConformanceReportSchema
} from './conformance-report.js'
import { runInvariantConformance } from './conformance-run.js'

const mergeBaseSha = '9f1c2ab3d4e5f60718293a4b5c6d7e8f90a1b2c3'
const generatedAt = new Date('2026-07-29T00:00:00.000Z')

const enabledConfig = CodeReviewerConfigSchema.parse({
  invariantConformance: { enabled: true }
})

const handler = (name: string, body: readonly string[]): string =>
  [`export const ${name} = (request) => {`, ...body, '}', ''].join('\n')

const guardedHandler = (name: string): string =>
  handler(name, [
    '  if (!requireAuth(request)) {',
    '    return deny()',
    '  }',
    '  return load(request)'
  ])

// A real repository on disk, because intake stats and hashes every changed file
// itself. The two seams below are the ones the CLI supplies from the mediated
// retriever, wired here straight to the filesystem so the composition — not the
// retriever — is what this file exercises.
const createdRoots: string[] = []

const createRepository = async (
  files: Readonly<Record<string, string>>
): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-conformance-'))

  createdRoots.push(root)

  for (const [filePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, ...filePath.split('/'))

    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, content)
  }

  return root
}

const createSeams = (root: string) => ({
  readRepositoryFile: async (filePath: string) => {
    try {
      return await readFile(path.join(root, ...filePath.split('/')), 'utf8')
    } catch {
      return undefined
    }
  },
  listDirectoryFiles: async (directory: string) => {
    try {
      const entries = await readdir(
        directory === '.' ? root : path.join(root, ...directory.split('/')),
        { withFileTypes: true }
      )

      return entries
        .filter((entry) => entry.isFile())
        .map((entry) =>
          directory === '.' ? entry.name : `${directory}/${entry.name}`
        )
    } catch {
      return []
    }
  }
})

afterEach(async () => {
  await Promise.all(
    createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

// Scripted git keeps the run hermetic. Every command it answers is one intake is
// allowed to issue.
const scriptedGit =
  (outputs: Readonly<Record<string, string>>): GitCommandRunner =>
  async (args) => {
    const output = outputs[args.join(' ')]

    if (output === undefined) {
      throw new Error(`Unexpected git command: ${args.join(' ')}`)
    }

    return output
  }

const gitFor = (
  changedPath: string,
  addedLineCount: number
): GitCommandRunner =>
  scriptedGit({
    'merge-base main HEAD': `${mergeBaseSha}\n`,
    [`diff --name-status ${mergeBaseSha} HEAD`]: `M\t${changedPath}\n`,
    [`diff --unified=0 ${mergeBaseSha} HEAD -- ${changedPath}`]:
      `diff --git a/${changedPath} b/${changedPath}\n` +
      `--- a/${changedPath}\n+++ b/${changedPath}\n` +
      `@@ -1,1 +1,${addedLineCount} @@\n-const old = 1\n` +
      '+replaced\n'.repeat(addedLineCount)
  })

describe('invariant conformance run', () => {
  test('reports disabled plainly rather than emitting an empty completed report', async () => {
    const root = await createRepository({})
    const report = await runInvariantConformance({
      repositoryRoot: root,
      config: CodeReviewerConfigSchema.parse({}),
      generatedAt,
      ...createSeams(root),
      runGit: scriptedGit({})
    })

    expect(report.status).toBe('disabled')
    expect(report.changeAttributedDivergences).toEqual([])
    expect(report.preExistingDivergences).toEqual([])
    expect(report.warnings).toEqual([
      'Invariant-conformance review is disabled. Set invariantConformance.enabled to true to run it.'
    ])
  })

  test('reads sibling files from the changed file directory and reports the divergence', async () => {
    const changed = handler('remove', ['  return load(request)'])
    const root = await createRepository({
      'src/handlers/remove.ts': changed,
      'src/handlers/read.ts': guardedHandler('readOne') + guardedHandler('readAll'),
      'src/handlers/write.ts': guardedHandler('writeOne'),
      // Another directory entirely: never a peer, and never read.
      'src/other/thing.ts': guardedHandler('unrelated')
    })
    const report = await runInvariantConformance({
      repositoryRoot: root,
      config: enabledConfig,
      baseRef: 'main',
      headRef: 'HEAD',
      generatedAt,
      ...createSeams(root),
      runGit: gitFor('src/handlers/remove.ts', changed.split('\n').length)
    })

    expect(report.status).toBe('completed')
    expect(report.scope).toEqual({
      baseRef: 'main',
      headRef: 'HEAD',
      mergeBaseRef: mergeBaseSha,
      changedFileCount: 1,
      // The two siblings in `src/handlers`, and neither of the files outside it.
      peerFileCount: 2,
      peerFilesTruncated: false
    })
    expect(report.summary.changedDeclarationCount).toBe(1)
    expect(report.summary.peerSetCount).toBe(1)
    expect(
      report.changeAttributedDivergences.map((divergence) => [
        divergence.declaration.name,
        divergence.pattern.kind,
        divergence.pattern.symbol,
        divergence.citedPeers.map((peer) => `${peer.path}:${peer.line}`)
      ])
    ).toEqual([
      [
        'remove',
        'call',
        'deny',
        [
          'src/handlers/read.ts:1',
          'src/handlers/read.ts:7',
          'src/handlers/write.ts:1'
        ]
      ],
      [
        'remove',
        'call',
        'requireAuth',
        [
          'src/handlers/read.ts:1',
          'src/handlers/read.ts:7',
          'src/handlers/write.ts:1'
        ]
      ]
    ])
    expect(() => InvariantConformanceReportSchema.parse(report)).not.toThrow()
  })

  test('reports no divergence rather than manufacturing one', async () => {
    const changed = guardedHandler('remove')
    const root = await createRepository({
      'src/handlers/remove.ts': changed,
      'src/handlers/read.ts': guardedHandler('readOne') + guardedHandler('readAll'),
      'src/handlers/write.ts': guardedHandler('writeOne')
    })
    const report = await runInvariantConformance({
      repositoryRoot: root,
      config: enabledConfig,
      baseRef: 'main',
      headRef: 'HEAD',
      generatedAt,
      ...createSeams(root),
      runGit: gitFor('src/handlers/remove.ts', changed.split('\n').length)
    })

    expect(report.status).toBe('completed')
    expect(report.summary.peerSetCount).toBe(1)
    expect(report.summary.changeAttributedDivergenceCount).toBe(0)
    expect(report.summary.preExistingDivergenceCount).toBe(0)
    expect(report.warnings).toEqual([])
  })

  test('keeps a pre-existing divergence out of the change-attributed list', async () => {
    const changed = guardedHandler('remove')
    const root = await createRepository({
      'src/handlers/remove.ts': changed,
      'src/handlers/read.ts': guardedHandler('readOne') + guardedHandler('readAll'),
      'src/handlers/write.ts':
        guardedHandler('writeOne') + handler('oddOneOut', ['  return load(request)'])
    })
    const report = await runInvariantConformance({
      repositoryRoot: root,
      config: enabledConfig,
      baseRef: 'main',
      headRef: 'HEAD',
      generatedAt,
      ...createSeams(root),
      runGit: gitFor('src/handlers/remove.ts', changed.split('\n').length)
    })

    expect(report.changeAttributedDivergences).toEqual([])
    expect(report.summary.changeAttributedDivergenceCount).toBe(0)
    expect(
      report.preExistingDivergences.map((divergence) => [
        divergence.declaration.name,
        divergence.pattern.symbol,
        divergence.attribution
      ])
    ).toEqual([
      ['oddOneOut', 'deny', 'pre-existing'],
      ['oddOneOut', 'requireAuth', 'pre-existing']
    ])
    expect(report.summary.preExistingDivergenceCount).toBe(2)
  })

  test('warns instead of failing when the changed file is in an unsupported language', async () => {
    const root = await createRepository({ 'notes.md': '# Notes\n\nSome prose.\n' })
    const report = await runInvariantConformance({
      repositoryRoot: root,
      config: enabledConfig,
      baseRef: 'main',
      headRef: 'HEAD',
      generatedAt,
      ...createSeams(root),
      runGit: gitFor('notes.md', 3)
    })

    expect(report.status).toBe('completed')
    expect(report.warnings).toEqual([
      'Some changed files are in a language the deterministic signal extractors do not cover; no declarations were seeded from them.'
    ])
  })

  test('warns when a changed declaration has no sibling to compare against', async () => {
    const changed = handler('solo', ['  return load(request)'])
    const root = await createRepository({ 'src/solo.ts': changed })
    const report = await runInvariantConformance({
      repositoryRoot: root,
      config: enabledConfig,
      baseRef: 'main',
      headRef: 'HEAD',
      generatedAt,
      ...createSeams(root),
      runGit: gitFor('src/solo.ts', changed.split('\n').length)
    })

    expect(report.summary.changedDeclarationCount).toBe(1)
    expect(report.summary.peerSetCount).toBe(0)
    expect(report.warnings).toEqual([
      'No changed declaration had a sibling declaration in its own file or directory, so no peer set could be built.'
    ])
  })

  test('counts an unreadable file rather than failing the report', async () => {
    const changed = handler('remove', ['  return load(request)'])
    const root = await createRepository({ 'src/handlers/remove.ts': changed })
    const report = await runInvariantConformance({
      repositoryRoot: root,
      config: enabledConfig,
      baseRef: 'main',
      headRef: 'HEAD',
      generatedAt,
      readRepositoryFile: async () => undefined,
      listDirectoryFiles: async () => [],
      runGit: gitFor('src/handlers/remove.ts', changed.split('\n').length)
    })

    expect(report.status).toBe('completed')
    expect(report.warnings).toEqual([
      '1 file(s) could not be read for declaration extraction and were skipped.'
    ])
  })

  test('bounds how many sibling files it reads and reports the truncation', async () => {
    const changed = handler('remove', ['  return load(request)'])
    const siblings = Object.fromEntries(
      Array.from({ length: 6 }, (_unused, index) => [
        `src/handlers/peer${index}.ts`,
        guardedHandler(`peer${index}`)
      ])
    )
    const root = await createRepository({
      'src/handlers/remove.ts': changed,
      ...siblings
    })
    const report = await runInvariantConformance({
      repositoryRoot: root,
      config: CodeReviewerConfigSchema.parse({
        invariantConformance: { enabled: true, maxPeerFiles: 3 }
      }),
      baseRef: 'main',
      headRef: 'HEAD',
      generatedAt,
      ...createSeams(root),
      runGit: gitFor('src/handlers/remove.ts', changed.split('\n').length)
    })

    expect(report.scope.peerFileCount).toBe(3)
    expect(report.scope.peerFilesTruncated).toBe(true)
  })

  test('the report schema carries no finding, severity, or gate field', () => {
    // The distinction this wave rests on: a divergence is NOT a finding. It is a
    // substantiated fact plus a question, and spec 24 forbids a verdict on
    // exploitability. Anything below appearing in this schema would misrepresent
    // what was measured, and spec 24 additionally forbids blocking outright.
    const shape = Object.keys(InvariantConformanceReportSchema.shape)

    expect(shape).toEqual([
      'schemaVersion',
      'status',
      'generatedAt',
      'scope',
      'summary',
      'changeAttributedDivergences',
      'preExistingDivergences',
      'warnings',
      'usage'
    ])
    for (const forbidden of [
      'findings',
      'admittedFindings',
      'severity',
      'qualityGate',
      'passed',
      'blocking'
    ]) {
      expect(shape).not.toContain(forbidden)
    }
    expect(
      Object.keys(
        InvariantConformanceReportSchema.shape.changeAttributedDivergences.element
          .shape
      )
    ).toEqual([
      'id',
      'attribution',
      'declaration',
      'pattern',
      'peerScope',
      'peerCount',
      'citedPeerCount',
      'citedPeers',
      'peersTruncated',
      'statement',
      'question',
      'adjudication'
    ])
  })

  // The structural half of the one-way valve. `adjudication.verdict` is a literal,
  // so the two verdicts that must never read as a divergence have no representation
  // in a divergence entry at all: a caller that skipped the filter gets a parse
  // error rather than a report claiming an undetermined answer found something.
  test('a divergence entry cannot carry any verdict except convention', () => {
    const divergence = {
      id: 'conf_x',
      attribution: 'change-attributed',
      declaration: {
        path: 'src/a.ts',
        line: 1,
        endLine: 3,
        name: 'a',
        kind: 'declaration',
        language: 'typescript'
      },
      pattern: { kind: 'call', symbol: 'requireAuth' },
      peerScope: 'directory',
      peerCount: 3,
      citedPeerCount: 3,
      citedPeers: [
        { path: 'src/b.ts', line: 1, name: 'b' },
        { path: 'src/c.ts', line: 1, name: 'c' },
        { path: 'src/d.ts', line: 1, name: 'd' }
      ],
      peersTruncated: false,
      statement: '3 of 3 sibling declarations call requireAuth; a does not.',
      question: 'Is calling requireAuth a convention a should follow?'
    }

    expect(() =>
      ConformanceDivergenceSchema.parse({
        ...divergence,
        adjudication: { verdict: 'convention', reason: 'The peers all load a record.' }
      })
    ).not.toThrow()
    for (const verdict of ['undetermined', 'incidental']) {
      expect(() =>
        ConformanceDivergenceSchema.parse({
          ...divergence,
          adjudication: { verdict, reason: 'Not enough to decide.' }
        })
      ).toThrow()
    }
    // And a convention with no stated basis is not representable either.
    expect(() =>
      ConformanceDivergenceSchema.parse({
        ...divergence,
        adjudication: { verdict: 'convention' }
      })
    ).toThrow()
  })

  test('the two divergence lists are separate arrays, so neither can inflate the other', () => {
    // Spec 24 requires pre-existing divergences to be "labelled and reported
    // separately, so they never inflate a change-attributed count". Separate
    // arrays make that structural rather than a convention a caller must honour.
    expect(
      InvariantConformanceReportSchema.shape.preExistingDivergences
    ).toBeDefined()
    expect(
      InvariantConformanceReportSchema.shape.summary.shape
        .preExistingDivergenceCount
    ).toBeDefined()
  })
})
