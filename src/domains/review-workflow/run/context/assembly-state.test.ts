import type { Logger } from '@purista/harness'
import { describe, expect, test } from 'vitest'
import {
  CodeReviewerConfigSchema,
  type EvidenceRecord
} from '../../../../shared/contracts/index.js'
import { createNoContentEventRecorder } from '../../../observability/index.js'
import type { ReviewTask } from '../../../review-planning/index.js'
import type {
  DeterministicSignalExtraction,
  SupportSignalSourceFile
} from '../../../deterministic-signals/index.js'
import { prepareReviewRunnerContextAssemblyState } from './assembly-state.js'
import type { ReviewRunnerContextState } from './context.js'

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

const sourceFiles: readonly SupportSignalSourceFile[] = [
  { path: 'src/app.ts', content: 'export const app = 1\n' }
]

const evidence: EvidenceRecord = {
  id: 'ev_app',
  kind: 'symbol',
  summary: 'app export is available.',
  location: {
    path: 'src/app.ts',
    startLine: 1,
    side: 'new'
  },
  source: 'deterministic-signal',
  redactionApplied: true
}

const analysis: DeterministicSignalExtraction = {
  facts: [
    {
      id: 'fact_app',
      language: 'typescript',
      kind: 'export',
      path: 'src/app.ts',
      name: 'app',
      line: 1,
      summary: 'Exports app.',
      contentHash: 'hash-app'
    }
  ],
  evidence: [evidence]
}

const task: ReviewTask = {
  id: 'task_app',
  round: 1,
  kind: 'file',
  paths: ['src/app.ts'],
  factIds: ['fact_app'],
  evidenceIds: ['ev_app'],
  candidateIds: [],
  contextEntryIds: [],
  priority: 1
}

describe('review runner context assembly state', () => {
  test('wraps context assembly with safe observability and logs', async () => {
    const config = CodeReviewerConfigSchema.parse({})
    const observability = createNoContentEventRecorder()
    const { logger, records } = createDebugLogger()
    const contextState: ReviewRunnerContextState = {
      assembledContext: {
        reviewContext: [],
        tasks: [],
        instructions: [],
        skills: [],
        skillDefinitions: {},
        skillIds: [],
        contextLedger: []
      },
      instructionHashes: ['instruction-hash'],
      skillHashes: ['skill-hash'],
      metrics: {
        ledgerEntryCount: 3,
        workflowTaskCount: 1,
        instructionCount: 1,
        skillCount: 1
      }
    }
    let receivedInput:
      | {
          readonly repositoryRoot: string
          readonly config: typeof config
          readonly sourceFiles: typeof sourceFiles
          readonly analysis: typeof analysis
          readonly tasks: readonly ReviewTask[]
        }
      | undefined

    const result = await prepareReviewRunnerContextAssemblyState({
      repositoryRoot: '/repo/project',
      config,
      sourceFiles,
      analysis,
      tasks: [task],
      observability,
      logger,
      prepareContextState: async (input) => {
        receivedInput = input
        return contextState
      }
    })

    expect(result).toBe(contextState)
    expect(receivedInput).toEqual({
      repositoryRoot: '/repo/project',
      config,
      sourceFiles,
      analysis,
      tasks: [task]
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
        step: 'context_assembly',
        attributes: {
          ledgerEntryCount: 3
        }
      }
    ])
    expect(records).toEqual([
      { message: 'Context assembly started.' },
      {
        message: 'Context assembly completed.',
        fields: {
          ledger_entry_count: 3,
          workflow_task_count: 1,
          instruction_count: 1,
          skill_count: 1
        }
      }
    ])
  })
})
