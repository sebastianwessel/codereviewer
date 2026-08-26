import { describe, expect, test } from 'vitest'
import { referencedDefinitionContextWarnings } from './referenced-definition-warnings.js'
import { referencedDefinitionBounds } from './referenced-definitions.js'

describe('referenced-definition context warnings', () => {
  // The whole point of the report channel: a run whose caps did not bind and whose
  // dependencies all read cleanly must say nothing, or the two messages below
  // become noise a reader learns to skip.
  test('says nothing when nothing was dropped and nothing was unreadable', () => {
    expect(
      referencedDefinitionContextWarnings({
        droppedCount: 0,
        unreadableCount: 0
      })
    ).toEqual([])
  })

  test('reports capped dependencies with the count and the caps that bound', () => {
    const warnings = referencedDefinitionContextWarnings({
      droppedCount: 3,
      unreadableCount: 0
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('3 imported dependency file(s)')
    expect(warnings[0]).toContain(`${referencedDefinitionBounds.maxFiles} files`)
    expect(warnings[0]).toContain(
      `${referencedDefinitionBounds.totalByteBudget} bytes total`
    )
    expect(warnings[0]).toContain(
      `${referencedDefinitionBounds.perFileByteBudget} bytes per file`
    )
  })

  test('reports unreadable dependencies without the capped message', () => {
    const warnings = referencedDefinitionContextWarnings({
      droppedCount: 0,
      unreadableCount: 2
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('2 imported dependency file(s)')
    expect(warnings[0]).toContain('could not be read')
    expect(warnings[0]).not.toContain('capped')
  })

  // Kept apart deliberately (`assembly-state.ts` explains why at length): a cap
  // that binds and a file that could not be opened call for different actions, and
  // one message carrying both counts would point at the wrong knob for half of it.
  test('keeps the two counts as separate messages when both occurred', () => {
    const warnings = referencedDefinitionContextWarnings({
      droppedCount: 4,
      unreadableCount: 1
    })

    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('was capped')
    expect(warnings[1]).toContain('unreadable')
  })
})
