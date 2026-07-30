// Spec 26: split a review task ONLY when the provider refuses it as too large.
//
// Assembly sends the change whole. If the provider accepts it, the review is the
// whole-file holistic one this project measured as out-recalling the chunked
// alternative. If the provider refuses, the task is halved and each half retried,
// recursing until the pieces are accepted — so the provider's own limit is the only
// authority and no value has to be chosen correctly in advance.

import { splitContentInHalf } from '../../../../shared/text/line-chunks.js'
import {
  type ReviewContextDocument,
  type TaskReviewInput,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { partitionReviewContext, subTaskFrom } from './task-context-split.js'

// A runaway guard, NOT a ration. It exists so a provider that refuses every packet
// — for a reason unrelated to size, or because a single indivisible document is
// genuinely too large — cannot recurse forever. Depth 6 allows up to 64 pieces,
// which is far past any split a real change needs; a task that reaches it has a
// problem that halving is not going to solve, and says so loudly. This is
// deliberately the same shape as `maxToolCallsPerTask`, which bounds a model that
// never stops requesting reads rather than rationing the reads it may make.
export const MAX_REACTIVE_SPLIT_DEPTH = 6

/**
 * Split a task's review context into two halves, or report that it cannot be split.
 *
 * Review targets (`kind: 'file'`) are what gets halved, because they are what makes
 * a packet large and what the review is actually about. Context-only documents
 * (referenced definitions, change intent, support signals) follow their path into
 * the half that reviews it; ones with no path — change intent describes the whole
 * change — go to BOTH halves, since dropping them from either would silently review
 * that half with less context than the whole task had.
 *
 * Returns `undefined` when there is nothing left to halve, which is the caller's
 * signal to fail loudly rather than retry the same packet forever.
 */
export const splitTaskInHalf = (
  task: WorkflowReviewTask
): readonly [WorkflowReviewTask, WorkflowReviewTask] | undefined => {
  const { targets, contextOnly } = partitionReviewContext(task)

  const halves = ((): readonly [
    readonly ReviewContextDocument[],
    readonly ReviewContextDocument[]
  ] | undefined => {
    if (targets.length >= 2) {
      const midpoint = Math.ceil(targets.length / 2)
      return [targets.slice(0, midpoint), targets.slice(midpoint)]
    }

    const only = targets[0]

    if (only === undefined) {
      // Nothing reviewable to halve. Splitting the context-only documents would
      // produce two tasks that can raise no finding at all, which is a worse
      // outcome than saying the task cannot be split.
      return undefined
    }

    const pieces = splitContentInHalf(only.content, only.startLine ?? 1)

    if (pieces === undefined) {
      return undefined
    }

    return [
      [{ ...only, content: pieces[0].content, startLine: pieces[0].startLine, endLine: pieces[0].endLine }],
      [{ ...only, content: pieces[1].content, startLine: pieces[1].startLine, endLine: pieces[1].endLine }]
    ]
  })()

  if (halves === undefined) {
    return undefined
  }

  return [
    subTaskFrom(task, 'split:a', halves[0], contextOnly),
    subTaskFrom(task, 'split:b', halves[1], contextOnly)
  ]
}

export const splitTaskInputInHalf = (
  taskInput: TaskReviewInput
): readonly [TaskReviewInput, TaskReviewInput] | undefined => {
  const tasks = splitTaskInHalf(taskInput.task)

  return tasks === undefined
    ? undefined
    : [
        { ...taskInput, task: tasks[0] },
        { ...taskInput, task: tasks[1] }
      ]
}
