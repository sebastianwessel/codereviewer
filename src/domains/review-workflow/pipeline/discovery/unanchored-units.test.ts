import { describe, expect, test } from 'vitest'
import {
  unanchoredUnitsForLineCount,
  unanchoredUnitsForSpan,
  unanchoredUnitText
} from './unanchored-units.js'

const geometry = { unitLines: 60, strideLines: 40 }

describe('un-anchored unit geometry', () => {
  test('derives units from the line count alone, at the configured size and stride', () => {
    expect(unanchoredUnitsForLineCount(140, geometry)).toEqual([
      { startLine: 1, endLine: 60 },
      { startLine: 41, endLine: 100 },
      { startLine: 81, endLine: 140 }
    ])
  })

  test('overlaps consecutive units, so a defect on a boundary is inside one of them', () => {
    const units = unanchoredUnitsForLineCount(140, geometry)

    for (const [index, unit] of units.entries()) {
      const previous = units[index - 1]

      if (previous === undefined) {
        continue
      }

      expect(unit.startLine).toBeLessThanOrEqual(previous.endLine)
    }
  })

  test('covers every line of the span', () => {
    const covered = new Set<number>()

    for (const unit of unanchoredUnitsForLineCount(203, geometry)) {
      for (let line = unit.startLine; line <= unit.endLine; line += 1) {
        covered.add(line)
      }
    }

    expect(covered.size).toBe(203)
  })

  test('a span shorter than one unit is a single unit clipped to the span', () => {
    expect(unanchoredUnitsForLineCount(12, geometry)).toEqual([
      { startLine: 1, endLine: 12 }
    ])
  })

  test('stops at the first unit that reaches the last line, so no unit repeats the tail', () => {
    const units = unanchoredUnitsForLineCount(101, geometry)

    // 1-60, 41-100, 81-101. A fourth start at 121 would be past the end, and a
    // start at 121-40=81 already reached it: enumeration must not emit a unit
    // that is a strict subset of the one before it.
    expect(units).toEqual([
      { startLine: 1, endLine: 60 },
      { startLine: 41, endLine: 100 },
      { startLine: 81, endLine: 101 }
    ])
  })

  test('an empty span produces no units', () => {
    expect(unanchoredUnitsForLineCount(0, geometry)).toEqual([])
  })

  // The rule may never consult anything but the line count. If it ever could, it
  // could be tuned — knowingly or not — towards the defects the engine is scored
  // on, and any measurement of the pass would be worthless.
  test('two files with the same line count decompose identically in any language', () => {
    const lineCount = 175
    const expected = unanchoredUnitsForLineCount(lineCount, geometry)

    const sources = [
      Array.from({ length: lineCount }, (_unused, index) =>
        `export const value${index} = ${index}`
      ),
      Array.from({ length: lineCount }, (_unused, index) =>
        `def value_${index}():\n`.trimEnd()
      ),
      Array.from({ length: lineCount }, (_unused, index) =>
        `    private final int value${index} = ${index};`
      ),
      Array.from({ length: lineCount }, () => '')
    ]

    for (const source of sources) {
      expect(
        unanchoredUnitsForLineCount(source.length, geometry)
      ).toEqual(expected)
    }
  })
})

describe('un-anchored units of a chunk', () => {
  test('numbers units in the file’s lines when the content starts partway in', () => {
    expect(unanchoredUnitsForSpan(201, 100, geometry)).toEqual([
      { startLine: 201, endLine: 260 },
      { startLine: 241, endLine: 300 }
    ])
  })

  test('is the plain geometry when the content starts at line 1', () => {
    expect(unanchoredUnitsForSpan(1, 100, geometry)).toEqual(
      unanchoredUnitsForLineCount(100, geometry)
    )
  })
})

describe('un-anchored unit text', () => {
  const content = ['one', 'two', 'three', 'four', 'five'].join('\n')

  test('slices the unit out of content that starts at line 1', () => {
    expect(
      unanchoredUnitText(content, 1, { startLine: 2, endLine: 4 })
    ).toBe('two\nthree\nfour')
  })

  // A file too large for one packet is split into chunks that each become their
  // own task, so a task's content can start partway into its file. Slicing must
  // be relative to that origin, or the unit's declared span and the lines the
  // reviewer is actually shown would disagree.
  test('slices against the chunk origin when the content starts partway into the file', () => {
    expect(
      unanchoredUnitText(content, 101, { startLine: 102, endLine: 103 })
    ).toBe('two\nthree')
  })

  test('a unit outside the content yields nothing to review', () => {
    expect(unanchoredUnitText(content, 1, { startLine: 9, endLine: 12 })).toBe('')
  })
})
