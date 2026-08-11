// End-to-end coverage of `intent check` over a REAL git repository. It stays
// hermetic and free: the command makes no provider call unless one is configured,
// and the tests that configure one hand in a SCRIPTED provider, so nothing here
// costs money or varies run to run. Git is used rather than a scripted runner
// because the CLI deliberately exposes no git seam — intake owns git, and the
// point of this file is to exercise the command exactly as a user runs it.
//
// It carries spec 23's two exit-code rows: "Cannot fail a pipeline on fulfilment
// grounds" and "Absent intent reports plainly and exits successfully".
import { execFileSync } from 'node:child_process'
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type {
  JsonValue,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import type { IntentFulfilmentReport } from '../domains/intent-fulfilment/index.js'
import { runCli } from './index.js'

const git = (root: string, args: readonly string[]): void => {
  execFileSync('git', [...args], { cwd: root, stdio: 'pipe' })
}

const writeConfig = async (
  root: string,
  intentFulfilment: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): Promise<void> => {
  await mkdir(join(root, '.codereviewer'), { recursive: true })
  await writeFile(
    join(root, '.codereviewer', 'config.json'),
    JSON.stringify(
      {
        intentFulfilment,
        contextSources: {
          enabled: true,
          providers: [{ type: 'inbox', dir: '.codereviewer/context' }]
        },
        ...extra
      },
      null,
      2
    )
  )
}

const writeTicket = async (root: string, body: string): Promise<void> => {
  await mkdir(join(root, '.codereviewer', 'context'), { recursive: true })
  await writeFile(
    join(root, '.codereviewer', 'context', 'ticket.md'),
    ['---', 'source: tracker', 'id: A-1', 'title: Reject tokens', '---', body, ''].join(
      '\n'
    )
  )
}

// Answers each of the three agents from the shape of the schema it was asked for,
// and records the requests. Enough to prove the command reached the model lane and
// honoured its answers; what a real model answers is measured by the domain's own
// suite and, ultimately, by a live run.
class ScriptedIntentProvider implements ModelProvider {
  readonly id = 'scripted-intent'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  constructor(private readonly judgement: JsonValue) {}

  async object<T extends JsonValue = JsonValue>(
    request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(request as ObjectRequest)

    const properties = Object.keys(
      (request.schema as { properties?: Record<string, unknown> }).properties ?? {}
    )
    const answer = properties.includes('obligations')
      ? {
          obligations: [
            {
              origin: 'inbox:tracker/A-1',
              line: 1,
              statement: 'Reject tokens older than five minutes.'
            }
          ]
        }
      : properties.includes('explanation')
        ? { explanation: 'The mapping above is what the change covers.' }
        : this.judgement

    return {
      object: answer as unknown as T,
      finishReason: 'stop',
      usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 }
    }
  }
}

// A base commit and a head commit that changes one file.
const buildRepositoryTemplate = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'codereviewer-intent-cli-template-'))

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src', 'token.ts'),
    'export const rejectExpired = () => true\n'
  )

  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'base'])

  await writeFile(
    join(root, 'src', 'token.ts'),
    'export const rejectExpired = (age: number) => age > 300\n'
  )
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'reject expired tokens'])

  return root
}

// Building the template costs several `git` spawns, and a spawn from a vitest
// worker is an order of magnitude more expensive than one from a bare node
// process. Paying it once per file and copying the directory per test keeps every
// test on its own writable repository while keeping the suite well clear of the
// timeout under parallel worker load.
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

  const root = await mkdtemp(join(tmpdir(), 'codereviewer-intent-cli-'))

  await cp(repositoryTemplate, root, { recursive: true })

  return root
}

const parseReport = (stdout: string): IntentFulfilmentReport =>
  JSON.parse(stdout) as IntentFulfilmentReport

const check = (
  root: string,
  options: Parameters<typeof runCli>[1] = { cwd: root, environment: {} }
) =>
  runCli(['intent', 'check', '--base-ref', 'main~1', '--head-ref', 'HEAD'], options)

// Every test here drives the real CLI over a real repository on disk, so it is
// bound by process spawns and filesystem work. The default 5s timeout leaves too
// little headroom on a loaded machine; the raise is scoped to this suite so the
// rest of the run keeps failing fast.
describe('intent CLI', { timeout: 20_000 }, () => {
  test('rejects a subcommand other than check', async () => {
    const result = await runCli(['intent', 'run'], {
      cwd: '/repo',
      environment: {}
    })

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr).message).toBe('Expected command: intent check')
  })

  // The lane became ON by default on 2026-08-11, so the switch is written out
  // here. What this test pins is unchanged: an operator who turns the lane OFF
  // gets `disabled` and exit 0 — distinct from `no-intent`, which is the lane
  // running and finding nothing to hold the change to.
  test('reports disabled, and exits 0, when the capability is switched off', async () => {
    const root = await createRepository()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({ intentFulfilment: { enabled: false } })
      )

      const result = await check(root)

      expect(result.exitCode).toBe(0)
      expect(parseReport(result.stdout).status).toBe('disabled')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports absent intent plainly and exits 0', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true })
      const result = await check(root)
      const report = parseReport(result.stdout)

      // Spec 23: "The command MUST handle absent or unusable intent by reporting
      // that plainly and exiting successfully. Most changes will have thin
      // descriptions."
      expect(result.exitCode).toBe(0)
      expect(report.status).toBe('no-intent')
      expect(report.obligations).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports a missing provider plainly and exits 0', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true })
      await writeTicket(root, 'Reject tokens older than five minutes.')
      const result = await check(root)

      expect(result.exitCode).toBe(0)
      expect(parseReport(result.stdout).status).toBe('provider-unavailable')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('maps the stated intent onto the change and accounts what it cost', async () => {
    const root = await createRepository()

    try {
      await writeConfig(
        root,
        { enabled: true },
        { provider: { id: 'openai', model: 'sentinel-model' } }
      )
      await writeTicket(root, 'Reject tokens older than five minutes.')
      const provider = new ScriptedIntentProvider({
        status: 'evidenced',
        evidence: [{ path: 'src/token.ts', line: 1 }]
      })
      const result = await check(root, {
        cwd: root,
        environment: { OPENAI_API_KEY: 'sk-test' },
        providerImport: async () => ({ openai: () => provider })
      })
      const report = parseReport(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(report.status).toBe('completed')
      expect(report.scope.intentOrigins).toEqual(['inbox:tracker/A-1'])
      expect(
        report.obligations.map((obligation) => [
          obligation.status,
          obligation.source.origin,
          obligation.source.line,
          obligation.status === 'evidenced'
            ? obligation.evidence.map(
                (citation) => `${citation.path}:${citation.line}`
              )
            : []
        ])
      ).toEqual([
        ['evidenced', 'inbox:tracker/A-1', 1, ['src/token.ts:1']]
      ])
      expect(report.explanation).toBe(
        'The mapping above is what the change covers.'
      )
      // Only reachable if the command actually handed the scripted factory to the
      // lane instead of importing the real SDK provider. THREE calls: extraction,
      // one judgement, explanation.
      //
      // The count is load-bearing in the other direction now. A fourth call was a
      // citation-aptness check on each `evidenced` verdict, measured and removed —
      // it suppressed five correct verdicts per wrong one caught. This assertion is
      // what makes reintroducing a per-obligation call a visible cost rather than a
      // silent one.
      expect(provider.requests).toHaveLength(3)
      expect(report.usage?.inputTokens).toBeGreaterThan(0)
      // No tool is offered: this capability judges a change it was handed, it does
      // not search a repository.
      for (const request of provider.requests) {
        expect(request.tools ?? []).toEqual([])
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The exit code is the load-bearing part of this capability's honesty, and spec
  // 23 states it as a requirement rather than a default: the command MUST NOT be
  // able to fail a pipeline on fulfilment grounds, and that is not configurable.
  // Every report shape is driven through the command here.
  test('exits 0 for every report shape it can produce, including an intent nothing evidences', async () => {
    const root = await createRepository()

    try {
      const disabled = await check(root)

      await writeConfig(
        root,
        { enabled: true },
        { provider: { id: 'openai', model: 'sentinel-model' } }
      )
      await writeTicket(root, 'Reject tokens older than five minutes.')
      const notEvidenced = await check(root, {
        cwd: root,
        environment: { OPENAI_API_KEY: 'sk-test' },
        providerImport: async () => ({
          openai: () => new ScriptedIntentProvider({ status: 'not-evidenced' })
        })
      })

      expect(disabled.exitCode).toBe(0)
      expect(notEvidenced.exitCode).toBe(0)
      // Nothing in the change evidences the only stated obligation, which is the
      // strongest case a gate would want to fail on. It still exits 0.
      expect(parseReport(notEvidenced.stdout).summary.notEvidencedStatusCount).toBe(1)
      expect(parseReport(notEvidenced.stdout).summary.evidencedCount).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // A report a reviewer has to go looking for is not in the workflow they use.
  // `review` writes `report.md` into a run directory; this puts the mapping in the
  // same place, and names it so the two schemas can never be confused.
  test('writes a rendered mapping into a run directory, and names it on stderr', async () => {
    const root = await createRepository()

    try {
      await writeConfig(
        root,
        { enabled: true },
        { provider: { id: 'openai', model: 'sentinel-model' } }
      )
      await writeTicket(root, 'Reject tokens older than five minutes.')
      const result = await check(root, {
        cwd: root,
        environment: { OPENAI_API_KEY: 'sk-test' },
        providerImport: async () => ({
          openai: () => new ScriptedIntentProvider({ status: 'not-evidenced' })
        })
      })

      const runDirectories = await readdir(join(root, '.codereviewer', 'runs'))
      expect(runDirectories).toHaveLength(1)
      expect(runDirectories[0]).toMatch(/^intent-/u)

      const markdown = await readFile(
        join(root, '.codereviewer', 'runs', runDirectories[0] ?? '', 'intent-report.md'),
        'utf8'
      )
      expect(markdown).toContain('# Intent Fulfilment Report')
      expect(markdown).toContain('## Not evidenced by this change (1)')

      // stdout stays exactly one JSON document: a script reading it must keep
      // working, so the artifact path goes to stderr.
      expect(() => parseReport(result.stdout)).not.toThrow()
      expect(result.stderr).toContain(
        `.codereviewer/runs/${runDirectories[0]}/intent-report.md`
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // `no-intent` is the ORDINARY outcome for most changes. A run directory per
  // invocation for a capability that is off by default, and that nothing ever
  // enumerates again, would litter a repository whose owner never asked for it.
  test('an outcome that mapped nothing leaves no run directory behind', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true })
      const result = await check(root)

      expect(parseReport(result.stdout).status).toBe('no-intent')
      await expect(readdir(join(root, '.codereviewer', 'runs'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('--format markdown puts the rendered mapping on stdout instead of JSON', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true })
      const result = await runCli(
        ['intent', 'check', '--base-ref', 'main~1', '--head-ref', 'HEAD', '--format', 'markdown'],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('# Intent Fulfilment Report')
      expect(result.stdout).toContain('## Nothing was mapped')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects a format it does not implement rather than ignoring it', async () => {
    const root = await createRepository()

    try {
      const result = await runCli(
        ['intent', 'check', '--format', 'html'],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--format must be one of json, markdown')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('maps an unresolvable ref to the repository exit code, not to a report', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true })
      const result = await runCli(
        ['intent', 'check', '--base-ref', 'no-such-ref', '--head-ref', 'HEAD'],
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
      // A `blocking` key is the one a user reaching for a gate would try. Spec 23
      // makes advisory-only non-configurable, so the schema rejects it rather than
      // accepting a setting that does nothing.
      await writeConfig(root, { enabled: true, blocking: true })
      const result = await check(root)

      expect(result.exitCode).toBe(2)
      expect(result.stdout).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
