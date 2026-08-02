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

  test('does not blame the language when the changed file is in a covered one', async () => {
    // Regression. The unsupported-language warning above used to be emitted for
    // ANY changed-files-but-no-declarations outcome, without checking coverage.
    // A real run over four TypeScript files reported that its files were in an
    // uncovered language, pointing the reader at the one explanation that was
    // definitely wrong. The two cases must stay distinguishable, so this asserts
    // the covered-language branch names no cause it has not established.
    const root = await createRepository({
      // Covered language, and nothing in it that the extractors seed as a
      // declaration.
      'src/constants.ts': 'const internalValue = 1\n\nexport default internalValue\n'
    })
    const report = await runInvariantConformance({
      repositoryRoot: root,
      config: enabledConfig,
      baseRef: 'main',
      headRef: 'HEAD',
      generatedAt,
      ...createSeams(root),
      runGit: gitFor('src/constants.ts', 3)
    })

    expect(report.status).toBe('completed')
    expect(report.summary.changedDeclarationCount).toBe(0)
    expect(report.warnings).not.toContain(
      'Some changed files are in a language the deterministic signal extractors do not cover; no declarations were seeded from them.'
    )
    expect(report.warnings).toContain(
      'Changed files were in covered languages but seeded no declarations to compare; nothing in them was extracted as a declaration.'
    )
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

  // Test files are excluded on BOTH sides. A test declaration's siblings are other
  // test declarations, and the pattern they share is the vocabulary of the test
  // harness — "43 of 60 siblings call `assertNoOutput`, this one does not" is true
  // and worthless. The first real-repository measurement of this capability found
  // that the majority of everything it reported had this shape, and that tests were
  // where the near-duplicate structure that produces the floods lives.
  describe('test files', () => {
    test('a sibling test file supplies no peers', async () => {
      const changed = handler('remove', ['  return load(request)'])
      const root = await createRepository({
        'src/handlers/remove.ts': changed,
        // Unanimous among the siblings, and every sibling is a test. Before the
        // exclusion this reported `remove` as the odd one out for not calling
        // `requireAuth` like the tests around it do.
        'src/handlers/read.test.ts':
          guardedHandler('readOne') + guardedHandler('readAll'),
        'src/handlers/write.spec.ts': guardedHandler('writeOne')
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

      // The seed still landed, so this is the peers being excluded rather than
      // the changed file failing to parse.
      expect(report.summary.changedDeclarationCount).toBe(1)
      expect(report.scope.peerFileCount).toBe(0)
      expect(report.summary.peerSetCount).toBe(0)
      expect(report.warnings).toEqual([
        'No changed declaration had a sibling declaration in its own file or directory, so no peer set could be built.'
      ])
    })

    test('a changed test file seeds nothing and says so', async () => {
      const changed = handler('remove', ['  return load(request)'])
      const root = await createRepository({
        'src/handlers/remove.test.ts': changed,
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
        runGit: gitFor('src/handlers/remove.test.ts', changed.split('\n').length)
      })

      expect(report.scope.changedFileCount).toBe(0)
      expect(report.summary.changedDeclarationCount).toBe(0)
      // Nothing was read for peers either: with the only changed file excluded
      // there is no directory left to look in.
      expect(report.scope.peerFileCount).toBe(0)
      // The silence is explained. Without this the report is empty, carries no
      // warning at all, and reads like a capability that failed.
      expect(report.warnings).toEqual([
        "1 changed test-side file(s) were excluded from conformance analysis: a test-side declaration's siblings are other test-side declarations, and what they share is test-harness vocabulary rather than a protective convention of the system under review."
      ])
    })

    // Rust writes most of its unit tests INSIDE the file under test, in an inline
    // `#[cfg(test)] mod tests`. So the file-level question has no answer for it —
    // the same path holds the production surface and the test suite — and asking
    // it anyway is what this fixture is built from.
    //
    // The peer file here is production code that happens to carry such a module.
    // Both halves of the exclusion have to be right at once, and each is asserted:
    // its four production methods MUST supply peers, and its four test functions
    // MUST NOT. Sitting at the same indentation as the methods, the test functions
    // are siblings by every structural rule this domain has; only the fact that
    // the crate compiles them for the test build alone separates them.
    test('an inline test module supplies no peers, and the production file around it still does', async () => {
      const changed = [
        'pub struct Store;',
        '',
        'impl Store {',
        '    pub fn remove(request: &Request) -> Response {',
        '        load(request)',
        '    }',
        '}',
        ''
      ].join('\n')
      const guardedMethod = (name: string): string =>
        [
          `    pub fn ${name}(request: &Request) -> Response {`,
          '        require_auth(request);',
          '        load(request)',
          '    }'
        ].join('\n')
      // Unanimous among the tests and nowhere in the production code, so a peer
      // set that counted them would report `unwrap` as a convention `remove`
      // breaks. Nothing below may mention it.
      const testFunction = (name: string): string =>
        [
          '    #[test]',
          `    fn ${name}() {`,
          '        load(fixture().unwrap());',
          '    }'
        ].join('\n')
      const root = await createRepository({
        'src/store.rs': changed,
        // Named like production because it IS production, and the only file that
        // can supply a peer.
        'src/helper.rs': [
          'pub struct Helper;',
          '',
          'impl Helper {',
          ['read_one', 'read_all', 'read_some', 'read_none']
            .map(guardedMethod)
            .join('\n\n'),
          '}',
          '',
          '#[cfg(test)]',
          'mod tests {',
          ['reads_one', 'reads_all', 'reads_some', 'reads_none']
            .map(testFunction)
            .join('\n\n'),
          '}',
          ''
        ].join('\n')
      })
      const report = await runInvariantConformance({
        repositoryRoot: root,
        config: enabledConfig,
        baseRef: 'main',
        headRef: 'HEAD',
        generatedAt,
        ...createSeams(root),
        runGit: gitFor('src/store.rs', changed.split('\n').length)
      })

      expect(report.summary.changedDeclarationCount).toBe(1)
      expect(report.scope.peerFileCount).toBe(1)
      expect(report.summary.peerSetCount).toBe(1)
      // The arithmetic is the assertion. `4 of 4` is the production methods and
      // only them: the eight-declaration denominator an inline test module used to
      // produce turns the same unanimous guard into a sub-majority `4 of 8` and
      // reports nothing at all.
      expect(
        [
          ...report.changeAttributedDivergences,
          ...report.preExistingDivergences
        ].map((divergence) => divergence.statement)
      ).toEqual([
        '4 of 4 sibling declarations call require_auth; remove does not.'
      ])
    })
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

  // The shape this capability is sold on, written the way a reader would describe
  // it: sibling modules in one directory share a validation convention and one of
  // them does not. It is here as a live-fire check that the deterministic path
  // still FIRES end to end — the capability spent a period reporting zero
  // divergences on every input tried, and nothing in the suite would have noticed.
  test('reports the sibling that breaks a convention its peers all follow', async () => {
    const validating = (name: string): string =>
      [
        `export const ${name} = (raw) => {`,
        '  log(name)',
        '  const parsed = schema.parse(raw)',
        '  return respond(parsed)',
        '}',
        ''
      ].join('\n')
    // Skips the parse, but is otherwise one of the group — which is what makes it
    // a member of the peer set rather than an unrelated declaration.
    const unvalidating = [
      'export const parseSix = (raw) => {',
      '  log(name)',
      '  const parsed = raw',
      '  return respond(parsed)',
      '}',
      ''
    ].join('\n')
    const root = await createRepository({
      'src/parse/six.ts': unvalidating,
      ...Object.fromEntries(
        ['one', 'two', 'three', 'four', 'five'].map((name) => [
          `src/parse/${name}.ts`,
          validating(`parse${name}`)
        ])
      )
    })
    const report = await runInvariantConformance({
      repositoryRoot: root,
      config: enabledConfig,
      baseRef: 'main',
      headRef: 'HEAD',
      generatedAt,
      ...createSeams(root),
      runGit: gitFor('src/parse/six.ts', unvalidating.split('\n').length)
    })

    expect(report.summary.changedDeclarationCount).toBe(1)
    expect(
      report.changeAttributedDivergences.map(
        (divergence) => divergence.pattern.symbol
      )
    ).toContain('parse')
    expect(
      report.changeAttributedDivergences.some((divergence) =>
        divergence.statement.includes('5 of 5 sibling declarations call parse')
      )
    ).toBe(true)
  })

  // The boundary of the shape above, asserted so it is a decision rather than a
  // surprise. A declaration that does nothing at all holds no trait, and this
  // capability compares declarations by what they DO: it is dropped before it can
  // be a subject, and it would fail the membership precondition even if it were
  // not. Relaxing either gate was measured and rejected — it reports every type
  // alias and constant as diverging from every peer. The cost is stated here: a
  // pure pass-through beside five validating siblings is NOT reported, and the
  // right diagnostic for that reader is the warning, not a divergence.
  test('says so plainly when the odd one out does nothing at all to compare', async () => {
    const passthrough = 'export const parseSix = (raw) => raw\n'
    const root = await createRepository({
      'src/parse/six.ts': passthrough,
      ...Object.fromEntries(
        ['one', 'two', 'three', 'four', 'five'].map((name) => [
          `src/parse/${name}.ts`,
          `export const parse${name} = (raw) => schema.parse(raw)\n`
        ])
      )
    })
    const report = await runInvariantConformance({
      repositoryRoot: root,
      config: enabledConfig,
      baseRef: 'main',
      headRef: 'HEAD',
      generatedAt,
      ...createSeams(root),
      runGit: gitFor('src/parse/six.ts', passthrough.split('\n').length)
    })

    expect(report.summary.changedDeclarationCount).toBe(0)
    expect(report.changeAttributedDivergences).toEqual([])
    expect(report.warnings).toContain(
      'Changed files were in covered languages but seeded no declarations to compare; nothing in them was extracted as a declaration.'
    )
  })

  // The regression that made this capability look dead. Both work bounds used to
  // keep the front of a path-sorted list, so a change wider than a bound was
  // analysed only where the paths sorted first — and a divergence anywhere later
  // was silently unreachable. Measured on this repository, a range with 23
  // divergences reported none, while a SUBSET of the same range reported 15.
  test('a bound that binds still reaches a divergence in a late-sorting directory', async () => {
    const directories = Array.from({ length: 8 }, (_unused, index) =>
      String.fromCharCode(97 + index)
    )
    // Every divergence in this repository is in the LATE half of the alphabet, so
    // an analysis confined to the front of the sorted change finds none at all —
    // which is exactly what the old bound did, and what a reader then read as
    // "your pull request is clean".
    const divergentDirectories = new Set(['e', 'f', 'g', 'h'])
    const files: Record<string, string> = {}
    const changedPaths: string[] = []

    for (const directory of directories) {
      // Two changed files per directory, so the seed bound binds well before the
      // last directory is reached.
      for (const name of ['one', 'two']) {
        const filePath = `src/${directory}/${name}.ts`

        files[filePath] =
          name === 'two' && divergentDirectories.has(directory)
            ? // Calls `load` like its peers, but never `requireAuth`.
              handler(`${directory}Two`, ['  return load(request)'])
            : guardedHandler(`${directory}${name}`)
        changedPaths.push(filePath)
      }

      for (const peer of ['peerA', 'peerB', 'peerC', 'peerD']) {
        files[`src/${directory}/${peer}.ts`] = guardedHandler(
          `${directory}${peer}`
        )
      }
    }

    const root = await createRepository(files)
    const report = await runInvariantConformance({
      repositoryRoot: root,
      config: CodeReviewerConfigSchema.parse({
        invariantConformance: {
          enabled: true,
          // Both bounds bind: 16 changed declarations against 6 seeds, and 32
          // sibling files against 24 reads.
          maxChangedDeclarations: 6,
          maxPeerFiles: 24
        }
      }),
      baseRef: 'main',
      headRef: 'HEAD',
      generatedAt,
      ...createSeams(root),
      runGit: scriptedGit({
        'merge-base main HEAD': `${mergeBaseSha}\n`,
        [`diff --name-status ${mergeBaseSha} HEAD`]: `${changedPaths
          .map((changedPath) => `M\t${changedPath}`)
          .join('\n')}\n`,
        // Intake asks for every changed file in one command, so the answer is one
        // diff covering all of them.
        [`diff --unified=0 ${mergeBaseSha} HEAD -- ${changedPaths.join(' ')}`]:
          changedPaths
            .map(
              (changedPath) =>
                `diff --git a/${changedPath} b/${changedPath}\n` +
                `--- a/${changedPath}\n+++ b/${changedPath}\n` +
                '@@ -1,1 +1,8 @@\n-const old = 1\n' +
                '+replaced\n'.repeat(8)
            )
            .join('')
      })
    })

    const reported = report.changeAttributedDivergences.map((divergence) => [
      divergence.declaration.path,
      divergence.pattern.symbol
    ])

    expect(report.summary.changedDeclarationsTruncated).toBe(true)
    expect(report.scope.peerFilesTruncated).toBe(true)
    // The bound still bounds — this is a sample, not the whole change — but the
    // sample reaches the part of the change where the divergences actually are.
    // The old front-of-list bound seeded `src/a`, `src/b` and `src/c` only, read
    // no sibling in `src/e` onwards, and reported nothing.
    expect(reported.length).toBeGreaterThan(0)
    expect(
      reported.every(
        ([declarationPath]) =>
          declarationPath !== undefined &&
          divergentDirectories.has(declarationPath.split('/')[1] ?? '')
      )
    ).toBe(true)
    expect(reported.map(([, symbol]) => symbol)).toContain('requireAuth')
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
