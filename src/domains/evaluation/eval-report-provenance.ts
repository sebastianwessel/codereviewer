import { createHash } from 'node:crypto'
import {
  resolveExpectedFindingMatchMode,
  type EvalCase
} from './eval-fixture.schema.js'

// Generic canonical-JSON digest: recursively sorts object keys (arrays keep
// their original order, since array order is sometimes semantically
// meaningful -- see `computeAnswerKeyDigest` below) before hashing, so two
// logically-identical values that merely differ in key order, or in which
// case happened to load first, produce the SAME digest. Without this, a
// report re-run after something as unrelated as a directory read order change
// could report a spurious mismatch and refuse a legitimate comparison.
//
// Takes `unknown` rather than a closed JSON-value type so it can digest
// arbitrary already-validated domain values (an effective configuration
// object, in the CLI's case) without forcing every optional field across
// every caller to satisfy a strict recursive union. `undefined` and functions
// are treated as absent, matching `JSON.stringify`'s own behaviour for object
// properties, so the digest of a value is stable under the same rules
// `JSON.stringify` already uses.
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
  createHash('sha256').update(stableStringify(value)).digest('hex')

// The answer-key digest covers exactly the expected-finding CONTENT of every
// selected case -- category, severity, path, effective match mode, declared
// line range, and semantic summary -- because that content is what determines
// the recall/precision denominators a report's headline numbers are scored
// against. It deliberately does NOT cover `expectedNoFindingZones`,
// `changedFiles`, `tags`, or any other case metadata: those can change (a
// fixture gaining a tag, a no-finding zone being widened) without altering
// what the run's recall or precision figures MEAN, and folding them in would
// make the digest flag mismatches that have nothing to do with the incident
// this guards against -- an archived run whose reported 78.8% recall was
// silently scored against an answer key that had since changed underneath it.
//
// Cases are sorted by id before hashing, so the digest is insensitive to
// selection/execution order (e.g. a different `--case` flag order, or a
// differently-ordered slice directory listing), matching the requirement that
// digests be order-insensitive where order carries no meaning. Expected
// findings WITHIN a case keep their original array order: `expectedIndex` is
// part of the matching contract (assignment prefers the lowest available
// index), so reordering them is not a "same content, different
// representation" change the way case order is.
export const computeAnswerKeyDigest = (
  cases: readonly EvalCase[]
): string =>
  stableJsonDigest(
    [...cases]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((evalCase) => ({
        id: evalCase.id,
        expectedFindings: evalCase.expectedFindings.map((expected) => ({
          category: expected.category,
          severity: expected.severity,
          path: expected.path ?? null,
          lineRange: expected.lineRange ?? null,
          matchMode: resolveExpectedFindingMatchMode(expected),
          semanticSummary: expected.semanticSummary
        }))
      }))
  )
