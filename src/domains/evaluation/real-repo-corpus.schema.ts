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

export const selectCorpusCases = (
  cases: readonly RealRepoCorpusCase[],
  caseFilters: readonly string[]
): readonly RealRepoCorpusCase[] => {
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
