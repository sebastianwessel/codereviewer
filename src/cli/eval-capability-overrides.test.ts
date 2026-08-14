// The CLI half of the committed evaluation configuration: parsing
// `--capability <flag>=<bool>`, plus the two cross-checks that can only be made
// on this side of the split because `evalReportCapabilityFlags` — the function
// that decides what an eval report RECORDS about capabilities — is CLI-owned.
// The pin table's own behaviour is covered beside it, in
// `src/domains/evaluation/run/eval-capability-pins.test.ts`.
import { describe, expect, test } from 'vitest'
import {
  applyEvalCapabilityPins,
  evalCapabilityPins
} from '../domains/evaluation/index.js'
import { CodeReviewerConfigSchema } from '../shared/contracts/index.js'
import { evalReportCapabilityFlags } from './eval-capability-flags.js'
import { parseEvalCapabilityOverrides } from './eval-capability-overrides.js'

type Config = ReturnType<typeof CodeReviewerConfigSchema.parse>

const configFrom = (raw: Record<string, unknown> = {}): Config =>
  CodeReviewerConfigSchema.parse(raw)

describe('--capability overrides', () => {
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
})

describe('pins against the capability provenance the CLI records', () => {
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

  // The pin set is a SUBSET of the provenance contract by design — a capability
  // no eval-run code path reads cannot move a measured number. What must not
  // happen is a pin naming a flag the provenance contract does not carry, which
  // would pin something no report can report.
  test('pins only flags the capability provenance records', () => {
    const recorded = new Set(Object.keys(evalReportCapabilityFlags(configFrom())))

    for (const pin of evalCapabilityPins) {
      expect(recorded).toContain(pin.flag)
    }
  })
})
