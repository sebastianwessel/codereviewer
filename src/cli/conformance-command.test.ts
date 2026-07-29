// End-to-end coverage of `conformance check` over a REAL git repository. It stays
// hermetic and free: the command makes no provider call at all, so nothing here
// costs money or varies run to run. Git is used rather than a scripted runner
// because the CLI deliberately exposes no git seam — intake owns git, and the
// point of this file is to exercise the command exactly as a user runs it.
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { InvariantConformanceReport } from '../domains/invariant-conformance/index.js'
import { runCli } from './index.js'

const git = (root: string, args: readonly string[]): void => {
  execFileSync('git', [...args], { cwd: root, stdio: 'pipe' })
}

const writeConfig = async (
  root: string,
  invariantConformance: Record<string, unknown>
): Promise<void> => {
  await mkdir(join(root, '.codereviewer'), { recursive: true })
  await writeFile(
    join(root, '.codereviewer', 'config.json'),
    JSON.stringify({ invariantConformance }, null, 2)
  )
}

const guardedHandler = (name: string): string =>
  [
    `export const ${name} = (request) => {`,
    '  if (!requireAuth(request)) {',
    '    return deny()',
    '  }',
    '  return load(request)',
    '}',
    ''
  ].join('\n')

const unguardedHandler = (name: string): string =>
  [
    `export const ${name} = (request) => {`,
    '  return load(request)',
    '}',
    ''
  ].join('\n')

// A base commit whose handler directory guards consistently, then a head commit
// adding one handler that does not.
const buildRepositoryTemplate = async (): Promise<string> => {
  const root = await mkdtemp(
    join(tmpdir(), 'codereviewer-conformance-cli-template-')
  )

  await mkdir(join(root, 'src', 'handlers'), { recursive: true })
  await writeFile(
    join(root, 'src', 'handlers', 'read.ts'),
    guardedHandler('readOne') + guardedHandler('readAll')
  )
  await writeFile(
    join(root, 'src', 'handlers', 'write.ts'),
    guardedHandler('writeOne')
  )

  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'base'])

  await writeFile(
    join(root, 'src', 'handlers', 'remove.ts'),
    unguardedHandler('removeOne')
  )
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'add a handler'])

  return root
}

// Building the template costs seven `git` spawns, and a spawn from a vitest
// worker is an order of magnitude more expensive than one from a bare node
// process (~1.3s per build, measured, against ~0.5s for the command itself).
// Paying it once per file and copying the directory per test keeps every test
// on its own writable repository — copying a repository, `.git` included,
// yields a fully independent one, so the tests below that commit on top of it
// stay isolated — while keeping the suite well clear of the timeout under
// parallel worker load.
let repositoryTemplate: string | undefined

beforeAll(async () => {
  repositoryTemplate = await buildRepositoryTemplate()
})

// The template is absent only when the build above failed, which vitest already
// reports; cleaning up unconditionally would bury that failure under a second
// error naming an undefined path.
afterAll(async () => {
  if (repositoryTemplate !== undefined) {
    await rm(repositoryTemplate, { recursive: true, force: true })
  }
})

const createRepository = async (): Promise<string> => {
  if (repositoryTemplate === undefined) {
    throw new Error('The repository template was not built.')
  }

  const root = await mkdtemp(join(tmpdir(), 'codereviewer-conformance-cli-'))

  await cp(repositoryTemplate, root, { recursive: true })

  return root
}

const parseReport = (stdout: string): InvariantConformanceReport =>
  JSON.parse(stdout) as InvariantConformanceReport

// Every test here drives the real CLI over a real repository on disk, so it is
// bound by process spawns and filesystem work rather than by anything this
// suite controls. The default 5s timeout leaves too little headroom on a loaded
// or slower machine; the raise is scoped to this suite so the rest of the run
// keeps failing fast.
describe('conformance CLI', { timeout: 20_000 }, () => {
  test('rejects a subcommand other than check', async () => {
    const result = await runCli(['conformance', 'run'], {
      cwd: '/repo',
      environment: {}
    })

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr).message).toBe(
      'Expected command: conformance check'
    )
  })

  test('reports disabled, and exits 0, when the capability is off by default', async () => {
    const root = await createRepository()

    try {
      const result = await runCli(
        ['conformance', 'check', '--base-ref', 'main~1', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(0)
      expect(parseReport(result.stdout).status).toBe('disabled')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('names the divergence and cites the peers by path and line', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true })
      const result = await runCli(
        ['conformance', 'check', '--base-ref', 'main~1', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )
      const report = parseReport(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(report.status).toBe('completed')
      expect(report.scope.changedFileCount).toBe(1)
      expect(report.scope.peerFileCount).toBe(2)
      expect(
        report.changeAttributedDivergences.map((divergence) => [
          divergence.declaration.path,
          divergence.declaration.name,
          divergence.pattern.symbol,
          divergence.citedPeers.map((peer) => `${peer.path}:${peer.line}`)
        ])
      ).toEqual([
        [
          'src/handlers/remove.ts',
          'removeOne',
          'deny',
          [
            'src/handlers/read.ts:1',
            'src/handlers/read.ts:7',
            'src/handlers/write.ts:1'
          ]
        ],
        [
          'src/handlers/remove.ts',
          'removeOne',
          'requireAuth',
          [
            'src/handlers/read.ts:1',
            'src/handlers/read.ts:7',
            'src/handlers/write.ts:1'
          ]
        ]
      ])
      expect(report.changeAttributedDivergences[1]?.statement).toBe(
        '3 of 3 sibling declarations call requireAuth; removeOne does not.'
      )
      expect(report.preExistingDivergences).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The exit code is the load-bearing part of this wave's honesty, and spec 24
  // states it as a requirement rather than a default: the capability is advisory
  // only and MUST NOT be able to fail a pipeline. Every report shape is driven
  // through the command here.
  test('exits 0 for every report shape it can produce', async () => {
    const root = await createRepository()

    try {
      const disabled = await runCli(
        ['conformance', 'check', '--base-ref', 'main~1', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )

      await writeConfig(root, { enabled: true })
      const withDivergences = await runCli(
        ['conformance', 'check', '--base-ref', 'main~1', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )
      // An empty range: no changed file, therefore no declaration and no
      // divergence.
      const withoutDivergences = await runCli(
        ['conformance', 'check', '--base-ref', 'HEAD', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )

      expect(parseReport(disabled.stdout).status).toBe('disabled')
      expect(disabled.exitCode).toBe(0)
      expect(
        parseReport(withDivergences.stdout).summary
          .changeAttributedDivergenceCount
      ).toBeGreaterThan(0)
      expect(withDivergences.exitCode).toBe(0)
      expect(
        parseReport(withoutDivergences.stdout).changeAttributedDivergences
      ).toEqual([])
      expect(withoutDivergences.exitCode).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports no divergence rather than manufacturing one when the change conforms', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true })
      await writeFile(
        join(root, 'src', 'handlers', 'remove.ts'),
        guardedHandler('removeOne')
      )
      git(root, ['add', '-A'])
      git(root, ['commit', '-q', '-m', 'guard it too'])
      const result = await runCli(
        ['conformance', 'check', '--base-ref', 'main~1', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )
      const report = parseReport(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(report.summary.peerSetCount).toBeGreaterThan(0)
      expect(report.changeAttributedDivergences).toEqual([])
      expect(report.preExistingDivergences).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('labels a divergence the change did not cause and keeps it out of the change-attributed count', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true })
      // The unguarded sibling lands in its own earlier commit, so the reviewed
      // range below does not contain it.
      await writeFile(
        join(root, 'src', 'handlers', 'legacy.ts'),
        unguardedHandler('legacyOne')
      )
      git(root, ['add', '-A'])
      git(root, ['commit', '-q', '-m', 'a handler nobody guarded'])
      // The change itself conforms.
      await writeFile(
        join(root, 'src', 'handlers', 'remove.ts'),
        guardedHandler('removeOne')
      )
      git(root, ['add', '-A'])
      git(root, ['commit', '-q', '-m', 'guard it too'])
      // Only `remove.ts` is in the reviewed range; `legacy.ts` predates it.
      const result = await runCli(
        ['conformance', 'check', '--base-ref', 'HEAD~1', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )
      const report = parseReport(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(report.changeAttributedDivergences).toEqual([])
      expect(report.summary.changeAttributedDivergenceCount).toBe(0)
      expect(
        report.preExistingDivergences.map((divergence) => [
          divergence.declaration.name,
          divergence.attribution
        ])
      ).toEqual([
        ['legacyOne', 'pre-existing'],
        ['legacyOne', 'pre-existing']
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a divergence citing fewer than three peers is never reported', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codereviewer-conformance-thin-'))

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      // Two conforming peers only. A unanimous majority, and still a
      // coincidence by spec 24's rule.
      await writeFile(
        join(root, 'src', 'peers.ts'),
        guardedHandler('one') + guardedHandler('two')
      )
      git(root, ['init', '-q', '-b', 'main'])
      git(root, ['config', 'user.email', 'test@example.com'])
      git(root, ['config', 'user.name', 'Test'])
      git(root, ['add', '-A'])
      git(root, ['commit', '-q', '-m', 'base'])
      await writeConfig(root, { enabled: true })
      await writeFile(join(root, 'src', 'odd.ts'), unguardedHandler('three'))
      git(root, ['add', '-A'])
      git(root, ['commit', '-q', '-m', 'add the odd one'])
      const result = await runCli(
        ['conformance', 'check', '--base-ref', 'main~1', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )
      const report = parseReport(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(report.summary.peerSetCount).toBe(1)
      expect(report.changeAttributedDivergences).toEqual([])
      expect(report.preExistingDivergences).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('maps an unresolvable ref to the repository exit code, not to a report', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true })
      const result = await runCli(
        ['conformance', 'check', '--base-ref', 'no-such-ref', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(3)
      expect(result.stdout).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('maps a malformed config to the config exit code', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true, blocking: true })
      const result = await runCli(
        ['conformance', 'check', '--base-ref', 'main~1', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(2)
      expect(result.stdout).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
