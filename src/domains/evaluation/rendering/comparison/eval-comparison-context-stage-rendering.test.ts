import { describe, expect, test } from 'vitest'
import {
  agenticStageCounts,
  appendAgenticStageDeltas,
  appendContextLedgerKindDeltas,
  contextLedgerKindCounts
} from './eval-comparison-context-stage-rendering.js'

describe('eval comparison context stage rendering', () => {
  test('exports context-ledger and agentic-stage helpers', () => {
    expect(typeof contextLedgerKindCounts).toBe('function')
    expect(typeof agenticStageCounts).toBe('function')
    expect(typeof appendContextLedgerKindDeltas).toBe('function')
    expect(typeof appendAgenticStageDeltas).toBe('function')
  })
})
