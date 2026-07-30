// THE ACCEPTANCE BAR for spec 24's adjudication layer, end to end: repository
// intake, deterministic peer derivation, packet construction, the real
// `adjudicate_conformance` harness agent, verdict normalization, and the report.
//
// Hermetic and free. The provider is a scripted `ModelProvider` — no network, no
// spend, no run-to-run variation.
//
// WHAT THE TWO CONTROLS ARE
//
//   Negative — the two divergences this repository actually produces ("4 of 7 call
//   `string`", "4 of 7 call `min`"). Both MUST be rejected and absent from the
//   report.
//
//   Positive — a handler that belongs to its group and dropped the group's
//   authorization check. It MUST survive and be reported.
//
// THE POSITIVE CONTROL IS THE ONE THAT MATTERS. A layer that answers "incidental"
// to everything removes the negative control perfectly and is worth nothing, so
// this file also proves that neither control can pass vacuously:
//
//   - with the layer BYPASSED, all three divergences are present, so the negative
//     control is genuinely being filtered rather than never produced;
//   - with a REJECT-EVERYTHING adjudicator, the positive control disappears, so its
//     survival is a real signal and not something any layer passes;
//   - with an ALWAYS-UNDETERMINED adjudicator, nothing is reported either, so
//     `undetermined` is not quietly read as a violation.
//
// WHAT THE SCRIPTED ADJUDICATOR PROVES, AND WHAT IT DOES NOT
//
// It is a stand-in that decides from ONE generic feature of the packet: whether a
// majority of the peers use the divergent symbol inside a conditional. It never
// looks at a path, a declaration name, or anything identifying which fixture it is
// judging, and the SAME function judges all three divergences.
//
// So these tests prove two things: the packet carries enough for a case-blind rule
// to separate a check from a construction call, and the wiring reports exactly the
// `convention` verdicts and nothing else. They do NOT prove that a real model
// answers this way — that is a model property, and measuring it needs the provider
// that this suite deliberately does not call. Nor is the stand-in's rule a proposal:
// "the peers guard with it" is not what makes every convention a convention, and a
// released lock or a closed handle is no less one for being unconditional.

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
import type {
  JsonValue,
  ModelMessage,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import {
  handlerPositiveControl,
  schemaBuilderNegativeControl,
  type ConformanceControlFixture
} from '../../shared/testing/conformance-control-fixtures.js'
import type { GitCommandRunner } from '../repository-intake/index.js'
import { modelConformanceAdjudicationInstructions } from './adjudication-instructions.js'
import {
  ConformanceAdjudicationInputSchema,
  type ConformanceAdjudicationInput,
  type ConformanceAdjudicationRunner
} from './conformance-adjudication.js'
import { createHarnessConformanceAdjudicator } from './conformance-adjudication-agent.js'
import type { InvariantConformanceReport } from './conformance-report.js'
import { runInvariantConformance } from './conformance-run.js'
import { describeDeclarationTrait } from '../declaration-analysis/declaration-shape.js'

const mergeBaseSha = '9f1c2ab3d4e5f60718293a4b5c6d7e8f90a1b2c3'
const generatedAt = new Date('2026-07-30T00:00:00.000Z')

const adjudicatedConfig = CodeReviewerConfigSchema.parse({
  invariantConformance: {
    enabled: true,
    adjudication: { enabled: true, maxAdjudications: 25 }
  }
})

const deterministicConfig = CodeReviewerConfigSchema.parse({
  invariantConformance: { enabled: true }
})

const createdRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

const createRepository = async (
  fixture: ConformanceControlFixture
): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-conformance-control-'))

  createdRoots.push(root)

  for (const file of fixture.files) {
    const absolutePath = path.join(root, ...file.path.split('/'))

    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, file.content)
  }

  return root
}

// Scripted git, so intake runs without a real repository. Every command answered
// here is one intake is allowed to issue.
const gitFor = (fixture: ConformanceControlFixture): GitCommandRunner => {
  const outputs: Record<string, string> = {
    'merge-base main HEAD': `${mergeBaseSha}\n`,
    [`diff --name-status ${mergeBaseSha} HEAD`]: `${fixture.changedPaths
      .map((changedPath) => `M\t${changedPath}`)
      .join('\n')}\n`
  }

  // Intake asks for every changed path in one `diff`, so the scripted answer is one
  // multi-file patch. Each hunk covers the whole file, which is what makes every
  // declaration in a changed file change-attributed.
  outputs[
    `diff --unified=0 ${mergeBaseSha} HEAD -- ${fixture.changedPaths.join(' ')}`
  ] = fixture.changedPaths
    .map((changedPath) => {
      const file = fixture.files.find((entry) => entry.path === changedPath)
      const lineCount = (file?.content ?? '').split('\n').length

      return (
        `diff --git a/${changedPath} b/${changedPath}\n` +
        `--- a/${changedPath}\n+++ b/${changedPath}\n` +
        `@@ -1,1 +1,${lineCount} @@\n-const old = 1\n` +
        '+replaced\n'.repeat(lineCount)
      )
    })
    .join('')

  return async (args) => {
    const output = outputs[args.join(' ')]

    if (output === undefined) {
      throw new Error(`Unexpected git command: ${args.join(' ')}`)
    }

    return output
  }
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
        .map((entry) => (directory === '.' ? entry.name : `${directory}/${entry.name}`))
    } catch {
      return []
    }
  }
})

const runControl = async (input: {
  readonly fixture: ConformanceControlFixture
  readonly adjudicate?: ConformanceAdjudicationRunner
}): Promise<InvariantConformanceReport> => {
  const root = await createRepository(input.fixture)

  return runInvariantConformance({
    repositoryRoot: root,
    config: input.adjudicate === undefined ? deterministicConfig : adjudicatedConfig,
    baseRef: 'main',
    headRef: 'HEAD',
    generatedAt,
    ...createSeams(root),
    runGit: gitFor(input.fixture),
    ...(input.adjudicate === undefined ? {} : { adjudicate: input.adjudicate })
  })
}

const statementsOf = (report: InvariantConformanceReport): readonly string[] =>
  [...report.changeAttributedDivergences, ...report.preExistingDivergences]
    .map((divergence) => divergence.statement)
    .sort()

const packetFromMessages = (
  messages: readonly ModelMessage[]
): ConformanceAdjudicationInput => {
  const userMessage = [...messages].reverse().find((message) => message.role === 'user')

  if (userMessage === undefined || typeof userMessage.content !== 'string') {
    throw new Error('scripted adjudicator: no serialized packet in the prompt')
  }

  return ConformanceAdjudicationInputSchema.parse(JSON.parse(userMessage.content))
}

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }

/**
 * The case-blind stand-in.
 *
 * One rule, over one packet feature: a trait a majority of the peers use inside a
 * conditional is a check they perform as part of their role; a trait they only ever
 * call while constructing something is how that thing is ordinarily built. It reads
 * no path and no name, and cannot tell which fixture it is judging.
 */
class ScriptedAdjudicatorProvider implements ModelProvider {
  readonly id = 'scripted-adjudicator'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(request)

    const packet = packetFromMessages(request.messages)

    if (packet.sharedPeerTraits.length === 0) {
      return this.answer<T>(
        'undetermined',
        'The peers share nothing else, so there is no role to read the trait against.'
      )
    }

    const usedAsCheck = packet.sharedPeerTraits.includes(
      describeDeclarationTrait({ kind: 'guard', name: packet.trait.symbol })
    )

    return usedAsCheck
      ? this.answer<T>(
          'convention',
          'A majority of the siblings use it as a condition before doing their work.'
        )
      : this.answer<T>(
          'incidental',
          'The siblings only ever call it while constructing a value.'
        )
  }

  private answer<T extends JsonValue>(
    verdict: string,
    reason: string
  ): ObjectResponse<T> {
    return {
      object: { verdict, reason } as unknown as T,
      finishReason: 'stop',
      usage
    }
  }
}

// A provider that answers one fixed verdict whatever it is shown. Both shapes are
// the ones a useless layer would have: one rejects everything, the other decides
// nothing.
class FixedVerdictProvider implements ModelProvider {
  readonly id = 'fixed-verdict'
  readonly genAiSystem = 'scripted'
  callCount = 0

  constructor(
    private readonly verdict: string,
    private readonly reason: string
  ) {}

  async object<T extends JsonValue = JsonValue>(
    _request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.callCount += 1

    return {
      object: { verdict: this.verdict, reason: this.reason } as unknown as T,
      finishReason: 'stop',
      usage
    }
  }
}

const adjudicatorFor = (provider: ModelProvider) =>
  createHarnessConformanceAdjudicator({
    modelAlias: { provider, model: 'scripted', capabilities: ['object'] }
  })

describe('conformance adjudication control tests', () => {
  // NON-VACUITY, both directions. With the adjudication layer bypassed the
  // deterministic core produces all three divergences, so the assertions below are
  // about a filter doing something rather than about a fixture producing nothing.
  test('bypassed, the deterministic arm produces all three control divergences', async () => {
    const negative = await runControl({ fixture: schemaBuilderNegativeControl })
    const positive = await runControl({ fixture: handlerPositiveControl })

    expect(statementsOf(negative)).toEqual([
      ...schemaBuilderNegativeControl.expectedStatements
    ])
    expect(statementsOf(positive)).toEqual([
      ...handlerPositiveControl.expectedStatements
    ])
    // The baseline arm judges nothing, and says so.
    expect(negative.summary.adjudication.mode).toBe('deterministic')
    expect(negative.usage).toBeUndefined()
    for (const divergence of negative.changeAttributedDivergences) {
      expect(divergence.adjudication).toBeUndefined()
    }
  })

  test('NEGATIVE CONTROL: this repository own two divergences are rejected', async () => {
    const provider = new ScriptedAdjudicatorProvider()
    const adjudicator = adjudicatorFor(provider)

    try {
      const report = await runControl({
        fixture: schemaBuilderNegativeControl,
        adjudicate: adjudicator.adjudicate
      })

      expect(report.changeAttributedDivergences).toEqual([])
      expect(report.preExistingDivergences).toEqual([])
      expect(statementsOf(report)).toEqual([])
      // And the report says why it is empty, rather than reading as "the change
      // conforms".
      expect(report.summary.adjudication).toEqual({
        mode: 'model',
        requestedCount: 2,
        conventionCount: 0,
        incidentalCount: 2,
        undeterminedCount: 0,
        failedCount: 0,
        unadjudicatedCount: 0
      })
      expect(report.summary.changeAttributedDivergenceCount).toBe(0)
      // One call per divergence, and no tool offered to any of them.
      expect(provider.requests.length).toBe(2)
      for (const request of provider.requests) {
        expect(request.tools ?? []).toEqual([])
      }
    } finally {
      await adjudicator.shutdown()
    }
  })

  test('POSITIVE CONTROL: the handler that dropped its guard survives and is reported', async () => {
    const provider = new ScriptedAdjudicatorProvider()
    const adjudicator = adjudicatorFor(provider)

    try {
      const report = await runControl({
        fixture: handlerPositiveControl,
        adjudicate: adjudicator.adjudicate
      })

      expect(
        report.changeAttributedDivergences.map((divergence) => [
          divergence.declaration.name,
          divergence.statement,
          divergence.adjudication?.verdict,
          divergence.citedPeers.map((peer) => peer.name)
        ])
      ).toEqual([
        [
          'ExportUsers',
          '3 of 3 sibling declarations call requireAuth; ExportUsers does not.',
          'convention',
          ['ListUsers', 'GetUser', 'DeleteUser']
        ]
      ])
      expect(report.summary.adjudication).toEqual({
        mode: 'model',
        requestedCount: 1,
        conventionCount: 1,
        incidentalCount: 0,
        undeterminedCount: 0,
        failedCount: 0,
        unadjudicatedCount: 0
      })
      // The surviving divergence still carries its evidence, unaltered.
      expect(report.changeAttributedDivergences[0]?.citedPeerCount).toBe(3)
      expect(report.changeAttributedDivergences[0]?.adjudication?.reason).toContain(
        'condition'
      )
    } finally {
      await adjudicator.shutdown()
    }
  })

  // The test that makes the positive control mean something. A layer that rejects
  // everything passes the negative control perfectly, and this is what it costs.
  test('a reject-everything adjudicator fails the positive control', async () => {
    const provider = new FixedVerdictProvider('incidental', 'Not a practice.')
    const adjudicator = adjudicatorFor(provider)

    try {
      const report = await runControl({
        fixture: handlerPositiveControl,
        adjudicate: adjudicator.adjudicate
      })

      expect(provider.callCount).toBe(1)
      expect(report.changeAttributedDivergences).toEqual([])
      expect(report.summary.adjudication.incidentalCount).toBe(1)
    } finally {
      await adjudicator.shutdown()
    }
  })

  test('undetermined is recorded as undetermined and never reported as a divergence', async () => {
    const provider = new FixedVerdictProvider(
      'undetermined',
      'The material does not let me decide.'
    )
    const adjudicator = adjudicatorFor(provider)

    try {
      const report = await runControl({
        fixture: handlerPositiveControl,
        adjudicate: adjudicator.adjudicate
      })

      expect(report.changeAttributedDivergences).toEqual([])
      expect(report.preExistingDivergences).toEqual([])
      expect(report.summary.adjudication.undeterminedCount).toBe(1)
      expect(report.summary.adjudication.conventionCount).toBe(0)
      // Nowhere in the serialized report does the word appear as anything but a
      // count: there is no entry it could have been written into.
      expect(JSON.stringify(report)).not.toContain('"verdict"')
    } finally {
      await adjudicator.shutdown()
    }
  })

  test('the agent sends the reviewed instructions verbatim, as its system message', async () => {
    const provider = new ScriptedAdjudicatorProvider()
    const adjudicator = adjudicatorFor(provider)

    try {
      await runControl({
        fixture: handlerPositiveControl,
        adjudicate: adjudicator.adjudicate
      })

      const systemMessages = (provider.requests[0]?.messages ?? []).filter(
        (message) => message.role === 'system'
      )

      expect(
        systemMessages.some(
          (message) =>
            typeof message.content === 'string' &&
            message.content.includes(modelConformanceAdjudicationInstructions)
        )
      ).toBe(true)
    } finally {
      await adjudicator.shutdown()
    }
  })
})
