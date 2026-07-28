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

export const SymbolReferenceSiteSchema = z.strictObject({
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
  // Reference sites OUTSIDE the defining file. References inside it are counted
  // separately below rather than listed: a symbol's own file is not a dependent.
  references: z.array(SymbolReferenceSiteSchema),
  referencesInDefinitionFile: z.int().min(0),
  // True when the per-symbol cap cut the reference list short, so a reader can
  // never mistake a bounded list for a complete one.
  referencesTruncated: z.boolean()
})

export const ChangeImpactReferenceReportSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
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
    referencedSymbolCount: z.int().min(0),
    referenceCount: z.int().min(0)
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
