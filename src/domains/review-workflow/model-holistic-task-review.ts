import {
  ModelSuspicionDropReasonSchema,
  ModelTaskDiagnosticSchema
} from '../../shared/contracts/index.js'
import {
  CandidateFindingSchema,
  type CandidateFinding
} from '../admission/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import {
  ModelHolisticReviewResultSchema,
  ModelSuspicionSuggestionSchema,
  type HolisticReviewRunner,
  type TaskReviewInput,
  type TaskReviewResult,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { type ReviewWorkflowInput } from './workflow-contracts.js'

type HolisticTaskReviewLogger = {
  readonly debug: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}

// Upper bound on candidates emitted per task. Holistic discovery favors recall,
// but every candidate costs one downstream refutation call, so we bound it. The
// refutation/judge filter (not this cap) is what controls precision.
const HOLISTIC_MAX_CANDIDATES = 12

// Holistic discovery emits candidates directly (no suspicion drop pipeline), so
// every suspicion drop-reason count is zero. The diagnostic schema requires all
// enum keys, so zero-fill them from the enum (stays correct if the enum grows).
const EMPTY_DROP_REASON_COUNTS: Readonly<Record<string, number>> =
  Object.fromEntries(
    ModelSuspicionDropReasonSchema.options.map((reason) => [reason, 0])
  )

const candidateFromFinding = (
  task: WorkflowReviewTask,
  raw: unknown
): CandidateFinding | undefined => {
  const parsed = ModelSuspicionSuggestionSchema.safeParse(raw)

  if (!parsed.success) {
    return undefined
  }

  const finding = parsed.data

  if (
    finding.category === undefined ||
    finding.severity === undefined ||
    finding.title === undefined ||
    finding.description === undefined ||
    finding.path === undefined ||
    finding.startLine === undefined ||
    !task.paths.includes(finding.path)
  ) {
    return undefined
  }

  const id = `cand_${sha256(
    `${task.id}:${finding.path}:${finding.startLine}:${finding.title}`
  ).slice(0, 16)}`

  return CandidateFindingSchema.parse({
    id,
    taskId: task.id,
    category: finding.category,
    severity: finding.severity,
    title: finding.title.slice(0, 120),
    description: finding.description.slice(0, 1200),
    location: {
      path: finding.path,
      startLine: finding.startLine,
      side: 'file'
    },
    evidenceIds: [],
    proposedBy: 'review-agent',
    ...(finding.fixSummary === undefined
      ? {}
      : { suggestedFix: finding.fixSummary })
  })
}

// Holistic discovery: one recall-first whole-change review per task that emits
// candidate findings directly. No suspicion/investigation/proof loop runs here;
// the shared refutation + judge + admission filter (prepareCandidatesForAdmission)
// verifies or discards every candidate downstream, exactly as it does for
// suspicion-mode candidates.
export const runModelBackedHolisticTaskReview = async (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly taskInput: TaskReviewInput
    readonly task: WorkflowReviewTask
    readonly runners: { readonly holisticReview: HolisticReviewRunner }
    readonly logger: HolisticTaskReviewLogger
    readonly signal?: AbortSignal | undefined
  }
): Promise<TaskReviewResult> => {
  const result = ModelHolisticReviewResultSchema.parse(
    await input.runners.holisticReview(input.taskInput, input.signal)
  )

  const candidatesById = new Map<string, CandidateFinding>()
  let droppedCount = 0

  for (const raw of result.findings) {
    if (candidatesById.size >= HOLISTIC_MAX_CANDIDATES) {
      break
    }

    const candidate = candidateFromFinding(input.task, raw)

    if (candidate === undefined) {
      droppedCount += 1
      continue
    }

    candidatesById.set(candidate.id, candidate)
  }

  const candidates = [...candidatesById.values()]

  input.logger.debug('Holistic task review completed.', {
    task_id: input.task.id,
    finding_count: result.findings.length,
    candidate_count: candidates.length,
    dropped_count: droppedCount
  })

  return {
    candidates,
    evidenceRecords: [],
    modelSuspicions: [],
    investigationTraces: [],
    proofPackets: [],
    refutationResults: [],
    aggregateResults: [],
    promotionDecisions: [],
    providerIssues: [],
    modelTaskDiagnostics: [
      ModelTaskDiagnosticSchema.parse({
        taskId: input.task.id,
        taskKind: input.task.kind,
        round: input.task.round,
        paths: input.task.paths,
        evidenceCount: input.taskInput.evidence.length,
        reviewContextCount: input.task.reviewContext.length,
        reviewIntentCount: input.taskInput.reviewIntents.length,
        verificationQuestionCount: input.taskInput.reviewIntents.reduce(
          (count, intent) => count + intent.verificationQuestions.length,
          0
        ),
        suggestionCount: result.findings.length,
        convertedCandidateCount: candidates.length,
        selectedCandidateCount: candidates.length,
        budgetDroppedCandidateCount: 0,
        modelSuspicionCount: 0,
        proofPacketCount: 0,
        zeroCandidateReason:
          candidates.length > 0
            ? 'none'
            : result.findings.length === 0
              ? 'no-suggestions'
              : 'all-suggestions-dropped',
        droppedSuspicionReasons: EMPTY_DROP_REASON_COUNTS
      })
    ]
  }
}
