import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../shared/contracts/index.js'
import { evalReportCapabilityFlags } from './eval-capability-flags.js'
import {
  applyEvalCapabilityPins,
  evalCapabilityPins,
  parseEvalCapabilityOverrides
} from './eval-capability-pins.js'

type Config = ReturnType<typeof CodeReviewerConfigSchema.parse>

const configFrom = (raw: Record<string, unknown> = {}): Config =>
  CodeReviewerConfigSchema.parse(raw)

// A configuration that already agrees with every pin, so a test that varies ONE
// flag reads one warning rather than a list. It is deliberately not the schema
// default: two pins disagree with today's shipped defaults on purpose, so an
// unmodified default config legitimately warns twice.
const pinnedBaselineConfig = (): Config =>
  applyEvalCapabilityPins({ config: configFrom(), overrides: new Map() }).config

describe('eval capability pins', () => {
  test('holds every pinned flag at its pinned value whatever the config says', () => {
    // The inverse of every pin, expressed as configuration, so no pin can pass
    // this by coincidence of already matching the schema default.
    const inverted = applyEvalCapabilityPins({
      config: evalCapabilityPins.reduce(
        (config, pin) => pin.write(config, !pin.pinned),
        configFrom()
      ),
      overrides: new Map()
    })

    for (const pin of evalCapabilityPins) {
      expect(pin.read(inverted.config)).toBe(pin.pinned)
    }
  })

  // The pin has to be readable in the artifact, not just applied in memory:
  // `evalReportCapabilityFlags` is what the eval report records, and it is read
  // off the same config object the pins produced.
  test('records the pinned values in the capability provenance', () => {
    const pinned = applyEvalCapabilityPins({
      config: configFrom({ contextSources: { enabled: true } }),
      overrides: new Map()
    })
    const flags = evalReportCapabilityFlags(pinned.config)

    for (const pin of evalCapabilityPins) {
      expect(flags[pin.flag]).toBe(pin.pinned)
    }
  })

  // A configuration silently overruled is the failure mode the pin itself could
  // introduce: an operator who sets a flag and sees no change in the numbers has
  // no way to tell a null result from a setting that never applied.
  // `crossFileRetrieval` is pinned ON and defaults ON, so a config asking for
  // OFF can only have come from the repository — which is the case worth saying
  // out loud, because the operator set something and the numbers will not move.
  test('names the setting it overruled', () => {
    const result = applyEvalCapabilityPins({
      config: configFrom({ review: { crossFileRetrieval: { enabled: false } } }),
      overrides: new Map()
    })

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('review.crossFileRetrieval.enabled')
    expect(result.warnings[0]).toContain(
      '--capability review.crossFileRetrieval.enabled=false'
    )
  })

  test('says nothing when the loaded configuration already agrees', () => {
    expect(
      applyEvalCapabilityPins({
        config: pinnedBaselineConfig(),
        overrides: new Map()
      }).warnings
    ).toEqual([])
  })

  // Two pins disagree with the shipped defaults on purpose. Warning about that
  // would print on every run in every repository, for a condition the pin file
  // documents — and a warning that is always there is not a warning.
  test('stays silent when the only disagreement is with the schema default', () => {
    const result = applyEvalCapabilityPins({
      config: configFrom(),
      overrides: new Map()
    })

    expect(result.config.contextSources.enabled).toBe(false)
    expect(result.config.review.citations.enabled).toBe(false)
    expect(result.warnings).toEqual([])
  })

  test('applies an override and warns that the run left the pinned baseline', () => {
    const result = applyEvalCapabilityPins({
      config: pinnedBaselineConfig(),
      overrides: new Map([['contextSources.enabled', true]])
    })

    expect(result.config.contextSources.enabled).toBe(true)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('not comparable')
  })

  test('parses repeatable overrides in both spellings', () => {
    expect([
      ...parseEvalCapabilityOverrides([
        '--capability',
        'contextSources.enabled=true',
        '--capability=fix.enabled=true'
      ])
    ]).toEqual([
      ['contextSources.enabled', true],
      ['fix.enabled', true]
    ])
  })

  test('refuses a flag outside the pinned set', () => {
    expect(() =>
      parseEvalCapabilityOverrides(['--capability', 'drift.enabled=false'])
    ).toThrow(/does not pin "drift.enabled"/u)
  })

  test('refuses a value that is not a boolean literal', () => {
    expect(() =>
      parseEvalCapabilityOverrides(['--capability', 'fix.enabled=yes'])
    ).toThrow(/must be true or false/u)
  })

  test('refuses an entry with no value at all', () => {
    expect(() =>
      parseEvalCapabilityOverrides(['--capability', 'fix.enabled'])
    ).toThrow(/<flag>=true or <flag>=false/u)
  })

  // The pin set is a SUBSET of the provenance contract by design — a capability
  // no eval-run code path reads cannot move a measured number. What must not
  // happen is a pin naming a flag the provenance contract does not carry, which
  // would pin something no report can report.
  test('pins only flags the capability provenance records', () => {
    const recorded = new Set(Object.keys(evalReportCapabilityFlags(configFrom())))

    for (const pin of evalCapabilityPins) {
      expect(recorded).toContain(pin.flag)
    }

    expect(new Set(evalCapabilityPins.map((pin) => pin.flag)).size).toBe(
      evalCapabilityPins.length
    )
  })
})

// The pin set is measured against the LEDGER, not against what ships, so some
// pins deliberately disagree with the shipped default. That gap is the whole
// design — and it is also a debt, because an instrument that drifts far enough
// from the product stops measuring the product.
//
// This test makes the debt countable instead of a matter of reading twelve
// comments. It fails in BOTH directions: flipping a shipped default without
// deciding what the pin should do, and changing a pin without recording it here.
// Either way somebody has to state which of the two moved and why.
describe('pins that deliberately disagree with the shipped default', () => {
  // Each entry owes a measurement before the pin can converge on the default.
  const expectedDivergence: Readonly<Record<string, string>> = {
    'contextSources.enabled':
      'shipped on 2026-08-11 for the product; every ledger figure predates it and its effect on recall is unmeasured. Owes the pre-registered A/B.',
    'review.citations.enabled':
      'shipped on 2026-08-10 for readability, after both live baselines, and its own A/B moved in-diff recall -3.2pp and failed its promotion rule. Owes a re-baseline.'
  }

  test('is exactly the recorded set, with a reason for each', () => {
    const shipped = CodeReviewerConfigSchema.parse({})
    const diverging = evalCapabilityPins
      .filter((pin) => pin.read(shipped) !== pin.pinned)
      .map((pin) => pin.flag)
      .sort()

    expect(diverging).toEqual(Object.keys(expectedDivergence).sort())

    for (const flag of diverging) {
      expect(expectedDivergence[flag]).toMatch(/Owes/u)
    }
  })

  // The converse, and the reason this is not just documentation: every pin that
  // AGREES with the shipped default must keep agreeing silently, so the list
  // above stays short enough to read.
  test('every other pin matches what ships', () => {
    const shipped = CodeReviewerConfigSchema.parse({})

    for (const pin of evalCapabilityPins) {
      if (pin.flag in expectedDivergence) {
        continue
      }

      expect({ [pin.flag]: pin.read(shipped) }).toEqual({
        [pin.flag]: pin.pinned
      })
    }
  })
})
