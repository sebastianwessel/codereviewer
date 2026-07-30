// Integration coverage of the whole `intent check` composition, driven with a
// scripted git runner and scripted model runners so it stays hermetic and free.
//
// It carries four of spec 23's verification-matrix rows:
//
//   - "Reuses spec 11 change-intent ingestion" — the obligations below are cited
//     against `inbox:` origins produced by spec 11's own inbox provider, reading a
//     real `.codereviewer/context` directory. Nothing in this domain gathers, and
//     an origin label this domain does not mint is what proves it.
//   - "Every obligation cites its source in the stated intent" — an extraction
//     citing a line nobody wrote produces no obligation.
//   - "Every satisfied obligation cites path and line".
//   - "Absent intent reports plainly and exits successfully".

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import type { GitCommandRunner } from '../repository-intake/index.js'
import type { FulfilmentJudgement } from './judgement.js'
import type { ExtractedObligation } from './obligation-extraction.js'
import {
  runIntentFulfilment,
  type IntentFulfilmentAgents
} from './intent-fulfilment-run.js'
import { IntentFulfilmentReportSchema } from './intent-fulfilment-report.js'

const mergeBaseSha = '9f1c2ab3d4e5f60718293a4b5c6d7e8f90a1b2c3'
const generatedAt = new Date('2026-07-30T00:00:00.000Z')

const configWith = (overrides: Record<string, unknown> = {}) =>
  CodeReviewerConfigSchema.parse({
    intentFulfilment: { enabled: true },
    contextSources: {
      enabled: true,
      providers: [{ type: 'inbox', dir: '.codereviewer/context' }]
    },
    ...overrides
  })

// A repository whose head commit changes one file, plus an inbox ticket stating
// two obligations. The inbox file is read by spec 11's provider, not by this
// domain.
const createRepository = async (): Promise<string> => {
  const root = join(tmpdir(), `codereviewer-intent-run-${crypto.randomUUID()}`)

  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, '.codereviewer', 'context'), { recursive: true })
  await writeFile(
    join(root, 'src', 'token.ts'),
    ['const a = 1', 'export const rejectExpired = () => false', ''].join('\n')
  )
  await writeFile(
    join(root, 'src', 'unrelated.ts'),
    ['export const renamedHelper = () => 1', ''].join('\n')
  )
  await writeFile(
    join(root, '.codereviewer', 'context', 'ticket.md'),
    [
      '---',
      'source: tracker',
      'id: A-1',
      'title: Reject expired tokens',
      '---',
      'Reject tokens older than five minutes.',
      'Record every refusal in the audit log.',
      ''
    ].join('\n')
  )

  return root
}

const readChangedFile = (root: string) => async (path: string) => {
  try {
    return await readFile(join(root, path), 'utf8')
  } catch {
    return undefined
  }
}

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

const gitOutputs: Readonly<Record<string, string>> = {
  'merge-base main HEAD': `${mergeBaseSha}\n`,
  [`diff --name-status ${mergeBaseSha} HEAD`]:
    'M\tsrc/token.ts\nM\tsrc/unrelated.ts\n',
  [`diff --unified=0 ${mergeBaseSha} HEAD -- src/token.ts src/unrelated.ts`]:
    'diff --git a/src/token.ts b/src/token.ts\n' +
    '--- a/src/token.ts\n+++ b/src/token.ts\n@@ -2,1 +2,1 @@\n' +
    '-export const rejectExpired = () => true\n' +
    '+export const rejectExpired = () => false\n' +
    'diff --git a/src/unrelated.ts b/src/unrelated.ts\n' +
    '--- a/src/unrelated.ts\n+++ b/src/unrelated.ts\n@@ -1,1 +1,1 @@\n' +
    '-export const helper = () => 1\n' +
    '+export const renamedHelper = () => 1\n'
}

type ScriptedAgents = IntentFulfilmentAgents & {
  readonly judgementPackets: { readonly obligation: string }[]
  readonly explanationCalls: unknown[]
}

const scriptedAgents = (script: {
  readonly obligations: readonly ExtractedObligation[]
  readonly judgements: readonly FulfilmentJudgement[]
  readonly explanation?: string
}): ScriptedAgents => {
  const judgementPackets: { readonly obligation: string }[] = []
  const explanationCalls: unknown[] = []
  let judged = 0

  return {
    judgementPackets,
    explanationCalls,
    extractObligations: async () => [...script.obligations],
    judge: async (input) => {
      judgementPackets.push({ obligation: input.obligation })
      const judgement = script.judgements[judged] ?? { status: 'undetermined' }
      judged += 1

      return judgement
    },
    explain: async (input) => {
      explanationCalls.push(input)

      return script.explanation
    }
  }
}

const run = (
  root: string,
  overrides: Partial<Parameters<typeof runIntentFulfilment>[0]> = {}
) =>
  runIntentFulfilment({
    repositoryRoot: root,
    config: configWith(),
    baseRef: 'main',
    headRef: 'HEAD',
    generatedAt,
    readChangedFile: readChangedFile(root),
    runGit: scriptedGit(gitOutputs),
    ...overrides
  })

describe('intent fulfilment run', () => {
  test('reports disabled plainly rather than emitting an empty completed report', async () => {
    const report = await runIntentFulfilment({
      repositoryRoot: '/repo',
      config: CodeReviewerConfigSchema.parse({}),
      generatedAt,
      readChangedFile: async () => undefined,
      runGit: scriptedGit({})
    })

    expect(report.status).toBe('disabled')
    expect(report.obligations).toEqual([])
    expect(report.warnings).toEqual([
      'Intent-fulfilment review is disabled. Set intentFulfilment.enabled to true to run it.'
    ])
  })

  test('maps obligations read from the spec 11 fragments onto the change', async () => {
    const root = await createRepository()

    try {
      const agents = scriptedAgents({
        obligations: [
          { origin: 'inbox:tracker/A-1', line: 1, statement: 'Reject old tokens.' },
          { origin: 'inbox:tracker/A-1', line: 2, statement: 'Log every refusal.' }
        ],
        judgements: [
          {
            status: 'addressed',
            evidence: [{ path: 'src/token.ts', line: 2 }]
          },
          { status: 'unaddressed' }
        ],
        explanation: 'One obligation is covered; the audit log is not.'
      })
      const report = await run(root, { agents })

      expect(report.status).toBe('completed')
      // The origin label is spec 11's, minted by its inbox provider from the
      // ticket's own frontmatter. Nothing in this domain could produce it, which is
      // what "reuses the existing ingestion" looks like from the outside.
      expect(report.scope.intentOrigins).toEqual(['inbox:tracker/A-1'])
      expect(report.summary.intentFragmentCount).toBe(1)
      expect(report.obligations).toEqual([
        {
          id: 'obl_1',
          source: {
            origin: 'inbox:tracker/A-1',
            line: 1,
            text: 'Reject tokens older than five minutes.'
          },
          statement: 'Reject old tokens.',
          status: 'addressed',
          evidence: [
            {
              path: 'src/token.ts',
              line: 2,
              side: 'added',
              text: 'export const rejectExpired = () => false'
            }
          ]
        },
        {
          id: 'obl_2',
          source: {
            origin: 'inbox:tracker/A-1',
            line: 2,
            text: 'Record every refusal in the audit log.'
          },
          statement: 'Log every refusal.',
          status: 'unaddressed'
        }
      ])
      expect(report.summary.addressedCount).toBe(1)
      expect(report.summary.unaddressedCount).toBe(1)
      expect(report.explanation).toBe(
        'One obligation is covered; the audit log is not.'
      )
      // The explanation call reads the frozen mapping and nothing else.
      expect(agents.explanationCalls).toHaveLength(1)
      expect(() => IntentFulfilmentReportSchema.parse(report)).not.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('drops an obligation whose citation is not a line of the stated intent', async () => {
    const root = await createRepository()

    try {
      const agents = scriptedAgents({
        obligations: [
          { origin: 'inbox:tracker/A-1', line: 1, statement: 'Reject old tokens.' },
          // A line nobody wrote, and an origin that was never gathered. Neither can
          // be reported: spec 23 says an obligation the reviewer inferred rather
          // than read is not an obligation.
          { origin: 'inbox:tracker/A-1', line: 99, statement: 'Invented.' },
          { origin: 'inbox:nowhere', line: 1, statement: 'Also invented.' }
        ],
        judgements: [{ status: 'unaddressed' }]
      })
      const report = await run(root, { agents })

      expect(report.obligations.map((obligation) => obligation.statement)).toEqual([
        'Reject old tokens.'
      ])
      expect(report.summary.uncitedObligationCount).toBe(2)
      expect(report.warnings).toContain(
        '2 proposed obligation(s) did not cite a line of the stated intent and were not reported.'
      )
      // Only the surviving obligation was judged: a dropped one costs no call.
      expect(agents.judgementPackets).toEqual([
        { obligation: 'Reject old tokens.' }
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('downgrades an addressed verdict that cites nothing the change touched, and counts it', async () => {
    const root = await createRepository()

    try {
      const report = await run(root, {
        agents: scriptedAgents({
          obligations: [
            {
              origin: 'inbox:tracker/A-1',
              line: 1,
              statement: 'Reject old tokens.'
            }
          ],
          judgements: [
            {
              status: 'addressed',
              evidence: [{ path: 'src/token.ts', line: 1 }]
            }
          ]
        })
      })

      // Line 1 of that file exists but the change did not touch it. Spec 23 names
      // the unevidenced satisfaction claim as the single most harmful output this
      // capability can produce, so it becomes `undetermined` rather than a
      // satisfaction claim with a decorative citation.
      expect(report.obligations[0]?.status).toBe('undetermined')
      expect(report.summary.unevidencedAddressedCount).toBe(1)
      expect(report.summary.addressedCount).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports extra scope neutrally, with no severity and no verdict', async () => {
    const root = await createRepository()

    try {
      const report = await run(root, {
        agents: scriptedAgents({
          obligations: [
            {
              origin: 'inbox:tracker/A-1',
              line: 1,
              statement: 'Reject old tokens.'
            }
          ],
          judgements: [
            {
              status: 'addressed',
              evidence: [{ path: 'src/token.ts', line: 2 }]
            }
          ]
        })
      })

      // `src/unrelated.ts` changed and no obligation cites it. Spec 23: "Extra
      // scope is reported neutrally. A change doing more than the ticket asked is
      // a normal and often desirable event, not a defect."
      expect(report.extraScope).toEqual([
        // 2, not 1: the file's added line plus the line the change removed.
        // Removed lines joined the change surface with spec 23's 2026-07-30
        // amendment, and extra scope counts the whole surface for a file.
        { path: 'src/unrelated.ts', changedLineCount: 2 }
      ])
      expect(report.summary.extraScopeFileCount).toBe(1)
      for (const entry of report.extraScope) {
        expect(Object.keys(entry)).toEqual(['path', 'changedLineCount'])
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports absent intent plainly rather than as an empty mapping', async () => {
    const root = await createRepository()

    try {
      await rm(join(root, '.codereviewer', 'context', 'ticket.md'))
      const emptyInbox = await run(root, {
        agents: scriptedAgents({ obligations: [], judgements: [] })
      })
      const noSources = await run(root, {
        config: configWith({ contextSources: { enabled: false } }),
        agents: scriptedAgents({ obligations: [], judgements: [] })
      })

      expect(emptyInbox.status).toBe('no-intent')
      expect(emptyInbox.warnings).toContain(
        'The configured change-intent sources produced no text, so there is no stated intent to check the change against.'
      )
      expect(noSources.status).toBe('no-intent')
      expect(noSources.warnings).toContain(
        'No change-intent source is configured, so there is no stated intent to check the change against. Configure contextSources to supply one.'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports unusable intent when nothing checkable can be read from it', async () => {
    const root = await createRepository()

    try {
      const report = await run(root, {
        agents: scriptedAgents({ obligations: [], judgements: [] })
      })

      expect(report.status).toBe('unusable-intent')
      expect(report.scope.intentOrigins).toEqual(['inbox:tracker/A-1'])
      expect(report.warnings).toContain(
        'No checkable obligation could be read from the stated intent. A short or purely descriptive intent is the ordinary reason.'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports a missing model plainly instead of failing', async () => {
    const root = await createRepository()

    try {
      const report = await run(root)

      expect(report.status).toBe('provider-unavailable')
      expect(report.warnings).toContain(
        'Intent-fulfilment review is enabled but no model was available to read the stated intent; no obligations were extracted.'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a failed judgement leaves the obligation reported as undetermined', async () => {
    const root = await createRepository()

    try {
      const agents = scriptedAgents({
        obligations: [
          { origin: 'inbox:tracker/A-1', line: 1, statement: 'Reject old tokens.' }
        ],
        judgements: []
      })
      const report = await run(root, {
        agents: {
          ...agents,
          judge: async () => {
            throw new Error('provider outage')
          }
        }
      })

      // Dropping it would hide an obligation the intent does state; asserting
      // anything about it would be a claim made on the strength of a failed call.
      expect(report.status).toBe('completed')
      expect(report.obligations[0]?.status).toBe('undetermined')
      expect(report.warnings).toContain(
        '1 judgement call(s) did not complete; those obligations are reported as undetermined.'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a failed explanation costs the prose and nothing else', async () => {
    const root = await createRepository()

    try {
      const agents = scriptedAgents({
        obligations: [
          { origin: 'inbox:tracker/A-1', line: 1, statement: 'Reject old tokens.' }
        ],
        judgements: [{ status: 'unaddressed' }]
      })
      const report = await run(root, {
        agents: {
          ...agents,
          explain: async () => {
            throw new Error('provider outage')
          }
        }
      })

      expect(report.status).toBe('completed')
      expect(report.obligations).toHaveLength(1)
      expect(report.explanation).toBeUndefined()
      expect(report.warnings).toContain(
        'The explanation call did not complete; the mapping is reported without it.'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('bounds the obligations it reports and judges', async () => {
    const root = await createRepository()

    try {
      const agents = scriptedAgents({
        obligations: [
          { origin: 'inbox:tracker/A-1', line: 1, statement: 'First.' },
          { origin: 'inbox:tracker/A-1', line: 2, statement: 'Second.' }
        ],
        judgements: [{ status: 'unaddressed' }, { status: 'unaddressed' }]
      })
      const report = await run(root, {
        config: configWith({ intentFulfilment: { enabled: true, maxObligations: 1 } }),
        agents
      })

      expect(report.summary.obligationCount).toBe(1)
      expect(report.summary.obligationsTruncated).toBe(true)
      // The bound is a SPEND bound, so it has to cut calls and not only report
      // entries.
      expect(agents.judgementPackets).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('the report schema carries no finding, severity, or gate field', () => {
    // The distinction the whole capability rests on: a mapping is NOT a finding.
    // Spec 23 forbids this command from failing a pipeline on fulfilment grounds,
    // and anything below appearing in the schema would misrepresent that.
    const shape = Object.keys(IntentFulfilmentReportSchema.shape)

    expect(shape).toEqual([
      'schemaVersion',
      'status',
      'generatedAt',
      'scope',
      'summary',
      'obligations',
      'extraScope',
      'explanation',
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
  })
})
