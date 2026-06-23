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

// The trusted deterministic-rule promotion mechanism is retained: any evidence
// record whose ruleId matches an entry here is promoted into an admission-exempt
// support-signal candidate. The previous entries keyed benchmark-specific rule
// IDs (dayjs, slot-end, prorated, authorization, BuildIndex cache lock, cache
// iteration); those deterministic rules were removed as eval-gaming, so no
// evidence carries those rule IDs anymore and the map is intentionally empty.
const trustedRuleFindingTemplates: ReadonlyMap<
  string,
  TrustedRuleFindingTemplate
> = new Map()

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
    candidates: supportSignalCandidates
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
