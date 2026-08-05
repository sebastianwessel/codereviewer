// Spec 22's admission requirement, and its verification-matrix row "A finding
// without a named dependent is rejected".
//
// The rule is not a formality. A change-impact finding is a claim about a specific
// file at a specific line — "this function has six callers; two rely on the return
// value you changed; here they are". Strip the dependent and what is left is an
// opinion about a change, which is the one thing spec 22 says this capability must
// never emit. Every rejection below is a way of losing the dependent.
//
// The gate is this capability's OWN, per spec 22: the diff reviewer's gate requires
// a finding to sit INSIDE the reviewed paths, and an impact finding is outside them
// by construction. Nothing here imports from `admission`; the shared pieces come
// from `shared/` (redaction, field-bound truncation, hashing).

import { describe, expect, test } from 'vitest'
import { admitImpactFinding } from './impact-admission.js'
import {
  ImpactRelianceSchema,
  type ImpactedFile,
  type ImpactFinding
} from './impact-report.js'

const dependent: ImpactedFile = {
  path: 'src/caller.ts',
  symbols: [
    {
      name: 'legacyApi',
      definitionPath: 'src/legacy.ts',
      definitionLine: 1,
      sites: [
        { line: 3, text: 'legacyApi()' },
        { line: 9, text: 'legacyApi()' }
      ]
    }
  ]
}

const policy = (admittedFindings: readonly ImpactFinding[] = []) => ({
  impactedFiles: [dependent],
  impactedTestFiles: [],
  admittedFindings
})

const candidate = (overrides: Record<string, unknown> = {}) => ({
  path: 'src/caller.ts',
  destination: 'production',
  compatibilityClass: 'breaks-on-build',
  reliances: [
    {
      symbolName: 'legacyApi',
      definitionPath: 'src/legacy.ts',
      definitionLine: 1,
      line: 3,
      contractElement: 'the declaration of legacyApi, which this change removes',
      consequence: 'this file references a name the change no longer declares',
      adjudicatedBy: 'deterministic'
    }
  ],
  ...overrides
})

describe('impact admission', () => {
  test('admits a finding that names its dependent, its line, the element and the consequence', () => {
    const result = admitImpactFinding({
      candidate: candidate(),
      policy: policy()
    })

    expect(result.status).toBe('admitted')
    expect(result.status === 'admitted' && result.finding).toMatchObject({
      path: 'src/caller.ts',
      destination: 'production',
      compatibilityClass: 'breaks-on-build'
    })
    // Content-addressed, so two runs over the same change join without a run id.
    expect(result.status === 'admitted' && result.finding.id).toMatch(
      /^impact_[0-9a-f]{24}$/u
    )
  })

  // SPEC 22, VERBATIM: "A finding without a named dependent is not a change-impact
  // finding and MUST be rejected."
  test('rejects a finding with no named dependent', () => {
    for (const path of ['', '   ']) {
      const result = admitImpactFinding({
        candidate: candidate({ path }),
        policy: policy()
      })

      expect(result.status).toBe('rejected')
      expect(result.status === 'rejected' && result.reason).toBe(
        'no-named-dependent'
      )
    }
  })

  test('rejects a finding that names no reliance at all', () => {
    // The other half of "named dependent": a path with nothing attached says a
    // file matters without saying what about it, which a reader cannot act on.
    const result = admitImpactFinding({
      candidate: candidate({ reliances: [] }),
      policy: policy()
    })

    expect(result.status === 'rejected' && result.reason).toBe(
      'no-named-dependent'
    )
  })

  test('rejects a dependent this run never located', () => {
    const result = admitImpactFinding({
      candidate: candidate({ path: 'src/never-searched.ts' }),
      policy: policy()
    })

    expect(result.status === 'rejected' && result.reason).toBe(
      'unknown-dependent'
    )
  })

  test('rejects a line the search did not find in that dependent', () => {
    // Without this, a finding survives on a line number produced from the shape of
    // the question, and the report sends a reviewer to a line nobody located.
    const result = admitImpactFinding({
      candidate: candidate({
        reliances: [{ ...candidate().reliances[0], line: 400 }]
      }),
      policy: policy()
    })

    expect(result.status === 'rejected' && result.reason).toBe('unlocated-line')
  })

  test('rejects a reliance naming a symbol that does not reach the dependent', () => {
    const result = admitImpactFinding({
      candidate: candidate({
        reliances: [
          { ...candidate().reliances[0], symbolName: 'somethingElse' }
        ]
      }),
      policy: policy()
    })

    expect(result.status === 'rejected' && result.reason).toBe(
      'unrelated-symbol'
    )
  })

  test('rejects a reliance missing the contract element or the consequence', () => {
    for (const field of ['contractElement', 'consequence']) {
      const result = admitImpactFinding({
        candidate: candidate({
          reliances: [{ ...candidate().reliances[0], [field]: '  ' }]
        }),
        policy: policy()
      })

      expect(result.status === 'rejected' && result.reason).toBe(
        'incomplete-evidence'
      )
    }
  })

  test('rejects no-impact as something to report', () => {
    // `no-impact` is an adjudication OUTCOME, not a finding. Admitting one would be
    // manufacturing a finding to fill a report, which spec 22 forbids.
    const result = admitImpactFinding({
      candidate: candidate({ compatibilityClass: 'no-impact' }),
      policy: policy()
    })

    expect(result.status === 'rejected' && result.reason).toBe(
      'not-reportable-class'
    )
  })

  test('rejects a second finding for the same dependent', () => {
    const first = admitImpactFinding({
      candidate: candidate(),
      policy: policy()
    })

    expect(first.status).toBe('admitted')

    const second = admitImpactFinding({
      candidate: candidate({
        reliances: [{ ...candidate().reliances[0], line: 9 }]
      }),
      policy: policy(first.status === 'admitted' ? [first.finding] : [])
    })

    // One finding per dependent file is the whole point of file granularity; a
    // second one would rebuild the per-site report by accident.
    expect(second.status === 'rejected' && second.reason).toBe('duplicate')
  })

  test('redacts and bounds the text it publishes', () => {
    const bound = ImpactRelianceSchema.shape.contractElement.maxLength ?? 0
    const result = admitImpactFinding({
      candidate: candidate({
        reliances: [
          {
            ...candidate().reliances[0],
            contractElement: 'x'.repeat(bound + 50)
          }
        ]
      }),
      policy: policy()
    })

    expect(result.status).toBe('admitted')

    const element =
      result.status === 'admitted'
        ? result.finding.reliances[0]?.contractElement
        : ''

    expect(element?.length).toBe(bound)
    // MARKED, not silently cut: an unmarked cut reads as a complete statement that
    // happens to end abruptly.
    expect(element?.endsWith('…')).toBe(true)
  })

  test('rejects a candidate that is not a candidate at all', () => {
    for (const junk of [undefined, null, 42, { path: 'src/caller.ts' }]) {
      expect(
        admitImpactFinding({ candidate: junk, policy: policy() }).status
      ).toBe('rejected')
    }
  })
})
