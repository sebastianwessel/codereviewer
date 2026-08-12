// End-to-end coverage of `eval intent` over a REAL hydrated intent case.
//
// Hermetic and free: no provider is configured, so no model call is ever made.
// What the model answers is a question for a live run; what this file proves is
// that the command hydrates a case from local history, resolves the answer key's
// source-line anchors through the hydrated line map, keeps its artefacts apart
// from the other two corpora's, and renders an absent measurement as absent
// instead of as a zero.

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  hydrateIntentCorpus,
  parseIntentEvalReport
} from '../domains/evaluation/index.js'
import { runCli } from './index.js'

const git = (root: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd: root, stdio: 'pipe' }).toString()

const CASE_ID = 'pw01-fixture'
const MANIFEST_PATH = 'eval/corpora/intent-test/manifest.json'
const CASE_ROOT = '.codereviewer/eval/intent-cases/intent-test'
const REPORT_PATH = join(
  '.codereviewer',
  'eval',
  'intent-fulfilment',
  'intent-eval-report.json'
)

const specDocument = [
  '# 99: A Capability',
  '',
  '## Requirements',
  '',
  '- The command MUST run the three arms and report the result.',
  '- Cost MUST be recorded and reported for every arm.',
  ''
].join('\n')

// A repository whose FIRST commit carries the specification, and whose second
// commit is the change under test. The intent commit is therefore a strict
// ancestor of the change's base, which is the pre-written guarantee hydration
// asserts.
const buildFixtureRepository = async (): Promise<{
  readonly root: string
  readonly intentCommit: string
  readonly baseCommit: string
  readonly headCommit: string
}> => {
  const root = await mkdtemp(join(tmpdir(), 'codereviewer-intent-eval-'))

  await mkdir(join(root, 'specs'), { recursive: true })
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'specs', '99-a-capability.md'), specDocument)
  await writeFile(join(root, 'src', 'run.ts'), 'export const run = () => 1\n')

  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'spec'])

  const intentCommit = git(root, ['rev-parse', 'HEAD']).trim()

  await writeFile(join(root, 'src', 'run.ts'), 'export const run = () => 2\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'base'])

  const baseCommit = git(root, ['rev-parse', 'HEAD']).trim()

  await writeFile(join(root, 'src', 'run.ts'), 'export const run = () => 3\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'head'])

  return {
    root,
    intentCommit,
    baseCommit,
    headCommit: git(root, ['rev-parse', 'HEAD']).trim()
  }
}

const hydrateFixture = async (): Promise<{ readonly root: string }> => {
  const fixture = await buildFixtureRepository()

  await mkdir(join(fixture.root, 'eval', 'corpora', 'intent-test'), {
    recursive: true
  })
  await writeFile(
    join(fixture.root, MANIFEST_PATH),
    JSON.stringify({
      schemaVersion: '1.0',
      datasetId: 'intent-test',
      description: 'A hermetic fixture corpus.',
      cases: [
        {
          id: CASE_ID,
          arm: 'prewritten',
          split: 'dev',
          mismatchOrigin: 'natural',
          source: 'repository-spec-slice',
          capturedAt: '2026-08-01',
          intent: {
            kind: 'document-slice',
            commit: fixture.intentCommit,
            path: 'specs/99-a-capability.md',
            title: 'Spec 99 — requirements',
            lineRanges: [[1, 6]]
          },
          change: {
            baseCommit: fixture.baseCommit,
            headCommit: fixture.headCommit
          },
          maxObligations: 40,
          humanObligationCount: 2,
          outstandingExpectations: [
            {
              id: 'out-1',
              statement: 'cost is neither recorded nor reported for any arm',
              intentLineRanges: [[6, 6]],
              rationale:
                'The clause requires cost to be recorded and reported, and nothing does.',
              provenance: 'Authored for this fixture.'
            }
          ]
        }
      ]
    })
  )

  await hydrateIntentCorpus({
    repositoryRoot: fixture.root,
    manifestPath: MANIFEST_PATH,
    outputRoot: CASE_ROOT
  })

  return { root: fixture.root }
}

describe('eval intent CLI', { timeout: 60_000 }, () => {
  // Three corpora answer three different questions. The option that selects the
  // diff reviewer's is unknown here, so a typo exits 2 rather than silently
  // scoring the wrong thing with the wrong answer key.
  test('does not accept --slice-root, the option that selects another corpus', async () => {
    const result = await runCli(
      ['eval', 'intent', '--slice-root', '.codereviewer/eval/corpus-slices/x'],
      { cwd: '/repo', environment: {} }
    )

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr).message).toBe('Unknown option --slice-root')
  })

  test('hydrates from local history alone and writes its own artefacts', async () => {
    const { root } = await hydrateFixture()

    try {
      const result = await runCli(
        [
          'eval',
          'intent',
          '--manifest',
          MANIFEST_PATH,
          '--case-root',
          CASE_ROOT
        ],
        { cwd: root, environment: {} }
      )

      // Nothing could be scored without a provider, and a run that scored nothing
      // is not a result: exiting 0 would let an un-hydrated corpus or a missing
      // provider look like a completed measurement that found nothing wrong.
      expect(result.exitCode).toBe(1)

      const report = parseIntentEvalReport(
        JSON.parse(await readFile(join(root, REPORT_PATH), 'utf8'))
      )

      expect(report.reportKind).toBe('intent-fulfilment-obligations')
      expect(report.coverage.totalExpectationCount).toBe(1)
      expect(report.caseResults).toEqual([
        expect.objectContaining({
          caseId: CASE_ID,
          status: 'unmeasured',
          reason: 'provider-unavailable'
        })
      ])
      // Absent, not zero.
      expect(report.arms.prewritten.outstandingRecall.status).toBe(
        'not-measured'
      )
      expect(report.arms.prewritten.falseSatisfied.claimCount).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Editing the manifest leaves an existing checkout describing the previous one.
  // This project has already had to void a published figure that was scored
  // against an answer key which had changed underneath it.
  test('refuses to score a checkout whose answer key has moved', async () => {
    const { root } = await hydrateFixture()

    try {
      const manifest = JSON.parse(
        await readFile(join(root, MANIFEST_PATH), 'utf8')
      ) as {
        cases: { outstandingExpectations: { intentLineRanges: number[][] }[] }[]
      }

      const expectation = manifest.cases[0]?.outstandingExpectations[0]

      if (expectation === undefined) {
        throw new Error('the fixture manifest lost its expectation')
      }

      expectation.intentLineRanges = [[5, 5]]
      await writeFile(join(root, MANIFEST_PATH), JSON.stringify(manifest))

      const result = await runCli(
        [
          'eval',
          'intent',
          '--manifest',
          MANIFEST_PATH,
          '--case-root',
          CASE_ROOT
        ],
        { cwd: root, environment: {} }
      )
      const report = parseIntentEvalReport(
        JSON.parse(await readFile(join(root, REPORT_PATH), 'utf8'))
      )

      expect(result.exitCode).toBe(1)
      expect(report.caseResults).toEqual([
        expect.objectContaining({ status: 'unmeasured', reason: 'stale-checkout' })
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The pre-written guarantee is the whole reason this corpus is not the
  // commit-message one. A document sliced at or after the change could have been
  // written to describe it, and hydration refuses rather than materialising it.
  test('hydration refuses an intent that is not an ancestor of the change', async () => {
    const { root } = await hydrateFixture()

    try {
      const manifest = JSON.parse(
        await readFile(join(root, MANIFEST_PATH), 'utf8')
      ) as { cases: { intent: { commit: string } }[] }
      const corpusCase = manifest.cases[0]

      if (corpusCase === undefined) {
        throw new Error('the fixture manifest lost its case')
      }

      // A commit made AFTER the change. It is neither the head — which the schema
      // already refuses without consulting git — nor an ancestor of the base, so
      // only the git check can catch it, which is the point of this test.
      await writeFile(join(root, 'specs', '99-a-capability.md'), specDocument)
      git(root, ['add', '-A'])
      git(root, ['commit', '-q', '--allow-empty', '-m', 'later'])
      corpusCase.intent.commit = git(root, ['rev-parse', 'HEAD']).trim()
      await writeFile(join(root, MANIFEST_PATH), JSON.stringify(manifest))

      await expect(
        hydrateIntentCorpus({
          repositoryRoot: root,
          manifestPath: MANIFEST_PATH,
          outputRoot: CASE_ROOT
        })
      ).rejects.toThrow(
        /is not an ancestor of the change's base .* and the case must not be materialised/su
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
