// End-to-end coverage of `eval impact` over a REAL hydrated change-impact case.
//
// Hermetic and free: every test here runs with `--adjudication off`, or with it on
// and no provider configured, so no provider call is ever made. What the model
// answers is a question for a live run; what this file proves is that the command
// scores the three arms, keeps its artefacts apart from the eval run's, and
// renders an absent measurement as absent.

import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildChangeImpactCase,
  parseChangeImpactEvalReport
} from '../domains/evaluation/index.js'
import { corpusCaseFixture } from '../domains/evaluation/change-impact-eval/change-impact-fixture.js'
import { runCli } from './index.js'

const git = (root: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd: root, stdio: 'pipe' }).toString()

const CASE_ID = 'store-contract-moved'
const MANIFEST_PATH = 'eval/corpora/impact-test/manifest.json'
const CASE_ROOT = '.codereviewer/eval/change-impact-cases/impact-test'
const REPORT_PATH = join(
  '.codereviewer',
  'eval',
  'change-impact',
  'change-impact-eval-report.json'
)

// A base commit exporting a symbol with one call site elsewhere, then a head
// commit that changes what the symbol returns. The call site is the proven
// dependent: it lies outside the reviewed diff, which is this corpus's invariant.
const buildCaseRepositoryTemplate = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'codereviewer-impact-eval-tmpl-'))

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src', 'store.ts'),
    'export const fetchUser = () => ({ id: "1" })\n'
  )
  await writeFile(
    join(root, 'src', 'caller.ts'),
    [
      'import { fetchUser } from "./store.js"',
      'export const name = fetchUser().id',
      ''
    ].join('\n')
  )

  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'base'])

  await writeFile(
    join(root, 'src', 'store.ts'),
    'export const fetchUser = () => null\n'
  )
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'change what the helper returns'])

  return root
}

let caseTemplate: string | undefined

beforeAll(async () => {
  caseTemplate = await buildCaseRepositoryTemplate()
  // Explicit, because `describe`'s `timeout` option DOES NOT COVER HOOKS. The
  // suite below raises the per-test timeout and that raise never reached this
  // hook, which is where the file's expensive work actually happens -- seven
  // `git` spawns from a vitest worker. Under parallel load it exceeded the
  // default and the file failed at `beforeAll`, reporting nothing about the code
  // under test. `review-e2e.test.ts` hit the same trap and carries the same
  // explicit bound.
}, 60_000)

afterAll(async () => {
  if (caseTemplate !== undefined) {
    await rm(caseTemplate, { recursive: true, force: true })
  }
})

type HydratedFixture = {
  readonly root: string
}

// Builds the outer repository root the command runs in: a manifest, and one
// hydrated case whose `case.json` is produced by the REAL hydration builder, so
// the coupling between what hydration writes and what the scorer reads is under
// test rather than restated.
const hydrateFixture = async (
  options: { readonly hydrate?: boolean; readonly staleAnswerKey?: boolean } = {}
): Promise<HydratedFixture> => {
  if (caseTemplate === undefined) {
    throw new Error('The case repository template was not built.')
  }

  const root = await mkdtemp(join(tmpdir(), 'codereviewer-impact-eval-'))
  const caseDirectory = join(root, ...CASE_ROOT.split('/'), CASE_ID)
  const workTree = join(caseDirectory, 'repo')

  await mkdir(join(root, 'eval', 'corpora', 'impact-test'), { recursive: true })
  await mkdir(caseDirectory, { recursive: true })
  await cp(caseTemplate, workTree, { recursive: true })

  const introducingCommit = git(workTree, ['rev-parse', 'HEAD']).trim()
  const parentCommit = git(workTree, ['rev-parse', 'HEAD~1']).trim()
  const corpusCase = corpusCaseFixture({
    id: CASE_ID,
    language: 'typescript',
    reviewedPaths: ['src/store.ts'],
    expected: [
      { path: 'src/caller.ts', reachability: 'caller-of-changed-symbol' }
    ],
    introducingCommit,
    parentCommit
  })

  await writeFile(
    join(root, ...MANIFEST_PATH.split('/')),
    JSON.stringify(
      {
        schemaVersion: '1.0',
        datasetId: 'impact-test',
        modelTrainingCutoff: '2026-01-01',
        description:
          'A single-case fixture corpus used to exercise the change-impact scorer end to end.',
        cases: [corpusCase]
      },
      null,
      2
    )
  )

  if (options.hydrate === false) {
    await rm(caseDirectory, { recursive: true, force: true })

    return { root }
  }

  const diff = git(workTree, [
    'diff',
    '--no-color',
    parentCommit,
    introducingCommit,
    '--',
    'src/store.ts'
  ])

  await writeFile(
    join(caseDirectory, 'case.json'),
    `${JSON.stringify(
      buildChangeImpactCase({
        corpusCase: options.staleAnswerKey === true
          ? {
              ...corpusCase,
              expectedImpact: corpusCase.expectedImpact.map((expected) => ({
                ...expected,
                path: 'src/a-file-the-manifest-no-longer-expects.ts'
              }))
            }
          : corpusCase,
        datasetId: 'impact-test',
        diff,
        changedFiles: ['src/store.ts']
      }),
      null,
      2
    )}\n`
  )

  return { root }
}

const runEvalImpact = async (
  root: string,
  args: readonly string[]
): Promise<Awaited<ReturnType<typeof runCli>>> =>
  runCli(
    [
      'eval',
      'impact',
      '--manifest',
      MANIFEST_PATH,
      '--case-root',
      CASE_ROOT,
      ...args
    ],
    { cwd: root, environment: {} }
  )

describe('eval impact CLI', { timeout: 30_000 }, () => {
  // Spec 22 forbids pooling this corpus with spec 17's. The option that selects
  // spec 17's corpus is unknown here, so a typo exits 2 rather than silently
  // scoring the wrong thing.
  test('does not accept --slice-root, the option that selects the other corpus', async () => {
    const result = await runCli(
      ['eval', 'impact', '--slice-root', '.codereviewer/eval/corpus-slices/x'],
      { cwd: '/repo', environment: {} }
    )

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr).message).toBe(
      'Unknown option --slice-root'
    )
  })

  test('scores the deterministic reference arm with no provider call at all', async () => {
    const { root } = await hydrateFixture()

    try {
      const result = await runEvalImpact(root, ['--adjudication', 'off'])

      expect(result.exitCode).toBe(0)

      const report = parseChangeImpactEvalReport(
        JSON.parse(await readFile(join(root, REPORT_PATH), 'utf8'))
      )

      expect(report.reportKind).toBe('change-impact-dependents')
      expect(report.coverage.scoredCaseCount).toBe(1)
      // The call site outside the diff is what the reference list had to find.
      expect(
        report.arms.reference.byReachability['caller-of-changed-symbol'].measured
      ).toEqual({ status: 'measured', matched: 1, total: 1, rate: 1 })
      // Nothing was adjudicated, so nothing about arm 2 is claimed.
      expect(report.arms.adjudicated.directlyReachable.measured.status).toBe(
        'not-measured'
      )
      expect(report.adjudicationDelta.status).toBe('not-measured')
      expect(report.engine.adjudicationRequested).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('writes its own artefacts, never the eval run ones', async () => {
    const { root } = await hydrateFixture()

    try {
      await runEvalImpact(root, ['--adjudication', 'off'])

      await expect(readFile(join(root, REPORT_PATH), 'utf8')).resolves.toContain(
        'change-impact-dependents'
      )
      await expect(
        readFile(
          join(
            root,
            '.codereviewer',
            'eval',
            'change-impact',
            'change-impact-eval-summary.md'
          ),
          'utf8'
        )
      ).resolves.toContain('Arm 1 — deterministic reference list')
      // The eval run's own artefacts must not appear: two corpora, two reports.
      await expect(
        readFile(join(root, '.codereviewer', 'eval', 'eval-report.json'), 'utf8')
      ).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // An un-hydrated corpus must never look like a completed measurement.
  test('exits non-zero and measures nothing when the corpus is not hydrated', async () => {
    const { root } = await hydrateFixture({ hydrate: false })

    try {
      const result = await runEvalImpact(root, ['--adjudication', 'off'])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('eval:impact-corpus:hydrate')

      const report = parseChangeImpactEvalReport(
        JSON.parse(await readFile(join(root, REPORT_PATH), 'utf8'))
      )

      expect(report.coverage.scoredCaseCount).toBe(0)
      expect(report.coverage.unmeasuredByReason['not-hydrated']).toBe(1)
      expect(
        report.arms.reference.byReachability['caller-of-changed-symbol'].measured
          .status
      ).toBe('not-measured')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refuses to score a checkout whose answer key drifted from the manifest', async () => {
    const { root } = await hydrateFixture({ staleAnswerKey: true })

    try {
      const result = await runEvalImpact(root, ['--adjudication', 'off'])

      expect(result.exitCode).toBe(1)

      const report = parseChangeImpactEvalReport(
        JSON.parse(await readFile(join(root, REPORT_PATH), 'utf8'))
      )

      expect(report.coverage.unmeasuredByReason['stale-checkout']).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Asking for adjudication without a provider must not produce a zero. It
  // produces an absence, and says so.
  test('reports the adjudicated arm as not measured when no model lane exists', async () => {
    const { root } = await hydrateFixture()

    try {
      const result = await runEvalImpact(root, ['--adjudication', 'on'])

      expect(result.exitCode).toBe(0)

      const report = parseChangeImpactEvalReport(
        JSON.parse(await readFile(join(root, REPORT_PATH), 'utf8'))
      )

      expect(report.engine.adjudicationRequested).toBe(true)
      expect(report.arms.adjudicated.directlyReachable.measured.status).toBe(
        'not-measured'
      )
      expect(report.warnings.join(' ')).toContain('NOT MEASURED')
      // The reference arm still measured, because the deterministic tier ran.
      expect(report.arms.reference.directlyReachable.measured.status).toBe(
        'measured'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Without this, a case whose language the engine does not cover scores as a
  // genuine miss with nothing on the page saying the engine never looked.
  test("carries the engine's own per-case warnings into the report, named by case", async () => {
    const { root } = await hydrateFixture()

    try {
      await runEvalImpact(root, ['--adjudication', 'off'])

      const report = parseChangeImpactEvalReport(
        JSON.parse(await readFile(join(root, REPORT_PATH), 'utf8'))
      )
      const adjudicationWarnings = report.warnings.filter((warning) =>
        warning.startsWith(`${CASE_ID}: `)
      )

      // Adjudication was off, so the engine says so — and it says so against the
      // case it belongs to.
      expect(adjudicationWarnings.join(' ')).toContain(
        'Change-impact adjudication is disabled'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects an unknown case filter rather than scoring a smaller corpus quietly', async () => {
    const { root } = await hydrateFixture()

    try {
      const result = await runEvalImpact(root, [
        '--adjudication',
        'off',
        '--case',
        'no-such-case'
      ])

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('no-such-case')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
