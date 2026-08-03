// The change-impact REFERENCE report.
//
// Read the name literally. This artifact is not a finding list and must never be
// mistaken for one. Spec 22 requires a change-impact finding to carry the
// contract element the dependent relies upon and the consequence of the change;
// a deterministic reference list has neither. What it says is exactly:
//
//   "symbol X changed at P:line; it is referenced at Q:line, Q:line, Q:line."
//
// That is deliberately the useful floor AND the falsifier: spec 22's removal
// criterion is that the capability must beat naming the changed symbols and
// letting a human grep. This report IS that baseline, so it has to be genuinely
// good, and it has to stay honest about being a baseline.
//
// Consequently there is no `severity`, no `findings`, no `passed`, and no
// admission decision anywhere in this schema, and `impact check` always exits 0.
// Adding any of them would misrepresent what was measured. The schema is
// deliberately this capability's own, not a reuse of `ReviewReportSchema`: one
// report schema across two capabilities means a change to one bumps the other's
// contract.

import { z } from 'zod'
import { RepositoryRelativePathSchema } from '../../shared/contracts/index.js'

// A matched line is source, not prose, and a real repository contains lines
// thousands of characters long (minified code, an embedded diff in a data file).
// The text exists so a reader can recognise the reference without opening the
// file; the path and line are what locate it. Capping keeps one pathological line
// from dominating the report.
//
// The cut is MARKED (`truncateForContract`) even though `path:line` sits beside
// it. The address says where the line is, not that something was removed from it,
// and this text is here precisely so the reader does NOT have to open the file —
// so "open it and see" is not the disclosure. Unmarked, an excerpt of a
// 5000-character minified line is indistinguishable from a line that is exactly
// 300 characters long, and `if (a && b)` cut at the cap is a different, valid,
// misleading statement.
export const MAX_REFERENCE_TEXT_LENGTH = 300

export const ChangedSymbolKindSchema = z.enum([
  'export',
  'public-symbol',
  'declaration'
])

export const ChangedFileChangeKindSchema = z.enum([
  'new',
  'modified',
  'deleted'
])

const SymbolReferenceSiteSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  line: z.int().min(1),
  // The matched line, redacted by `context-retrieval` before it ever leaves the
  // filesystem seam, then capped.
  text: z.string().max(MAX_REFERENCE_TEXT_LENGTH)
})

export const ChangedSymbolReferencesSchema = z.strictObject({
  name: z.string().min(1),
  kind: ChangedSymbolKindSchema,
  language: z.string().min(1),
  // Where the symbol is defined, and how that file changed.
  definitionPath: RepositoryRelativePathSchema,
  definitionLine: z.int().min(1),
  changeKind: ChangedFileChangeKindSchema,
  // WHAT changed about this symbol's contract, in the words a reviewer would use.
  //
  // Without this the report says only "`scheme` was modified, here are 49 places
  // that mention it" — a bounded grep, which is not a reason to look at any
  // particular one of them. Each entry names an observable change to what callers
  // can rely on: whether it can now be absent, whether it can now fail, whether
  // what it returns has moved.
  //
  // Empty when the change touched the symbol's body without altering anything a
  // caller could observe from outside. That is the common case and saying nothing
  // is correct: an empty list means "changed, but not in a way this engine can show
  // reaches you", not "safe".
  contractChanges: z.array(z.string().min(1)),
  // Production reference sites OUTSIDE the defining file: the dependents a reader
  // is here for. References inside the defining file, in a test, and in a
  // non-source destination are separated below rather than mixed in.
  references: z.array(SymbolReferenceSiteSchema),
  // Test reference sites, listed rather than dropped. A test that calls a changed
  // symbol IS a dependent and will break; it is a different KIND of dependent
  // (breakage shows up in CI, not in production), so it gets its own bucket
  // instead of diluting the production list.
  testReferences: z.array(SymbolReferenceSiteSchema),
  referencesInDefinitionFile: z.int().min(0),
  // Reference sites in files no language adapter recognises as source —
  // documentation, specification prose, fixture data, snapshots. Counted, never
  // listed: they are textual coincidence, not dependency. The count is here so
  // the report cannot look cleaner than the search actually was.
  referencesInNonSourceFiles: z.int().min(0),
  // True when the per-symbol cap cut the reference list short, so a reader can
  // never mistake a bounded list for a complete one. The cap applies to the
  // search, ahead of the classification above, so a truncated list can be short
  // in any of the four buckets.
  referencesTruncated: z.boolean()
})

export const ChangeImpactReferenceReportSchema = z.strictObject({
  // 1.1 split the single reference list into production, test and non-source
  // buckets. The literal is bumped rather than left alone because a consumer
  // written against 1.0 would silently read `referenceCount` as "every reference"
  // when it now means "production references".
  schemaVersion: z.literal('1.1'),
  // `disabled` is a first-class outcome: the capability is off by default until
  // measured (spec 22), and saying so plainly beats emitting an empty report that
  // looks like "nothing depends on your change".
  status: z.enum(['completed', 'disabled']),
  generatedAt: z.iso.datetime(),
  scope: z.strictObject({
    baseRef: z.string().min(1),
    headRef: z.string().min(1),
    mergeBaseRef: z.string().min(1).optional(),
    changedFileCount: z.int().min(0),
    deletedFileCount: z.int().min(0)
  }),
  summary: z.strictObject({
    changedSymbolCount: z.int().min(0),
    // True when `changeImpact.maxChangedSymbols` bounded the seed.
    changedSymbolsTruncated: z.boolean(),
    // Symbols with at least one LISTED reference — production or test. A symbol
    // whose only references were withheld as non-source is not "referenced" for
    // this purpose, because none of those references is a dependent.
    referencedSymbolCount: z.int().min(0),
    // Production reference sites. This is the headline number and it deliberately
    // excludes tests and non-source destinations; the other two are reported
    // beside it rather than folded into it.
    referenceCount: z.int().min(0),
    testReferenceCount: z.int().min(0),
    // Withheld, not hidden: how many matches landed in files no language adapter
    // recognises as source.
    nonSourceReferenceCount: z.int().min(0)
  }),
  symbols: z.array(ChangedSymbolReferencesSchema),
  // Non-fatal conditions worth telling the user about, for example a language
  // the deterministic signal extractors do not cover.
  warnings: z.array(z.string())
})

export type SymbolReferenceSiteReport = z.infer<typeof SymbolReferenceSiteSchema>
export type ChangedSymbolReferences = z.infer<
  typeof ChangedSymbolReferencesSchema
>
export type ChangeImpactReferenceReport = z.infer<
  typeof ChangeImpactReferenceReportSchema
>
