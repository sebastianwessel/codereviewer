import { describe, expect, test } from 'vitest'
import {
  ModelHolisticFindingSchema,
  ModelHolisticReviewResultSchema,
  ModelSemanticMergeResultSchema,
  modelCategoryAliases,
  semanticMergeGroups
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

describe('semanticMergeGroups', () => {
  const known = ['cand_1111111111111111', 'cand_2222222222222222', 'cand_3333333333333333']

  test('reads an absent or empty group list as no grouping', () => {
    // The conservative answer is the safe one here: no grouping costs at most a
    // redundant comment, while a wrong merge deletes a real defect.
    expect(
      semanticMergeGroups(ModelSemanticMergeResultSchema.parse({}), known)
    ).toEqual([])
    expect(
      semanticMergeGroups(
        ModelSemanticMergeResultSchema.parse({ groups: [] }),
        known
      )
    ).toEqual([])
  })

  test('normalizes the shapes a model actually returns', () => {
    expect(
      semanticMergeGroups(
        {
          groups: [
            // A bare array of ids, and candidate objects instead of ids.
            [known[0], known[1]],
            [{ id: known[2] }, { candidateId: 'cand_4444444444444444' }]
          ]
        },
        [...known, 'cand_4444444444444444']
      )
    ).toEqual([
      [known[0], known[1]],
      [known[2], 'cand_4444444444444444']
    ])

    expect(
      semanticMergeGroups(
        { groups: [{ ids: [known[0], known[1]] }] },
        known
      )
    ).toEqual([[known[0], known[1]]])
    expect(
      semanticMergeGroups(
        { groups: [{ candidate_ids: [known[0], known[1]] }] },
        known
      )
    ).toEqual([[known[0], known[1]]])
  })

  test('drops invented ids, repeats, and anything left with fewer than two members', () => {
    expect(
      semanticMergeGroups(
        {
          groups: [
            null,
            'not a group',
            { candidateIds: [] },
            { candidateIds: [known[0]] },
            { candidateIds: [known[0], 'cand_invented'] },
            { candidateIds: [known[1], known[1], known[2]] }
          ]
        },
        known
      )
    ).toEqual([[known[1], known[2]]])
  })

  test('honours only the first group that claims a candidate', () => {
    // Overlapping groups make the reduction ambiguous, and an ambiguous merge
    // must resolve towards leaving candidates alone.
    expect(
      semanticMergeGroups(
        {
          groups: [
            { candidateIds: [known[0], known[1]] },
            { candidateIds: [known[1], known[2]] }
          ]
        },
        known
      )
    ).toEqual([[known[0], known[1]]])
  })
})
