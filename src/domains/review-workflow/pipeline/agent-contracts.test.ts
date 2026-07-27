import { describe, expect, test } from 'vitest'
import {
  ModelContextScoutResultSchema,
  ModelHolisticFindingSchema,
  ModelHolisticReviewResultSchema,
  contextScoutRequests,
  modelCategoryAliases
} from './agent-contracts.js'

describe('ModelHolisticReviewResultSchema', () => {
  // A response truncated by the output-token budget arrives as an empty body and
  // becomes {}. Accepting that as "no findings" made an exhausted review look
  // exactly like a clean file, in the review and in the eval scoring it.
  test('rejects an empty object rather than reading it as no findings', () => {
    expect(ModelHolisticReviewResultSchema.safeParse({}).success).toBe(false)
  })

  test('accepts an explicitly empty finding list', () => {
    expect(
      ModelHolisticReviewResultSchema.parse({ findings: [] }).findings
    ).toEqual([])
  })
})

// These findings are minimal: only the fields the category resolver reads
// (category/type and the free-text fields) are ever set, since every other
// field on ModelHolisticFindingSchema is independently optional.
describe('ModelHolisticFindingSchema category normalization', () => {
  test('every declared alias resolves through the structured category field to its mapped category', () => {
    for (const [alias, expectedCategory] of Object.entries(modelCategoryAliases)) {
      const { category } = ModelHolisticFindingSchema.parse({ category: alias })

      expect(category, `alias "${alias}" should resolve to "${expectedCategory}"`).toBe(
        expectedCategory
      )
    }
  })

  test('resolves an alias regardless of the casing, spacing, or punctuation the model sent', () => {
    expect(ModelHolisticFindingSchema.parse({ category: 'Race Condition' }).category).toBe(
      'bug'
    )
    expect(ModelHolisticFindingSchema.parse({ type: 'RACE_CONDITION!!' }).category).toBe(
      'bug'
    )
  })

  test('falls back to a keyword scan over free text when there is no structured category', () => {
    expect(
      ModelHolisticFindingSchema.parse({
        title: 'Customer invoice total is wrong',
        description: 'Customer was overcharged due to a rounding error in checkout.'
      }).category
    ).toBe('bug')
  })

  test('a structured category takes priority over free text that would resolve differently', () => {
    // The description below would resolve to `performance` on a text scan (it
    // mentions caching), but the model's own `category` field is authoritative
    // once it resolves to something, so that must win.
    expect(
      ModelHolisticFindingSchema.parse({
        category: 'security',
        title: 'Slow endpoint',
        description: 'This endpoint leaks a JWT in its response body and caches too eagerly.'
      }).category
    ).toBe('security')
  })

  test('an unrecognized category with no matching free text resolves to no category', () => {
    expect(
      ModelHolisticFindingSchema.parse({ category: 'zzz-not-a-real-category' }).category
    ).toBeUndefined()
    expect(ModelHolisticFindingSchema.parse({}).category).toBeUndefined()
  })

  // The defect this normalization replaces: "race condition" filed under
  // `security`, "concurrency" filed under `bug`, and free text merely
  // mentioning a race or a lock filed under `performance` - three different
  // categories for the same underlying kind of defect, depending on which
  // field/word the model happened to use. All three must now agree.
  test('a race condition, "concurrency", and free text mentioning a race or a lock all agree on bug', () => {
    expect(ModelHolisticFindingSchema.parse({ category: 'race condition' }).category).toBe(
      'bug'
    )
    expect(ModelHolisticFindingSchema.parse({ category: 'concurrency' }).category).toBe(
      'bug'
    )
    expect(
      ModelHolisticFindingSchema.parse({
        title: 'Possible race between two goroutines',
        description: 'One thread may still hold the lock when the other reads stale state.'
      }).category
    ).toBe('bug')
  })
})

describe('ModelHolisticFindingSchema fix fields', () => {
  // Discovery's fixSummary was pure dead weight: the prompt asked for it, this
  // schema accepted it, but the candidate mapping in holistic-task-review.ts never
  // read it (a fix proposal requires at least one evidence id, and discovery
  // candidates start with none). It must not survive parsing.
  test('drops a model-supplied fixSummary instead of carrying it through', () => {
    const parsed = ModelHolisticFindingSchema.parse({
      category: 'bug',
      fixSummary: 'Add a null check before dereferencing.'
    })

    expect(parsed).not.toHaveProperty('fixSummary')
  })

  // fixEdits was dead weight one step further gone than fixSummary: the discovery
  // prompt never even asked for it, and the candidate mapping never read it. Only
  // the REFUTER produces fix edits that reach a fix proposal - discovery must not
  // grow a second, unvalidated path to the same field.
  test('drops model-supplied fixEdits instead of carrying them through', () => {
    const parsed = ModelHolisticFindingSchema.parse({
      category: 'bug',
      fixEdits: [
        {
          path: 'src/pricing.ts',
          startLine: 12,
          endLine: 14,
          replacement: 'if (rate === undefined) return 0'
        }
      ]
    })

    expect(parsed).not.toHaveProperty('fixEdits')
  })

  // Snake_case aliases were mapped in the preprocess step; that mapping is gone
  // too, so the alias must not sneak the field back in either.
  test('drops the fix_edits alias as well', () => {
    const parsed = ModelHolisticFindingSchema.parse({
      category: 'bug',
      fix_edits: [
        {
          path: 'src/pricing.ts',
          start_line: 12,
          end_line: 14,
          replacement: 'if (rate === undefined) return 0'
        }
      ]
    })

    expect(parsed).not.toHaveProperty('fixEdits')
    expect(parsed).not.toHaveProperty('fix_edits')
  })

  // The fields a holistic candidate is actually built from must keep parsing
  // normally when a model volunteers fix edits alongside them.
  test('still parses the candidate fields when fixEdits is present', () => {
    const parsed = ModelHolisticFindingSchema.parse({
      category: 'bug',
      severity: 'high',
      title: 'Unchecked rate lookup',
      description: 'A missing rate dereferences undefined.',
      path: 'src/pricing.ts',
      startLine: 12,
      fixEdits: [
        {
          path: 'src/pricing.ts',
          startLine: 12,
          endLine: 14,
          replacement: 'if (rate === undefined) return 0'
        }
      ]
    })

    expect(parsed.severity).toBe('high')
    expect(parsed.path).toBe('src/pricing.ts')
    expect(parsed.startLine).toBe(12)
    expect(parsed).not.toHaveProperty('fixEdits')
  })
})

describe('contextScoutRequests', () => {
  test('returns nothing for an absent or empty request list', () => {
    expect(contextScoutRequests(ModelContextScoutResultSchema.parse({}))).toEqual(
      []
    )
    expect(
      contextScoutRequests(
        ModelContextScoutResultSchema.parse({ requests: [] })
      )
    ).toEqual([])
  })

  test('normalizes the field aliases models actually emit', () => {
    expect(
      contextScoutRequests({
        requests: [
          { symbol: 'applyDiscount', file: 'src/pricing.ts', why: 'caps the rate' },
          {
            symbol_name: '  parseAmount  ',
            declared_in: 'src/money.ts',
            rationale: 'rounding contract'
          },
          { identifier: 'Rate', filePath: 'src/rate.ts', justification: 'shape' }
        ]
      })
    ).toEqual([
      { name: 'applyDiscount', path: 'src/pricing.ts', reason: 'caps the rate' },
      { name: 'parseAmount', path: 'src/money.ts', reason: 'rounding contract' },
      { name: 'Rate', path: 'src/rate.ts', reason: 'shape' }
    ])
  })

  test('keeps a request whose path or reason is unusable', () => {
    // The path is only a resolution hint and the reason is only for humans, so
    // neither may cost the reviewer the symbol itself.
    expect(
      contextScoutRequests({
        requests: [
          { name: 'chargeCard', path: '../outside/secrets.ts' },
          { name: 'refund', path: '/etc/passwd', reason: 42 },
          { name: 'settle' }
        ]
      })
    ).toEqual([{ name: 'chargeCard' }, { name: 'refund' }, { name: 'settle' }])
  })

  test('de-duplicates on the (name, path) pair and keeps the first, best-ranked entry', () => {
    expect(
      contextScoutRequests({
        requests: [
          { name: 'applyDiscount', path: 'src/pricing.ts', reason: 'first' },
          { name: 'applyDiscount', path: 'src/pricing.ts', reason: 'repeat' },
          // The same name in a different file is a DIFFERENT symbol.
          { name: 'applyDiscount', path: 'src/legacy/pricing.ts' },
          { name: 'applyDiscount' }
        ]
      })
    ).toEqual([
      { name: 'applyDiscount', path: 'src/pricing.ts', reason: 'first' },
      { name: 'applyDiscount', path: 'src/legacy/pricing.ts' },
      { name: 'applyDiscount' }
    ])
  })

  test('drops junk entries without losing the valid ones around them', () => {
    expect(
      contextScoutRequests({
        requests: [
          null,
          'applyDiscount',
          ['applyDiscount'],
          {},
          { name: '' },
          { name: '   ' },
          { name: 7 },
          { reason: 'no symbol named' },
          { name: 'settleInvoice', path: 'src/billing.ts' }
        ]
      })
    ).toEqual([{ name: 'settleInvoice', path: 'src/billing.ts' }])
  })
})
