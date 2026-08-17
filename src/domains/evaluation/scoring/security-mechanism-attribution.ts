// Mechanism attribution for ADMITTED findings (spec 15, *Measurement First*).
//
// Per-mechanism RECALL needs only the ground truth's label, which expected
// findings already carry. Per-mechanism ADJUSTED PRECISION needs the other half
// of the denominator — the genuine false positives that belong to each mechanism
// — and an admitted finding carries no mechanism, so that half did not exist and
// spec 15 recorded the gap as an unmet acceptance criterion.
//
// This module supplies the label from the only two sources that can justify one,
// and REFUSES to supply it otherwise. Guessing a mechanism from a finding's title
// or description would manufacture the very denominator the measurement is
// supposed to establish, so an unattributable finding is `unknown` and is counted
// as such. `unknown` is not a bucket of last resort that quietly disappears: it is
// what makes every per-mechanism precision rate readable, because a genuine false
// positive that could belong to any mechanism bounds all of them.
//
// It sits in `scoring/` rather than `judging/` even though it reads match
// results: what it produces is a per-mechanism count, `scoring/metrics.ts` is
// its only consumer, and it makes no model call. `judging/` is the model-backed
// half of the domain; nothing here talks to a provider.

import type { AdmittedFinding } from '../../../shared/contracts/index.js'
import {
  SecurityMechanismSchema,
  type ExpectedFinding,
  type SecurityMechanism
} from '../corpus/eval-fixture.schema.js'

// The bucket for a finding whose mechanism cannot be justified. Deliberately a
// distinct literal rather than `undefined`: it is reported, aggregated, and
// rendered like any other bucket.
export const UNATTRIBUTED_SECURITY_MECHANISM = 'unknown' as const

export type SecurityMechanismBucket =
  | SecurityMechanism
  | typeof UNATTRIBUTED_SECURITY_MECHANISM

export const allSecurityMechanismBuckets: readonly SecurityMechanismBucket[] = [
  ...SecurityMechanismSchema.options,
  UNATTRIBUTED_SECURITY_MECHANISM
]

// Where a label came from, so a reader can tell a mechanism the ground truth
// stated from one this engine derived from a third party's CWE tagging.
export type SecurityMechanismAttributionSource = 'expectation' | 'cwe' | 'unknown'

// Public CWE -> mechanism table. Every entry is a CWE whose own definition IS the
// mechanism spec 15 names; none of it is derived from an eval finding, and adding
// an id here is a claim about the CWE catalog, not about a fixture. Ids the table
// does not know stay unmapped rather than being forced into the nearest bucket.
//
// Sources: CWE 4.x weakness definitions and the OWASP Top 10 category mappings
// they carry.
const cweMechanisms: Readonly<Record<string, SecurityMechanism>> = {
  // Access control (CWE-284 and its children).
  'CWE-269': 'authorization',
  'CWE-284': 'authorization',
  'CWE-285': 'authorization',
  'CWE-306': 'authorization',
  'CWE-425': 'authorization',
  'CWE-566': 'authorization',
  'CWE-639': 'authorization',
  'CWE-862': 'authorization',
  'CWE-863': 'authorization',
  'CWE-1220': 'authorization',
  // Injection (CWE-74 and its children), excluding XSS and SSRF, which spec 15
  // measures as their own mechanisms.
  'CWE-74': 'injection',
  'CWE-77': 'injection',
  'CWE-78': 'injection',
  'CWE-88': 'injection',
  'CWE-89': 'injection',
  'CWE-90': 'injection',
  'CWE-91': 'injection',
  'CWE-94': 'injection',
  'CWE-95': 'injection',
  'CWE-917': 'injection',
  'CWE-943': 'injection',
  'CWE-1336': 'injection',
  // Server-side request forgery: the SERVER is the one issuing the request.
  'CWE-918': 'ssrf',
  // Open redirect. CWE-601 is the whole of this bucket because it is the only id
  // in the catalog whose definition IS the mechanism, and the strict rule above
  // forbids rounding a near-miss into it. The two ids a reader will reach for are
  // deliberately absent: CWE-610 (*Externally Controlled Reference to a Resource
  // in Another Sphere*) is CWE-601's PARENT and equally covers SSRF, so it states
  // no mechanism on its own; CWE-1022 (*Use of Web Link to Untrusted Target with
  // window.opener Access*) is reverse tabnabbing, where the destination is
  // intended and the defect is the opener handle it inherits.
  'CWE-601': 'open-redirect',
  // Cross-site scripting and output encoding.
  'CWE-79': 'xss',
  'CWE-80': 'xss',
  'CWE-83': 'xss',
  'CWE-87': 'xss',
  'CWE-116': 'xss',
  // Deserialization.
  'CWE-502': 'deserialization',
  // Secret and sensitive-data flow.
  'CWE-200': 'secret-flow',
  'CWE-201': 'secret-flow',
  'CWE-209': 'secret-flow',
  'CWE-312': 'secret-flow',
  'CWE-313': 'secret-flow',
  'CWE-315': 'secret-flow',
  'CWE-319': 'secret-flow',
  'CWE-522': 'secret-flow',
  'CWE-532': 'secret-flow',
  'CWE-798': 'secret-flow',
  // Cryptography: weak primitive, misuse, predictable randomness.
  'CWE-261': 'cryptography',
  'CWE-323': 'cryptography',
  'CWE-326': 'cryptography',
  'CWE-327': 'cryptography',
  'CWE-328': 'cryptography',
  'CWE-330': 'cryptography',
  'CWE-335': 'cryptography',
  'CWE-338': 'cryptography',
  'CWE-347': 'cryptography',
  'CWE-759': 'cryptography',
  'CWE-760': 'cryptography',
  'CWE-916': 'cryptography',
  // Filesystem / path traversal.
  'CWE-22': 'path-traversal',
  'CWE-23': 'path-traversal',
  'CWE-36': 'path-traversal',
  'CWE-59': 'path-traversal',
  'CWE-73': 'path-traversal',
  // Unsafe configuration.
  'CWE-16': 'unsafe-config',
  'CWE-614': 'unsafe-config',
  'CWE-942': 'unsafe-config',
  'CWE-1004': 'unsafe-config',
  'CWE-1275': 'unsafe-config',
  // Concurrency and resource exhaustion.
  'CWE-362': 'concurrency-resource',
  'CWE-366': 'concurrency-resource',
  'CWE-367': 'concurrency-resource',
  'CWE-400': 'concurrency-resource',
  'CWE-674': 'concurrency-resource',
  'CWE-770': 'concurrency-resource',
  'CWE-833': 'concurrency-resource',
  'CWE-1333': 'concurrency-resource'
}

/**
 * Resolve the mechanism a CWE list states, or `undefined` when it states none.
 *
 * A list whose known ids disagree resolves to `undefined` rather than to the
 * first, the most severe, or the most common of them: an alert tagged both
 * `CWE-89` and `CWE-79` is evidence that its producer was unsure, and picking one
 * would invent certainty this engine does not have. Ids absent from the table
 * carry no vote either way.
 */
export const securityMechanismFromCwe = (
  cwe: readonly string[] | undefined
): SecurityMechanism | undefined => {
  const mechanisms = new Set(
    (cwe ?? []).flatMap((id) => {
      const mechanism = cweMechanisms[id.toUpperCase()]

      return mechanism === undefined ? [] : [mechanism]
    })
  )

  return mechanisms.size === 1 ? [...mechanisms][0] : undefined
}

export type SecurityMechanismAttribution = {
  readonly bucket: SecurityMechanismBucket
  readonly source: SecurityMechanismAttributionSource
}

/**
 * Attribute one admitted finding to a security mechanism.
 *
 * The expectation it matched wins, because that label is ground truth a human
 * wrote about this exact defect. Failing that, the finding's own CWE tags are
 * consulted — the only other signal on a finding whose meaning is defined by a
 * public catalog rather than by prose this engine wrote. Failing both, `unknown`.
 */
export const attributeSecurityMechanism = (input: {
  readonly matchedExpected?: ExpectedFinding | undefined
  readonly cwe?: readonly string[] | undefined
}): SecurityMechanismAttribution => {
  const fromExpectation = input.matchedExpected?.securityMechanism

  if (fromExpectation !== undefined) {
    return { bucket: fromExpectation, source: 'expectation' }
  }

  const fromCwe = securityMechanismFromCwe(input.cwe)

  if (fromCwe !== undefined) {
    return { bucket: fromCwe, source: 'cwe' }
  }

  return { bucket: UNATTRIBUTED_SECURITY_MECHANISM, source: 'unknown' }
}

// Matched/genuine-false-positive pair for one mechanism bucket: the two halves of
// per-mechanism adjusted precision.
export type SecurityFindingMechanismCounts = {
  readonly matched: number
  readonly genuineFalsePositive: number
}

export const emptySecurityFindingMechanismCounts = (): Record<
  SecurityMechanismBucket,
  SecurityFindingMechanismCounts
> =>
  Object.fromEntries(
    allSecurityMechanismBuckets.map((bucket) => [
      bucket,
      { matched: 0, genuineFalsePositive: 0 }
    ])
  ) as Record<SecurityMechanismBucket, SecurityFindingMechanismCounts>

/**
 * Tally one case's admitted findings into per-mechanism precision counts.
 *
 * The population is deliberately asymmetric, and each half is chosen so the two
 * sides of the ratio describe the same thing:
 *
 * - A finding that MATCHED a mechanism-labelled expectation is in the numerator
 *   for that mechanism, whatever category the engine gave it. This is exactly the
 *   pair `securityRecallByMechanism` already counts, so precision and recall can
 *   never disagree about what matched.
 * - An unmatched finding enters the denominator only when it is a GENUINE false
 *   positive AND the engine itself called it security. Unlisted-real findings are
 *   excluded for the same reason the run-level `adjustedPrecision` excludes them:
 *   a real defect the fixture omitted is not a precision failure.
 */
export const securityFindingMechanismCountsForCase = (input: {
  readonly admittedFindings: readonly AdmittedFinding[]
  readonly expectedFindings: readonly ExpectedFinding[]
  readonly matches: readonly {
    readonly expectedIndex: number
    readonly findingId: string
  }[]
  readonly genuineFalsePositiveFindingIds: readonly string[]
}): Record<SecurityMechanismBucket, SecurityFindingMechanismCounts> => {
  const counts = emptySecurityFindingMechanismCounts()
  const expectedByFindingId = new Map<string, ExpectedFinding>()

  for (const match of input.matches) {
    const expected = input.expectedFindings[match.expectedIndex]

    if (expected !== undefined) {
      expectedByFindingId.set(match.findingId, expected)
    }
  }

  const genuineFalsePositiveIds = new Set(input.genuineFalsePositiveFindingIds)

  for (const finding of input.admittedFindings) {
    const matchedExpected = expectedByFindingId.get(finding.id)
    // The precedence rule lives in `attributeSecurityMechanism` and nowhere
    // else. This loop used to reimplement its matched-expectation branch inline,
    // which left the two free to drift with a green suite; both halves of the
    // decision below are read off the ONE attribution.
    const { bucket, source } = attributeSecurityMechanism({
      matchedExpected,
      cwe: finding.cwe
    })

    if (matchedExpected !== undefined) {
      // A matched expectation that states no mechanism is not counted: its CWE
      // fallback would credit the numerator with a mechanism the ground truth
      // never claimed, and `securityRecallByMechanism` — the other half of this
      // ratio — counts the same pair only under the label the expectation
      // carries. `source` is what says the label came from the expectation
      // itself; the bucket alone cannot.
      if (source !== 'expectation') {
        continue
      }

      const current = counts[bucket]
      counts[bucket] = {
        ...current,
        matched: current.matched + 1
      }
      continue
    }

    if (
      !genuineFalsePositiveIds.has(finding.id) ||
      finding.category !== 'security'
    ) {
      continue
    }

    const current = counts[bucket]
    counts[bucket] = {
      ...current,
      genuineFalsePositive: current.genuineFalsePositive + 1
    }
  }

  return counts
}
