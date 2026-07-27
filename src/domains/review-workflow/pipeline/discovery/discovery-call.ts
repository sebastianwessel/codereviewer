// One discovery model call, and the failure policy every discovery call shares.
//
// Extracted so the general pass, the dedicated security pass (spec 15), and the
// un-anchored pass (spec 19) cannot drift apart on what "this call failed" means.
// Every one of them is a single model response whose loss must cost that response
// and nothing more.

import {
  ModelHolisticReviewResultSchema,
  type HolisticReviewRunner,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { providerIssueForError, type ProviderIssue } from '../provider-issues.js'

// Two ways a discovery CALL can fail without the review being broken: the agent
// exhausts its step allowance (a tool-enabled call whose model keeps requesting
// reads instead of answering), or the model returns output that does not validate
// (a truncated or malformed response, which grows more likely as the packet grows).
// Both are properties of one model response, not of the run. Letting either
// propagate fails the whole TASK and loses every finding it had — and, in an
// evaluation, silently drops the case from the comparison, which is how a
// measurement starts lying. Such a call yields no findings and is surfaced as a
// recovered provider issue so the degradation stays visible instead of silent.
// Failures that cost this task its findings but must not take the run down with
// them. Malformed structured-object JSON belongs here: it is what a response
// truncated mid-array looks like, and one over-long file should degrade to a
// recorded provider issue rather than fail an entire review or evaluation.
const isRecoverableDiscoveryFailure = (error: unknown): boolean =>
  error instanceof Error &&
  /agent loop budget exceeded|iterations_exceeded|agent output validation failed|malformed structured object json/iu.test(
    error.message
  )

export type DiscoveryCallResult = {
  readonly findings: readonly unknown[]
  readonly providerIssues: readonly ProviderIssue[]
}

export const runDiscoveryCall = async (
  runner: HolisticReviewRunner,
  task: WorkflowReviewTask,
  reviewText: string,
  signal: AbortSignal | undefined,
  stage: string
): Promise<DiscoveryCallResult> => {
  try {
    const review = ModelHolisticReviewResultSchema.parse(
      await runner(
        {
          taskId: task.id,
          paths: [...task.paths],
          reviewText
        },
        signal
      )
    )

    return { findings: review.findings, providerIssues: [] }
  } catch (error) {
    if (!isRecoverableDiscoveryFailure(error)) {
      throw error
    }

    return {
      findings: [],
      providerIssues: [providerIssueForError({ error, stage, recovered: true })]
    }
  }
}
