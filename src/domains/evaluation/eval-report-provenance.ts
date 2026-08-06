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

// The same content, keyed per case, so a comparison can ask the question that
// actually matters: did the expectations for a case present in BOTH runs change
// underneath them?
//
// The aggregate digest above cannot distinguish that from a deliberately
// different case selection, and those deserve opposite treatment. Comparing a
// filtered run against a full one is a legitimate thing to do and the report
// already warns about it; comparing two runs whose SHARED cases were scored
// against different expectations is the incident that produced an archived
// 78.8% recall figure nobody could see was stale. Refusing both would make the
// guard so blunt it blocks ordinary work, which is how guards end up removed.
export const computeAnswerKeyDigestByCase = (
  cases: readonly EvalCase[]
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    cases.map((evalCase) => [
      evalCase.id,
      stableJsonDigest(
        evalCase.expectedFindings.map((expected) => ({
          category: expected.category,
          severity: expected.severity,
          path: expected.path ?? null,
          lineRange: expected.lineRange ?? null,
          matchMode: resolveExpectedFindingMatchMode(expected),
          semanticSummary: expected.semanticSummary
        }))
      )
    ])
  )

// The same discipline for the change-impact corpus, over ITS answer key.
//
// Deliberately a separate pair of functions rather than a generalisation of the
// two above: the two corpora's expectations have different fields, and a digest
// that tried to span both would either drop a field one of them scores on or
// change value for one corpus whenever the other gained a field. The scope is the
// same in spirit — exactly the content that decides what counts as correct, which
// here is the destination path, the reachability class and the compatibility class
// the corpus asserts. `severity` is deliberately outside it: spec 22 makes it
// descriptive metadata and not a scoring input, so relabelling one must not
// invalidate a comparison.
const changeImpactAnswerKeyContent = (corpusCase: {
  readonly expectedImpact: readonly {
    readonly path: string
    readonly lineRange: readonly [number, number]
    readonly reachability: string
    readonly compatibilityClass: string
  }[]
}): unknown =>
  corpusCase.expectedImpact.map((expected) => ({
    path: expected.path,
    lineRange: [...expected.lineRange],
    reachability: expected.reachability,
    compatibilityClass: expected.compatibilityClass
  }))

type ChangeImpactDigestableCase = {
  readonly id: string
  readonly expectedImpact: readonly {
    readonly path: string
    readonly lineRange: readonly [number, number]
    readonly reachability: string
    readonly compatibilityClass: string
  }[]
}

export const computeChangeImpactAnswerKeyDigest = (
  cases: readonly ChangeImpactDigestableCase[]
): string =>
  stableJsonDigest(
    [...cases]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((corpusCase) => ({
        id: corpusCase.id,
        expectedImpact: changeImpactAnswerKeyContent(corpusCase)
      }))
  )

export const computeChangeImpactAnswerKeyDigestByCase = (
  cases: readonly ChangeImpactDigestableCase[]
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    cases.map((corpusCase) => [
      corpusCase.id,
      stableJsonDigest(changeImpactAnswerKeyContent(corpusCase))
    ])
  )

// Cases both runs scored, whose expectations differ between them. An empty list
// means every shared case was scored against the same answer key, whatever else
// differs about the two runs.
export const casesWithDivergedAnswerKeys = (
  base: Readonly<Record<string, string>>,
  head: Readonly<Record<string, string>>
): readonly string[] =>
  Object.keys(base)
    .filter((caseId) => head[caseId] !== undefined && head[caseId] !== base[caseId])
    .sort((left, right) => left.localeCompare(right))
