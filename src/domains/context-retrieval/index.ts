export {
  ContextRetrievalBudgetSchema,
  type ContextRetrievalBudget
} from './budget.js'
export {
  createContextRetriever,
  type ContextRetrievalMatch,
  type ContextRetrievalResult,
  type ContextRetriever
} from './context-retriever.js'
export { ContextRetrievalEligibilityConfigSchema } from './eligibility.js'
export type {
  ContextRetrievalEligibilityConfig,
  EligibilityResult
} from './eligibility.js'

// The bounded tool surface and the model-facing repository-tool contract are part
// of this domain's public API: every lane allowed to inspect the repository (the
// verification/fix investigation agent, tool-enabled discovery) consumes them from
// here rather than defining its own.
export {
  ToolCallBudgetExceededError,
  isToolCallBudgetExceededError,
  createBoundedRetrievalTools,
  type BoundedRetrievalTools,
  type RetrievalTools
} from './bounded-tools.js'
export {
  lookupSymbolReferences,
  type LookupSymbolReferencesInput,
  type SymbolReferenceQuery,
  type SymbolReferenceResult,
  type SymbolReferenceSite
} from './symbol-reference-lookup.js'
export {
  contextRetrievalConditions,
  ContextRetrievalConditionError,
  isContextRetrievalConditionError,
  type ContextRetrievalCondition
} from './expected-conditions.js'
export {
  disclosedRetrievalCondition,
  withDisclosedRetrievalCondition
} from './condition-disclosure.js'
// The eligibility floor, exported because a second domain needs to ask the same
// question this one answers: may this path be looked at at all? Analyzer
// ingestion asks it of every path a third-party artifact names, and the only
// alternative to reaching for this one is a weaker second copy of a security
// floor — which is a worse outcome than a wider public surface.
//
// Exported deliberately rather than deep-imported: the domain boundary is what
// makes this reviewable, and a reader of this file can now see every question
// the domain answers for others.
export {
  compileEligibilityConfig,
  evaluatePathEligibility,
  type CompiledEligibilityConfig
} from './eligibility.js'
export {
  RepoReadToolInputSchema,
  RepoListToolInputSchema,
  RepoGrepToolInputSchema,
  RepoToolOutputSchema,
  REPO_TOOL_DESCRIPTIONS,
  REPO_TOOL_IDS,
  toRepoToolOutput,
  type RepoToolOutput
} from './repo-tool-contracts.js'
