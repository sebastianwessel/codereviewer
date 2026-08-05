import { ModelError, ValidationError } from '@purista/harness'
import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../../admission/index.js'
import {
  type FindingRefutationBatchInput,
  type ModelFindingRefutationBatchResult,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { type DebugLogger } from '../debug-logger.js'
import { executeBatchRefutation } from './execution.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from '../contracts.js'

const configHash =
  '4444444444444444444444444444444444444444444444444444444444444444'

const evidence: EvidenceRecord = {
  id: 'ev_refutationexecution',
  kind: 'diagnostic',
  summary: 'Changed branch was reviewed.',
  location: {
    path: 'src/admission.ts',
    startLine: 12,
    side: 'new'
  },
  source: 'review-agent',
  redactionApplied: true
}

const candidate: CandidateFinding = {
  id: 'cand_refutationexecution',
  taskId: 'task_refutationexecution',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch can lose data',
  description: 'The model claims the changed branch can lose data.',
  location: {
    path: 'src/admission.ts',
    startLine: 12,
    side: 'new'
  },
  evidenceIds: ['ev_refutationexecution'],
  proposedBy: 'review-agent'
}

const secondCandidate: CandidateFinding = {
  ...candidate,
  id: 'cand_refutationexecution2',
  title: 'Changed branch skips validation',
  description: 'The model claims the changed branch skips validation.',
  location: {
    path: 'src/admission.ts',
    startLine: 14,
    side: 'new'
  }
}

const task: WorkflowReviewTask = {
  id: 'task_refutationexecution',
  kind: 'file',
  round: 1,
  paths: ['src/admission.ts'],
  factIds: [],
  evidenceIds: ['ev_refutationexecution'],
  candidateIds: ['cand_refutationexecution'],
  contextEntryIds: ['ctx_aaaaaaaaaaaaaaaa'],
  instructions: [],
  reviewContext: [
    {
      kind: 'file',
      path: 'src/admission.ts',
      content: 'export const changed = true\n',
      ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaa'
    }
  ],
  priority: 1
}

// A task carrying one instruction document, as context assembly resolves it.
// Instructions are irreducible packet content: the refutation budget ladder can
// shed the digest, the support signals and the review context, never these.
const taskWithInstruction = (content: string): WorkflowReviewTask => ({
  ...task,
  instructions: [{ path: 'AGENTS.md', content, allowed: true }]
})

const workflowInput = (
  input: {
    readonly maxTaskInputBytes?: number
  } = {}
): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-refutation-execution',
    reviewedPaths: ['src/admission.ts'],
    reviewedDiffRanges: [
      { path: 'src/admission.ts', startLine: 1, endLine: 30 }
    ],
    evidence: [evidence],
    candidates: [candidate],
    skills: [],
    ...(input.maxTaskInputBytes === undefined
      ? {}
      : { maxTaskInputBytes: input.maxTaskInputBytes }),
    promotionPolicy: {
      modelWeakOrRefuted: 'rejected'
    },
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

const batchInput = (
  input: {
    readonly candidates: readonly CandidateFinding[]
    readonly refuteFinding: (
      packet: FindingRefutationBatchInput
    ) => Promise<ModelFindingRefutationBatchResult>
    readonly workflowInput?: ReviewWorkflowInput
    readonly task?: WorkflowReviewTask
    readonly logger?: DebugLogger
  }
) => ({
  workflowInput: input.workflowInput ?? workflowInput(),
  tasks: [input.task ?? task],
  candidates: input.candidates,
  allCandidates: input.candidates,
  sharedDigest: '(no admitted shared context yet)',
  reviewEvidence: [evidence],
  refuteFinding: async (packet: FindingRefutationBatchInput) =>
    input.refuteFinding(packet),
  ...(input.logger === undefined ? {} : { logger: input.logger })
})

// A recorded logger the retry tests use to assert both that a retry happened and
// what the logged fields were, so the instrumentation itself is under test rather
// than only the observable retry behaviour.
const recordingLogger = (): {
  readonly logger: DebugLogger
  readonly messages: string[]
} => {
  const messages: string[] = []
  return {
    messages,
    logger: {
      debug: (message) => {
        messages.push(message)
      }
    }
  }
}

describe('model admission batched refutation execution', () => {
  test('adjudicates every candidate of a task in a single refuter call', async () => {
    const observedBatches: string[][] = []
    const resolutions = await executeBatchRefutation(
      batchInput({
        candidates: [candidate, secondCandidate],
        refuteFinding: async (packet) => {
          observedBatches.push(packet.candidates.map((entry) => entry.id))
          expect(packet.evidence.map((entry) => entry.id)).toEqual([
            'ev_refutationexecution'
          ])

          return {
            verdicts: [
              {
                candidateId: candidate.id,
                verdict: 'proved',
                rationaleSummary: 'The active refuter proved the claim.'
              },
              {
                candidateId: secondCandidate.id,
                verdict: 'refuted',
                rationaleSummary: 'The second claim is contradicted.'
              }
            ]
          }
        }
      })
    )

    // One call, both candidates in it: the shared task context is sent once.
    expect(observedBatches).toEqual([
      ['cand_refutationexecution', 'cand_refutationexecution2']
    ])
    expect(resolutions.get(candidate.id)).toEqual({
      status: 'verdict',
      refutation: {
        verdict: 'proved',
        rationaleSummary: 'The active refuter proved the claim.'
      }
    })
    expect(resolutions.get(secondCandidate.id)).toEqual({
      status: 'verdict',
      refutation: {
        verdict: 'refuted',
        rationaleSummary: 'The second claim is contradicted.'
      }
    })
  })

  test('resolves a candidate the batch never adjudicated to missing-verdict', async () => {
    const resolutions = await executeBatchRefutation(
      batchInput({
        candidates: [candidate, secondCandidate],
        refuteFinding: async () => ({
          verdicts: [
            {
              candidateId: candidate.id,
              verdict: 'proved',
              rationaleSummary: 'Only the first candidate was adjudicated.'
            }
          ]
        })
      })
    )

    // Absence of a verdict is an absence of signal, never a silent "proved".
    expect(resolutions.get(secondCandidate.id)).toEqual({
      status: 'missing-verdict'
    })
  })

  test('ignores a verdict whose candidateId is not in the batch', async () => {
    const resolutions = await executeBatchRefutation(
      batchInput({
        candidates: [candidate],
        refuteFinding: async () => ({
          verdicts: [
            {
              candidateId: 'cand_hallucinated',
              verdict: 'proved',
              rationaleSummary: 'A verdict for a candidate that was never sent.'
            }
          ]
        })
      })
    )

    // A stray id must never be bound to a real candidate.
    expect(resolutions.get(candidate.id)).toEqual({ status: 'missing-verdict' })
    expect(resolutions.has('cand_hallucinated')).toBe(false)
  })

  test('returns a provider-error resolution for every candidate when refutation fails', async () => {
    const resolutions = await executeBatchRefutation(
      batchInput({
        candidates: [candidate, secondCandidate],
        refuteFinding: async () => {
          throw new Error('provider timed out while refuting')
        }
      })
    )

    for (const candidateId of [candidate.id, secondCandidate.id]) {
      const resolution = resolutions.get(candidateId)

      expect(resolution?.status).toBe('provider-error')
      expect(
        resolution?.status === 'provider-error' ? resolution.stage : undefined
      ).toBe('refutation-check')
    }
  })

  test('does NOT retry a plain provider error, since that already has its own retry policy', async () => {
    // A generic thrown error (a timeout, a dropped connection) is exactly the shape
    // of failure the provider layer already retries on its own; retrying it again
    // here would double an already-handled backoff instead of adding recall.
    let refutationCalls = 0
    const resolutions = await executeBatchRefutation(
      batchInput({
        candidates: [candidate],
        refuteFinding: async () => {
          refutationCalls += 1
          throw new Error('provider timed out while refuting')
        }
      })
    )

    expect(refutationCalls).toBe(1)
    expect(resolutions.get(candidate.id)?.status).toBe('provider-error')
  })

  test('retries once on a harness output-validation failure and uses the successful retry', async () => {
    // This is the failure mode the plan measured firing 16 times across 9 cases:
    // the model's response failed the harness's own agent-output schema check.
    // Without the retry, this test fails because the first (and only) call's
    // ValidationError maps every candidate straight to a provider-error / needs-
    // more-evidence outcome.
    let refutationCalls = 0
    const { logger, messages } = recordingLogger()
    const resolutions = await executeBatchRefutation(
      batchInput({
        candidates: [candidate],
        logger,
        refuteFinding: async () => {
          refutationCalls += 1
          if (refutationCalls === 1) {
            throw new ValidationError('Agent output validation failed.', {
              where: 'agent_output',
              issues: []
            })
          }
          return {
            verdicts: [
              {
                candidateId: candidate.id,
                verdict: 'proved',
                rationaleSummary: 'The retried call proved the claim.'
              }
            ]
          }
        }
      })
    )

    expect(refutationCalls).toBe(2)
    expect(resolutions.get(candidate.id)).toEqual({
      status: 'verdict',
      refutation: {
        verdict: 'proved',
        rationaleSummary: 'The retried call proved the claim.'
      }
    })
    expect(messages).toEqual(['Refutation output-validation retry succeeded.'])
  })

  test('retries once on a malformed-structured-output ModelError and uses the retry', async () => {
    // The provider adapter can also fail to parse a structured object out of the
    // response at all, which surfaces as a `ModelError` rather than a schema
    // `ValidationError`. Both are "the model returned garbage this one time" and
    // both must be retried.
    let refutationCalls = 0
    const resolutions = await executeBatchRefutation(
      batchInput({
        candidates: [candidate],
        refuteFinding: async () => {
          refutationCalls += 1
          if (refutationCalls === 1) {
            throw new ModelError('OpenAI returned malformed structured object JSON.', {
              provider: 'openai',
              model: 'gpt-test',
              method: 'generateObject',
              reason: 'malformed_response'
            })
          }
          return {
            verdicts: [
              {
                candidateId: candidate.id,
                verdict: 'proved',
                rationaleSummary: 'The retried call proved the claim.'
              }
            ]
          }
        }
      })
    )

    expect(refutationCalls).toBe(2)
    expect(resolutions.get(candidate.id)?.status).toBe('verdict')
  })

  test('degrades to provider-error when the retry also fails, without a third attempt', async () => {
    let refutationCalls = 0
    const { logger, messages } = recordingLogger()
    const resolutions = await executeBatchRefutation(
      batchInput({
        candidates: [candidate],
        logger,
        refuteFinding: async () => {
          refutationCalls += 1
          throw new ValidationError('Agent output validation failed.', {
            where: 'agent_output',
            issues: []
          })
        }
      })
    )

    expect(refutationCalls).toBe(2)
    expect(resolutions.get(candidate.id)?.status).toBe('provider-error')
    expect(messages).toEqual(['Refutation output-validation retry failed.'])
  })

  test('does not retry a hard provider ModelError (e.g. rate limiting)', async () => {
    // Auth failures, rate limiting, and network errors already have their own
    // retry policy in the provider layer; retrying them again here would
    // duplicate that policy instead of adding recall.
    let refutationCalls = 0
    const resolutions = await executeBatchRefutation(
      batchInput({
        candidates: [candidate],
        refuteFinding: async () => {
          refutationCalls += 1
          throw new ModelError('Provider rate limited the request.', {
            provider: 'openai',
            model: 'gpt-test',
            method: 'generateObject',
            reason: 'rate_limited'
          })
        }
      })
    )

    expect(refutationCalls).toBe(1)
    expect(resolutions.get(candidate.id)?.status).toBe('provider-error')
  })

  test('splits an oversized batch in half instead of losing its candidates', async () => {
    // Instructions are irreducible context (the budget ladder cannot shed them), and
    // each candidate carries a maximum-length description. Sized so that a
    // one-candidate packet fits the budget and a two-candidate packet does not.
    const oversizedInput = workflowInput({ maxTaskInputBytes: 10000 })
    const bulky = (source: CandidateFinding): CandidateFinding => ({
      ...source,
      description: source.description.padEnd(1200, ' and it keeps describing')
    })
    const observedBatches: string[][] = []
    const resolutions = await executeBatchRefutation(
      batchInput({
        workflowInput: oversizedInput,
        task: taskWithInstruction('irreducible instruction '.repeat(290)),
        candidates: [bulky(candidate), bulky(secondCandidate)],
        refuteFinding: async (packet) => {
          observedBatches.push(packet.candidates.map((entry) => entry.id))

          return {
            verdicts: packet.candidates.map((entry) => ({
              candidateId: entry.id,
              verdict: 'proved',
              rationaleSummary: 'The active refuter proved the claim.'
            }))
          }
        }
      })
    )

    expect(observedBatches).toEqual([
      ['cand_refutationexecution'],
      ['cand_refutationexecution2']
    ])
    expect(resolutions.get(candidate.id)?.status).toBe('verdict')
    expect(resolutions.get(secondCandidate.id)?.status).toBe('verdict')
  })

  test('reports a packet-budget failure that a single candidate cannot escape', async () => {
    let refutationCalls = 0
    const resolutions = await executeBatchRefutation(
      batchInput({
        workflowInput: workflowInput({ maxTaskInputBytes: 10000 }),
        task: taskWithInstruction('irreducible instruction '.repeat(800)),
        candidates: [candidate],
        refuteFinding: async () => {
          refutationCalls += 1

          return { verdicts: [] }
        }
      })
    )

    expect(refutationCalls).toBe(0)
    const resolution = resolutions.get(candidate.id)
    expect(resolution?.status).toBe('provider-error')
    expect(
      resolution?.status === 'provider-error' ? resolution.stage : undefined
    ).toBe('refutation-packet')
  })
})
