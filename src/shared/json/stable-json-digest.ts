import { sha256 } from '../hash/hash.js'

// CANONICAL-JSON DIGESTS, DEFINED ONCE.
//
// Every digest built here decides whether two runs may be compared: the
// answer-key digests in `domains/evaluation/report/eval-report-provenance.ts`,
// the slice manifest's content digest in
// `domains/evaluation/corpus/eval-slice-manifest.ts`, the stored-vs-manifest
// expectation check in `cli/impact-eval-runner.ts`, and the effective-config
// hash the `eval run` and `eval impact` commands stamp into their reports. A
// second, independently-written serializer backing the same question lands as
// either a spuriously accepted comparison or an unexplained mismatch, so there
// is exactly one.
//
// It lives in `shared/json/` rather than in `evaluation/` because none of it is
// evaluation-specific and two of its callers are not the evaluation domain:
// per spec 01's Shared Helper Policy, a helper two callers outside one domain
// use belongs in `shared/`.
//
// Recursively sorts object keys -- arrays keep their original order, since array
// order is sometimes semantically meaningful (see `computeAnswerKeyDigest`) --
// before hashing, so two logically-identical values that merely differ in key
// order, or in which case happened to load first, produce the SAME digest.
// Without this, a report re-run after something as unrelated as a directory read
// order change could report a spurious mismatch and refuse a legitimate
// comparison.
//
// Takes `unknown` rather than a closed JSON-value type so it can digest
// arbitrary already-validated domain values (an effective configuration object,
// in the CLI's case) without forcing every optional field across every caller to
// satisfy a strict recursive union. `undefined` and functions are treated as
// ABSENT, matching `JSON.stringify`'s own behaviour for object properties, so
// the digest of a value is stable under the same rules `JSON.stringify` already
// uses. Coercing them to `null` instead -- which a second copy of this once did
// -- makes `{a: undefined}` and `{a: null}` indistinguishable while making
// `{a: undefined}` and `{}` differ, the opposite of what the callers mean.

const isPlainObject = (
  value: unknown
): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const stableStringify = (value: unknown): string => {
  if (value === undefined || typeof value === 'function') {
    return 'null'
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined && typeof value[key] !== 'function')
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value) ?? 'null'
}

export const stableJsonDigest = (value: unknown): string =>
  sha256(stableStringify(value))
