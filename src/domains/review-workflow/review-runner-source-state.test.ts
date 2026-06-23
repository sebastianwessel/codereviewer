import type { Logger } from '@purista/harness'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import { createNoContentEventRecorder } from '../observability/index.js'
import type { RepositoryIntake } from '../repository-intake/index.js'
import { prepareReviewRunnerSourceState } from './review-runner-source-state.js'
import type {
  ReviewRunnerRepositoryInputOptions,
  ReviewRunnerRepositoryIntakeState,
  ReviewRunnerSourceReadState
} from './review-runner-repository-input.js'

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

describe('review runner source state', () => {
  test('wraps repository intake and source reads with safe observability and logs', async () => {
    const config = CodeReviewerConfigSchema.parse({
      review: {
        maxFiles: 25,
        maxFileBytes: 12345
      }
    })
    const signal = new AbortController().signal
    const intake: RepositoryIntake = {
      repositorySnapshot: {
        repositoryRoot: '/repo/project',
        changedFileCount: 1,
        skippedFileCount: 1
      },
      changedFiles: [
        {
          path: 'src/app.ts',
          status: 'modified',
          sizeBytes: 42,
          contentHash: 'hash-app'
        }
      ],
      skippedFiles: [
        {
          path: 'src/large.ts',
          reason: 'too-large'
        }
      ],
      diffMaps: []
    }
    const intakeState: ReviewRunnerRepositoryIntakeState = {
      intake,
      effectiveDiffMaps: [],
      effectiveDiffRanges: [
        {
          path: 'src/app.ts',
          startLine: 3,
          endLine: 4,
          changeKind: 'modified'
        }
      ],
      intakeMetrics: {
        changedFileCount: 1,
        skippedFileCount: 1
      }
    }
    const sourceState: ReviewRunnerSourceReadState = {
      sourceFiles: [{ path: 'src/app.ts', content: 'const value = 1\n' }],
      sourceReadMetrics: { fileCount: 1 }
    }
    const observability = createNoContentEventRecorder()
    const { logger, records } = createDebugLogger()
    let collectedOptions: ReviewRunnerRepositoryInputOptions | undefined
    let readInput: { readonly repositoryRoot: string; readonly intake: RepositoryIntake } | undefined

    const result = await prepareReviewRunnerSourceState({
      repositoryRoot: '/repo/project',
      config,
      explicitFiles: ['src/app.ts'],
      reviewDiffMaps: [],
      baseRef: 'main',
      headRef: 'HEAD',
      signal,
      observability,
      logger,
      collectRepositoryIntake: async (options) => {
        collectedOptions = options
        return intakeState
      },
      readSourceInput: async (input) => {
        readInput = input
        return sourceState
      }
    })

    expect(result).toEqual({
      ...intakeState,
      ...sourceState
    })
    expect(collectedOptions).toMatchObject({
      repositoryRoot: '/repo/project',
      config,
      explicitFiles: ['src/app.ts'],
      reviewDiffMaps: [],
      baseRef: 'main',
      headRef: 'HEAD',
      signal
    })
    expect(readInput).toEqual({
      repositoryRoot: '/repo/project',
      intake
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
        step: 'repository_intake',
        attributes: {
          changedFileCount: 1,
          skippedFileCount: 1
        }
      },
      {
        step: 'source_read',
        attributes: {
          fileCount: 1
        }
      }
    ])
    expect(records).toEqual([
      {
        message: 'Repository intake started.',
        fields: {
          explicit_file_count: 1,
          max_files: 25,
          max_file_bytes: 12345
        }
      },
      {
        message: 'Repository intake completed.',
        fields: {
          changed_file_count: 1,
          skipped_file_count: 1
        }
      },
      {
        message: 'Source read started.',
        fields: {
          file_count: 1
        }
      },
      {
        message: 'Source read completed.',
        fields: {
          file_count: 1
        }
      }
    ])
  })
})
