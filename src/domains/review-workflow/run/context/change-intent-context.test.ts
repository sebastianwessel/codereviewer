// Regression coverage for the change-intent silent-failure bug: a model
// summarizer that cannot be resolved -- whether resolution throws or simply
// yields no callable model -- must surface a classified, non-fatal warning
// instead of degrading to the deterministic digest with zero visible signal.
// See `selectSummarizer` in ./change-intent-context.ts.
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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
  contextLedger: []
}

describe('prepareReviewRunnerChangeIntentContext — model summarizer availability', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'change-intent-context-'))
    // An empty inbox: ingestion legitimately gathers nothing, so these tests
    // isolate summarizer-selection visibility from provider-ingestion content.
    await mkdir(path.join(root, '.codereviewer', 'context'), { recursive: true })
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
