import type { CodeReviewerConfig, EvidenceRecord } from '../../../../shared/contracts/index.js'
import {
  planReviewTasks,
  type ReviewTask
} from '../../../review-planning/index.js'
import type { SupportSignalFact } from '../../../deterministic-signals/index.js'

export type ReviewRunnerTaskPlanningInput = {
  readonly depth: CodeReviewerConfig['review']['depth']
  readonly files: readonly { readonly path: string }[]
  readonly facts: readonly SupportSignalFact[]
  readonly evidence: readonly EvidenceRecord[]
}

export type ReviewRunnerTaskPlanningMetrics = {
  readonly taskCount: number
}

export type ReviewRunnerTaskPlanningResult = {
  readonly reviewTasks: readonly ReviewTask[]
  readonly metrics: ReviewRunnerTaskPlanningMetrics
}

export const prepareReviewRunnerTaskPlanning = (
  input: ReviewRunnerTaskPlanningInput
): ReviewRunnerTaskPlanningResult => {
  const reviewTasks = planReviewTasks({
    depth: input.depth,
    files: input.files,
    facts: input.facts,
    evidence: input.evidence,
    candidates: []
  })

  return {
    reviewTasks,
    metrics: {
      taskCount: reviewTasks.length,
    }
  }
}
