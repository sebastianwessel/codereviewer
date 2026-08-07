import { assertDeterministicSignalEvidenceOwnsPath } from '../../../deterministic-signals/index.js'
import {
  TaskReviewInputSchema,
  type TaskReviewInput,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import {
  pathFromCandidate,
  pathFromEvidence,
  taskCoversPath
} from '../task-planning.js'
import { type ReviewWorkflowInput } from '../contracts.js'
import {
  createTaskPacketBudgetExceededError,
  serializedBytes
} from '../packet-budget.js'
import { partitionTaskForDiscovery } from './discovery-partition.js'
import { buildSecurityReviewText } from './holistic-task-review.js'
import { buildReviewText, holisticReviewInputFor } from './review-packet.js'

/**
 * The largest packet the discovery calls for this task will actually send.
 *
 * A `TaskReviewInput` is the material discovery is assembled FROM, not what it
 * transmits: a discovery call sends `{taskId, paths, reviewText}` and nothing
 * else, and `reviewText` is a rendered document that includes the unified diff
 * (which the task input does not carry at all) and line-number prefixes on every
 * source line (which it does not carry either). Measuring the task input was
 * therefore measuring a different object from the one being guarded, and it was
 * wrong in BOTH directions — over-counting the fields that are never sent, and
 * under-counting the diff and the numbering that always are. Measured on this
 * repository over a 38-file change in 10 tasks, the counted size ranged from
 * 0.99x to 3.08x the largest packet the task actually sends (0.71x to 1.22x the
 * undivided one); the cases below 1.0x are the ones that matter, because a guard
 * that under-measures admits a packet it was placed there to refuse.
 *
 * Every call a task issues is measured, and the largest wins:
 *
 * - one packet per discovery PARTITION (spec 27), because a partition is the unit
 *   a call is issued for. Taking the maximum rather than the whole undivided task
 *   is what keeps the guard from refusing a task whose calls each fit;
 * - both passes when the dedicated security pass is on (spec 15). Its packet is
 *   the general one plus two static blocks, so it is strictly the larger of the
 *   two and it is the one a byte ceiling has to be checked against.
 *
 * Reactive splitting (spec 26) only ever makes a packet smaller, so it needs no
 * measurement here.
 *
 * What is deliberately NOT counted, unchanged from before: the agent's own
 * instruction text and output schema, which the harness sends alongside every
 * packet. They are a per-agent constant of a few kilobytes, they belong to the
 * agent definition rather than to this task, and the ceiling this guards is a
 * packet ceiling. A run whose margin is a few kilobytes wide is one the provider
 * decides, which is the arrangement spec 26 asks for.
 */
const largestDiscoveryPacketBytes = (
  taskInput: TaskReviewInput,
  input: ReviewWorkflowInput
): number => {
  const rawDiff = input.reviewedDiffText
  const partitions = partitionTaskForDiscovery(
    taskInput.task,
    input.maxFilesPerDiscoveryCall
  )
  let largest = 0

  for (const partition of partitions) {
    const partitionInput: TaskReviewInput = { ...taskInput, task: partition }
    const reviewTexts = [
      buildReviewText(partitionInput, rawDiff),
      ...(input.securityPassEnabled
        ? [buildSecurityReviewText(partitionInput, rawDiff)]
        : [])
    ]

    for (const reviewText of reviewTexts) {
      largest = Math.max(
        largest,
        serializedBytes(holisticReviewInputFor(partition, reviewText))
      )
    }
  }

  return largest
}

/**
 * Refuse a task whose discovery packet exceeds the configured provider input
 * budget.
 *
 * There is nothing to shed. The packet used to drop the shared digest before
 * refusing, which read as a reduction and was not one: the digest never reaches a
 * discovery prompt at all (verified over every packet this repository's own change
 * produces — the digest text appeared in none of them), so replacing it shrank
 * only the guard's own arithmetic. What that step actually did was let a packet
 * through by making the measurement smaller, which is the failure a budget exists
 * to prevent. It is gone; the guard refuses, and refuses loudly, exactly as spec
 * 26 requires of a ceiling that never truncates. The digest field itself is gone
 * from `TaskReviewInput` too, for the same reason the shedding was: a value no
 * discovery call transmits could only ever distort what this guard measures.
 */
const assertDiscoveryPacketWithinBudget = (
  taskInput: TaskReviewInput,
  input: ReviewWorkflowInput
): void => {
  if (input.maxTaskInputBytes === undefined) {
    return
  }

  const packetBytes = largestDiscoveryPacketBytes(taskInput, input)

  if (packetBytes <= input.maxTaskInputBytes) {
    return
  }

  throw createTaskPacketBudgetExceededError({
    taskId: taskInput.task.id,
    maxTaskInputBytes: input.maxTaskInputBytes,
    serializedBytes: packetBytes
  })
}

export const taskReviewInputFor = (
  input: ReviewWorkflowInput,
  task: WorkflowReviewTask,
  sharedDigest: string
): TaskReviewInput => {
  const evidence = input.evidence.filter((record) =>
    task.evidenceIds.length > 0
      ? task.evidenceIds.includes(record.id)
      : taskCoversPath(task, pathFromEvidence(record))
  )

  for (const record of evidence) {
    assertDeterministicSignalEvidenceOwnsPath(record)
  }

  const taskInput = TaskReviewInputSchema.parse({
    task,
    reviewedDiffRanges: (input.reviewedDiffRanges ?? []).filter((range) =>
      taskCoversPath(task, range.path)
    ),
    evidence,
    candidates: input.candidates.filter((candidate) =>
      task.candidateIds.length > 0
        ? task.candidateIds.includes(candidate.id)
        : taskCoversPath(task, pathFromCandidate(candidate))
    ),
    // No `instructions` key: the task's own, scope-resolved instruction
    // documents travel inside `task` (see `TaskReviewInputSchema`).
    skills: input.skills,
    sharedDigest,
    provenance: input.provenance
  })

  assertDiscoveryPacketWithinBudget(taskInput, input)

  return taskInput
}
