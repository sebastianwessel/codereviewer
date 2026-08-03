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
  referencedDefinitionsDroppedCount: 0
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
        'Provider credential source "OPENAI_API_KEY" is required. ' +
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
