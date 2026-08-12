import { z } from 'zod'
import { RepositoryRelativePathSchema } from '../../../shared/contracts/index.js'
import { EvalLineRangeSchema } from '../corpus/eval-fixture.schema.js'
import {
  CorpusSplitSchema,
  FullCommitShaSchema
} from '../corpus/real-repo-corpus.schema.js'

// Intent-fulfilment corpus (spec 23 §Evaluation).
//
// WHY THIS EXISTS AS A COMMITTED MANIFEST AT ALL. Spec 23 ships the lane with a
// measured, named failure mode — the false-satisfied route — rather than with a
// mitigation, and the lane has been on by default since 2026-08-11. A rate that
// reaches every reader of every pull request has to rest on an instrument anybody
// can re-run from a clean checkout. Until this file existed the only instrument
// lived under `.codereviewer/`, which is gitignored, so the published figures
// could not be reproduced by anyone who cloned the repository.
//
// TWO THINGS MAKE THIS CORPUS CHEAPER TO HYDRATE THAN SPEC 22'S. Its fixture
// repository is THIS repository, so hydration is local git and needs no network at
// all, and its stated intent is a verbatim slice of a `specs/*.md` section as it
// existed at a commit that is a strict ancestor of the change under test — a
// document approved before the implementation existed, in the register a real
// ticket is written in.
//
// NOTHING HERE IS DERIVED FROM ENGINE OUTPUT. The expectations are the FIXED human
// enumeration: what a human read in the intent excerpt and found genuinely not done
// at head, in the human's own words, including items no extraction ever proposed.
// Deriving them from a run would convert recall into similarity-to-our-own-engine,
// which this project has a standing rule against.

// The two arms, which are REPORTED SEPARATELY AND NEVER POOLED.
//
// A pre-written case takes its intent from a specification section that already
// existed when the change was made; a post-hoc case judges the SAME diff against
// the change's own commit message. A commit message is written after the work, so
// obligations read out of it are addressed by construction. Pooling the two would
// blend a question about intent provenance into a question about case difficulty,
// which is the measurement error spec 23's Evaluation section warns about when it
// requires real and synthetic mismatches to be reported apart.
export const IntentArmSchema = z.enum(['prewritten', 'posthoc'])

export type IntentArm = z.infer<typeof IntentArmSchema>

export const intentArms: readonly IntentArm[] = IntentArmSchema.options

// Spec 23 permits synthetic mismatches — "a truthful description with one
// obligation removed is a valid negative fixture" — but requires them to be MARKED
// and reported apart, "because a synthetic mismatch is likely easier than a real
// one and pooling them would overstate the capability".
//
// Every case in the shipped manifest is `natural`: nothing was removed from, added
// to, or reworded in any excerpt to manufacture a leftover. The field is here so a
// synthetic case cannot be added later without saying so in the data.
export const IntentMismatchOriginSchema = z.enum(['natural', 'synthetic'])

export type IntentMismatchOrigin = z.infer<typeof IntentMismatchOriginSchema>

// Where the stated intent comes from.
//
// A discriminated union rather than optional fields, because the two kinds carry
// genuinely different provenance obligations: a document slice must name the
// document and the commit it is sliced from — that pair is the whole pre-written
// guarantee — while a commit message has neither and names only the commit whose
// message it is.
export const IntentSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('document-slice'),
    // The commit the document is read AT. Hydration asserts this is a strict
    // ancestor of the change's base, which is what makes the intent pre-written;
    // a schema cannot check ancestry because ancestry is a git fact.
    commit: FullCommitShaSchema,
    path: RepositoryRelativePathSchema,
    title: z.string().min(1).max(300),
    // Inclusive `[from, to]` line ranges of the historical file, joined verbatim
    // in order. Nothing is reworded and nothing is removed to create a leftover.
    lineRanges: z.array(EvalLineRangeSchema).min(1)
  }),
  z.strictObject({
    kind: z.literal('commit-message'),
    commit: FullCommitShaSchema
  })
])

export type IntentSourceDefinition = z.infer<typeof IntentSourceSchema>

// ONE obligation a human read in the stated intent and found genuinely NOT DONE in
// the repository at the change's head commit.
//
// THE ANSWER KEY HOLDS ONLY THIS DIRECTION, and that is a decision rather than an
// omission. An `addressed` row would assert that a clause holds at head, which
// takes the same hand curation as an outstanding one and buys a denominator this
// corpus does not need: spec 23's decision rule is stated on the false-satisfied
// rate, whose numerator is exactly the rows below. There is deliberately no `truth`
// field to set to anything else — adding the other direction has to be a schema
// change and a recorded decision, not a value somebody types into a row.
export const OutstandingExpectationSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/u, 'Expectation id must be a lowercase slug'),
  // The human's own words. Never an extraction's phrasing: the enumeration exists
  // to hold items no extraction proposed, and rewriting one into the engine's
  // vocabulary would quietly narrow the denominator to what the engine can say.
  statement: z.string().min(10).max(400),
  // THE JOIN KEY, and the reason it is a line range of the SOURCE DOCUMENT rather
  // than of the assembled intent.
  //
  // Spec 23 requires every reported obligation to cite where in the stated intent
  // it came from, so a reported obligation and an expectation can be joined by the
  // clause they both point at. Addressing that clause in the source document keeps
  // the key auditable with `git show <commit>:<path>`; addressing it in the
  // assembled body would make every row move whenever a slice range changed.
  //
  // Hydration maps assembled-body lines back to source lines, so the scorer never
  // has to reproduce how the document was joined.
  intentLineRanges: z.array(EvalLineRangeSchema).min(1),
  // Why a human calls this outstanding at head. Long enough that "not done" is not
  // a valid answer: the rationale is the only thing a later reader can check the
  // label against without redoing the reading.
  rationale: z.string().min(20).max(900),
  // Where the item itself came from, so a reader can tell a label established for
  // this manifest from one preserved out of an earlier measurement.
  provenance: z.string().min(10).max(400)
})

export type OutstandingExpectation = z.infer<typeof OutstandingExpectationSchema>

export const IntentCorpusCaseSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/u, 'Case id must be a lowercase slug'),
  arm: IntentArmSchema,
  split: CorpusSplitSchema,
  mismatchOrigin: IntentMismatchOriginSchema,
  source: z.string().min(1).max(100),
  capturedAt: z.iso.date(),
  intent: IntentSourceSchema,
  // The change under review, reviewed FORWARD as it was made.
  change: z.strictObject({
    baseCommit: FullCommitShaSchema,
    headCommit: FullCommitShaSchema
  }),
  // Spec 23's obligation limit REFUSES the run when it binds; it never truncates.
  // The value is per case because it is a property of how much the excerpt asks
  // for, and a case configured at a value its extraction lands on refuses in one
  // round and scores in the next. That is correct behaviour and the manifest
  // records the value so a between-round delta can be read against it.
  maxObligations: z.int().min(1).max(100),
  // How many discrete obligations a human read in the excerpt. The denominator for
  // extraction coverage, and a fixed human count rather than a run's obligation
  // count — an extraction that proposes forty statements out of a twelve-clause
  // section has not found forty obligations.
  humanObligationCount: z.int().min(0),
  // May be empty. A case in which a human found nothing outstanding still measures
  // something: it is where a false-satisfied claim has no true item to hide behind,
  // and it holds the extraction-coverage denominator above.
  outstandingExpectations: z.array(OutstandingExpectationSchema),
  notes: z.string().min(1).max(1500).optional()
})

export type IntentCorpusCase = z.infer<typeof IntentCorpusCaseSchema>

// What was looked at and refused while the corpus was assembled. Recorded so the
// rejection patterns are not re-derived by the next curator.
export const IntentCorpusCurationSchema = z.strictObject({
  note: z.string().min(20).max(2000),
  rejections: z
    .array(
      z.strictObject({
        candidate: z.string().min(1).max(300),
        reason: z.string().min(20).max(1000)
      })
    )
    .default([])
})

export const IntentCorpusManifestSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  datasetId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/u, 'Dataset id must be a lowercase slug'),
  description: z.string().min(1).max(3000),
  curation: IntentCorpusCurationSchema.optional(),
  cases: z.array(IntentCorpusCaseSchema).min(1)
})

export type IntentCorpusManifest = z.infer<typeof IntentCorpusManifestSchema>

const assertUnique = <T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  message: (duplicate: string) => string
): void => {
  const seen = new Set<string>()

  for (const value of values) {
    const key = keyOf(value)

    if (seen.has(key)) {
      throw new Error(message(key))
    }

    seen.add(key)
  }
}

const rangeContains = (
  outer: readonly (readonly [number, number])[],
  inner: readonly [number, number]
): boolean =>
  outer.some(([from, to]) => inner[0] >= from && inner[1] <= to)

/**
 * Parses a manifest and applies the cross-case rules a per-case schema cannot
 * express. They are validation rather than a checklist someone is trusted to have
 * followed: this repository has a recorded incident in which a shipped corpus
 * manifest failed its own schema while the test suite stayed green, and only
 * hydration caught it.
 */
export const parseIntentCorpusManifest = (
  input: unknown
): IntentCorpusManifest => {
  const manifest = IntentCorpusManifestSchema.parse(input)

  assertUnique(
    manifest.cases,
    (corpusCase) => corpusCase.id,
    (duplicate) => `Duplicate intent case id "${duplicate}".`
  )

  for (const corpusCase of manifest.cases) {
    assertUnique(
      corpusCase.outstandingExpectations,
      (expectation) => expectation.id,
      (duplicate) =>
        `Intent case "${corpusCase.id}" declares expectation id "${duplicate}" twice.`
    )

    if (corpusCase.change.baseCommit === corpusCase.change.headCommit) {
      throw new Error(
        `Intent case "${corpusCase.id}" declares the same base and head commit; there is no change to check the intent against.`
      )
    }

    // A document sliced AT the head commit could have been written to describe the
    // change, which is exactly the defect a corpus built from commit messages has.
    // Ancestry is checked properly by hydration, against real git; this catches the
    // one case that needs no git at all.
    if (
      corpusCase.intent.kind === 'document-slice' &&
      corpusCase.intent.commit === corpusCase.change.headCommit
    ) {
      throw new Error(
        `Intent case "${corpusCase.id}" slices its intent from the head commit, so the intent is not pre-written.`
      )
    }

    if (
      corpusCase.arm === 'prewritten' &&
      corpusCase.intent.kind !== 'document-slice'
    ) {
      throw new Error(
        `Intent case "${corpusCase.id}" is in the pre-written arm but takes its intent from a commit message, which is written after the work.`
      )
    }

    if (
      corpusCase.arm === 'posthoc' &&
      corpusCase.intent.kind !== 'commit-message'
    ) {
      throw new Error(
        `Intent case "${corpusCase.id}" is in the post-hoc arm but does not take its intent from a commit message.`
      )
    }

    if (
      corpusCase.outstandingExpectations.length > corpusCase.humanObligationCount
    ) {
      throw new Error(
        `Intent case "${corpusCase.id}" enumerates ${corpusCase.outstandingExpectations.length} outstanding obligation(s) out of ${corpusCase.humanObligationCount} a human read; the outstanding set is a subset of what the excerpt asks for.`
      )
    }

    // THE CENTRAL INVARIANT. An expectation's clause must lie inside the excerpt
    // the run is actually shown. An anchor outside it names a clause no obligation
    // can ever cite, so the row would be an unreachable recall miss on every run —
    // a permanent penalty for material the engine was never given.
    if (corpusCase.intent.kind === 'document-slice') {
      const sliceRanges = corpusCase.intent.lineRanges

      for (const expectation of corpusCase.outstandingExpectations) {
        for (const range of expectation.intentLineRanges) {
          if (!rangeContains(sliceRanges, range)) {
            throw new Error(
              `Intent case "${corpusCase.id}" anchors expectation "${expectation.id}" at lines ${range[0]}-${range[1]} of ${corpusCase.intent.path}, which the intent excerpt does not include.`
            )
          }
        }
      }
    }

    // The anchors PARTITION the excerpt's cited lines. Two expectations sharing a
    // line would both claim the same reported obligation, so one obligation could
    // satisfy two rows of the answer key — and, worse, one wrong `evidenced` would
    // be counted as two false-satisfied claims. The join has to be a function.
    const claimedLines = new Map<number, string>()

    for (const expectation of corpusCase.outstandingExpectations) {
      for (const [from, to] of expectation.intentLineRanges) {
        for (let line = from; line <= to; line += 1) {
          const owner = claimedLines.get(line)

          if (owner !== undefined) {
            throw new Error(
              `Intent case "${corpusCase.id}" anchors both "${owner}" and "${expectation.id}" at line ${line}; one clause cannot answer for two expectations.`
            )
          }

          claimedLines.set(line, expectation.id)
        }
      }
    }
  }

  // A corpus with no outstanding expectation anywhere can report a false-satisfied
  // numerator of zero without having looked at anything, which is this project's
  // recorded silent-optimism shape.
  const expectationCount = manifest.cases.reduce(
    (total, corpusCase) => total + corpusCase.outstandingExpectations.length,
    0
  )

  if (expectationCount === 0) {
    throw new Error(
      'The intent corpus declares no outstanding obligation in any case, so no false-satisfied claim could ever be detected.'
    )
  }

  return manifest
}

export const parseIntentCorpusManifestJson = (
  jsonText: string
): IntentCorpusManifest => {
  const parsed: unknown = JSON.parse(jsonText)

  return parseIntentCorpusManifest(parsed)
}

export type IntentArmCounts = Readonly<Record<IntentArm, number>>

/** Outstanding expectations per arm, over whichever cases a run selected. */
export const countOutstandingExpectationsByArm = (
  cases: readonly IntentCorpusCase[]
): IntentArmCounts => {
  const counts: Record<IntentArm, number> = { prewritten: 0, posthoc: 0 }

  for (const corpusCase of cases) {
    counts[corpusCase.arm] += corpusCase.outstandingExpectations.length
  }

  return counts
}
