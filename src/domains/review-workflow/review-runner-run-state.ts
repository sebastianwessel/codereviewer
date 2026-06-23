import { randomUUID } from 'node:crypto'
import type { CodeReviewerConfig } from '../../shared/contracts/index.js'
import { sha256 } from '../../shared/hash/hash.js'

export type ReviewRunClock = () => Date

export type CreateReviewRunStartStateOptions = {
  readonly config: CodeReviewerConfig
  readonly runId?: string
  readonly now?: ReviewRunClock
}

export type ReviewRunStartState = {
  readonly now: ReviewRunClock
  readonly startedAt: Date
  readonly runId: string
  readonly configHash: string
}

const stableJson = (value: unknown): string => JSON.stringify(value)

export const createReviewRunId = (): string => `run-${randomUUID()}`

export const createReviewRunStartState = (
  options: CreateReviewRunStartStateOptions
): ReviewRunStartState => {
  const now = options.now ?? (() => new Date())

  return {
    now,
    startedAt: now(),
    runId: options.runId ?? createReviewRunId(),
    configHash: sha256(stableJson(options.config))
  }
}
