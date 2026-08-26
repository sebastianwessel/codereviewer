import { describe, expect, test } from 'vitest'
import {
  ClaimSchema,
  VERDICT_RATIONALE_MAX,
  VerdictSchema
} from './verification.schema.js'

describe('ClaimSchema', () => {
  test('accepts a well-formed prior-finding claim fixture', () => {
    const parsed = ClaimSchema.parse({
      id: 'claim_0a1b2c3d4e5f6071',
      kind: 'prior-finding',
      title: 'SQL injection in query builder',
      detail:
        'A prior run reported unsanitized user input reaching a raw SQL query in the order lookup path.',
      location: {
        path: 'src/orders/lookup.ts',
        startLine: 42,
        endLine: 48,
        side: 'new'
      },
      source: 'prior-finding',
      question: 'Does the current code still concatenate unsanitized input into the query?',
      evidenceRefs: [
        { key: 'cwe', value: 'CWE-89' },
        { key: 'ruleId', value: 'sql-injection' }
      ]
    })

    expect(parsed.kind).toBe('prior-finding')
    expect(parsed.evidenceRefs).toHaveLength(2)
  })

  test('accepts a claim without the optional location and evidenceRefs', () => {
    const parsed = ClaimSchema.parse({
      id: 'claim_a1b2c3d4',
      kind: 'analyzer',
      title: 'Analyzer flagged a hardcoded secret',
      detail: 'CodeQL reported a hardcoded credential candidate.',
      source: 'analyzer:codeql',
      question: 'Is the flagged string an actual secret reachable at runtime?'
    })

    expect(parsed.location).toBeUndefined()
    expect(parsed.evidenceRefs).toBeUndefined()
  })

  test('rejects a claim id that does not match the claim_<hex> pattern', () => {
    expect(() =>
      ClaimSchema.parse({
        id: 'not-a-claim-id',
        kind: 'comment',
        title: 'Reviewer comment',
        detail: 'A human reviewer flagged this line as suspicious.',
        source: 'comment:github',
        question: 'Is this concern still valid?'
      })
    ).toThrow()
  })

  test('rejects unknown fields (strict object)', () => {
    expect(() =>
      ClaimSchema.parse({
        id: 'claim_a1b2c3d4',
        kind: 'fix',
        title: 'Fix claim',
        detail: 'A patch claims to resolve the prior finding.',
        source: 'fix',
        question: 'Does the patch resolve the issue without introducing a new one?',
        unexpected: 'nope'
      })
    ).toThrow()
  })
})

describe('VerdictSchema', () => {
  test('accepts a well-formed confirmed verdict fixture', () => {
    const parsed = VerdictSchema.parse({
      claimId: 'claim_0a1b2c3d4e5f6071',
      status: 'confirmed',
      rationale:
        'The query builder still concatenates the raw `orderId` parameter into the SQL string without parameterization.',
      citedEvidenceIds: ['ev_a1b2c3d4e5f60718'],
      fingerprints: [{ algorithm: 'v1', value: 'abc123' }]
    })

    expect(parsed.status).toBe('confirmed')
    expect(parsed.fingerprints).toHaveLength(1)
  })

  test('defaults citedEvidenceIds to an empty array', () => {
    const parsed = VerdictSchema.parse({
      claimId: 'claim_a1b2c3d4',
      status: 'uncertain',
      rationale: 'Tool call budget exhausted before the location could be confirmed.',
      fingerprints: [{ algorithm: 'v1', value: 'abc123' }]
    })

    expect(parsed.citedEvidenceIds).toEqual([])
  })

  test('requires at least one fingerprint', () => {
    expect(() =>
      VerdictSchema.parse({
        claimId: 'claim_a1b2c3d4',
        status: 'refuted',
        rationale: 'The flagged code path was removed in a later commit.',
        fingerprints: []
      })
    ).toThrow()
  })

  test('rejects a rationale longer than the contract cap', () => {
    expect(() =>
      VerdictSchema.parse({
        claimId: 'claim_a1b2c3d4',
        status: 'refuted',
        rationale: 'x'.repeat(VERDICT_RATIONALE_MAX + 1),
        fingerprints: [{ algorithm: 'v1', value: 'abc123' }]
      })
    ).toThrow()
  })
})
