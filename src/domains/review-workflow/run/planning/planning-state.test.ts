import type { Logger } from '@purista/harness'
import { describe, expect, test } from 'vitest'
import {
  CodeReviewerConfigSchema,
  type EvidenceRecord
} from '../../../../shared/contracts/index.js'
import type { CandidateFinding } from '../../../admission/index.js'
import { createNoContentEventRecorder } from '../../../observability/index.js'
import type { ReviewTask } from '../../../review-planning/index.js'
import type {
  DeterministicSignalExtraction,
  SupportSignalFact,
  SupportSignalSourceFile
} from '../../../deterministic-signals/index.js'
import { prepareReviewRunnerPlanningState } from './planning-state.js'
import type { ReviewRunnerTaskPlanningInput } from './task-planning.js'

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

const fact: SupportSignalFact = {
  id: 'fact_export',
  language: 'typescript',
  kind: 'export',
  path: 'src/app.ts',
  name: 'handler',
  line: 1,
  summary: 'Exports handler.',
  contentHash: 'hash-app'
}

const evidence: EvidenceRecord = {
  id: 'ev_export',
  kind: 'symbol',
  summary: 'The handler export is visible to reviewers.',
  location: {
    path: 'src/app.ts',
    startLine: 1,
    side: 'new'
  },
  source: 'deterministic-signal',
  redactionApplied: true
}

const task: ReviewTask = {
  id: 'task_app',
  round: 1,
  kind: 'file',
  paths: ['src/app.ts'],
  factIds: [fact.id],
  evidenceIds: [evidence.id],
  candidateIds: [],
  contextEntryIds: [],
  priority: 1
}

describe('review runner planning state', () => {
  test('wraps deterministic signal extraction and task planning with safe observability and logs', () => {
    const sourceFiles: readonly SupportSignalSourceFile[] = [
      { path: 'src/app.ts', content: 'export const handler = () => 1\n' }
    ]
    const files = [{ path: 'src/app.ts' }]
    const analysis: DeterministicSignalExtraction = {
      facts: [fact],
      evidence: [evidence]
    }
    const config = CodeReviewerConfigSchema.parse({
      review: { depth: 'thorough' }
    })
    const observability = createNoContentEventRecorder()
    const { logger, records } = createDebugLogger()
    let planningInput: ReviewRunnerTaskPlanningInput | undefined

    const result = prepareReviewRunnerPlanningState({
      config,
      files,
      sourceFiles,
      observability,
      logger,
      prepareDeterministicSignalStartAttributes: () => ({
        structuralEngine: 'typescript-compiler+ast-grep',
        astGrepVersion: 'ast-grep@test',
        fileCount: 1
      }),
      prepareDeterministicSignals: () => ({
        analysis,
        evidence: [evidence],
        testMappings: [],
        startAttributes: {
          structuralEngine: 'typescript-compiler+ast-grep',
          astGrepVersion: 'ast-grep@test',
          fileCount: 1
        },
        metrics: {
          factCount: 1,
          evidenceCount: 1,
          languageCount: 1,
          testMappingCount: 0,
          structuralEngine: 'typescript-compiler+ast-grep',
          astGrepVersion: 'ast-grep@test'
        }
      }),
      prepareTaskPlanning: (input) => {
        planningInput = input
        return {
          reviewTasks: [task],
          supportSignalCandidates: [] satisfies readonly CandidateFinding[],
          metrics: {
            taskCount: 1,
            supportSignalCandidateCount: 0
          }
        }
      }
    })

    expect(result).toMatchObject({
      analysis,
      evidence: [evidence],
      reviewTasks: [task],
      supportSignalCandidates: []
    })
    expect(planningInput).toEqual({
      depth: 'thorough',
      files,
      facts: [fact],
      evidence: [evidence]
    })
    expect(
      observability
        .snapshot()
        .events.filter((event) => event.type === 'step-started')
        .map((event) => ({
          step: event.step,
          attributes: event.attributes
        }))
    ).toEqual([
      {
        step: 'deterministic_signals',
        attributes: {
          structuralEngine: 'typescript-compiler+ast-grep',
          astGrepVersion: 'ast-grep@test',
          fileCount: 1
        }
      },
      {
        step: 'task_planning',
        attributes: {}
      }
    ])
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
        step: 'deterministic_signals',
        attributes: {
          factCount: 1,
          evidenceCount: 1,
          languageCount: 1,
          testMappingCount: 0,
          structuralEngine: 'typescript-compiler+ast-grep',
          astGrepVersion: 'ast-grep@test'
        }
      },
      {
        step: 'task_planning',
        attributes: { taskCount: 1 }
      }
    ])
    expect(records).toEqual([
      {
        message: 'Deterministic support signal extraction started.',
        fields: { file_count: 1 }
      },
      {
        message: 'Deterministic support signal extraction completed.',
        fields: {
          fact_count: 1,
          evidence_count: 1
        }
      },
      { message: 'Task planning started.' },
      {
        message: 'Task planning completed.',
        fields: {
          task_count: 1,
          support_signal_candidate_count: 0
        }
      }
    ])
  })
})
