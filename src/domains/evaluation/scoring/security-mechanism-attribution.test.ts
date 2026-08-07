import { describe, expect, test } from 'vitest'
import type { AdmittedFinding } from '../../../shared/contracts/index.js'
import type { ExpectedFinding } from '../corpus/eval-fixture.schema.js'
import {
  attributeSecurityMechanism,
  securityFindingMechanismCountsForCase,
  securityMechanismFromCwe,
  UNATTRIBUTED_SECURITY_MECHANISM
} from './security-mechanism-attribution.js'

const expected = (
  overrides: Partial<ExpectedFinding> = {}
): ExpectedFinding =>
  ({
    category: 'security',
    severity: 'high',
    semanticSummary: 'tenant check is missing on the update path',
    ...overrides
  }) as ExpectedFinding

const finding = (
  overrides: Partial<AdmittedFinding> & { readonly id: string }
): AdmittedFinding =>
  ({
    category: 'security',
    ...overrides
  }) as AdmittedFinding

describe('security mechanism attribution', () => {
  test('reads a mechanism from a CWE the public table knows', () => {
    expect(securityMechanismFromCwe(['CWE-89'])).toBe('injection')
    expect(securityMechanismFromCwe(['CWE-862'])).toBe('authorization')
    expect(securityMechanismFromCwe(['cwe-22'])).toBe('path-traversal')
  })

  // CWE-601 resolved to `ssrf` until 2026-08-07, which is the same conflation two
  // curators made independently on the same advisory. The server issues no request
  // in an open redirect; it emits a `Location` the victim's browser follows.
  test('separates open redirect from server-side request forgery', () => {
    expect(securityMechanismFromCwe(['CWE-601'])).toBe('open-redirect')
    expect(securityMechanismFromCwe(['CWE-918'])).toBe('ssrf')
    // The two ids a reader reaches for next are near-misses, and the table's rule
    // is that only a CWE whose DEFINITION is the mechanism may be carried:
    // CWE-610 is the parent that also spans SSRF, CWE-1022 is reverse tabnabbing.
    expect(securityMechanismFromCwe(['CWE-610'])).toBeUndefined()
    expect(securityMechanismFromCwe(['CWE-1022'])).toBeUndefined()
  })

  test('refuses to guess when the CWE list is unknown, empty, or contradictory', () => {
    expect(securityMechanismFromCwe(undefined)).toBeUndefined()
    expect(securityMechanismFromCwe([])).toBeUndefined()
    // A CWE the table does not carry is not forced into the nearest bucket.
    expect(securityMechanismFromCwe(['CWE-1427'])).toBeUndefined()
    // Two known ids that disagree are evidence the producer was unsure. Picking
    // one would invent certainty this engine does not have.
    expect(securityMechanismFromCwe(['CWE-89', 'CWE-79'])).toBeUndefined()
    // Ids the table does not know cast no vote, so a single known id still wins.
    expect(securityMechanismFromCwe(['CWE-89', 'CWE-1427'])).toBe('injection')
  })

  test('prefers the matched expectation over the finding CWE', () => {
    expect(
      attributeSecurityMechanism({
        matchedExpected: expected({ securityMechanism: 'authorization' }),
        cwe: ['CWE-89']
      })
    ).toEqual({ bucket: 'authorization', source: 'expectation' })
  })

  test('falls back to unknown rather than inventing a bucket', () => {
    expect(attributeSecurityMechanism({})).toEqual({
      bucket: UNATTRIBUTED_SECURITY_MECHANISM,
      source: 'unknown'
    })
    // An expectation without a mechanism label is not itself a mechanism.
    expect(
      attributeSecurityMechanism({ matchedExpected: expected() })
    ).toEqual({ bucket: UNATTRIBUTED_SECURITY_MECHANISM, source: 'unknown' })
  })

  test('counts a matched finding under the mechanism its expectation states', () => {
    const counts = securityFindingMechanismCountsForCase({
      admittedFindings: [finding({ id: 'f1' })],
      expectedFindings: [expected({ securityMechanism: 'authorization' })],
      matches: [{ expectedIndex: 0, findingId: 'f1' }],
      genuineFalsePositiveFindingIds: []
    })

    expect(counts.authorization).toEqual({
      matched: 1,
      genuineFalsePositive: 0
    })
  })

  test('counts a matched finding by its expectation even when the engine called it something else', () => {
    // Recall already credits this pair, so precision must credit the same one or
    // the two halves of the ratio describe different populations.
    const counts = securityFindingMechanismCountsForCase({
      admittedFindings: [finding({ id: 'f1', category: 'bug' })],
      expectedFindings: [expected({ securityMechanism: 'injection' })],
      matches: [{ expectedIndex: 0, findingId: 'f1' }],
      genuineFalsePositiveFindingIds: []
    })

    expect(counts.injection.matched).toBe(1)
  })

  test('buckets an unattributable genuine false positive under unknown', () => {
    const counts = securityFindingMechanismCountsForCase({
      admittedFindings: [finding({ id: 'f1' })],
      expectedFindings: [],
      matches: [],
      genuineFalsePositiveFindingIds: ['f1']
    })

    expect(counts[UNATTRIBUTED_SECURITY_MECHANISM]).toEqual({
      matched: 0,
      genuineFalsePositive: 1
    })
  })

  test('attributes a genuine false positive that carries a CWE', () => {
    const counts = securityFindingMechanismCountsForCase({
      admittedFindings: [finding({ id: 'f1', cwe: ['CWE-918'] })],
      expectedFindings: [],
      matches: [],
      genuineFalsePositiveFindingIds: ['f1']
    })

    expect(counts.ssrf.genuineFalsePositive).toBe(1)
    expect(counts[UNATTRIBUTED_SECURITY_MECHANISM].genuineFalsePositive).toBe(0)
  })

  test('leaves an unlisted-real finding out of the precision denominator', () => {
    // Same exclusion the run-level adjustedPrecision makes: a real defect the
    // fixture omitted is not a precision failure.
    const counts = securityFindingMechanismCountsForCase({
      admittedFindings: [finding({ id: 'f1', cwe: ['CWE-918'] })],
      expectedFindings: [],
      matches: [],
      genuineFalsePositiveFindingIds: []
    })

    expect(counts.ssrf.genuineFalsePositive).toBe(0)
  })

  test('leaves a non-security genuine false positive out of the population', () => {
    const counts = securityFindingMechanismCountsForCase({
      admittedFindings: [finding({ id: 'f1', category: 'maintainability' })],
      expectedFindings: [],
      matches: [],
      genuineFalsePositiveFindingIds: ['f1']
    })

    expect(counts[UNATTRIBUTED_SECURITY_MECHANISM].genuineFalsePositive).toBe(0)
  })
})
