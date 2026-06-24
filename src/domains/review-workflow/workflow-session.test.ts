import { describe, expect, test } from 'vitest'
import {
  runProvidedCandidateReviewWorkflow,
  type ReviewHarness
} from './workflow-session.js'
import {
  ReviewWorkflowInputSchema,
  ReviewWorkflowOutputSchema
} from './workflow-contracts.js'

const configHash =
  '7777777777777777777777777777777777777777777777777777777777777777'

const workflowInput = ReviewWorkflowInputSchema.parse({
  runId: 'run-session',
  reviewedPaths: ['src/session.ts'],
  evidence: [],
  candidates: [],
  instructions: [],
  skills: [],
  baselineConfigured: false,
  provenance: {
    reviewer: 'review-agent',
    signalVersions: {},
    configHash
  }
})

const workflowOutput = ReviewWorkflowOutputSchema.parse({
  admittedFindings: [],
  rejectedFindings: [],
  evidence: [],
  candidateFindings: [],
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
  warnings: []
})

describe('workflow session', () => {
  test('invokes the review workflow with parsed input and closes the session', async () => {
    const controller = new AbortController()
    const observed: {
      sessionId?: string
      input?: unknown
      signal: AbortSignal | undefined
      closed: boolean
    } = {
      signal: undefined,
      closed: false
    }
    const harness: ReviewHarness = {
      getSession: async (sessionId) => {
        observed.sessionId = sessionId

        return {
          workflows: {
            review_repository: {
              prompt: async (input, options) => {
                observed.input = input
                observed.signal = options?.signal

                return workflowOutput
              }
            }
          },
          close: async () => {
            observed.closed = true
          }
        }
      },
      shutdown: async () => undefined
    }

    const output = await runProvidedCandidateReviewWorkflow({
      harness,
      sessionId: 'session-1',
      input: workflowInput,
      signal: controller.signal
    })

    expect(output).toEqual(workflowOutput)
    expect(observed).toMatchObject({
      sessionId: 'session-1',
      input: workflowInput,
      signal: controller.signal,
      closed: true
    })
  })
})
