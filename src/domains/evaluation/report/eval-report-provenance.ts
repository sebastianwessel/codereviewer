import {
  resolveExpectedFindingMatchMode,
  type EvalCase
} from '../corpus/eval-fixture.schema.js'
import { stableJsonDigest } from '../../../shared/json/stable-json-digest.js'

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

// And a third pair, for the intent-fulfilment corpus, separate for the same reason
// the second pair is separate from the first.
//
// The scope is exactly what decides whether a run got a row right: the expectation
// id and the intent lines it anchors. The `statement` and the `rationale` are
// deliberately OUTSIDE it — they are what a human reads to check the label, and
// rewording one for clarity must not invalidate a comparison between two runs that
// scored the identical join.
const intentAnswerKeyContent = (corpusCase: {
  readonly outstandingExpectations: readonly {
    readonly id: string
    readonly intentLineRanges: readonly (readonly [number, number])[]
  }[]
}): unknown =>
  corpusCase.outstandingExpectations.map((expectation) => ({
    id: expectation.id,
    intentLineRanges: expectation.intentLineRanges.map((range) => [...range])
  }))

type IntentDigestableCase = {
  readonly id: string
  readonly outstandingExpectations: readonly {
    readonly id: string
    readonly intentLineRanges: readonly (readonly [number, number])[]
  }[]
}

export const computeIntentAnswerKeyDigest = (
  cases: readonly IntentDigestableCase[]
): string =>
  stableJsonDigest(
    [...cases]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((corpusCase) => ({
        id: corpusCase.id,
        outstandingExpectations: intentAnswerKeyContent(corpusCase)
      }))
  )

export const computeIntentAnswerKeyDigestByCase = (
  cases: readonly IntentDigestableCase[]
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    cases.map((corpusCase) => [
      corpusCase.id,
      stableJsonDigest(intentAnswerKeyContent(corpusCase))
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
