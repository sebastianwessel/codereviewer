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
