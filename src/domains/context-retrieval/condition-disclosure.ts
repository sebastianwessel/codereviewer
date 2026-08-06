// Turns an EXPECTED retrieval condition into the tool result the model reads.
//
// A thrown error does not reach the model as itself: the harness normalizes any
// non-harness failure to `ToolError("Tool execution failed.")` and drops the
// message, so a model whose lookup was refused was told only that something broke.
// It then fills the gap with the plausible assumption that the code it meant to
// check is not there — this project's recurring silent-optimism shape, and here it
// was making a documented promise false (specs 12 and 16 both tell the model it
// will be told when a path is not found, not eligible, or a budget is spent).
//
// So a refusal answers in the model's own channel and says what it means. It is
// still CODE that refused: nothing was read, and the refusal is stated as a limit
// of this engine rather than as a finding about the repository.
//
// ONE disclosure shape for every refusal, deliberately: a marker the model cannot
// miss, what did not happen, what it does NOT mean, and what to do instead. The
// text is model-facing, so it is generic and language-neutral (spec 15) and is held
// to that by the prompt-genericity guard. The only variable parts are the tool id
// and the repository-relative path the caller itself supplied; no file content,
// no absolute filesystem path, and no eligibility rule detail is interpolated, so
// nothing here can carry an unredacted secret or reveal an excluded file.

import { isToolCallBudgetExceededError } from './bounded-tools.js'
import {
  isContextRetrievalConditionError,
  type ContextRetrievalCondition
} from './expected-conditions.js'
import type { RepoToolOutput } from './repo-tool-contracts.js'

// The sentence every refusal ends up carrying, because it is the one the model
// gets wrong on its own: a lookup that did not happen is not an observation.
const engineLimitMeaning =
  'This is a limit of this engine, not a fact about the code: it is not evidence that anything is absent, correct, or safe.'

const wrongPathMeaning =
  'This is a fact about this path only, not about the code you are checking: it is not evidence that anything is absent, correct, or safe.'

const decideFromWhatYouHave =
  'Decide from what you have already read, and say that a check you could not complete is unresolved.'

const refusalOutput = (input: {
  readonly toolId: string
  readonly marker: string
  readonly summaryReason: string
  readonly situation: string
  readonly meaning: string
  readonly remedy: string
}): RepoToolOutput => ({
  summary: `${input.toolId} was refused: ${input.summaryReason}`,
  content: `[${input.marker}: ${input.toolId} did NOT run and returned no repository content. ${input.situation} ${input.meaning} ${input.remedy}]`
})

// Quoted when the condition carries one; the two budget conditions carry none, and
// a path condition without one is not reachable — the fallback exists so the
// disclosure degrades to a still-true sentence instead of printing `undefined`.
const requestedPathPhrase = (portablePath: string | undefined): string =>
  portablePath === undefined ? 'the requested path' : `"${portablePath}"`

const conditionDisclosure: Record<
  ContextRetrievalCondition,
  (input: {
    readonly toolId: string
    readonly portablePath: string | undefined
  }) => RepoToolOutput
> = {
  'path-not-eligible': ({ toolId, portablePath }) =>
    refusalOutput({
      toolId,
      marker: 'PATH NOT ELIGIBLE',
      summaryReason: 'the requested path is not eligible for repository retrieval.',
      situation: `The path ${requestedPathPhrase(
        portablePath
      )} is outside what this engine will retrieve; hidden, generated, dependency, and operator-excluded paths are never served.`,
      meaning: engineLimitMeaning,
      remedy:
        'Ask for a different path, and say that a check you could not complete is unresolved.'
    }),
  'path-not-found': ({ toolId, portablePath }) =>
    refusalOutput({
      toolId,
      marker: 'PATH NOT FOUND',
      summaryReason: 'the requested path was not found in the repository.',
      situation: `No file or directory exists at ${requestedPathPhrase(
        portablePath
      )}.`,
      meaning: wrongPathMeaning,
      remedy:
        'Use repo_grep to locate the path you meant, and say that a check you could not complete is unresolved.'
    }),
  'read-budget-exhausted': ({ toolId }) =>
    refusalOutput({
      toolId,
      marker: 'READ BUDGET EXHAUSTED',
      summaryReason: "this call's repository read budget is exhausted.",
      situation: 'You have no file reads or directory listings left in this call.',
      meaning: engineLimitMeaning,
      remedy: decideFromWhatYouHave
    }),
  'search-budget-exhausted': ({ toolId }) =>
    refusalOutput({
      toolId,
      marker: 'SEARCH BUDGET EXHAUSTED',
      summaryReason: "this call's repository search budget is exhausted.",
      situation: 'You have no searches left in this call.',
      meaning: engineLimitMeaning,
      remedy: decideFromWhatYouHave
    })
}

// The scope's tool-call bound. Not a retriever condition — it is the wrapper in
// `bounded-tools.ts` refusing before the retriever is reached — but it is expected
// for the same reason and is disclosed in the same shape, so the model never has to
// learn two vocabularies for "your lookup did not happen".
const toolCallBudgetDisclosure = (toolId: string): RepoToolOutput =>
  refusalOutput({
    toolId,
    marker: 'TOOL-CALL BUDGET EXHAUSTED',
    summaryReason: "this call's repository tool-call budget is exhausted.",
    situation: 'You have no lookups left in this call.',
    meaning: engineLimitMeaning,
    remedy: decideFromWhatYouHave
  })

/**
 * The tool result for an expected condition, or `undefined` when the failure is
 * not one — in which case the caller must let it propagate as the fault it is.
 */
export const disclosedRetrievalCondition = (input: {
  readonly toolId: string
  readonly error: unknown
}): RepoToolOutput | undefined => {
  if (isToolCallBudgetExceededError(input.error)) {
    return toolCallBudgetDisclosure(input.toolId)
  }

  if (isContextRetrievalConditionError(input.error)) {
    return conditionDisclosure[input.error.condition]({
      toolId: input.toolId,
      portablePath: input.error.portablePath
    })
  }

  return undefined
}

/**
 * Runs a mediated repository tool handler, disclosing an expected condition as
 * tool-result content and letting every other failure propagate.
 *
 * Shared by every lane that exposes these tools (spec 12's `investigate_claim`,
 * spec 16's tool-enabled discovery and spec 05's refutation) so a refusal reads the
 * same whichever lane the model is running in.
 */
export const withDisclosedRetrievalCondition = async (
  toolId: string,
  invoke: () => Promise<RepoToolOutput>
): Promise<RepoToolOutput> => {
  try {
    return await invoke()
  } catch (error: unknown) {
    const disclosure = disclosedRetrievalCondition({ toolId, error })

    if (disclosure === undefined) {
      throw error
    }

    return disclosure
  }
}
