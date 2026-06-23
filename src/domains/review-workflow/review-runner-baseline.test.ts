import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Logger } from '@purista/harness'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import { createNoContentEventRecorder } from '../observability/index.js'
import {
  loadBaselineFingerprints,
  prepareReviewRunnerBaseline
} from './review-runner-baseline.js'

type CapturedLogRecord = {
  readonly message: string
  readonly fields?: Record<string, unknown>
}

const createDebugLogger = (): {
  readonly logger: Logger
  readonly records: CapturedLogRecord[]
} => {
  const records: CapturedLogRecord[] = []
  const logger: Logger = {
    trace: () => {},
    debug: (message, fields) => {
      records.push({ message, ...(fields === undefined ? {} : { fields }) })
    },
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => logger
  }

  return { logger, records }
}

describe('review runner baseline loader', () => {
  test('returns an empty list when baseline support is disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codereviewer-baseline-'))
    const config = CodeReviewerConfigSchema.parse({
      baseline: {
        enabled: false,
        path: '.codereviewer/baseline.json'
      }
    })

    await expect(loadBaselineFingerprints(root, config)).resolves.toEqual([])
  })

  test('returns undefined for an enabled missing baseline file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codereviewer-baseline-'))
    const config = CodeReviewerConfigSchema.parse({
      baseline: {
        enabled: true,
        path: '.codereviewer/baseline.json'
      }
    })

    await expect(loadBaselineFingerprints(root, config)).resolves.toBeUndefined()
  })

  test('loads schema-validated baseline fingerprints from the repository root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codereviewer-baseline-'))
    const baselinePath = 'baseline.json'
    const config = CodeReviewerConfigSchema.parse({
      baseline: {
        enabled: true,
        path: baselinePath
      }
    })

    await writeFile(
      join(root, baselinePath),
      `${JSON.stringify([
        {
          fingerprints: [
            {
              algorithm: 'v1',
              value: 'abc123'
            }
          ]
        }
      ])}\n`
    )

    await expect(loadBaselineFingerprints(root, config)).resolves.toEqual([
      {
        fingerprints: [
          {
            algorithm: 'v1',
            value: 'abc123'
          }
        ]
      }
    ])
  })

  test('prepares baseline state with explicit configuration policy and metrics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codereviewer-baseline-'))
    const baselinePath = 'baseline.json'
    const config = CodeReviewerConfigSchema.parse({
      baseline: {
        enabled: true,
        path: baselinePath
      }
    })

    await writeFile(
      join(root, baselinePath),
      `${JSON.stringify([
        {
          fingerprints: [
            {
              algorithm: 'v1',
              value: 'abc123'
            }
          ]
        }
      ])}\n`
    )

    await expect(
      prepareReviewRunnerBaseline({
        repositoryRoot: root,
        config,
        baselineExplicitlyConfigured: true
      })
    ).resolves.toEqual({
      baselineFingerprints: [
        {
          fingerprints: [
            {
              algorithm: 'v1',
              value: 'abc123'
            }
          ]
        }
      ],
      baselineConfigured: true,
      metrics: {
        baselineEntryCount: 1
      }
    })

    await expect(
      prepareReviewRunnerBaseline({
        repositoryRoot: root,
        config,
        baselineExplicitlyConfigured: false
      })
    ).resolves.toEqual(
      expect.objectContaining({
        baselineConfigured: false,
        metrics: {
          baselineEntryCount: 1
        }
      })
    )
  })

  test('records baseline load observability and logs when collaborators are provided', async () => {
    const config = CodeReviewerConfigSchema.parse({
      baseline: {
        enabled: true,
        path: 'baseline.json'
      }
    })
    const observability = createNoContentEventRecorder()
    const { logger, records } = createDebugLogger()

    const result = await prepareReviewRunnerBaseline({
      repositoryRoot: '/repo/project',
      config,
      baselineExplicitlyConfigured: true,
      observability,
      logger,
      loadBaselineFingerprints: async () => [
        {
          fingerprints: [
            {
              algorithm: 'v1',
              value: 'abc123'
            }
          ]
        }
      ]
    })

    expect(result).toEqual({
      baselineFingerprints: [
        {
          fingerprints: [
            {
              algorithm: 'v1',
              value: 'abc123'
            }
          ]
        }
      ],
      baselineConfigured: true,
      metrics: {
        baselineEntryCount: 1
      }
    })
    expect(
      observability
        .snapshot()
        .events.filter((event) => event.type === 'step-ended')
        .map((event) => ({
          step: event.step,
          attributes: event.attributes
        }))
    ).toEqual([
      {
        step: 'baseline_load',
        attributes: {
          baselineEntryCount: 1
        }
      }
    ])
    expect(records).toEqual([
      { message: 'Baseline load started.' },
      {
        message: 'Baseline load completed.',
        fields: {
          baseline_entry_count: 1
        }
      }
    ])
  })
})
