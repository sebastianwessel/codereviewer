import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { evalReportCapabilityFlags } from './eval-capability-flags.js'
import { EvalReportCapabilityFlagsSchema } from '../domains/evaluation/index.js'
import { CodeReviewerConfigSchema } from '../shared/contracts/index.js'

// Every dotted path of an `enabled` toggle in the EFFECTIVE configuration,
// derived from a parsed config rather than from a hand-kept list. The derivation
// is the point: a capability block added to the config schema appears here the
// moment it exists, with nobody having remembered to add it.
//
// A parsed config is the right source because it is what "effective flags"
// means -- every block in `CodeReviewerConfigSchema` carries `.prefault({})`, so
// parsing materialises each block's own defaults, and a toggle that appears
// there is a toggle a run can have on.
const configCapabilityTogglePaths = (
  value: unknown,
  prefix = ''
): readonly string[] => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return []
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`

    if (typeof child === 'boolean') {
      return key === 'enabled' ? [path] : []
    }

    return configCapabilityTogglePaths(child, path)
  })
}

const sorted = (values: readonly string[]): readonly string[] =>
  [...values].sort((left, right) => left.localeCompare(right))

const declaredCapabilities = (schema: {
  readonly parse: (value: unknown) => unknown
}): readonly string[] => sorted(configCapabilityTogglePaths(schema.parse({})))

const recordedCapabilities = (): readonly string[] =>
  sorted(Object.keys(EvalReportCapabilityFlagsSchema.shape))

// TypeScript cannot express "this contract covers every capability the config
// schema declares" -- the two shapes share no type and one of them is a set of
// string literals -- so the guard is a test, on the same pattern as "every
// reviewContext kind is a decision, not a default".
describe('every configuration capability is a decision in eval provenance', () => {
  test('the provenance contract holds exactly the config schema toggles', () => {
    expect(recordedCapabilities()).toEqual(
      declaredCapabilities(CodeReviewerConfigSchema)
    )
  })

  // The failure mode, exercised rather than described: a config schema that grows
  // a capability block the provenance contract does not carry makes the
  // assertion above fail, naming the missing key. Without this, a run under the
  // new capability would archive a report that cannot say whether it was on, and
  // nothing in the system would notice.
  test('fails when the config schema grows a capability the contract lacks', () => {
    const configWithNewCapability = CodeReviewerConfigSchema.extend({
      reviewNarration: z
        .strictObject({ enabled: z.boolean().default(false) })
        .prefault({})
    })

    expect(declaredCapabilities(configWithNewCapability)).toContain(
      'reviewNarration.enabled'
    )
    expect(recordedCapabilities()).not.toEqual(
      declaredCapabilities(configWithNewCapability)
    )
  })

  test('the builder produces a value for every recorded capability', () => {
    const flags = evalReportCapabilityFlags(CodeReviewerConfigSchema.parse({}))

    expect(EvalReportCapabilityFlagsSchema.parse(flags)).toEqual(flags)
    expect(sorted(Object.keys(flags))).toEqual(recordedCapabilities())
  })

  test('reads the flags a config actually set, not their defaults', () => {
    const flags = evalReportCapabilityFlags(
      CodeReviewerConfigSchema.parse({
        fix: { enabled: true },
        review: { citations: { enabled: false } }
      })
    )

    expect(flags['fix.enabled']).toBe(true)
    expect(flags['review.citations.enabled']).toBe(false)
    // Untouched blocks keep their schema defaults, so the record describes the
    // EFFECTIVE configuration rather than the keys an operator happened to write.
    expect(flags['aiReview.enabled']).toBe(true)
    expect(flags['verification.enabled']).toBe(false)
  })
})
