import { describe, expect, test } from 'vitest'
import {
  AdmittedFindingSchema,
  type AdmittedFinding
} from '../../shared/contracts/findings/finding.schema.js'
import {
  ClaimSchema,
  VerdictSchema,
  type Claim,
  type Verdict
} from '../../shared/contracts/verification/verification.schema.js'
import { corroborateFindings } from './corroboration.js'

const configHash =
  '1111111111111111111111111111111111111111111111111111111111111111'

const makeFinding = (overrides: Partial<AdmittedFinding> = {}): AdmittedFinding =>
  AdmittedFindingSchema.parse({
    id: 'find_abc123',
    taskId: 'task_abc123',
    category: 'bug',
    severity: 'high',
    title: 'Incorrect return branch',
    description: 'The changed branch can return an incorrect value.',
    location: { path: 'src/app.ts', startLine: 10, endLine: 14, side: 'new' },
    evidenceIds: ['ev_diff1'],
    proposedBy: 'review-agent',
    admissionStatus: 'admitted',
    admittedAt: '2026-06-20T00:00:00.000Z',
    admissionEvidenceIds: ['ev_diff1'],
    reporterEligibility: 'inline',
    provenance: {
      reviewer: 'review-agent',
      instructionHashes: [],
      skillHashes: [],
      signalVersions: {},
      configHash
    },
    baselineStatus: 'new',
    fingerprints: [{ algorithm: 'v2-anchor', value: 'abc123' }],
    ...overrides
  })

const makeVerdict = (overrides: Partial<Verdict> = {}): Verdict =>
  VerdictSchema.parse({
    claimId: 'claim_v1',
    status: 'confirmed',
    rationale: 'The defect is still present at src/app.ts.',
    citedEvidenceIds: [],
    fingerprints: [{ algorithm: 'v2-anchor', value: 'abc123' }],
    ...overrides
  })

const makeClaim = (overrides: Partial<Claim> = {}): Claim =>
  ClaimSchema.parse({
    id: 'claim_v1',
    kind: 'prior-finding',
    title: 'Prior finding',
    detail: 'Does it still hold?',
    location: { path: 'src/app.ts', startLine: 12, side: 'new' },
    source: 'prior-finding',
    question: 'Does the prior finding still hold?',
    ...overrides
  })

describe('corroborateFindings', () => {
  test('corroborates a finding whose fingerprint matches a confirmed verdict', () => {
    const result = corroborateFindings({
      findings: [makeFinding()],
      verdicts: [makeVerdict()]
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.findingId).toBe('find_abc123')
    expect(result[0]?.confidence).toBe('corroborated')
    expect(result[0]?.matchKinds).toEqual(['fingerprint'])
    expect(result[0]?.witnessClaimIds).toEqual(['claim_v1'])
  })

  test('does not corroborate from a refuted or uncertain verdict', () => {
    const result = corroborateFindings({
      findings: [makeFinding()],
      verdicts: [
        makeVerdict({ status: 'refuted' }),
        makeVerdict({ claimId: 'claim_v2', status: 'uncertain' })
      ]
    })

    expect(result).toEqual([])
  })

  test('fuzzy-matches on path and overlapping line range via the claim location', () => {
    // No shared fingerprint, but the verdict's claim location overlaps the
    // finding's line range in the same file.
    const finding = makeFinding({
      fingerprints: [{ algorithm: 'v2-anchor', value: 'different' }]
    })
    const result = corroborateFindings({
      findings: [finding],
      verdicts: [makeVerdict()],
      claims: [makeClaim()]
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.matchKinds).toEqual(['fuzzy'])
  })

  test('does not fuzzy-match a non-overlapping line range', () => {
    const finding = makeFinding({
      location: { path: 'src/app.ts', startLine: 100, endLine: 104, side: 'new' },
      fingerprints: [{ algorithm: 'v2-anchor', value: 'different' }]
    })
    const result = corroborateFindings({
      findings: [finding],
      verdicts: [makeVerdict()],
      claims: [makeClaim()]
    })

    expect(result).toEqual([])
  })

  test('does not fuzzy-match a different file', () => {
    const finding = makeFinding({
      location: { path: 'src/other.ts', startLine: 12, endLine: 12, side: 'new' },
      fingerprints: [{ algorithm: 'v2-anchor', value: 'different' }]
    })
    const result = corroborateFindings({
      findings: [finding],
      verdicts: [makeVerdict()],
      claims: [makeClaim()]
    })

    expect(result).toEqual([])
  })

  test('never references severity — the signal only raises confidence', () => {
    const finding = makeFinding({ severity: 'low' })
    const result = corroborateFindings({
      findings: [finding],
      verdicts: [makeVerdict()]
    })

    // The corroboration payload carries no severity; the input finding's
    // severity is untouched.
    expect(result[0]).not.toHaveProperty('severity')
    expect(finding.severity).toBe('low')
  })

  test('records multiple witnesses for one finding', () => {
    const result = corroborateFindings({
      findings: [makeFinding()],
      verdicts: [
        makeVerdict({ claimId: 'claim_a' }),
        makeVerdict({ claimId: 'claim_b' })
      ]
    })

    expect(result[0]?.witnessClaimIds).toEqual(['claim_a', 'claim_b'])
  })
})
