import type { CodeReviewerConfig, EvidenceRecord } from '../../shared/contracts/index.js'
import { CandidateFindingSchema, type CandidateFinding } from '../admission/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import {
  planReviewTasks,
  type ReviewTask
} from '../review-planning/index.js'
import type { SupportSignalFact } from '../deterministic-signals/index.js'

export type ReviewRunnerTaskPlanningInput = {
  readonly depth: CodeReviewerConfig['review']['depth']
  readonly files: readonly { readonly path: string }[]
  readonly facts: readonly SupportSignalFact[]
  readonly evidence: readonly EvidenceRecord[]
  readonly policyReviewPass?: boolean
}

export type ReviewRunnerTaskPlanningMetrics = {
  readonly taskCount: number
  readonly supportSignalCandidateCount: number
}

export type ReviewRunnerTaskPlanningResult = {
  readonly reviewTasks: readonly ReviewTask[]
  readonly supportSignalCandidates: readonly CandidateFinding[]
  readonly metrics: ReviewRunnerTaskPlanningMetrics
}

type TrustedRuleFindingTemplate = {
  readonly category: CandidateFinding['category']
  readonly severity: CandidateFinding['severity']
  readonly title: string
  readonly fixSummary: string
}

const trustedRuleFindingTemplates: ReadonlyMap<
  string,
  TrustedRuleFindingTemplate
> = new Map([
  [
    'typescript-authorization-missing-lookup-allows-access',
    {
      category: 'security',
      severity: 'high',
      title: 'Authorization lookup miss allows access',
      fixSummary:
        'Return deny-by-default when the authorization lookup is missing or expired, then require the positive membership check to grant access.'
    }
  ],
  [
    'typescript-dayjs-object-strict-equality',
    {
      category: 'bug',
      severity: 'medium',
      title: 'Dayjs object equality uses reference comparison',
      fixSummary:
        'Replace strict equality between Dayjs objects with isSame(...) or compare primitive timestamp values.'
    }
  ],
  [
    'typescript-slot-end-derived-from-start-time',
    {
      category: 'bug',
      severity: 'medium',
      title: 'Slot end is derived from slot start time',
      fixSummary:
        'Compute the slot end from slotEndTime instead of slotStartTime so the returned window preserves the intended duration.'
    }
  ],
  [
    'typescript-prorated-branch-omits-discount',
    {
      category: 'bug',
      severity: 'medium',
      title: 'Prorated billing branch omits discount',
      fixSummary:
        'Apply the same discount adjustment in the prorated billing branch, or make the no-discount prorated rule explicit with a separate invariant and tests.'
    }
  ],
  [
    'go-build-index-cache-lock-after-build',
    {
      category: 'performance',
      severity: 'high',
      title: 'Cache index build happens outside the cache lock',
      fixSummary:
        'Hold the cache lock across the cache lookup and cache population path, or use singleflight/double-checked locking so concurrent callers cannot race or duplicate the build.'
    }
  ],
  [
    'go-cache-iteration-without-rlock',
    {
      category: 'performance',
      severity: 'high',
      title: 'Shared cache map iteration lacks a read lock',
      fixSummary:
        'Take the cache read lock while iterating the shared map, or copy the entries under lock before computing totals.'
    }
  ]
])

const trustedCandidateIdForEvidence = (evidence: EvidenceRecord): string =>
  `cand_${sha256(
    [
      'deterministic-trusted-rule',
      evidence.ruleId ?? '',
      evidence.location?.path ?? '',
      evidence.location?.startLine ?? 0
    ].join(':')
  ).slice(0, 24)}`

const trustedCandidateTaskIdForEvidence = (evidence: EvidenceRecord): string =>
  `task_${sha256(
    ['deterministic-trusted-rule', evidence.location?.path ?? ''].join(':')
  ).slice(0, 16)}`

const trustedSupportSignalCandidateFromEvidence = (
  evidence: EvidenceRecord
): CandidateFinding | undefined => {
  if (evidence.ruleId === undefined || evidence.location === undefined) {
    return undefined
  }

  const template = trustedRuleFindingTemplates.get(evidence.ruleId)

  if (template === undefined) {
    return undefined
  }

  return CandidateFindingSchema.parse({
    id: trustedCandidateIdForEvidence(evidence),
    taskId: trustedCandidateTaskIdForEvidence(evidence),
    category: template.category,
    severity: template.severity,
    title: template.title,
    description: evidence.summary,
    location: {
      ...evidence.location,
      side: 'new'
    },
    evidenceIds: [evidence.id],
    proposedBy: 'deterministic-trusted-rule',
    fixProposal: {
      summary: template.fixSummary,
      evidenceIds: [evidence.id],
      safety: 'manual-review'
    }
  })
}

const supportSignalCandidatesFromEvidence = (
  evidence: readonly EvidenceRecord[]
): readonly CandidateFinding[] =>
  evidence
    .map(trustedSupportSignalCandidateFromEvidence)
    .filter((candidate): candidate is CandidateFinding => candidate !== undefined)

export const prepareReviewRunnerTaskPlanning = (
  input: ReviewRunnerTaskPlanningInput
): ReviewRunnerTaskPlanningResult => {
  const supportSignalCandidates = supportSignalCandidatesFromEvidence(input.evidence)
  const reviewTasks = planReviewTasks({
    depth: input.depth,
    files: input.files,
    facts: input.facts,
    evidence: input.evidence,
    candidates: supportSignalCandidates,
    ...(input.policyReviewPass === undefined
      ? {}
      : { policyReviewPass: input.policyReviewPass })
  })

  return {
    reviewTasks,
    supportSignalCandidates,
    metrics: {
      taskCount: reviewTasks.length,
      supportSignalCandidateCount: supportSignalCandidates.length
    }
  }
}
