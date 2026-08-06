import { createHash } from 'node:crypto'
import { z } from 'zod'
import { RepositoryRelativePathSchema } from '../../shared/contracts/index.js'
import {
  ExpectedFindingSchema,
  ExpectedNoFindingZoneSchema
} from './eval-fixture.schema.js'

// Real-repository corpus (spec 06 dataset contract + spec 15 anti-contamination).
//
// Committed benchmark slices carry only the changed files, so a defect whose
// evidence lives in an unchanged file cannot be found by construction and
// cross-file recall is structurally unmeasurable. A corpus case therefore names
// an upstream repository and one fix commit; hydration materialises the FULL
// working tree at the fix commit's parent (the state that still contains the
// defect) so a review can read any file in the repository.
//
// Nothing in this manifest is a detector input: it is ground truth plus the
// provenance needed to reproduce and audit a case.

// Git object names. 40 hex for SHA-1 repositories, 64 for SHA-256 ones. Short
// shas are rejected: an ambiguous prefix cannot prove which commit was reviewed.
export const FullCommitShaSchema = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u, 'Commit must be a full lowercase git object name')

export type FullCommitSha = z.infer<typeof FullCommitShaSchema>

export const isFullCommitSha = (value: string): boolean =>
  FullCommitShaSchema.safeParse(value).success

// Only permissive upstreams. A case may be republished with its checkout
// instructions, so weak-copyleft and copyleft sources stay out of the corpus.
export const PermissiveLicenseSchema = z.enum([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense'
])

// Chronological split (spec 15): held-out cases must come from fixes dated after
// the evaluated model's training cutoff, and must all be newer than every dev
// case. A random split leaks near-duplicate fixes across the boundary.
export const CorpusSplitSchema = z.enum(['dev', 'held-out'])

export type CorpusSplit = z.infer<typeof CorpusSplitSchema>

// What the split validation below is actually able to prove about this dataset.
//
// It exists because the chronological check has exactly one silent failure mode:
// with cases in only ONE split there is nothing to compare, so the check passes
// while checking nothing, and a corpus that never had a split reads identically
// to one whose split was verified. That is the shape this repository has a
// standing rule against — absence producing a plausible optimistic answer — and
// a validation that can pass vacuously is worse than no validation, because the
// green result is quoted.
//
// A manifest must therefore SAY which case it is in, and the declaration is
// cross-checked against the cases:
//
// `chronological-split` — both splits are populated and the chronological
//   boundary was verified. Improvements may be decided on the held-out cases.
// `single-split` — only one split is populated. Nothing was compared, and the
//   manifest must carry the note that says what every figure from this dataset
//   must be read as.
export const CorpusSplitIntegritySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('chronological-split') }),
  z.strictObject({
    status: z.literal('single-split'),
    // Long enough that "single split" is not a valid answer: it has to state the
    // consequence for the reader of a number produced from this corpus.
    contaminationNote: z.string().min(120).max(1200)
  })
])

export type CorpusSplitIntegrity = z.infer<typeof CorpusSplitIntegritySchema>

// The reviewed input must never contain the answer key. Advisory identifiers and
// "this fixes a vulnerability" phrasing name the defect outright, so they are
// rejected from every field that describes the change under review.
const answerKeyPattern =
  /\bCVE-\d{4}-\d{4,}\b|\bGHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}\b|nvd\.nist\.gov|\badvisor(?:y|ies)\b|\bvulnerabilit(?:y|ies)\b|\bexploit(?:ed|able)?\b/iu

export const containsAnswerKey = (value: string): boolean =>
  answerKeyPattern.test(value)

// The first answer-key marker in a text, with a little surrounding context, or
// undefined when there is none. The manifest schema only needs a yes/no, but a
// curator whose CASE is rejected needs to see WHAT leaked in order to judge it.
export const answerKeyLeakIn = (value: string): string | undefined => {
  const match = new RegExp(answerKeyPattern.source, 'iu').exec(value)

  if (match === null) {
    return undefined
  }

  const start = Math.max(0, match.index - 40)

  return value.slice(start, match.index + match[0].length + 40).replace(/\s+/gu, ' ').trim()
}

const answerKeyFreeText = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine(
      (value) => !containsAnswerKey(value),
      'Reviewed-input text must not name the defect (advisory id, vulnerability, or exploit wording)'
    )

// A curator's resolution of the removed-comment disclosure warning raised by
// hydration (spec 17 anti-contamination). The reviewed diff is the fix read
// backwards, so a comment the fix ADDED shows up as a removed line; when that
// comment explains the defect in prose, the case measures nothing.
//
// The warning is fuzzy by construction and cannot decide disclosure on its own,
// so the decision is recorded here per case and per comment. `verdict` has one
// value on purpose: a disclosing comment has no resolution other than dropping
// the case, so there is no way to record "disclosing" and keep running. Who made
// the call is the commit that added this record.
export const RemovedCommentDisclosureReviewSchema = z.strictObject({
  reviewedAt: z.iso.date(),
  verdict: z.literal('non-disclosing'),
  // Why every acknowledged comment fails to give the expectation away. Long
  // enough that "checked" is not a valid answer.
  rationale: z.string().min(40).max(1000),
  // The exact flagged comment texts, trimmed as hydration reports them. Listing
  // them individually is what keeps the resolution from covering a comment
  // nobody read: a re-capture that changes or adds one fails until it is judged.
  acknowledgedComments: z
    .array(
      z
        .string()
        .min(1)
        .max(500)
        .refine(
          (value) => value === value.trim(),
          'Acknowledged comment text must be trimmed exactly as hydration reports it'
        )
    )
    .min(1)
})

export type RemovedCommentDisclosureReview = z.infer<
  typeof RemovedCommentDisclosureReviewSchema
>

// Only https remotes. ssh/file/git remotes would pull local credentials or a
// local path into the hydration command line.
const RepositoryUrlSchema = z
  .url()
  .refine((value) => value.startsWith('https://'), 'Repository URL must be https')
  .refine((value) => !value.includes('@'), 'Repository URL must not embed credentials')

export const RealRepoCorpusCaseSchema = z.strictObject({
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
  // Where the case came from and when it was captured, so a stale corpus is
  // visible instead of silently ageing into the training data of a newer model.
  source: z.string().min(1).max(100),
  capturedAt: z.iso.date(),
  // The upstream commit that REPAIRED the defect, its author-visible date, and
  // its parent. The parent is what gets checked out; the fix commit is only ever
  // used to compute the reviewed diff and to prove the pair is genuine.
  fixCommit: FullCommitShaSchema,
  fixCommittedAt: z.iso.datetime({ offset: true }),
  parentCommit: FullCommitShaSchema,
  // Paths the reviewed diff is restricted to. Restricting is deliberate: the fix
  // commit usually adds a regression test whose name and body are the answer key.
  reviewedPaths: z.array(RepositoryRelativePathSchema).min(1),
  // Sanitized intent shown as slice metadata for humans. It describes the change
  // under review, never the fix that motivated the capture.
  reviewIntent: answerKeyFreeText(300),
  expectedFindings: z.array(ExpectedFindingSchema).min(1),
  expectedNoFindingZones: z.array(ExpectedNoFindingZoneSchema).default([]),
  // Present only for a case whose reviewed diff removes prose comments.
  // Hydration fails such a case until this record covers every flagged comment.
  removedCommentDisclosureReview:
    RemovedCommentDisclosureReviewSchema.optional(),
  tags: z.array(z.string().min(1)).default([]),
  // Curator notes. Never rendered into slice metadata, never model-visible.
  notes: z.string().min(1).max(1000).optional()
})

export const RealRepoCorpusManifestSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  datasetId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/u, 'Dataset id must be a lowercase slug'),
  // Temporal cutoff anchor. Set it to the evaluated model's training cutoff and
  // re-freshen it each model generation: raising it INVALIDATES held-out cases
  // captured before the new cutoff, which is the intended failure.
  modelTrainingCutoff: z.iso.date(),
  // Required, and cross-checked against the cases below. Without it a manifest
  // with no dev set silently satisfied the chronological-split rule.
  splitIntegrity: CorpusSplitIntegritySchema,
  description: z.string().min(1).max(1000),
  cases: z.array(RealRepoCorpusCaseSchema).min(1)
})

export type RealRepoCorpusCase = z.infer<typeof RealRepoCorpusCaseSchema>
export type RealRepoCorpusManifest = z.infer<typeof RealRepoCorpusManifestSchema>

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

// Cross-case rules that a per-case schema cannot express. They encode the
// anti-contamination policy of spec 15 as validation rather than as a checklist
// someone is trusted to have followed.
export const parseRealRepoCorpusManifest = (
  input: unknown
): RealRepoCorpusManifest => {
  const manifest = RealRepoCorpusManifestSchema.parse(input)

  assertUnique(
    manifest.cases,
    (corpusCase) => corpusCase.id,
    (duplicate) => `Duplicate corpus case id "${duplicate}".`
  )
  assertUnique(
    manifest.cases,
    (corpusCase) => `${corpusCase.repositoryUrl}@${corpusCase.fixCommit}`,
    (duplicate) => `Duplicate corpus fix commit "${duplicate}".`
  )

  for (const corpusCase of manifest.cases) {
    if (corpusCase.fixCommit === corpusCase.parentCommit) {
      throw new Error(
        `Corpus case "${corpusCase.id}" declares the same fix and parent commit.`
      )
    }

    // Hydration matches acknowledgements against flagged comments as a set, so a
    // duplicate entry silently inflates the record without covering anything.
    assertUnique(
      corpusCase.removedCommentDisclosureReview?.acknowledgedComments ?? [],
      (comment) => comment,
      (duplicate) =>
        `Corpus case "${corpusCase.id}" acknowledges the same removed comment twice: "${duplicate}".`
    )

    // A path-bearing expectation outside the reviewed diff can never be scored
    // fairly: the reviewer was not asked to look at that file.
    for (const expected of corpusCase.expectedFindings) {
      if (
        expected.path !== undefined &&
        !corpusCase.reviewedPaths.includes(expected.path)
      ) {
        throw new Error(
          `Corpus case "${corpusCase.id}" expects a finding at "${expected.path}", which is not a reviewed path.`
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

  for (const corpusCase of heldOutCases) {
    if (isoDateOf(corpusCase.fixCommittedAt) <= manifest.modelTrainingCutoff) {
      throw new Error(
        `Held-out corpus case "${corpusCase.id}" was fixed on ${isoDateOf(corpusCase.fixCommittedAt)}, which is not after the declared training cutoff ${manifest.modelTrainingCutoff}.`
      )
    }
  }

  // The declared integrity must match the cases. Either half of this being wrong
  // is the failure the declaration exists to prevent: a manifest claiming a
  // verified split while carrying only one, or one still carrying the
  // contamination note after a genuine comparison set was added.
  const singleSplit = devCases.length === 0 || heldOutCases.length === 0

  if (manifest.splitIntegrity.status === 'chronological-split' && singleSplit) {
    throw new Error(
      `Corpus "${manifest.datasetId}" declares a chronological split but has ${devCases.length} dev and ${heldOutCases.length} held-out cases; with one split empty there is nothing to compare and the chronological check would pass without checking anything.`
    )
  }

  if (manifest.splitIntegrity.status === 'single-split' && !singleSplit) {
    throw new Error(
      `Corpus "${manifest.datasetId}" declares a single split but has both dev and held-out cases; update splitIntegrity to "chronological-split" so the boundary is actually verified.`
    )
  }

  // Chronological split: no held-out case may predate a dev case, or a
  // near-duplicate fix pair straddles the boundary and inflates held-out scores.
  const newestDevFix = devCases.reduce<string | undefined>(
    (newest, corpusCase) =>
      newest === undefined || corpusCase.fixCommittedAt > newest
        ? corpusCase.fixCommittedAt
        : newest,
    undefined
  )

  if (newestDevFix !== undefined) {
    for (const corpusCase of heldOutCases) {
      if (corpusCase.fixCommittedAt < newestDevFix) {
        throw new Error(
          `Held-out corpus case "${corpusCase.id}" predates the newest dev case; the split must be chronological.`
        )
      }
    }
  }

  return manifest
}

export const parseRealRepoCorpusManifestJson = (
  jsonText: string
): RealRepoCorpusManifest => {
  const parsed: unknown = JSON.parse(jsonText)

  return parseRealRepoCorpusManifest(parsed)
}

// Exact/derivative duplicate detection over the reviewed change itself.
// Comments, blank lines, and whitespace runs are dropped so a fork of the same
// fix (re-indented, re-commented) collapses onto the same fingerprint. It is a
// deliberate floor, not fuzzy near-duplicate clustering: it catches the
// duplicates that matter (the same fix imported twice) without pretending to
// measure similarity.
export const tokenNormalizedDiffFingerprint = (diff: string): string => {
  const normalized = diff
    .split(/\r?\n/u)
    .filter((line) => /^[+-]/u.test(line) && !/^(?:\+\+\+|---)/u.test(line))
    .map((line) => line.slice(1).replace(/\s+/gu, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')

  return createHash('sha256').update(normalized).digest('hex')
}

// Shared by every corpus whose cases are identified by a slug, so a second
// corpus cannot grow a second, subtly different notion of "unknown filter".
export const selectCorpusCases = <TCase extends { readonly id: string }>(
  cases: readonly TCase[],
  caseFilters: readonly string[]
): readonly TCase[] => {
  if (caseFilters.length === 0) {
    return cases
  }

  const filterSet = new Set(caseFilters)
  const selected = cases.filter((corpusCase) => filterSet.has(corpusCase.id))
  const unknownFilters = caseFilters.filter(
    (filter) => !cases.some((corpusCase) => corpusCase.id === filter)
  )

  if (unknownFilters.length > 0) {
    throw new Error(
      `Unknown corpus case filter(s): ${unknownFilters.join(', ')}.`
    )
  }

  return selected
}
