import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { FindingRefutationResultSchema } from '../../domains/review-workflow/pipeline/agent-contracts.js'
import {
  ClaimSchema,
  FixProposalSchema,
  RefutationResultSchema,
  RejectedFindingSchema
} from '../contracts/index.js'
import {
  stringFieldBound,
  TRUNCATION_MARK,
  truncateForContract,
  truncateToFieldBound
} from './truncate.js'

describe('truncateForContract', () => {
  test('returns short values unchanged', () => {
    expect(truncateForContract('hello', 10)).toBe('hello')
  })

  test('truncates values longer than the cap to exactly the cap length', () => {
    const value = 'x'.repeat(600)
    const result = truncateForContract(value, 500)

    expect(result).toHaveLength(500)
    expect(value.startsWith(result.slice(0, -TRUNCATION_MARK.length))).toBe(true)
  })

  test('marks the cut so a reader cannot mistake it for the whole value', () => {
    const result = truncateForContract('x'.repeat(600), 500)

    expect(result.endsWith(TRUNCATION_MARK)).toBe(true)
  })

  test('leaves an uncut value unmarked, so the mark means what it says', () => {
    expect(truncateForContract('short', 500)).not.toContain(TRUNCATION_MARK)
  })

  test('drops whitespace stranded before the mark', () => {
    expect(truncateForContract(`${'x'.repeat(6)}    tail`, 10)).toBe(
      `xxxxxx${TRUNCATION_MARK}`
    )
  })

  test('handles the boundary length exactly', () => {
    const value = 'y'.repeat(500)
    expect(truncateForContract(value, 500)).toBe(value)
  })

  test('honours a cap too small to hold the mark', () => {
    expect(truncateForContract('abc', 1)).toBe(TRUNCATION_MARK)
    expect(truncateForContract('abc', 0)).toBe('')
  })
})

describe('truncateToFieldBound', () => {
  const bounded = z.string().max(10)
  const optionalBounded = z.string().max(10).optional()

  test('cuts to the bound the field itself declares', () => {
    expect(truncateToFieldBound('a'.repeat(50), bounded)).toHaveLength(10)
    expect(truncateToFieldBound('a'.repeat(50), bounded)).toMatch(/…$/u)
  })

  test('unwraps an optional field', () => {
    expect(truncateToFieldBound('a'.repeat(50), optionalBounded)).toHaveLength(10)
  })

  test('leaves a value that already fits untouched', () => {
    expect(truncateToFieldBound('short', bounded)).toBe('short')
  })

  // The earlier private version of this returned `Number.POSITIVE_INFINITY` for a
  // field with no `.max(n)`, so "truncate to this field's bound" quietly did not
  // truncate — a limit that fails to bind and produces a plausible result instead
  // of an error. A caller asking for a bound that does not exist has made a
  // programming error and is told at the first call.
  test('refuses a field that declares no bound rather than not truncating', () => {
    expect(() => truncateToFieldBound('a'.repeat(50), z.string())).toThrow(
      /declares no maximum length/u
    )
  })
})

// The reason `truncateToFieldBound` exists: the bound must live in exactly one
// place. Each of these once had a second copy at its call site — three claim caps
// declared once per provider in two providers, a fix-summary cap, and two bare
// numbers in the refutation result — and every copy happened to be correct, which
// is what made the shape worth removing rather than auditing. Nothing fails when a
// copy is merely SMALLER than the contract, so drift here is silent by
// construction.
describe('contract bounds have exactly one definition', () => {
  test('the schema is the only place these numbers appear', () => {
    expect(stringFieldBound(ClaimSchema.shape.title)).toBe(200)
    expect(stringFieldBound(ClaimSchema.shape.question)).toBe(500)
    expect(stringFieldBound(ClaimSchema.shape.detail)).toBe(2000)
    expect(stringFieldBound(FixProposalSchema.shape.summary)).toBe(1200)
    expect(stringFieldBound(RejectedFindingSchema.shape.message)).toBe(1200)
    expect(stringFieldBound(RefutationResultSchema.shape.summary)).toBe(1200)
  })

  // The rule the values follow, asserted as a rule rather than as seven numbers.
  //
  // A destination smaller than its only producer does not guard against a runaway
  // model — it guarantees a cut on ordinary output. Every field the refuter's
  // 1200-character rationale flows into is therefore at least 1200. Two were not:
  // `RefutationResult.summary` at 1000 and `RejectedFinding.message` at 500,
  // which discarded 16% and 58% of the argument respectively.
  test('nothing the refutation rationale flows into is smaller than the rationale', () => {
    const rationaleBound = stringFieldBound(
      FindingRefutationResultSchema.shape.rationaleSummary
    )

    expect(stringFieldBound(RefutationResultSchema.shape.summary)).toBeGreaterThanOrEqual(
      rationaleBound
    )
    expect(
      stringFieldBound(RejectedFindingSchema.shape.message)
    ).toBeGreaterThanOrEqual(rationaleBound)
  })

  // The counterweight, so "size it to the producer" does not become "make every
  // cap enormous". A check summary is NOT fed the rationale — it states which
  // check ran, while the rationale sits one line above it in full — so it stays
  // small on purpose. Raising it would print the same argument twice.
  test('a field that is not fed the rationale stays small', () => {
    expect(
      stringFieldBound(RefutationResultSchema.shape.checks.element.shape.summary)
    ).toBe(500)
  })
})
