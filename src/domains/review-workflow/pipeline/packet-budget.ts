import {
  createStructuredError,
  normalizeError,
  type StructuredError
} from '../../../shared/errors/error-normalizer.js'

export const serializedBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value))

export const createTaskPacketBudgetExceededError = (
  input: {
    readonly taskId: string
    readonly maxTaskInputBytes: number
    readonly serializedBytes: number
  }
): StructuredError =>
  createStructuredError({
    code: 'task_packet_budget_exceeded',
    message:
      'Review task packet exceeds the configured provider input budget. The packet was not truncated; split the review scope further or increase the provider task budget.',
    category: 'provider',
    recoverable: true,
    exitCode: 4,
    details: {
      taskId: input.taskId,
      maxTaskInputBytes: input.maxTaskInputBytes,
      serializedBytes: input.serializedBytes
    }
  })

export const isTaskPacketBudgetExceededError = (error: unknown): boolean =>
  normalizeError(error).code === 'task_packet_budget_exceeded'

// Spec 26's terminal case: the provider refused the packet as too large, and there
// is nothing left to halve — a single line, or a task whose only oversized document
// is context rather than a review target.
//
// This is deliberately the same refusal shape as the budget error above: it fails
// LOUDLY with an actionable message instead of truncating, dropping the task, or
// retrying an identical packet forever. Recoverable, because the fix is a smaller
// commit or a larger-context model rather than a code change.
export const createIndivisibleTaskError = (
  input: {
    readonly taskId: string
    readonly splitDepth: number
    readonly documentCount: number
  }
): StructuredError =>
  createStructuredError({
    code: 'review_task_indivisible',
    message:
      'The provider refused this review task as exceeding its context length, and the task cannot be split further. Nothing was truncated. Review a smaller change, or configure a model with a larger context window.',
    category: 'provider',
    recoverable: true,
    exitCode: 4,
    details: {
      taskId: input.taskId,
      splitDepth: input.splitDepth,
      documentCount: input.documentCount
    }
  })
