// The conditions the mediated retrieval surface EXPECTS a caller — in practice a
// model driving `repo_read`/`repo_list`/`repo_grep` — to hit, and which that caller
// can act on: a path it may not have, a path that is not there, and the two
// per-retriever budgets running out.
//
// They carry a TYPE, not just a message, because the distinction they make is a
// security one. An expected condition is disclosed to the model as an ordinary tool
// result (`condition-disclosure.ts`); everything else stays a fault and propagates.
// Path containment is on the fault side: an escape from the repository root is an
// invariant breach and must never be softened into a result the model shrugs off.
// That classification used to be made by matching prose — a regex for
// `/resolve inside the root/` against an error message owned by `path-service` —
// so a reword in another module would have silently reclassified a containment
// breach as an ordinary miss. A type cannot be reworded by accident.
//
// Membership is deliberately CLOSED and small: exactly the four conditions the
// retriever raises as part of normal operation. Anything else — a containment
// breach, an unreadable path, a tool called outside its scope, a bug — is a fault,
// because a fault disguised as an answer is worse than a fault.

export const contextRetrievalConditions = [
  'path-not-eligible',
  'path-not-found',
  'read-budget-exhausted',
  'search-budget-exhausted'
] as const

export type ContextRetrievalCondition =
  (typeof contextRetrievalConditions)[number]

export class ContextRetrievalConditionError extends Error {
  readonly condition: ContextRetrievalCondition
  // The repository-relative path the caller asked for, for the two path
  // conditions. Never the resolved absolute filesystem path, so the error stays
  // safe to surface to a model.
  readonly portablePath: string | undefined

  constructor(input: {
    readonly condition: ContextRetrievalCondition
    readonly message: string
    readonly portablePath?: string
  }) {
    super(input.message)
    this.name = 'ContextRetrievalConditionError'
    this.condition = input.condition
    this.portablePath = input.portablePath
  }
}

export const isContextRetrievalConditionError = (
  error: unknown
): error is ContextRetrievalConditionError =>
  error instanceof ContextRetrievalConditionError

// Raised for a path that resolved and passed containment, but that the eligibility
// gate (dotfiles, dependency/build directories, configured paths.include/exclude)
// rejects. Eligibility is decided from the path alone, before existence is checked,
// so this answer reveals nothing about whether the path is there.
export const pathNotEligibleCondition = (
  portablePath: string,
  reason: string
): ContextRetrievalConditionError =>
  new ContextRetrievalConditionError({
    condition: 'path-not-eligible',
    portablePath,
    message: `Path "${portablePath}" is not eligible for context retrieval: ${reason}.`
  })

export const pathNotFoundCondition = (
  portablePath: string
): ContextRetrievalConditionError =>
  new ContextRetrievalConditionError({
    condition: 'path-not-found',
    portablePath,
    message: `Path "${portablePath}" was not found in the repository.`
  })

export const readBudgetExhaustedCondition =
  (): ContextRetrievalConditionError =>
    new ContextRetrievalConditionError({
      condition: 'read-budget-exhausted',
      message: 'Context retrieval read budget exceeded.'
    })

export const searchBudgetExhaustedCondition =
  (): ContextRetrievalConditionError =>
    new ContextRetrievalConditionError({
      condition: 'search-budget-exhausted',
      message: 'Context retrieval search budget exceeded.'
    })
