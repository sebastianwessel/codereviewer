import { describe, expect, test } from 'vitest'
import type { ContextLedgerEntry } from '../../../review-planning/context-ledger.js'
import { provenanceHashesFromContextLedger } from './provenance.js'

const ledgerEntry = (
  kind: ContextLedgerEntry['kind'],
  contentHash?: string
): ContextLedgerEntry => ({
  id: `ctx_${kind.replaceAll('-', '')}`,
  kind,
  decision: 'included',
  reason: 'test',
  bytesConsidered: 1,
  bytesIncluded: 1,
  ...(contentHash === undefined ? {} : { contentHash })
})

describe('review runner provenance', () => {
  test('extracts instruction and skill content hashes from context ledger entries', () => {
    const instructionHash =
      '1111111111111111111111111111111111111111111111111111111111111111'
    const secondInstructionHash =
      '2222222222222222222222222222222222222222222222222222222222222222'
    const skillHash =
      '3333333333333333333333333333333333333333333333333333333333333333'

    expect(
      provenanceHashesFromContextLedger([
        ledgerEntry('instruction', instructionHash),
        ledgerEntry('file', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
        ledgerEntry('instruction'),
        ledgerEntry('skill', skillHash),
        ledgerEntry('support-signal-output'),
        ledgerEntry('instruction', secondInstructionHash)
      ])
    ).toEqual({
      instructionHashes: [instructionHash, secondInstructionHash],
      skillHashes: [skillHash]
    })
  })
})
