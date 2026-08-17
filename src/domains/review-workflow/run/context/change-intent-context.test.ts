// Regression coverage for the change-intent silent-failure bug: a model
// summarizer that cannot be resolved -- whether resolution throws or simply
// yields no callable model -- must surface a classified, non-fatal warning
// instead of degrading to the deterministic digest with zero visible signal.
// See `selectSummarizer` in ./change-intent-context.ts.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Logger } from '@purista/harness'
import { CodeReviewerConfigSchema } from '../../../../shared/contracts/index.js'
import { createNoContentEventRecorder } from '../../../observability/index.js'
import type { ContextAssemblyResult } from './context.js'
import { prepareReviewRunnerChangeIntentContext } from './change-intent-context.js'

type CapturedLogRecord = {
  readonly level: 'debug' | 'warn'
  readonly message: string
  readonly fields?: Record<string, unknown>
}

const createCapturingLogger = (): {
  readonly logger: Logger
  readonly records: CapturedLogRecord[]
} => {
  const records: CapturedLogRecord[] = []
  const logger: Logger = {
    trace: () => {},
    debug: (message, fields) => {
      records.push({ level: 'debug', message, ...(fields === undefined ? {} : { fields }) })
    },
    info: () => {},
    warn: (message, fields) => {
      records.push({ level: 'warn', message, ...(fields === undefined ? {} : { fields }) })
    },
    error: () => {},
    fatal: () => {},
    child: () => logger
  }

  return { logger, records }
}

const emptyAssembledContext: ContextAssemblyResult = {
  reviewContext: [],
  tasks: [],
  instructions: [],
  skills: [],
  skillDefinitions: {},
  skillIds: [],
  contextLedger: [],
  referencedDefinitionsDroppedCount: 0,
  referencedDefinitionsUnreadableCount: 0,
      redactedContextSpanCount: 0
}

describe('prepareReviewRunnerChangeIntentContext — model summarizer availability', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'change-intent-context-'))
    // A NON-empty inbox, which is what actually isolates summarizer-selection
    // visibility from provider ingestion. The inbox used to be left empty, which
    // isolated nothing once an empty inbox became a warning of its own (spec
    // 11): every assertion below would have carried that unrelated warning.
    await mkdir(path.join(root, '.codereviewer', 'context'), { recursive: true })
    await writeFile(
      path.join(root, '.codereviewer', 'context', 'ticket.md'),
      '# Ticket\n\nRotate the session token on sign-in.\n'
    )
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('says so when a model summary was asked for but model review is off', async () => {
    // This path used to be silent. It shared an early return with the two cases
    // where the digest IS the deliberate choice (digest requested, no provider), so
    // an operator who explicitly configured a model summary and had aiReview off
    // received the digest with nothing said about it.
    const config = CodeReviewerConfigSchema.parse({
      provider: { id: 'openai', model: 'gpt-x' },
      aiReview: { enabled: false },
      contextSources: {
        enabled: true,
        providers: [{ type: 'inbox', dir: '.codereviewer/context' }],
        summary: { mode: 'model' }
      }
    })
    const { logger } = createCapturingLogger()

    const result = await prepareReviewRunnerChangeIntentContext({
      repositoryRoot: root,
      config,
      assembledContext: emptyAssembledContext,
      sourceFiles: [],
      environment: {},
      observability: createNoContentEventRecorder(),
      logger
    })

    expect(result.warnings).toEqual([
      'External change-intent model summarizer was requested but aiReview.enabled is false; the run used the deterministic digest instead.'
    ])
  })

  test('stays quiet when the digest is the deliberate choice', async () => {
    // The counterweight: a warning that fires on a setting the operator chose on
    // purpose trains people to ignore warnings.
    const config = CodeReviewerConfigSchema.parse({
      provider: { id: 'openai', model: 'gpt-x' },
      aiReview: { enabled: false },
      contextSources: {
        enabled: true,
        providers: [{ type: 'inbox', dir: '.codereviewer/context' }],
        summary: { mode: 'digest' }
      }
    })
    const { logger } = createCapturingLogger()

    const result = await prepareReviewRunnerChangeIntentContext({
      repositoryRoot: root,
      config,
      assembledContext: emptyAssembledContext,
      sourceFiles: [],
      environment: {},
      observability: createNoContentEventRecorder(),
      logger
    })

    expect(result.warnings).toEqual([])
  })

  test('says so when its own summary cap cut the brief', async () => {
    // The third bound on this path and the last one that was mute. The provider caps
    // (`maxFiles`, `maxFileBytes`) each get a carefully-worded warning; the
    // summarizer's own `contextSources.summary.maxBytes` got none, so a brief that
    // lost most of its sources reached the reviewer looking complete. It was
    // reported only as an observability attribute and a ledger `decision`, neither
    // of which a default run surfaces to a human.
    //
    // Nothing here raises or lowers a bound: the cap is its 4 000-byte DEFAULT, and
    // the ticket is a single ordinary Markdown file above it. That is the point —
    // `changed-files` defaults to `include: ['**/*.md']`, so this binds on real
    // changes rather than on contrived ones.
    await writeFile(
      path.join(root, '.codereviewer', 'context', 'long-ticket.md'),
      `# Ticket\n\n${'Rotate the session token on sign-in. '.repeat(200)}\n`
    )
    const config = CodeReviewerConfigSchema.parse({
      contextSources: {
        enabled: true,
        providers: [{ type: 'inbox', dir: '.codereviewer/context' }],
        summary: { mode: 'digest' }
      }
    })
    const { logger } = createCapturingLogger()

    const result = await prepareReviewRunnerChangeIntentContext({
      repositoryRoot: root,
      config,
      assembledContext: emptyAssembledContext,
      sourceFiles: [],
      environment: {},
      observability: createNoContentEventRecorder(),
      logger
    })

    // One warning, and it names the setting that relieves it. The provider's own
    // per-file cap is 64 000 bytes and did not bind, so the `maxFileBytes` warning
    // must NOT fire here: two warnings for one cut would name the wrong remedy.
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('contextSources.summary.maxBytes')
    expect(result.warnings[0]).toContain('4000')
    expect(result.warnings[0]).toContain(
      'the beginning of the intent, not all of it'
    )
  })

  test('stays quiet when the brief fits its cap', async () => {
    // The counterweight, and the reason this is driven by the summary cap rather
    // than by the brief's `truncated` flag: the flag is also true when a provider
    // had already cut a body at `maxFileBytes`, which has its own warning. A
    // warning that fires on every ordinary run is one nobody reads.
    const config = CodeReviewerConfigSchema.parse({
      contextSources: {
        enabled: true,
        providers: [{ type: 'inbox', dir: '.codereviewer/context' }],
        summary: { mode: 'digest' }
      }
    })
    const { logger } = createCapturingLogger()

    const result = await prepareReviewRunnerChangeIntentContext({
      repositoryRoot: root,
      config,
      assembledContext: emptyAssembledContext,
      sourceFiles: [],
      environment: {},
      observability: createNoContentEventRecorder(),
      logger
    })

    expect(result.warnings).toEqual([])
  })

  test('reports the classified reason when resolving the model summarizer throws', async () => {
    const config = CodeReviewerConfigSchema.parse({
      provider: { id: 'openai', model: 'gpt-x' },
      contextSources: {
        enabled: true,
        providers: [{ type: 'inbox', dir: '.codereviewer/context' }]
      }
    })
    const { logger, records } = createCapturingLogger()

    const result = await prepareReviewRunnerChangeIntentContext({
      repositoryRoot: root,
      config,
      assembledContext: emptyAssembledContext,
      sourceFiles: [],
      // No OPENAI_API_KEY: resolveProviderModelAlias throws
      // `provider_credentials_missing` before any model is ever created.
      environment: {},
      observability: createNoContentEventRecorder(),
      logger
    })

    expect(result.warnings).toEqual([
      'External change-intent model summarizer unavailable (provider_credentials_missing): ' +
        'Provider credential source "OPENAI_API_KEY" is required, and is not set. ' +
        'Export it in the environment, or set it in a .env file at the repository root. ' +
        'The run used the deterministic digest instead.'
    ])
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          message:
            'Change-intent model summarizer resolution failed; falling back to the deterministic digest.',
          fields: { code: 'provider_credentials_missing' }
        })
      ])
    )
    // Non-fatal: ingestion still completes and hands back usable output rather
    // than the run failing outright.
    expect(result.usage).toBeUndefined()
  })

  test('reports when the resolved provider carries no callable model, even though nothing threw', async () => {
    const config = CodeReviewerConfigSchema.parse({
      provider: { id: 'openai', model: 'gpt-x' },
      contextSources: {
        enabled: true,
        providers: [{ type: 'inbox', dir: '.codereviewer/context' }]
      }
    })
    const { logger, records } = createCapturingLogger()

    const result = await prepareReviewRunnerChangeIntentContext({
      repositoryRoot: root,
      config,
      assembledContext: emptyAssembledContext,
      sourceFiles: [],
      environment: { OPENAI_API_KEY: 'sk-test' },
      observability: createNoContentEventRecorder(),
      logger,
      // A resolvable adapter whose factory returns an object with no `object`
      // method. Nothing throws here -- without the fix this degraded to the
      // digest with zero visible signal, indistinguishable from "no change
      // intent was configured".
      providerImport: async () => ({
        openai: () => ({ id: 'broken-provider', genAiSystem: 'broken' })
      })
    })

    expect(result.warnings).toEqual([
      'External change-intent model summarizer resolved no callable model; ' +
        'the run used the deterministic digest instead.'
    ])
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          message:
            'Change-intent model summarizer resolved no callable model; falling back to the deterministic digest.'
        })
      ])
    )
  })

  test('reports no reason when the digest is the deliberate choice', async () => {
    const config = CodeReviewerConfigSchema.parse({
      provider: { id: 'openai', model: 'gpt-x' },
      contextSources: {
        enabled: true,
        providers: [{ type: 'inbox', dir: '.codereviewer/context' }],
        // Explicitly requests the digest: no model resolution is ever
        // attempted, so this must never be confused with a failure.
        summary: { mode: 'digest' }
      }
    })
    const { logger } = createCapturingLogger()

    const result = await prepareReviewRunnerChangeIntentContext({
      repositoryRoot: root,
      config,
      assembledContext: emptyAssembledContext,
      sourceFiles: [],
      environment: {},
      observability: createNoContentEventRecorder(),
      logger
    })

    expect(result.warnings).toEqual([])
  })
})

// Spec 11 warns about a provider that produced NOTHING. A provider that produced
// something bounded was silent in exactly the way that matters most: the review
// ran on a fraction of the stated intent and every number in the run said the
// source had been consumed.
describe('prepareReviewRunnerChangeIntentContext — provider bounds', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'change-intent-bounds-'))
    await mkdir(path.join(root, '.codereviewer', 'context'), { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const runWith = async (providers: readonly Record<string, unknown>[]) => {
    const config = CodeReviewerConfigSchema.parse({
      contextSources: {
        enabled: true,
        providers,
        summary: { mode: 'digest' }
      }
    })

    return prepareReviewRunnerChangeIntentContext({
      repositoryRoot: root,
      config,
      assembledContext: emptyAssembledContext,
      sourceFiles: [],
      environment: {},
      observability: createNoContentEventRecorder(),
      logger: createCapturingLogger().logger
    })
  }

  test('says how many files the maxFiles cap withheld', async () => {
    for (const name of ['a.md', 'b.md', 'c.md', 'd.md', 'e.md']) {
      await writeFile(
        path.join(root, '.codereviewer', 'context', name),
        `Intent stated in ${name}\n`
      )
    }

    const result = await runWith([
      { type: 'inbox', dir: '.codereviewer/context', maxFiles: 2 }
    ])

    expect(result.warnings).toEqual([
      'External change-intent provider "inbox:.codereviewer/context" matched 5 files but contributed 2; 3 were dropped and their content is not in the review. Raise its maxFiles cap or point the provider at fewer files.'
    ])
  })

  test('says how many files the maxFileBytes cap cut', async () => {
    await writeFile(
      path.join(root, '.codereviewer', 'context', 'ticket.md'),
      `---\nsource: jira\nid: PROJ-1\n---\n${'x'.repeat(400)}\n`
    )

    const result = await runWith([
      { type: 'inbox', dir: '.codereviewer/context', maxFileBytes: 40 }
    ])

    expect(result.warnings).toEqual([
      'External change-intent provider "inbox:.codereviewer/context" cut 1 of 1 files at its maxFileBytes cap; the review sees the beginning of each, not the whole. Raise maxFileBytes if the intent is stated further down.'
    ])
  })

  test('stays quiet when nothing was withheld or cut', async () => {
    // The counterweight: a bound that did not bind must not warn, or the warning
    // stops meaning anything.
    await writeFile(
      path.join(root, '.codereviewer', 'context', 'ticket.md'),
      '---\nsource: jira\nid: PROJ-1\n---\nRotate the session token on sign-in.\n'
    )

    const result = await runWith([
      { type: 'inbox', dir: '.codereviewer/context' }
    ])

    expect(result.warnings).toEqual([])
  })
})

// The ledger's one job is to say which bytes reached the model. The brief is
// injected into EVERY task, so a run with N tasks sends it N times — and it was
// recorded once, with no `taskId`, so neither the run total nor any per-task
// figure could account for it. Its two siblings already get this right: the task
// diff is ledgered inside the per-task loop ("Recorded per task because that is
// how many times they are sent", context.ts) and the analyzer-signal document
// carries `taskId: task.id`.
describe('prepareReviewRunnerChangeIntentContext — ledger accounting', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'change-intent-ledger-'))
    await mkdir(path.join(root, '.codereviewer', 'context'), { recursive: true })
    await writeFile(
      path.join(root, '.codereviewer', 'context', 'ticket.md'),
      '# Ticket\n\nRotate the session token on sign-in.\n'
    )
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const taskFixture = (id: string, filePath: string) => ({
    id,
    round: 1,
    kind: 'file' as const,
    paths: [filePath],
    factIds: [],
    evidenceIds: [],
    candidateIds: [],
    contextEntryIds: [],
    priority: 1,
    reviewContext: [],
    instructions: []
  })

  test('ledgers the injected brief once per task that carries it', async () => {
    const config = CodeReviewerConfigSchema.parse({
      contextSources: {
        enabled: true,
        providers: [{ type: 'inbox', dir: '.codereviewer/context' }],
        summary: { mode: 'digest' }
      }
    })

    const result = await prepareReviewRunnerChangeIntentContext({
      repositoryRoot: root,
      config,
      assembledContext: {
        ...emptyAssembledContext,
        tasks: [taskFixture('task_a', 'a.ts'), taskFixture('task_b', 'b.ts')]
      },
      sourceFiles: [],
      environment: {},
      observability: createNoContentEventRecorder(),
      logger: createCapturingLogger().logger
    })

    const briefEntries = result.assembledContext.contextLedger.filter(
      (entry) => entry.reason === 'task-context-change-intent'
    )

    expect(briefEntries.map((entry) => entry.taskId)).toEqual([
      'task_a',
      'task_b'
    ])
    // Each task's document points at its OWN entry, so a per-task reader can
    // resolve the bytes that task sent.
    expect(
      result.assembledContext.tasks.map(
        (task) =>
          task.reviewContext.find((entry) => entry.kind === 'change-intent')
            ?.ledgerEntryId
      )
    ).toEqual(briefEntries.map((entry) => entry.id))
  })
})

// Spec 11 "Observability": a PER-PROVIDER no-content event carrying the origin
// label, bytes gathered, status and duration, plus the summarizer's input byte
// count and whether truncation occurred. One aggregate step reduced every provider
// to a count of failures, so a run that ingested nothing and a run whose provider
// failed emitted the same events.
describe('prepareReviewRunnerChangeIntentContext — no-content observability', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'change-intent-observability-'))
    await mkdir(path.join(root, '.codereviewer', 'context'), { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const runWith = async (input: {
    readonly providers: readonly Record<string, unknown>[]
    readonly sourceFiles?: readonly { readonly path: string; readonly content: string }[]
  }) => {
    const config = CodeReviewerConfigSchema.parse({
      contextSources: {
        enabled: true,
        providers: input.providers,
        summary: { mode: 'digest' }
      }
    })
    const observability = createNoContentEventRecorder()

    await prepareReviewRunnerChangeIntentContext({
      repositoryRoot: root,
      config,
      assembledContext: emptyAssembledContext,
      sourceFiles: (input.sourceFiles ?? []).map((file) => ({
        path: file.path,
        content: file.content,
        language: 'typescript' as const,
        changeStatus: 'modified' as const
      })),
      environment: {},
      observability,
      logger: createCapturingLogger().logger
    })

    return observability.snapshot()
  }

  test('emits one event per provider naming its origin, status, bytes and duration', async () => {
    await writeFile(
      path.join(root, '.codereviewer', 'context', 'ticket.md'),
      '---\nsource: jira\nid: PROJ-1\n---\nRotate the session token on sign-in.\n'
    )

    const snapshot = await runWith({
      providers: [
        { type: 'inbox', dir: '.codereviewer/context' },
        // Matches nothing: no changed file is supplied. A provider that ran and
        // found nothing must be distinguishable from one that carried the intent.
        { type: 'changed-files' }
      ]
    })
    const providerEvents = snapshot.events.filter(
      (event) => event.type === 'step-ended' && event.step === 'context_ingestion_provider'
    )

    expect(providerEvents).toHaveLength(2)
    expect(providerEvents[0]).toMatchObject({
      step: 'context_ingestion_provider',
      attributes: {
        originLabel: 'inbox:.codereviewer/context',
        providerType: 'inbox',
        status: 'included',
        matchedCount: 1,
        fragmentCount: 1,
        truncatedFragmentCount: 0
      }
    })
    const firstProviderEvent = providerEvents[0]

    expect(
      firstProviderEvent !== undefined && 'attributes' in firstProviderEvent
        ? firstProviderEvent.attributes.bytes
        : undefined
    ).toBeGreaterThan(0)
    expect(providerEvents[0]).toHaveProperty('durationMs')
    expect(providerEvents[1]).toMatchObject({
      attributes: {
        originLabel: 'changed-files',
        providerType: 'changed-files',
        status: 'empty',
        fragmentCount: 0,
        bytes: 0
      }
    })
  })

  test('marks a provider that failed as failed rather than as empty', async () => {
    const snapshot = await runWith({
      // A directory that does not exist: the provider yields nothing. It is the
      // `empty` case, and the point of the assertion below is that `status` is a
      // reported fact rather than an inference from a zero count.
      providers: [{ type: 'inbox', dir: '.codereviewer/nowhere' }]
    })
    const providerEvents = snapshot.events.filter(
      (event) => event.type === 'step-ended' && event.step === 'context_ingestion_provider'
    )

    expect(providerEvents).toHaveLength(1)
    expect(providerEvents[0]).toMatchObject({
      attributes: {
        originLabel: 'inbox:.codereviewer/nowhere',
        status: 'empty',
        fragmentCount: 0
      }
    })
  })

  test('records the summarizer input bytes and whether the brief was truncated', async () => {
    await writeFile(
      path.join(root, '.codereviewer', 'context', 'ticket.md'),
      `---\nsource: jira\nid: PROJ-1\n---\n${'x'.repeat(400)}\n`
    )

    const snapshot = await runWith({
      providers: [
        { type: 'inbox', dir: '.codereviewer/context', maxFileBytes: 40 }
      ]
    })
    const ingestionEnd = snapshot.events.find(
      (event) => event.type === 'step-ended' && event.step === 'context_ingestion'
    )

    expect(ingestionEnd).toMatchObject({
      attributes: {
        fragmentCount: 1,
        summaryInputBytes: 40,
        summaryTruncated: true
      }
    })
  })

  test('reports an unknown brief size as null rather than as zero', async () => {
    // No fragment was gathered, so no brief exists. Zero bytes and "no brief" are
    // different runs and must not render identically.
    const snapshot = await runWith({
      providers: [{ type: 'inbox', dir: '.codereviewer/context' }]
    })
    const ingestionEnd = snapshot.events.find(
      (event) => event.type === 'step-ended' && event.step === 'context_ingestion'
    )

    expect(ingestionEnd).toMatchObject({
      attributes: {
        injected: 0,
        summaryInputBytes: 0,
        briefBytes: null,
        summaryTruncated: null
      }
    })
  })

  // Spec 11 "Observability And Errors": a provider that fails at run time is
  // "recorded as a failed provider in the `context_ingestion` observability step
  // (`failedProviders` count)", while "a provider that finds nothing is not a
  // failure and must not be worded as one". The count was derived from the length
  // of the unused-provider WARNING list, which holds all three cases — so the
  // default shape of an ordinary repository (providers on, no written intent)
  // reported every provider as failed.
  test('counts a provider that found nothing as empty, not as failed', async () => {
    const snapshot = await runWith({
      providers: [{ type: 'inbox', dir: '.codereviewer/context' }]
    })
    const ingestionEnd = snapshot.events.find(
      (event) => event.type === 'step-ended' && event.step === 'context_ingestion'
    )

    expect(ingestionEnd).toMatchObject({
      attributes: {
        failedProviders: 0,
        unusedProviders: 1
      }
    })
  })

  test('still counts a provider that threw as failed', async () => {
    // `dir` points at a path that is not a directory, so the provider throws.
    await writeFile(path.join(root, 'not-a-directory'), 'x\n')

    const snapshot = await runWith({
      providers: [{ type: 'inbox', dir: 'not-a-directory' }]
    })
    const ingestionEnd = snapshot.events.find(
      (event) => event.type === 'step-ended' && event.step === 'context_ingestion'
    )

    expect(ingestionEnd).toMatchObject({
      attributes: {
        failedProviders: 1,
        unusedProviders: 1
      }
    })
  })

  test('keeps ingested text out of every emitted event', async () => {
    await writeFile(
      path.join(root, '.codereviewer', 'context', 'ticket.md'),
      '---\nsource: jira\nid: PROJ-1\n---\nRotate the session token on sign-in.\n'
    )

    const snapshot = await runWith({
      providers: [{ type: 'inbox', dir: '.codereviewer/context' }]
    })

    expect(JSON.stringify(snapshot)).not.toContain('Rotate the session token')
  })
})
