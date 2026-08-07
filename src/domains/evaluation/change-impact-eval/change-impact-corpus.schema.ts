import { z } from 'zod'
import {
  RepositoryRelativePathSchema,
  SeveritySchema
} from '../../../shared/contracts/index.js'
import { CompatibilityClassSchema } from '../../change-impact/index.js'
import { EvalLineRangeSchema } from '../corpus/eval-fixture.schema.js'
import {
  containsAnswerKey,
  CorpusScreeningSchema,
  CorpusSplitSchema,
  FullCommitShaSchema,
  PermissiveLicenseSchema,
  RemovedCommentDisclosureReviewSchema
} from '../corpus/real-repo-corpus.schema.js'

// Change-impact corpus (spec 22 §Evaluation).
//
// This is the INVERSE of the real-repository corpus, and the two schemas are
// deliberately separate rather than one schema with a mode flag. Spec 17's
// central invariant is that every expectation sits INSIDE the reviewed paths;
// this corpus's central invariant is that every expectation sits OUTSIDE them.
// A schema whose central rule is conditional enforces nothing, so the invariant
// is stated once here, unconditionally, in its negated form.
//
// Orientation is forward: `base = introducingCommit^`, `head = introducingCommit`
// — a real change reviewed as it was made, not a fix read backwards. The reviewed
// paths P are the files the change touches; the expectations live in Q with
// `Q ⊄ P`.
//
// Nothing in this manifest is a detector input. It is ground truth plus the
// provenance needed to reproduce and audit a case.

// Where a dependent sits relative to the change, and therefore which lookup could
// possibly reach it. Spec 22 requires recall to be reportable per class, "because
// a capability that finds direct callers and misses indirect ones is useful and
// should not be scored as if those were the same problem".
//
// The label is carried per EXPECTED DEPENDENT rather than per case, because the
// pre-registered decision rule scores a destination FILE, and one change can break
// a direct caller and a repository-search-only dependent at the same time. A case
// whose dependents differ would otherwise have to be scored under one label that
// is wrong for the other.
//
// The first three are directly reachable — a reference lookup from a symbol named
// in the diff lands on them. `whole-repo-search` is the class spec 22 describes as
// "linked only by a relation no local lookup would surface", and an engine that
// scores zero there is behaving as designed, not failing.
export const ImpactReachabilitySchema = z.enum([
  // The dependent names the changed symbol and calls it, or subclasses the type
  // that declares it. One hop, and the diff names the far end.
  'caller-of-changed-symbol',
  // The dependent is what the changed code calls or imports. One hop, and the
  // diff names the near end; what the diff does NOT show is the callee's body.
  'callee-of-changed-code',
  // The dependent owns the attribute, module, or class the diff mutates or
  // imports, so following the mutated name reaches it.
  'attribute-owner',
  // No import edge, no call, no shared name in the diff. Reaching the dependent
  // means knowing what the change means and searching the repository for code
  // exposed to it.
  'whole-repo-search'
])

export type ImpactReachability = z.infer<typeof ImpactReachabilitySchema>

export const directlyReachableImpactClasses: readonly ImpactReachability[] = [
  'caller-of-changed-symbol',
  'callee-of-changed-code',
  'attribute-owner'
]

export const isDirectlyReachable = (
  reachability: ImpactReachability
): boolean => directlyReachableImpactClasses.includes(reachability)

// Spec 22's compatibility class, restricted to the classes a FINDING can carry.
// `no-impact` is an adjudication outcome and is never a finding, so a corpus of
// PROVEN breakage cannot express it: every case here is damage that happened.
//
// Narrowed from the implemented enum rather than retyped, so a class added to the
// lane is a class this answer key can also assert. The exclusion is the invariant
// worth stating by hand; the membership is not.
//
// The class is mechanism, not judgement, and it is what this corpus asserts in
// place of a severity. See the note on `severity` below for why.
export const ExpectedCompatibilityClassSchema = CompatibilityClassSchema.exclude(
  ['no-impact']
)

// The upstream artefact that PROVES the dependent broke. A required discriminated
// union with no free-text-only variant, because that is how spec 22's "a curator's
// inference that something might break is not admissible" becomes enforceable
// rather than a rule someone is trusted to have followed.
//
// Every variant carries a verbatim quote from the upstream artefact and the
// verification of how the reference resolves to the introducing commit. Both are
// bounded strings, so an empty or hand-waved provenance fails parsing.
const EvidenceQuoteSchema = z.string().min(10).max(1000)
const LinkVerificationSchema = z.string().min(20).max(600)

export const EvidenceOfBreakageSchema = z.discriminatedUnion('kind', [
  // A later commit that repairs the dependent and names the introducing commit.
  z.strictObject({
    kind: z.literal('upstream-fix'),
    commit: FullCommitShaSchema,
    committedAt: z.iso.date(),
    subject: z.string().min(1).max(300),
    // The files the fix repairs. At least one MUST be an expected dependent, so
    // an "evidence" commit that repairs something else cannot be attached.
    repairedPaths: z.array(RepositoryRelativePathSchema).min(1),
    quotes: z.array(EvidenceQuoteSchema).min(1),
    linkVerification: LinkVerificationSchema
  }),
  // A revert of the introducing commit itself.
  z.strictObject({
    kind: z.literal('revert'),
    commit: FullCommitShaSchema,
    committedAt: z.iso.date(),
    subject: z.string().min(1).max(300),
    quotes: z.array(EvidenceQuoteSchema).min(1),
    // Revert commits notoriously reference the merge base rather than the commit
    // they revert, so a revert has to say how the reference was resolved.
    linkVerification: LinkVerificationSchema
  }),
  // An upstream issue naming the caller-side symptom.
  z.strictObject({
    kind: z.literal('issue'),
    url: z.url(),
    reportedAt: z.iso.date(),
    // The symptom as the reporter described it, on the dependent's side.
    symptomQuote: EvidenceQuoteSchema,
    linkVerification: LinkVerificationSchema
  })
])

export type EvidenceOfBreakage = z.infer<typeof EvidenceOfBreakageSchema>

export const evidenceDateOf = (evidence: EvidenceOfBreakage): string =>
  evidence.kind === 'issue' ? evidence.reportedAt : evidence.committedAt

const answerKeyFreeText = (minLength: number, maxLength: number) =>
  z
    .string()
    .min(minLength)
    .max(maxLength)
    .refine(
      (value) => !containsAnswerKey(value),
      'Reviewed-input text must not name the defect (advisory id, vulnerability, or exploit wording)'
    )

// One proven-broken dependent. The scoring unit, per spec 22's pre-registered
// decision rule: "A predicted file counts as correct when the corpus's
// proven-broken dependent is that file."
export const ExpectedImpactSchema = z.strictObject({
  // The dependent FILE. Validated against `reviewedPaths` at manifest level:
  // it MUST NOT be one of them.
  path: RepositoryRelativePathSchema,
  // Where in the dependent, at the INTRODUCING commit — the head side, which is
  // the tree hydration checks out. A range that pointed at the parent would name
  // bytes no reviewer ever saw.
  lineRange: EvalLineRangeSchema,
  reachability: ImpactReachabilitySchema,
  compatibilityClass: ExpectedCompatibilityClassSchema,
  // What breaks and why, described from the code at the introducing commit and
  // never from the upstream fix.
  semanticSummary: answerKeyFreeText(40, 900),
  // Descriptive only. Spec 22 resolved the severity/threshold tension by giving
  // impact findings a compatibility class and NO severity, and the impact
  // admission gate applies no severity threshold, so nothing here is gated on
  // this value and nothing may be relabelled to move it. It is retained so a
  // reader can weigh this corpus beside spec 17's, which is why it is narrowed
  // from the same canonical `SeveritySchema` rather than retyped.
  //
  // It is a SUBSET of that vocabulary, not a copy of it. `info` is excluded for
  // the reason `no-impact` is excluded above: an entry here is a dependent PROVEN
  // to have broken, and "informational" is not a thing that broke. That exclusion
  // used to be implicit in a hand-written four-member list, under a comment
  // claiming a parity the list did not have.
  severity: SeveritySchema.exclude(['info']),
  severityRationale: z.string().min(20).max(700),
  notes: z.string().min(1).max(700).optional()
})

export type ExpectedImpact = z.infer<typeof ExpectedImpactSchema>

// Whether the change reads as fine on its own. If the diff alone reveals the
// problem the case belongs in the spec 17 corpus, so the verdict is recorded and
// its reasoning is long enough that "looks fine" is not a valid answer.
export const LocalPlausibilitySchema = z.strictObject({
  verdict: z.enum(['plausible', 'plausible-with-caveat']),
  rationale: z.string().min(60).max(1200)
})

const RepositoryUrlSchema = z
  .url()
  .refine((value) => value.startsWith('https://'), 'Repository URL must be https')
  .refine((value) => !value.includes('@'), 'Repository URL must not embed credentials')

export const ChangeImpactCorpusCaseSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/u, 'Case id must be a lowercase slug'),
  language: z.string().min(1),
  split: CorpusSplitSchema,
  repositoryUrl: RepositoryUrlSchema,
  upstreamOwner: z.string().min(1).max(200),
  upstreamRepo: z.string().min(1).max(200),
  license: PermissiveLicenseSchema,
  source: z.string().min(1).max(100),
  capturedAt: z.iso.date(),
  // The change under review, and its parent. FORWARD: the parent is the base and
  // the introducing commit is the head that gets checked out.
  introducingCommit: FullCommitShaSchema,
  introducingCommittedAt: z.iso.datetime({ offset: true }),
  parentCommit: FullCommitShaSchema,
  // P — the files the change touches, restricted to the ones under review.
  // Restricting is deliberate: an upstream change commonly also updates tests,
  // release notes or documentation that state the new contract in prose.
  reviewedPaths: z.array(RepositoryRelativePathSchema).min(1),
  // Paths the change touches that are deliberately NOT reviewed, and why. Recorded
  // so that a narrowing choice is auditable instead of invisible.
  excludedPaths: z.array(RepositoryRelativePathSchema).default([]),
  excludedPathsReason: z.string().min(1).max(500).optional(),
  reviewIntent: answerKeyFreeText(1, 300),
  evidenceOfBreakage: z.array(EvidenceOfBreakageSchema).min(1),
  expectedImpact: z.array(ExpectedImpactSchema).min(1),
  localPlausibility: LocalPlausibilitySchema,
  // Reused verbatim from spec 17: the forward orientation removes the "a comment
  // the fix added shows up as a removed line" route, but a change that DELETES an
  // explanatory comment still shows one, and the curator's judgement is recorded
  // the same way.
  removedCommentDisclosureReview:
    RemovedCommentDisclosureReviewSchema.optional(),
  tags: z.array(z.string().min(1)).default([]),
  notes: z.string().min(1).max(1500).optional()
})

export const ChangeImpactCorpusManifestSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  datasetId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/u, 'Dataset id must be a lowercase slug'),
  modelTrainingCutoff: z.iso.date(),
  description: z.string().min(1).max(2000),
  screening: CorpusScreeningSchema.optional(),
  cases: z.array(ChangeImpactCorpusCaseSchema).min(1)
})

export type ChangeImpactCorpusCase = z.infer<typeof ChangeImpactCorpusCaseSchema>
export type ChangeImpactCorpusManifest = z.infer<
  typeof ChangeImpactCorpusManifestSchema
>

const isoDateOf = (isoDateTime: string): string => isoDateTime.slice(0, 10)

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

// Cross-case rules a per-case schema cannot express. They encode spec 22's
// evaluation contract and spec 15's anti-contamination policy as validation
// rather than as a checklist someone is trusted to have followed.
export const parseChangeImpactCorpusManifest = (
  input: unknown
): ChangeImpactCorpusManifest => {
  const manifest = ChangeImpactCorpusManifestSchema.parse(input)

  assertUnique(
    manifest.cases,
    (corpusCase) => corpusCase.id,
    (duplicate) => `Duplicate change-impact case id "${duplicate}".`
  )
  assertUnique(
    manifest.cases,
    (corpusCase) => `${corpusCase.repositoryUrl}@${corpusCase.introducingCommit}`,
    (duplicate) => `Duplicate change-impact introducing commit "${duplicate}".`
  )

  for (const corpusCase of manifest.cases) {
    if (corpusCase.introducingCommit === corpusCase.parentCommit) {
      throw new Error(
        `Change-impact case "${corpusCase.id}" declares the same introducing and parent commit.`
      )
    }

    assertUnique(
      corpusCase.removedCommentDisclosureReview?.acknowledgedComments ?? [],
      (comment) => comment,
      (duplicate) =>
        `Change-impact case "${corpusCase.id}" acknowledges the same removed comment twice: "${duplicate}".`
    )

    // The scoring unit is a destination FILE, so two expectations on one file
    // would double-count one dependent.
    assertUnique(
      corpusCase.expectedImpact,
      (expected) => expected.path,
      (duplicate) =>
        `Change-impact case "${corpusCase.id}" expects two impacts in "${duplicate}"; the scoring unit is the destination file.`
    )

    const reviewedPaths = new Set(corpusCase.reviewedPaths)

    // THE central invariant, and the exact negation of spec 17's. An expectation
    // inside the reviewed diff is a diff-review expectation and belongs in the
    // spec 17 corpus; scoring it here would pool two different questions, which
    // is the measurement error spec 22 exists to avoid.
    for (const expected of corpusCase.expectedImpact) {
      if (reviewedPaths.has(expected.path)) {
        throw new Error(
          `Change-impact case "${corpusCase.id}" expects an impact in "${expected.path}", which is a reviewed path. Expectations must lie outside the diff (Q ⊄ P).`
        )
      }
    }

    for (const excluded of corpusCase.excludedPaths) {
      if (reviewedPaths.has(excluded)) {
        throw new Error(
          `Change-impact case "${corpusCase.id}" lists "${excluded}" as both reviewed and excluded.`
        )
      }
    }

    if (
      corpusCase.excludedPaths.length > 0 &&
      corpusCase.excludedPathsReason === undefined
    ) {
      throw new Error(
        `Change-impact case "${corpusCase.id}" excludes paths from review without recording why.`
      )
    }

    // Evidence must prove THIS case's dependents broke. A fix that repairs some
    // other file is a real fix and not evidence for this case, and accepting one
    // would let a curator's inference in through the back door.
    const expectedPaths = new Set(
      corpusCase.expectedImpact.map((expected) => expected.path)
    )
    const provenPaths = new Set(
      corpusCase.evidenceOfBreakage.flatMap((evidence) =>
        evidence.kind === 'upstream-fix'
          ? evidence.repairedPaths.filter((repaired) =>
              expectedPaths.has(repaired)
            )
          : []
      )
    )
    const hasNonFixEvidence = corpusCase.evidenceOfBreakage.some(
      (evidence) => evidence.kind !== 'upstream-fix'
    )

    if (!hasNonFixEvidence) {
      for (const expected of corpusCase.expectedImpact) {
        if (!provenPaths.has(expected.path)) {
          throw new Error(
            `Change-impact case "${corpusCase.id}" expects an impact in "${expected.path}" that no upstream fix repairs. A curator's inference is not admissible evidence.`
          )
        }
      }
    }

    for (const evidence of corpusCase.evidenceOfBreakage) {
      if (evidence.kind === 'upstream-fix' || evidence.kind === 'revert') {
        if (evidence.commit === corpusCase.introducingCommit) {
          throw new Error(
            `Change-impact case "${corpusCase.id}" cites the introducing commit as its own evidence.`
          )
        }
      }

      // The damage has to be discovered after it is caused. An artefact dated
      // before the change cannot be evidence that the change broke anything.
      if (evidenceDateOf(evidence) < isoDateOf(corpusCase.introducingCommittedAt)) {
        throw new Error(
          `Change-impact case "${corpusCase.id}" cites evidence dated ${evidenceDateOf(evidence)}, before the change it is supposed to prove broke something (${isoDateOf(corpusCase.introducingCommittedAt)}).`
        )
      }
    }
  }

  const heldOutCases = manifest.cases.filter(
    (corpusCase) => corpusCase.split === 'held-out'
  )
  const devCases = manifest.cases.filter(
    (corpusCase) => corpusCase.split === 'dev'
  )

  // Contamination is decided on the INTRODUCING commit, because that is the text
  // the model reads. Spec 22 records that the evidence must be later still and
  // that the observed fix lag is 3-12 months, which is why this corpus leans on
  // `dev` cases: requiring both sides after the cutoff is a narrow window by
  // construction, and results must be reported split rather than pooled.
  for (const corpusCase of heldOutCases) {
    if (
      isoDateOf(corpusCase.introducingCommittedAt) <= manifest.modelTrainingCutoff
    ) {
      throw new Error(
        `Held-out change-impact case "${corpusCase.id}" introduces its change on ${isoDateOf(corpusCase.introducingCommittedAt)}, which is not after the declared training cutoff ${manifest.modelTrainingCutoff}.`
      )
    }

  }

  // Nothing checks the EVIDENCE against the cutoff, and nothing needs to: every
  // artefact is required above to be dated no earlier than the change it proves
  // broke something, and a held-out change is required here to postdate the
  // cutoff, so the evidence clears it by construction. Spec 22's "the evidence
  // commit must be later still" is a statement about how NARROW that window is,
  // not a second rule.

  const newestDevChange = devCases.reduce<string | undefined>(
    (newest, corpusCase) =>
      newest === undefined || corpusCase.introducingCommittedAt > newest
        ? corpusCase.introducingCommittedAt
        : newest,
    undefined
  )

  if (newestDevChange !== undefined) {
    for (const corpusCase of heldOutCases) {
      if (corpusCase.introducingCommittedAt < newestDevChange) {
        throw new Error(
          `Held-out change-impact case "${corpusCase.id}" predates the newest dev case; the split must be chronological.`
        )
      }
    }
  }

  return manifest
}

export const parseChangeImpactCorpusManifestJson = (
  jsonText: string
): ChangeImpactCorpusManifest => {
  const parsed: unknown = JSON.parse(jsonText)

  return parseChangeImpactCorpusManifest(parsed)
}

export type ImpactReachabilityCounts = Readonly<
  Record<ImpactReachability, number>
>

// Expected dependents per reachability class, over whichever cases a run selected.
// Spec 22 requires recall to be REPORTED per class; this is the denominator side
// of that, computed from committed data with no measurement involved.
export const countExpectedImpactByReachability = (
  cases: readonly ChangeImpactCorpusCase[]
): ImpactReachabilityCounts => {
  const counts: Record<ImpactReachability, number> = {
    'caller-of-changed-symbol': 0,
    'callee-of-changed-code': 0,
    'attribute-owner': 0,
    'whole-repo-search': 0
  }

  for (const corpusCase of cases) {
    for (const expected of corpusCase.expectedImpact) {
      counts[expected.reachability] += 1
    }
  }

  return counts
}
