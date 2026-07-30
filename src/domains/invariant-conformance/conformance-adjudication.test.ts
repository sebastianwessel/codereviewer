// The one-way valve, tested at the boundary where it is enforced.
//
// Every test below is about the same property: an answer becomes a reported
// divergence only by saying `convention` and saying why. Nothing else — not a
// synonym, not a sentence containing the word, not a missing field, not a
// malformed response — can produce a verdict that reaches a report.

import { describe, expect, test } from 'vitest'
import {
  ConformanceAdjudicationInputSchema,
  conformanceAdjudicationInputFor,
  normalizeConformanceAdjudication
} from './conformance-adjudication.js'
import type { ConformanceDivergence } from './conformance-report.js'

const divergence: ConformanceDivergence = {
  id: 'conf_abc',
  attribution: 'change-attributed',
  declaration: {
    path: 'handlers/users.go',
    line: 25,
    endLine: 27,
    name: 'ExportUsers',
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
  statement: '3 of 3 sibling declarations call requireAuth; ExportUsers does not.',
  question:
    'Is calling requireAuth a convention ExportUsers should follow, or do those peers merely resemble each other?'
}

describe('conformance adjudication verdict normalization', () => {
  test('only an explicit convention with a reason can admit a divergence', () => {
    expect(
      normalizeConformanceAdjudication({
        verdict: 'convention',
        reason: 'The peers all authorize before responding.'
      })
    ).toEqual({
      verdict: 'convention',
      reason: 'The peers all authorize before responding.'
    })
    // Casing and a trailing full stop are formatting, not a different answer.
    expect(
      normalizeConformanceAdjudication({
        verdict: 'Convention.',
        reason: 'The peers all authorize before responding.'
      }).verdict
    ).toBe('convention')
  })

  test('a convention asserted with no reason is undetermined, not a divergence', () => {
    // The instructions ask for the answer AND the basis for it. An assertion with
    // no stated basis is not a decidable answer, and the direction this layer fails
    // in is silence.
    for (const value of [
      { verdict: 'convention' },
      { verdict: 'convention', reason: '' },
      { verdict: 'convention', reason: '   ' }
    ]) {
      expect(normalizeConformanceAdjudication(value)).toEqual({
        verdict: 'undetermined'
      })
    }
  })

  test('everything unusable resolves to undetermined, never to convention', () => {
    for (const value of [
      undefined,
      null,
      'convention',
      42,
      {},
      { verdict: '' },
      { reason: 'The peers all authorize.' },
      // A paraphrase is a different answer and is not read as one of the three.
      { verdict: 'this is a convention', reason: 'because they all guard' },
      { verdict: 'deliberate practice', reason: 'because they all guard' },
      { verdict: 'yes', reason: 'because they all guard' },
      { verdict: 'violation', reason: 'the guard is missing' },
      // Even a well-formed extra field cannot smuggle an answer past the shape.
      { verdict: 'convention', reason: 'ok', severity: 'high' }
    ]) {
      expect(normalizeConformanceAdjudication(value).verdict).not.toBe('convention')
    }
  })

  test('incidental is distinguished from undetermined, because the counts differ', () => {
    expect(
      normalizeConformanceAdjudication({
        verdict: 'incidental',
        reason: 'It is how the library is ordinarily written.'
      })
    ).toEqual({
      verdict: 'incidental',
      reason: 'It is how the library is ordinarily written.'
    })
    expect(
      normalizeConformanceAdjudication({ verdict: 'undetermined', reason: 'Cannot tell.' })
    ).toEqual({ verdict: 'undetermined' })
  })

  test('an overlong reason is truncated rather than discarded', () => {
    const result = normalizeConformanceAdjudication({
      verdict: 'convention',
      reason: 'x'.repeat(900)
    })

    expect(result.verdict).toBe('convention')
    expect(result.reason?.length).toBe(400)
  })
})

describe('conformance adjudication packet', () => {
  const packet = conformanceAdjudicationInputFor(
    divergence,
    {
      sharedPeerTraits: ['calls respond', 'calls requireAuth in a conditional'],
      declarationTraits: ['calls respond', 'calls exportAll']
    },
    'calls requireAuth'
  )

  test('carries the divergence, its peers, and what the group has in common', () => {
    expect(packet.statement).toBe(divergence.statement)
    expect(packet.trait).toEqual({
      kind: 'call',
      symbol: 'requireAuth',
      description: 'calls requireAuth'
    })
    expect(packet.citedPeers.map((peer) => peer.name)).toEqual([
      'ListUsers',
      'GetUser',
      'DeleteUser'
    ])
    expect(packet.sharedPeerTraits).toEqual([
      'calls respond',
      'calls requireAuth in a conditional'
    ])
    expect(packet.declaration.traits).toEqual(['calls respond', 'calls exportAll'])
  })

  // The regression this guards is measured, not hypothetical: a fresh UUID in front
  // of a packet in this repository cut the shared prefix to roughly thirty tokens
  // against a 1024-token cache minimum and bought a guaranteed miss on every call.
  test('puts nothing per-run unique early, and carries no identifier at all', () => {
    const keys = Object.keys(ConformanceAdjudicationInputSchema.shape)

    expect(keys[0]).toBe('language')
    expect(keys.slice(0, 3)).toEqual(['language', 'declarationKind', 'peerScope'])
    for (const forbidden of [
      'id',
      'divergenceId',
      'runId',
      'requestId',
      'sessionId',
      'generatedAt',
      'timestamp'
    ]) {
      expect(keys).not.toContain(forbidden)
    }
    // The whole serialized packet, not only the field names: no identifier value
    // can reach the provider through a nested field either.
    expect(JSON.stringify(packet)).not.toContain(divergence.id)
    // And the fact and the question come last, so a longer packet grows at the end.
    expect(keys.slice(-2)).toEqual(['statement', 'question'])
  })

  // Two divergences from one peer set differ only in their tail, which is what makes
  // a shared prefix possible at all.
  test('two packets from the same peer set share a leading prefix', () => {
    const other = conformanceAdjudicationInputFor(
      { ...divergence, id: 'conf_def', pattern: { kind: 'call', symbol: 'respond' } },
      {
        sharedPeerTraits: ['calls respond', 'calls requireAuth in a conditional'],
        declarationTraits: ['calls respond', 'calls exportAll']
      },
      'calls respond'
    )
    const left = JSON.stringify(packet)
    const right = JSON.stringify(other)
    let shared = 0

    while (shared < left.length && left[shared] === right[shared]) {
      shared += 1
    }

    expect(shared).toBeGreaterThan(60)
  })

  test('the packet cannot describe a pattern held by fewer than three peers', () => {
    expect(() =>
      ConformanceAdjudicationInputSchema.parse({
        ...packet,
        citedPeerCount: 2,
        citedPeers: packet.citedPeers.slice(0, 2)
      })
    ).toThrow()
  })
})
