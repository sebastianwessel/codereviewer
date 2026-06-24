import type { Logger } from '@purista/harness'
import { describe, expect, test } from 'vitest'
import {
  CodeReviewerConfigSchema,
  type EvidenceRecord
} from '../../../shared/contracts/index.js'
import type { CandidateFinding } from '../../admission/index.js'
import { createNoContentEventRecorder } from '../../observability/index.js'
import {
  admissionFromProviderWorkflowOutput,
  prepareReviewRunnerAdmissionState,
  runDeterministicAdmission
} from './admission.js'
import type { WorkflowReviewTask } from './context/context.js'
import { ReviewWorkflowOutputSchema } from '../pipeline/contracts.js'

const configHash =
  '1111111111111111111111111111111111111111111111111111111111111111'

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

const evidence: EvidenceRecord = {
  id: 'ev_diff1',
  kind: 'diff',
  summary: 'Changed branch can return an incorrect value.',
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  source: 'typescript-support-signal',
  contentHash: '2222222222222222222222222222222222222222222222222222222222222222',
  redactionApplied: true
}

const candidate: CandidateFinding = {
  id: 'cand_bug1',
  taskId: 'task_bug1',
  category: 'bug',
  severity: 'high',
  title: 'Incorrect return branch',
  description: 'The changed branch can return an incorrect value for callers.',
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  evidenceIds: ['ev_diff1'],
  proposedBy: 'deterministic-support-signal',
  fixProposal: {
    summary: 'Return the computed value from the changed branch.',
    evidenceIds: ['ev_diff1'],
    safety: 'manual-review'
  }
}

const workflowTask: WorkflowReviewTask = {
  id: 'task_bug1',
  kind: 'file',
  round: 1,
  paths: ['src/app.ts'],
  factIds: [],
  evidenceIds: ['ev_diff1'],
  candidateIds: [],
  contextEntryIds: [],
  priority: 0,
  reviewContext: []
}

describe('review runner deterministic admission', () => {
  test('admits reviewed evidence-backed candidates and evaluates the quality gate', () => {
    const config = CodeReviewerConfigSchema.parse({
      review: {
        inlineSeverityThreshold: 'high'
      },
      qualityGate: {
        maxHigh: 0
      }
    })

    const result = runDeterministicAdmission({
      reviewedPaths: ['src/app.ts'],
      reviewedLineRanges: [{ path: 'src/app.ts', startLine: 1, endLine: 20 }],
      reviewedDiffRanges: [{ path: 'src/app.ts', startLine: 4, endLine: 4 }],
      candidates: [candidate],
      evidence: [evidence],
      config,
      admittedAt: '2026-06-20T00:00:00.000Z',
      configHash,
      instructionHashes: [],
      skillHashes: [],
      baselineConfigured: false,
      taskEvents: []
    })

    expect(result.admittedFindings).toHaveLength(1)
    expect(result.admittedFindings[0]).toEqual(
      expect.objectContaining({
        category: 'bug',
        severity: 'high',
        reporterEligibility: 'inline',
        evidenceIds: ['ev_diff1']
      })
    )
    expect(result.rejectedFindings).toEqual([])
    expect(result.qualityGate?.passed).toBe(false)
    expect(result.qualityGate?.failingFindingIds).toEqual([
      result.admittedFindings[0]?.id
    ])
    expect(result.providerIssues).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.evidence.map((record) => record.id)).toEqual(['ev_diff1'])
    expect(result.admissionDecisions).toEqual([
      {
        candidateId: 'cand_bug1',
        status: 'admitted',
        findingId: result.admittedFindings[0]?.id
      }
    ])
    expect(result.admittedFindings[0]?.provenance.configHash).toBe(configHash)
    expect(result.admittedFindings[0]?.provenance.signalVersions).toEqual(
      expect.objectContaining({
        typescript: expect.any(String)
      })
    )
  })

  test('maps provider workflow output into runner admission state', () => {
    const output = ReviewWorkflowOutputSchema.parse({
      admittedFindings: [],
      rejectedFindings: [],
      evidence: [evidence],
      candidateFindings: [candidate],
      contextLedgerEntries: [],
      refutationResults: [],
      providerIssues: [],
      admissionDecisions: [
        {
          candidateId: 'cand_bug1',
          status: 'needs-more-evidence',
          supersedes: 'previous-finding'
        }
      ],
      taskEvents: [
        {
          id: 'task_bug1',
          kind: 'file',
          round: 1,
          paths: ['src/app.ts'],
          state: 'completed',
          workerId: 'worker-1',
          message: 'completed by provider'
        }
      ],
      qualityGate: {
        passed: true,
        failingFindingIds: [],
        thresholds: {
          maxCritical: null,
          maxHigh: null,
          maxMedium: null,
          failOnProviderError: true,
          failOnNewOnly: false
        },
        baselineFilteringApplied: false
      },
      instructionHashes: [],
      skillHashes: [],
      warnings: ['provider-warning']
    })

    const admission = admissionFromProviderWorkflowOutput(output)

    expect(admission.evidence).toEqual([evidence])
    expect(admission.candidateFindings).toEqual([candidate])
    expect(admission.admissionDecisions).toEqual([
      {
        candidateId: 'cand_bug1',
        status: 'needs-more-evidence',
        supersedes: 'previous-finding'
      }
    ])
    expect(admission.taskEvents).toEqual([
      {
        id: 'task_bug1',
        kind: 'file',
        round: 1,
        paths: ['src/app.ts'],
        state: 'completed',
        workerId: 'worker-1',
        message: 'completed by provider'
      }
    ])
    expect(admission.warnings).toEqual(['provider-warning'])
    expect(admission.qualityGate).toEqual(output.qualityGate)
  })

  test('prepares provider or deterministic admission state from runner inputs', () => {
    const config = CodeReviewerConfigSchema.parse({
      review: {
        maxConcurrentTasks: 2,
        inlineSeverityThreshold: 'high'
      }
    })
    const providerOutput = ReviewWorkflowOutputSchema.parse({
      admittedFindings: [],
      rejectedFindings: [],
      evidence: [evidence],
      candidateFindings: [candidate],
      contextLedgerEntries: [],
      refutationResults: [],
      providerIssues: [],
      admissionDecisions: [],
      taskEvents: [],
      qualityGate: {
        passed: true,
        failingFindingIds: [],
        thresholds: {
          maxCritical: null,
          maxHigh: null,
          maxMedium: null,
          failOnProviderError: true,
          failOnNewOnly: false
        },
        baselineFilteringApplied: false
      },
      instructionHashes: [],
      skillHashes: [],
      warnings: ['provider-warning']
    })

    expect(
      prepareReviewRunnerAdmissionState({
        providerWorkflowOutput: providerOutput,
        reviewedPaths: ['src/app.ts'],
        reviewedLineRanges: [{ path: 'src/app.ts', startLine: 1, endLine: 20 }],
        reviewedDiffRanges: [{ path: 'src/app.ts', startLine: 4, endLine: 4 }],
        candidates: [candidate],
        evidence: [evidence],
        config,
        admittedAt: '2026-06-20T00:00:00.000Z',
        configHash,
        instructionHashes: [],
        skillHashes: [],
        baselineConfigured: false,
        tasks: [workflowTask]
      })
    ).toEqual({
      admission: admissionFromProviderWorkflowOutput(providerOutput),
      deterministicTaskQueueRan: false
    })

    const observability = createNoContentEventRecorder()
    const { logger, records } = createDebugLogger()
    const deterministic = prepareReviewRunnerAdmissionState({
      providerWorkflowOutput: undefined,
      reviewedPaths: ['src/app.ts'],
      reviewedLineRanges: [{ path: 'src/app.ts', startLine: 1, endLine: 20 }],
      reviewedDiffRanges: [{ path: 'src/app.ts', startLine: 4, endLine: 4 }],
      candidates: [candidate],
      evidence: [evidence],
      config,
      admittedAt: '2026-06-20T00:00:00.000Z',
      configHash,
      instructionHashes: [],
      skillHashes: [],
      baselineConfigured: false,
      tasks: [workflowTask],
      observability,
      logger
    })

    expect(deterministic.deterministicTaskQueueRan).toBe(true)
    expect(deterministic.admission.admittedFindings).toHaveLength(1)
    expect(deterministic.admission.taskEvents.map((event) => event.state)).toEqual([
      'planned',
      'running',
      'completed'
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
        step: 'deterministic_task_queue',
        attributes: { taskCount: 3 }
      }
    ])
    expect(records).toEqual([
      {
        message: 'Deterministic task queue completed.',
        fields: {
          task_count: 3
        }
      }
    ])
  })
})
