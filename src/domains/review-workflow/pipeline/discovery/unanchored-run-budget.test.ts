import { describe, expect, test } from 'vitest'
import {
  createUnanchoredRunBudget,
  unanchoredTruncationWarnings
} from './unanchored-run-budget.js'

const bounds = {
  unitLines: 60,
  strideLines: 40,
  maxUnitsPerFile: 3,
  maxUnitsPerRun: 5
}

describe('un-anchored run budget', () => {
  test('grants everything a file asks for while it fits inside both bounds', () => {
    const budget = createUnanchoredRunBudget(bounds)

    expect(budget.claimUnits(2)).toBe(2)

    const summary = budget.summary()
    expect(summary.unitsGranted).toBe(2)
    expect(summary.unitsWithheld).toBe(0)
    expect(summary.truncatedFileCount).toBe(0)
    expect(unanchoredTruncationWarnings(summary)).toEqual([])
  })

  test('enforces the per-file bound and records what it withheld', () => {
    const budget = createUnanchoredRunBudget(bounds)

    expect(budget.claimUnits(9)).toBe(3)

    const summary = budget.summary()
    expect(summary.unitsWithheld).toBe(6)
    expect(summary.truncatedFileCount).toBe(1)
    expect(summary.perFileBoundReached).toBe(true)
    expect(summary.perRunBoundReached).toBe(false)
  })

  test('enforces the per-run bound across files, not per file', () => {
    const budget = createUnanchoredRunBudget(bounds)

    expect(budget.claimUnits(3)).toBe(3)
    // Two units of the run allowance remain, so the second file gets two of the
    // three its per-file bound would otherwise have allowed.
    expect(budget.claimUnits(3)).toBe(2)
    expect(budget.claimUnits(3)).toBe(0)

    const summary = budget.summary()
    expect(summary.unitsGranted).toBe(5)
    expect(summary.perRunBoundReached).toBe(true)
  })

  // Silent truncation reads as full coverage, which is exactly the failure this
  // record exists to prevent. The warning must name the bound that withheld the
  // work, so a reader can tell configuration from a defect.
  test('reports truncation as a run warning naming the applied bound', () => {
    const budget = createUnanchoredRunBudget(bounds)

    budget.claimUnits(9)

    const warnings = unanchoredTruncationWarnings(budget.summary())
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('unanchored-discovery-truncated')
    expect(warnings[0]).toContain('6 of 9 units')
    expect(warnings[0]).toContain('per-file bound 3')
  })

  test('names the per-run bound when that is what withheld the work', () => {
    const budget = createUnanchoredRunBudget(bounds)

    budget.claimUnits(3)
    budget.claimUnits(3)

    const warnings = unanchoredTruncationWarnings(budget.summary())
    expect(warnings[0]).toContain('per-run bound 5')
  })

  // The budget is the only thing standing between this pass and an unbounded
  // number of model calls, so its disabled shape must grant nothing rather than
  // fall back to some default allowance.
  test('a disabled budget grants nothing and reports nothing', () => {
    const budget = createUnanchoredRunBudget(undefined)

    expect(budget.claimUnits(10)).toBe(0)
    expect(budget.summary().enabled).toBe(false)
    expect(unanchoredTruncationWarnings(budget.summary())).toEqual([])
  })

  test('claiming nothing is free and is not counted as truncation', () => {
    const budget = createUnanchoredRunBudget(bounds)

    expect(budget.claimUnits(0)).toBe(0)
    expect(budget.summary().truncatedFileCount).toBe(0)
  })
})
