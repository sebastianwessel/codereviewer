import { describe, expect, test } from 'vitest'
import {
  CandidateIdSchema,
  ContextLedgerIdSchema,
  ContractIdSchema,
  TaskIdSchema,
  prefixedIdSchema
} from './finding.schema.js'

// Every prefix the codebase generates ids with (`<prefix>_<hex>` via sha256, plus
// the grouped `task_intent_<hex>` form). If a generator introduces a new prefix or
// a multi-segment id, this list must grow AND ContractIdSchema must keep accepting
// it. This is the regression guard for the id-pattern drift that previously
// surfaced as `provider_error` schema failures at provider-call time.
const generatedIdPrefixes = [
  'task',
  'cand',
  'ctx',
  'proof',
  'refute',
  'ref',
  'judge',
  'agg',
  'susp',
  'ev',
  'evidence',
  'evctx',
  'fact',
  'find',
  'intent',
  'drift',
  'shared'
] as const

const sampleHex = '0a1b2c3d4e5f6071'

describe('contract id drift guard', () => {
  test('ContractIdSchema accepts a representative id for every generated prefix', () => {
    for (const prefix of generatedIdPrefixes) {
      expect(
        ContractIdSchema.safeParse(`${prefix}_${sampleHex}`).success,
        `ContractIdSchema must accept generated prefix "${prefix}_"`
      ).toBe(true)
    }
  })

  test('ContractIdSchema accepts multi-segment grouped ids', () => {
    // Intent grouping emits `task_intent_<hex>`; rejecting it was the original bug.
    expect(ContractIdSchema.safeParse(`task_intent_${sampleHex}`).success).toBe(true)
  })

  test('ContractIdSchema still accepts the test fixture form and rejects junk', () => {
    expect(ContractIdSchema.safeParse('test-anything_here-1').success).toBe(true)
    expect(ContractIdSchema.safeParse('Task_ABC').success).toBe(false)
    expect(ContractIdSchema.safeParse('task').success).toBe(false)
    expect(ContractIdSchema.safeParse('task_').success).toBe(false)
  })

  test('TaskIdSchema accepts task ids (incl. intent grouping) and rejects others', () => {
    expect(TaskIdSchema.safeParse(`task_${sampleHex}`).success).toBe(true)
    expect(TaskIdSchema.safeParse(`task_intent_${sampleHex}`).success).toBe(true)
    expect(TaskIdSchema.safeParse(`cand_${sampleHex}`).success).toBe(false)
    expect(TaskIdSchema.safeParse('task_UPPER').success).toBe(false)
  })

  test('CandidateIdSchema and ContextLedgerIdSchema validate their own prefixes', () => {
    expect(CandidateIdSchema.safeParse(`cand_${sampleHex}`).success).toBe(true)
    expect(CandidateIdSchema.safeParse(`task_${sampleHex}`).success).toBe(false)
    expect(ContextLedgerIdSchema.safeParse(`ctx_${sampleHex}`).success).toBe(true)
    expect(ContextLedgerIdSchema.safeParse(`ev_${sampleHex}`).success).toBe(false)
  })

  test('prefixedIdSchema builds a schema scoped to one prefix', () => {
    const proofId = prefixedIdSchema('proof')
    expect(proofId.safeParse(`proof_${sampleHex}`).success).toBe(true)
    expect(proofId.safeParse(`refute_${sampleHex}`).success).toBe(false)
  })
})
