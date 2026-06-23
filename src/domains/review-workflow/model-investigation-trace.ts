import {
  InvestigationTraceSchema,
  type InvestigationTrace
} from '../../shared/contracts/index.js'
import type { ContextRetrievalBudget } from '../context-retrieval/index.js'
import type { ContextRequestArtifacts } from './model-context-artifacts.js'

export const investigationTraceForContextArtifacts = (
  input: {
    readonly suspicionId: string
    readonly contextArtifacts: ContextRequestArtifacts
    readonly retrievalBudget?: ContextRetrievalBudget | undefined
    readonly usedRounds: number
    readonly maxRounds: number
    readonly result: InvestigationTrace['result']
  }
): InvestigationTrace => {
  const ledgerEntryIds = [
    ...new Set(
      input.contextArtifacts.reviewContext.map((context) => context.ledgerEntryId)
    )
  ]
  const toolCalls = input.contextArtifacts.evidence.map((evidence) =>
    InvestigationTraceSchema.shape.toolCalls.element.parse({
      tool: evidence.kind,
      status: 'completed',
      ...(evidence.rawContentRef === undefined
        ? {}
        : { ledgerEntryId: evidence.rawContentRef }),
      summary: evidence.summary.slice(0, 500)
    })
  )
  const usedReads = input.contextArtifacts.evidence.filter(
    (evidence) => evidence.kind === 'tool-read'
  ).length
  const usedSearches = input.contextArtifacts.evidence.filter(
    (evidence) => evidence.kind === 'tool-search'
  ).length

  return InvestigationTraceSchema.parse({
    suspicionId: input.suspicionId,
    toolCalls,
    contextLedgerEntryIds: ledgerEntryIds,
    budget: {
      maxReads: input.retrievalBudget?.maxReads ?? usedReads,
      usedReads,
      maxSearches: input.retrievalBudget?.maxSearches ?? usedSearches,
      usedSearches,
      maxRounds: input.maxRounds,
      usedRounds: input.usedRounds
    },
    result: input.result
  })
}
