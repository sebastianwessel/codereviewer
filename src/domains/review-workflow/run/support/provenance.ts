import type { ContextLedgerEntry } from '../../../review-planning/context-ledger.js'

export type ReviewRunnerProvenanceHashes = {
  readonly instructionHashes: readonly string[]
  readonly skillHashes: readonly string[]
}

const hashesForKind = (
  contextLedger: readonly ContextLedgerEntry[],
  kind: ContextLedgerEntry['kind']
): readonly string[] =>
  contextLedger
    .filter((entry) => entry.kind === kind && entry.contentHash !== undefined)
    .map((entry) => entry.contentHash as string)

export const provenanceHashesFromContextLedger = (
  contextLedger: readonly ContextLedgerEntry[]
): ReviewRunnerProvenanceHashes => ({
  instructionHashes: hashesForKind(contextLedger, 'instruction'),
  skillHashes: hashesForKind(contextLedger, 'skill')
})
