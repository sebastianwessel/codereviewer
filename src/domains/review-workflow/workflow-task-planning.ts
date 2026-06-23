import {
  ReviewIntentSchema,
  type EvidenceRecord,
  type ReviewIntent
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import {
  IntentPlanningInputSchema,
  WorkflowReviewTaskSchema,
  type IntentPlanningInput,
  type ModelReviewIntentPlan,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { type ReviewWorkflowInput } from './workflow-contracts.js'

const taskIdForPath = (path: string): string =>
  `task_${sha256(path).slice(0, 16)}`

export const pathFromEvidence = (
  evidence: EvidenceRecord
): string | undefined => evidence.location?.path

export const pathFromCandidate = (candidate: CandidateFinding): string =>
  candidate.location.path

export const taskCoversPath = (
  task: WorkflowReviewTask,
  path: string | undefined
): boolean => path !== undefined && task.paths.includes(path)

export const tasksForWorkflowInput = (
  input: ReviewWorkflowInput
): readonly WorkflowReviewTask[] => {
  const inputTasks = input.tasks ?? []
  const inputReviewContext = input.reviewContext ?? []

  if (inputTasks.length > 0) {
    return inputTasks.map((task) =>
      task.reviewContext.length > 0
        ? task
        : WorkflowReviewTaskSchema.parse({
            ...task,
            reviewContext: inputReviewContext.filter(
              (context) =>
                context.path === undefined ||
                task.paths.includes(context.path)
            )
          })
    )
  }

  return input.reviewedPaths.map((path) =>
    WorkflowReviewTaskSchema.parse({
      id: taskIdForPath(path),
      round: 1,
      kind: 'file',
      paths: [path],
      factIds: [],
      evidenceIds: input.evidence
        .filter((evidence) => pathFromEvidence(evidence) === path)
        .map((evidence) => evidence.id),
      candidateIds: input.candidates
        .filter((candidate) => pathFromCandidate(candidate) === path)
        .map((candidate) => candidate.id),
      reviewContext: inputReviewContext.filter(
        (context) => context.path === undefined || context.path === path
      ),
      contextEntryIds: inputReviewContext
        .filter((context) => context.path === undefined || context.path === path)
        .map((context) => context.ledgerEntryId),
      priority: 0
    })
  )
}

const reviewIntentIdFor = (
  source: ReviewIntent['source'],
  taskIds: readonly string[],
  paths: readonly string[]
): string =>
  `intent_${sha256(`${source}:${taskIds.join('|')}:${paths.join('|')}`).slice(0, 16)}`

const defaultVerificationQuestionForTask = (
  task: WorkflowReviewTask
): string =>
  task.paths.length === 1
    ? `Does the reviewed change in ${task.paths[0]} preserve the intended behavior without introducing a concrete bug, security issue, or reliability regression?`
    : `Do the reviewed ${task.kind} changes preserve the intended behavior across their related paths without introducing a concrete defect?`

export const deterministicReviewIntentsForTasks = (
  tasks: readonly WorkflowReviewTask[]
): readonly ReviewIntent[] =>
  tasks.map((task) =>
    ReviewIntentSchema.parse({
      id: reviewIntentIdFor('deterministic', [task.id], task.paths),
      title:
        task.paths.length === 1
          ? `Review ${task.paths[0]}`
          : `Review ${task.kind} task`,
      objective:
        task.objective ??
        `Verify the reviewed ${task.kind} task end to end within its provided paths and evidence.`,
      paths: task.paths,
      taskIds: [task.id],
      focusAreas: task.focusAreas ?? [],
      riskAreas: task.riskAreas ?? [],
      verificationQuestions: task.verificationQuestions ?? [
        defaultVerificationQuestionForTask(task)
      ],
      source: 'deterministic'
    })
  )

export const intentPlanningInputFor = (
  input: ReviewWorkflowInput,
  tasks: readonly WorkflowReviewTask[]
): IntentPlanningInput =>
  IntentPlanningInputSchema.parse({
    runId: input.runId,
    reviewedPaths: input.reviewedPaths,
    reviewedDiffRanges: input.reviewedDiffRanges ?? [],
    tasks: tasks.map((task) => ({
      id: task.id,
      kind: task.kind,
      paths: task.paths,
      evidenceIds: task.evidenceIds,
      candidateIds: task.candidateIds,
      focusAreas: task.focusAreas ?? [],
      riskAreas: task.riskAreas ?? [],
      verificationQuestions: task.verificationQuestions ?? []
    })),
    evidenceSummaries: input.evidence.slice(0, 200).map((record) => ({
      id: record.id,
      kind: record.kind,
      ...(record.location?.path === undefined
        ? {}
        : { path: record.location.path }),
      summary: record.summary
    })),
    candidateSummaries: input.candidates.slice(0, 200).map((candidate) => ({
      id: candidate.id,
      path: candidate.location.path,
      title: candidate.title,
      category: candidate.category,
      severity: candidate.severity
    }))
  })

export const normalizeModelReviewIntentPlan = (
  tasks: readonly WorkflowReviewTask[],
  plan: ModelReviewIntentPlan
): readonly ReviewIntent[] => {
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const usedTaskIds = new Set<string>()
  const intents: ReviewIntent[] = []

  for (const suggestion of plan.intents) {
    const selectedTasks = suggestion.taskIds
      .map((taskId) => tasksById.get(taskId))
      .filter((task): task is WorkflowReviewTask => task !== undefined)

    if (selectedTasks.length === 0) {
      continue
    }

    const taskIds = selectedTasks.map((task) => task.id)
    const taskPathSet = new Set(selectedTasks.flatMap((task) => task.paths))
    const paths = [...new Set(suggestion.paths ?? [...taskPathSet])]
      .filter((path) => taskPathSet.has(path))
      .sort((left, right) => left.localeCompare(right))

    if (paths.length === 0) {
      continue
    }

    for (const taskId of taskIds) {
      usedTaskIds.add(taskId)
    }

    intents.push(
      ReviewIntentSchema.parse({
        id: reviewIntentIdFor('model', taskIds, paths),
        title: suggestion.title,
        objective: suggestion.objective,
        paths,
        taskIds,
        focusAreas: suggestion.focusAreas,
        riskAreas: suggestion.riskAreas,
        verificationQuestions: suggestion.verificationQuestions,
        source: 'model'
      })
    )
  }

  const fallbackTasks = tasks.filter((task) => !usedTaskIds.has(task.id))

  return [
    ...intents,
    ...deterministicReviewIntentsForTasks(fallbackTasks)
  ]
}

export const applyReviewIntentsToTasks = (
  tasks: readonly WorkflowReviewTask[],
  reviewIntents: readonly ReviewIntent[]
): readonly WorkflowReviewTask[] => {
  const intentsByTaskId = new Map<string, ReviewIntent>()

  for (const intent of reviewIntents) {
    for (const taskId of intent.taskIds) {
      intentsByTaskId.set(taskId, intent)
    }
  }

  return tasks.map((task) => {
    const intent = intentsByTaskId.get(task.id)

    if (intent === undefined) {
      return task
    }

    return WorkflowReviewTaskSchema.parse({
      ...task,
      intentId: intent.id,
      objective: intent.objective,
      focusAreas: intent.focusAreas,
      riskAreas: intent.riskAreas,
      verificationQuestions: intent.verificationQuestions
    })
  })
}

const sortedUniqueValues = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right))

const mergeReviewContext = (
  tasks: readonly WorkflowReviewTask[]
): WorkflowReviewTask['reviewContext'] => {
  const seen = new Set<string>()
  const merged: WorkflowReviewTask['reviewContext'] = []

  for (const context of tasks.flatMap((task) => task.reviewContext)) {
    if (seen.has(context.ledgerEntryId)) {
      continue
    }
    seen.add(context.ledgerEntryId)
    merged.push(context)
  }

  return merged
}

const intentClusterTaskIdFor = (intent: ReviewIntent): string =>
  `task_intent_${sha256(intent.id).slice(0, 16)}`

export const executionTasksForReviewIntents = (
  tasks: readonly WorkflowReviewTask[],
  reviewIntents: readonly ReviewIntent[],
  options: {
    readonly canUseClusterTask?: (task: WorkflowReviewTask) => boolean
  } = {}
): readonly WorkflowReviewTask[] => {
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const consumedTaskIds = new Set<string>()
  const executionTasks: WorkflowReviewTask[] = []

  for (const intent of reviewIntents) {
    if (intent.source !== 'model' || intent.taskIds.length < 2) {
      continue
    }

    const selectedTasks = intent.taskIds
      .map((taskId) => tasksById.get(taskId))
      .filter((task): task is WorkflowReviewTask => task !== undefined)
      .filter((task) => !consumedTaskIds.has(task.id))
    const rounds = new Set(selectedTasks.map((task) => task.round))

    if (selectedTasks.length < 2 || rounds.size !== 1) {
      continue
    }

    const clusterTask = WorkflowReviewTaskSchema.parse({
      id: intentClusterTaskIdFor(intent),
      round: selectedTasks[0]!.round,
      kind: 'dependency-cluster',
      paths: sortedUniqueValues(selectedTasks.flatMap((task) => task.paths)),
      factIds: sortedUniqueValues(selectedTasks.flatMap((task) => task.factIds)),
      evidenceIds: sortedUniqueValues(
        selectedTasks.flatMap((task) => task.evidenceIds)
      ),
      candidateIds: sortedUniqueValues(
        selectedTasks.flatMap((task) => task.candidateIds)
      ),
      contextEntryIds: sortedUniqueValues(
        selectedTasks.flatMap((task) => task.contextEntryIds)
      ),
      intentId: intent.id,
      objective: intent.objective,
      focusAreas: intent.focusAreas,
      riskAreas: intent.riskAreas,
      verificationQuestions: intent.verificationQuestions,
      reviewContext: mergeReviewContext(selectedTasks),
      priority: Math.min(...selectedTasks.map((task) => task.priority))
    })

    if (options.canUseClusterTask?.(clusterTask) === false) {
      continue
    }

    for (const task of selectedTasks) {
      consumedTaskIds.add(task.id)
    }

    executionTasks.push(clusterTask)
  }

  return [
    ...executionTasks,
    ...tasks.filter((task) => !consumedTaskIds.has(task.id))
  ].sort(
    (left, right) =>
      left.round - right.round ||
      left.priority - right.priority ||
      left.id.localeCompare(right.id)
  )
}
