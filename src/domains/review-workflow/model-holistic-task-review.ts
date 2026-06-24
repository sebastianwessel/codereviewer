import {
  CandidateFindingSchema,
  type CandidateFinding
} from '../admission/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import {
  ModelHolisticFindingSchema,
  ModelHolisticReviewResultSchema,
  type HolisticReviewRunner,
  type TaskReviewInput,
  type TaskReviewResult,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { type ReviewWorkflowInput } from './workflow-contracts.js'

// Present the changed source to the holistic reviewer as a clean, line-numbered
// document (plus the diff ranges). This is the input shape that let whole-file
// holistic review out-recall the gauntlet in probes; burying the source inside a
// structured packet dilutes whole-file reasoning. Extract the unified-diff
// segments for the task's paths from the raw diff blob (the blob covers all
// changed files; split on `diff --git` file headers).
const diffSegmentsForPaths = (
  rawDiff: string,
  paths: readonly string[]
): string => {
  if (rawDiff.trim().length === 0) {
    return ''
  }

  const headerPattern = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/u
  const segments: string[] = []
  let current: string[] | undefined
  let currentPath: string | undefined

  const flush = (): void => {
    if (
      current !== undefined &&
      currentPath !== undefined &&
      paths.includes(currentPath)
    ) {
      segments.push(current.join('\n'))
    }
  }

  for (const line of rawDiff.split('\n')) {
    const match = headerPattern.exec(line)

    if (match !== null) {
      flush()
      current = [line]
      currentPath = match[2] ?? match[1]
      continue
    }

    if (current !== undefined) {
      current.push(line)
    }
  }

  flush()

  return segments.join('\n\n')
}

const buildReviewText = (taskInput: TaskReviewInput, rawDiff: string): string => {
  const files = taskInput.task.reviewContext
    .filter(
      (entry): entry is typeof entry & { readonly path: string } =>
        typeof entry.content === 'string' &&
        entry.content.length > 0 &&
        typeof entry.path === 'string' &&
        taskInput.task.paths.includes(entry.path)
    )
    .map((entry) => {
      const numbered = entry.content
        .split('\n')
        .map((line, index) => `${index + 1}: ${line}`)
        .join('\n')
      return `### FILE: ${entry.path}\n${numbered}`
    })
    .join('\n\n')

  // Prefer the actual unified diff (before/after); fall back to line ranges when
  // the raw diff is unavailable (e.g. explicit-file runs with no diff).
  const diffText = diffSegmentsForPaths(rawDiff, taskInput.task.paths)
  const diffRanges = taskInput.reviewedDiffRanges
    .map(
      (range) =>
        `${range.path} lines ${range.startLine}-${range.endLine}${
          range.changeKind === undefined ? '' : ` (${range.changeKind})`
        }`
    )
    .join('\n')
  const changeSection =
    diffText.length > 0
      ? `\n## Diff - exactly what this change modified (review this closely)\n\`\`\`diff\n${diffText}\n\`\`\``
      : diffRanges.length === 0
        ? ''
        : `\n## Reviewed diff ranges (what changed)\n${diffRanges}`

  return [
    `Review task ${taskInput.task.id}.`,
    changeSection,
    `\n## Changed files (full content, line-numbered, for context)\n${
      files.length === 0 ? '(no file content provided)' : files
    }`
  ].join('\n')
}

type HolisticTaskReviewLogger = {
  readonly debug: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}

// Upper bound on candidates emitted per task. Holistic discovery favors recall,
// but every candidate costs one downstream refutation call, so we bound it. The
// refutation filter (not this cap) is what controls precision.
const HOLISTIC_MAX_CANDIDATES = 12

const candidateFromFinding = (
  task: WorkflowReviewTask,
  raw: unknown
): CandidateFinding | undefined => {
  const parsed = ModelHolisticFindingSchema.safeParse(raw)

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
// candidate findings directly. The shared refutation + admission filter
// (prepareCandidatesForAdmission) verifies or discards every candidate
// downstream.
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
    await input.runners.holisticReview(
      {
        runId: input.taskInput.runId,
        taskId: input.task.id,
        paths: [...input.task.paths],
        reviewText: buildReviewText(
          input.taskInput,
          input.workflowInput.reviewedDiffText
        )
      },
      input.signal
    )
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
    providerIssues: []
  }
}
