// The filter policy: what survives, what is counted, and what the layer can never
// do.

import { describe, expect, test } from 'vitest'
import {
  adjudicateDivergences,
  deterministicAdjudicationSummary
} from './adjudicate-divergences.js'
import {
  conformanceAdjudicationInputFor,
  type ConformanceAdjudication,
  type ConformanceAdjudicationInput,
  type ConformanceAdjudicationRunner
} from './conformance-adjudication.js'
import type { ConformanceDivergence } from './conformance-report.js'

const divergenceFor = (
  name: string,
  attribution: 'change-attributed' | 'pre-existing'
): ConformanceDivergence => ({
  id: `conf_${name}`,
  attribution,
  declaration: {
    path: 'handlers/users.go',
    line: 1,
    endLine: 3,
    name,
    kind: 'declaration',
    language: 'go'
  },
  pattern: { kind: 'call', symbol: 'requireAuth' },
  peerScope: 'file',
  peerCount: 3,
  citedPeerCount: 3,
  citedPeers: [
    { path: 'handlers/users.go', line: 3, name: 'ListUsers' },
    { path: 'handlers/users.go', line: 11, name: 'GetUser' },
    { path: 'handlers/users.go', line: 19, name: 'DeleteUser' }
  ],
  peersTruncated: false,
  statement: `3 of 3 sibling declarations call requireAuth; ${name} does not.`,
  question: `Is calling requireAuth a convention ${name} should follow?`
})

const packetsFor = (
  divergences: readonly ConformanceDivergence[]
): ReadonlyMap<string, ConformanceAdjudicationInput> =>
  new Map(
    divergences.map((divergence) => [
      divergence.id,
      conformanceAdjudicationInputFor(
        divergence,
        { sharedPeerTraits: ['calls respond'], declarationTraits: ['calls respond'] },
        'calls requireAuth'
      )
    ])
  )

const answering =
  (
    answers: (input: ConformanceAdjudicationInput) => ConformanceAdjudication
  ): ConformanceAdjudicationRunner =>
  async (input) =>
    answers(input)

const alwaysConvention = answering(() => ({
  verdict: 'convention',
  reason: 'The peers all authorize before responding.'
}))

describe('adjudicate divergences', () => {
  test('reports the conventions and records the rest as counts only', async () => {
    const changeAttributed = [
      divergenceFor('ExportUsers', 'change-attributed'),
      divergenceFor('ImportUsers', 'change-attributed')
    ]
    const preExisting = [divergenceFor('LegacyUsers', 'pre-existing')]
    const result = await adjudicateDivergences({
      changeAttributed,
      preExisting,
      adjudicationInputsById: packetsFor([...changeAttributed, ...preExisting]),
      adjudicate: answering((input) =>
        input.declaration.name === 'ExportUsers'
          ? { verdict: 'convention', reason: 'The peers all authorize first.' }
          : input.declaration.name === 'ImportUsers'
            ? { verdict: 'incidental', reason: 'A shared shape, not a rule.' }
            : { verdict: 'undetermined' }
      ),
      maxAdjudications: 25
    })

    expect(
      result.changeAttributed.map((divergence) => [
        divergence.declaration.name,
        divergence.adjudication
      ])
    ).toEqual([
      [
        'ExportUsers',
        { verdict: 'convention', reason: 'The peers all authorize first.' }
      ]
    ])
    // The incidental and the undetermined leave no entry anywhere, in either list.
    expect(result.preExisting).toEqual([])
    expect(result.summary).toEqual({
      mode: 'model',
      requestedCount: 3,
      conventionCount: 1,
      incidentalCount: 1,
      undeterminedCount: 1,
      failedCount: 0,
      unadjudicatedCount: 0
    })
  })

  test('the counts reconcile with what the core produced', async () => {
    const changeAttributed = Array.from({ length: 4 }, (_unused, index) =>
      divergenceFor(`Changed${index}`, 'change-attributed')
    )
    const preExisting = Array.from({ length: 3 }, (_unused, index) =>
      divergenceFor(`Legacy${index}`, 'pre-existing')
    )
    let call = 0
    const result = await adjudicateDivergences({
      changeAttributed,
      preExisting,
      adjudicationInputsById: packetsFor([...changeAttributed, ...preExisting]),
      adjudicate: answering(() => {
        call += 1

        if (call === 1) {
          return { verdict: 'convention', reason: 'A practice.' }
        }

        if (call === 2) {
          return { verdict: 'incidental' }
        }

        throw new Error('provider unavailable')
      }),
      maxAdjudications: 5
    })
    const { summary } = result

    expect(
      summary.conventionCount +
        summary.incidentalCount +
        summary.undeterminedCount +
        summary.failedCount
    ).toBe(summary.requestedCount)
    expect(summary.requestedCount + summary.unadjudicatedCount).toBe(7)
    expect(summary).toEqual({
      mode: 'model',
      requestedCount: 5,
      conventionCount: 1,
      incidentalCount: 1,
      undeterminedCount: 0,
      failedCount: 3,
      unadjudicatedCount: 2
    })
  })

  test('spends the bound on change-attributed divergences first', async () => {
    const changeAttributed = [
      divergenceFor('ChangedOne', 'change-attributed'),
      divergenceFor('ChangedTwo', 'change-attributed')
    ]
    const preExisting = [divergenceFor('Legacy', 'pre-existing')]
    const judged: string[] = []
    const result = await adjudicateDivergences({
      changeAttributed,
      preExisting,
      adjudicationInputsById: packetsFor([...changeAttributed, ...preExisting]),
      adjudicate: answering((input) => {
        judged.push(input.declaration.name)

        return { verdict: 'convention', reason: 'A practice.' }
      }),
      maxAdjudications: 2
    })

    expect(judged).toEqual(['ChangedOne', 'ChangedTwo'])
    expect(result.preExisting).toEqual([])
    expect(result.summary.unadjudicatedCount).toBe(1)
  })

  // A failed call is not a verdict. Spec 24 requires failure to be recoverable, so
  // the run continues over the remaining divergences.
  test('a failing call drops its divergence and does not stop the run', async () => {
    const changeAttributed = [
      divergenceFor('Failing', 'change-attributed'),
      divergenceFor('Surviving', 'change-attributed')
    ]
    const result = await adjudicateDivergences({
      changeAttributed,
      preExisting: [],
      adjudicationInputsById: packetsFor(changeAttributed),
      adjudicate: answering((input) => {
        if (input.declaration.name === 'Failing') {
          throw new Error('529 overloaded')
        }

        return { verdict: 'convention', reason: 'A practice.' }
      }),
      maxAdjudications: 25
    })

    expect(result.changeAttributed.map((divergence) => divergence.declaration.name)).toEqual([
      'Surviving'
    ])
    expect(result.summary.failedCount).toBe(1)
  })

  // The layer is a filter and nothing else: it cannot invent a divergence, cannot
  // move one between the two lists, and cannot rewrite a statement or a cited peer.
  test('cannot add, relabel, or alter a divergence', async () => {
    const changeAttributed = [divergenceFor('ExportUsers', 'change-attributed')]
    const preExisting = [divergenceFor('Legacy', 'pre-existing')]
    const result = await adjudicateDivergences({
      changeAttributed,
      preExisting,
      adjudicationInputsById: packetsFor([...changeAttributed, ...preExisting]),
      adjudicate: alwaysConvention,
      maxAdjudications: 25
    })

    expect(result.changeAttributed.length).toBe(1)
    expect(result.preExisting.length).toBe(1)
    expect(result.changeAttributed[0]).toEqual({
      ...changeAttributed[0],
      adjudication: {
        verdict: 'convention',
        reason: 'The peers all authorize before responding.'
      }
    })
    expect(result.preExisting[0]?.attribution).toBe('pre-existing')
  })

  test('a divergence with no packet is dropped and counted, never reported unjudged', async () => {
    const changeAttributed = [divergenceFor('ExportUsers', 'change-attributed')]
    const result = await adjudicateDivergences({
      changeAttributed,
      preExisting: [],
      adjudicationInputsById: new Map(),
      adjudicate: alwaysConvention,
      maxAdjudications: 25
    })

    expect(result.changeAttributed).toEqual([])
    expect(result.summary.failedCount).toBe(1)
  })

  test('the deterministic summary states that nothing was judged', () => {
    expect(deterministicAdjudicationSummary()).toEqual({
      mode: 'deterministic',
      requestedCount: 0,
      conventionCount: 0,
      incidentalCount: 0,
      undeterminedCount: 0,
      failedCount: 0,
      unadjudicatedCount: 0
    })
  })
})
