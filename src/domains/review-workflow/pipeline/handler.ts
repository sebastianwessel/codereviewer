import { type Logger } from '@purista/harness'
import {
  type ContextDocument,
  type FindingRefutationRunner,
  type SkillContextDocument,
  type TaskReviewInput,
  type TaskReviewResult,
  type WorkflowReviewTask,
  type WorkflowTaskEvent
} from './agent-contracts.js'
import { type ProviderIssue } from './provider-issues.js'
import { type CandidateFinding } from '../../admission/index.js'
import {
  createContextRetriever,
  type ContextRetriever
} from '../../context-retrieval/index.js'
import { type ContextLedgerEntry } from '../../review-planning/index.js'
import { createStructuredError } from '../../../shared/errors/error-normalizer.js'
import { sha256 } from '../../../shared/hash/hash.js'
import { prepareCandidatesForAdmission } from './admission/review.js'
import { summarizeDiscoveryTelemetry } from './discovery/discovery-telemetry.js'
import { taskReviewInputFor } from './discovery/task-packet.js'
import { tasksForWorkflowInput } from './task-planning.js'
import {
  ReviewTaskExecutionError,
  isReviewTaskExecutionError,
  runQueuedReviewTasks
} from './task-queue.js'
import { completeReviewWorkflow } from './completion.js'
import {
  type ReviewWorkflowInput,
  type ReviewWorkflowOutput
} from './contracts.js'

const boundedWorkflowConcurrency = (
  workflowMaxConcurrentTasks: number | undefined,
  harnessMaxConcurrentTasks: number
): number =>
  Math.min(
    workflowMaxConcurrentTasks ?? harnessMaxConcurrentTasks,
    harnessMaxConcurrentTasks
  )

// Every instruction document any task in this run actually carried, deduplicated
// by path, in first-seen order.
//
// Scoping (spec 04) makes the instruction set a property of a task, so the run's
// set is the union of its tasks' sets rather than a list handed in whole. A run
// where one instruction is scoped to files nothing touched genuinely did not use
// that instruction, and its hash must not appear as if it had.
const instructionsAcrossTasks = (
  tasks: readonly WorkflowReviewTask[]
): readonly ContextDocument[] => {
  const byPath = new Map<string, ContextDocument>()

  for (const task of tasks) {
    for (const instruction of task.instructions) {
      if (!byPath.has(instruction.path)) {
        byPath.set(instruction.path, instruction)
      }
    }
  }

  return [...byPath.values()]
}

const hashAllowedInstructionContent = (
  instructions: readonly ContextDocument[]
): readonly string[] =>
  instructions.map((instruction) => {
    if (!instruction.allowed) {
      throw createStructuredError({
        code: 'instruction_read_denied',
        message: `Instruction file "${instruction.path}" is not allowed for this review run.`,
        category: 'config',
        details: {
          path: instruction.path
        }
      })
    }

    return sha256(instruction.content)
  })

const hashAllowedSkillContent = (
  skills: readonly SkillContextDocument[]
): readonly string[] =>
  skills.map((skill) => {
    if (!skill.allowed) {
      throw createStructuredError({
        code: 'skill_read_denied',
        message: `Skill "${skill.name}" is not allowed for this review run.`,
        category: 'config',
        details: {
          name: skill.name,
          path: skill.path
        }
      })
    }

    return skill.contentHash
  })

const mergeCandidates = (
  inputCandidates: readonly CandidateFinding[],
  proposedCandidates: readonly CandidateFinding[]
): readonly CandidateFinding[] => {
  const candidatesById = new Map<string, CandidateFinding>()

  for (const candidate of [...inputCandidates, ...proposedCandidates]) {
    candidatesById.set(candidate.id, candidate)
  }

  return [...candidatesById.values()]
}

export type ReviewWorkflowTaskRunner = (
  taskInput: TaskReviewInput,
  task: WorkflowReviewTask,
  signal: AbortSignal | undefined,
  contextRetriever: ContextRetriever | undefined
) => Promise<TaskReviewResult>

export const runReviewWorkflowHandler = async (params: {
  readonly input: ReviewWorkflowInput
  readonly signal: AbortSignal | undefined
  readonly logger: Logger
  readonly maxConcurrentTasks: number
  readonly onTaskEvent?: (event: WorkflowTaskEvent) => void
  readonly runTask: ReviewWorkflowTaskRunner
  readonly refuteFinding?: FindingRefutationRunner
}): Promise<ReviewWorkflowOutput> => {
  const { input, logger } = params
  const tasks = tasksForWorkflowInput(input)
  const concurrency = boundedWorkflowConcurrency(
    input.maxConcurrentTasks,
    params.maxConcurrentTasks
  )
  logger.debug('Review workflow handler started.', {
    task_count: tasks.length,
    reviewed_path_count: input.reviewedPaths.length,
    max_concurrent_tasks: concurrency
  })
  const instructionHashes = hashAllowedInstructionContent(
    instructionsAcrossTasks(tasks)
  )
  const skillHashes = hashAllowedSkillContent(input.skills)
  const contextLedgerEntries: ContextLedgerEntry[] = []
  const contextRetriever =
    input.repositoryRoot === undefined
      ? undefined
      : createContextRetriever({
          repositoryRoot: input.repositoryRoot,
          ...(input.contextRetrievalBudget === undefined
            ? {}
            : { budget: input.contextRetrievalBudget }),
          // The operator's configured scope, on the same terms every other
          // mediated lane passes it (verification, impact, intent). Omitting it
          // does not fall back to something stricter: the eligibility gate then
          // compiles `**/*` plus the built-in excludes, so an operator's
          // `paths.exclude` stopped binding on the one surface an untrusted
          // model drives against a live working tree, and cross-file retrieval
          // is on by default.
          ...(input.paths === undefined ? {} : { paths: input.paths }),
          ledgerEntries: contextLedgerEntries
        })
  const queued = await runQueuedReviewTasks<TaskReviewResult>({
    tasks,
    maxConcurrentTasks: concurrency,
    logger,
    ...(params.onTaskEvent === undefined
      ? {}
      : { onTaskEvent: params.onTaskEvent }),
    runTask: async (task) => {
      return params.runTask(
        taskReviewInputFor(input, task),
        task,
        params.signal,
        contextRetriever
      )
    }
  }).catch((error: unknown) => {
    if (isReviewTaskExecutionError(error)) {
      throw new ReviewTaskExecutionError({
        taskEvents: error.taskEvents,
        partialResults: error.partialResults,
        originalError: error.originalError
      })
    }

    throw error
  })

  const taskCandidates = queued.results.flatMap((result) => result.candidates)
  // The sub-tasks discovery actually ran (partitions, reactive split halves). They
  // are the only units carrying a genuine sub-file span, and admission needs them to
  // check a finding's line against what its own call was shown.
  const reviewedTasks = queued.results.flatMap((result) => result.reviewedTasks)
  // What discovery produced, per task, before refutation and admission filtered it
  // (spec 27). Threaded exactly like `reviewedTasks` above, and for the same
  // reason: a number no stage downstream can recompute has to be carried, or it is
  // gone.
  const discovery = summarizeDiscoveryTelemetry(
    queued.results.flatMap((result) =>
      result.discovery === undefined ? [] : [result.discovery]
    )
  )
  const taskEvidenceRecords = queued.results.flatMap(
    (result) => result.evidenceRecords
  )
  const taskProviderIssues = queued.results.flatMap(
    (result) => result.providerIssues
  )
  // Candidates a task itself decided are terminal before admission — today, the
  // non-representative members of a semantic merge group (spec 05). They stay in
  // `candidateFindings` so the report still shows what discovery produced and the
  // rejection resolves to a candidate, but they are held out of refutation: a
  // candidate already known to be terminal must not spend an adjudication slot.
  const taskRejectedFindings = queued.results.flatMap(
    (result) => result.rejectedFindings
  )
  const taskRejectedCandidateIds = new Set(
    taskRejectedFindings.map((finding) => finding.candidateId)
  )
  const mergedCandidates = mergeCandidates(input.candidates, taskCandidates)
  const prepared = await prepareCandidatesForAdmission({
    workflowInput: input,
    // Planned tasks AND the sub-tasks discovery actually ran. A candidate carries
    // the id of the call that raised it, which for a partition (spec 27) or a
    // reactive half (spec 26) is a synthetic id matching nothing in the planned
    // list — so refutation looked up the originating task, found none, and fell
    // back to workflow-wide context for exactly the runs partitioning is on for.
    // The same union `completeReviewWorkflow` already needs, for the same reason:
    // the sub-task is the unit that was reviewed, and it is the unit carrying the
    // instruction set and the review context its candidates must be judged against.
    tasks: [...tasks, ...reviewedTasks],
    candidates: mergedCandidates.filter(
      (candidate) => !taskRejectedCandidateIds.has(candidate.id)
    ),
    reviewEvidence: [...input.evidence, ...taskEvidenceRecords],
    ...(params.refuteFinding === undefined
      ? {}
      : { refuteFinding: params.refuteFinding }),
    ...(params.signal === undefined ? {} : { signal: params.signal }),
    logger
  }).catch((error: unknown) => {
    throw new ReviewTaskExecutionError({
      taskEvents: queued.taskEvents,
      partialResults: queued.results,
      originalError: error
    })
  })

  const providerIssues: ProviderIssue[] = [
    ...taskProviderIssues,
    ...prepared.providerIssues
  ]

  const output = completeReviewWorkflow({
    workflowInput: input,
    reviewedTasks,
    ...(discovery === undefined ? {} : { discovery }),
    candidateFindings: mergedCandidates,
    admissionCandidates: prepared.admissionCandidates,
    artifactOnlyCandidateIds: prepared.artifactOnlyCandidateIds,
    refutationResults: prepared.refutationResults,
    providerIssues,
    contextLedgerEntries,
    evidence: [...prepared.evidence, ...taskEvidenceRecords],
    preRejectedFindings: [...taskRejectedFindings, ...prepared.rejectedFindings],
    preAdmissionDecisions: prepared.admissionDecisions,
    taskEvents: queued.taskEvents,
    instructionHashes,
    skillHashes,
  })

  logger.debug('Review workflow handler completed.', {
    task_event_count: queued.taskEvents.length,
    candidate_count: output.candidateFindings.length,
    admitted_finding_count: output.admittedFindings.length,
    rejected_finding_count: output.rejectedFindings.length
  })

  return output
}
