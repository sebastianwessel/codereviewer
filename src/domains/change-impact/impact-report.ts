// The change-impact report: a REFERENCE list, plus the adjudicated subset of it.
//
// The reference list is the floor and the falsifier. It says exactly:
//
//   "file Q references symbol X, which this change altered, at these lines."
//
// Spec 22's removal criterion is that the capability must beat naming the changed
// symbols and letting a human grep, and that list IS that baseline, so it has to
// be genuinely good and it has to stay honest about being a baseline.
//
// `impactFindings` is the layer above it (spec 22 design step 3). Published rates
// for this task put an untriaged reference list near 90% irrelevant — only 7.9% of
// clients are affected by a breaking change across 119,879 upgrades — so the list
// alone is mostly noise by construction, and adjudication is the entire precision
// lever. A finding is a dependent SHOWN to rely on the part of the contract that
// changed, carrying its path, its line, the contract element, and the consequence.
//
// THERE IS STILL NO SEVERITY HERE, and there will not be. Spec 22's open decision
// is resolved: change-impact findings carry a COMPATIBILITY CLASS, not spec 05's
// severity. See `CompatibilityClassSchema` below. There is likewise no `passed`
// and no gate: `impact check` always exits 0, and a breaking change is frequently
// intentional. The schema is deliberately this capability's own, not a reuse of
// `ReviewReportSchema`: one report schema across two capabilities means a change
// to one bumps the other's contract.
//
// THE PRIMARY LIST IS DESTINATION FILES, NOT CHANGED SYMBOLS. Spec 22's prior-art
// section records the measured reason: scoring the identical predictions at file
// granularity rather than at method granularity moved precision 28.2% -> 60.9%
// and F1 25.0 -> 54.6. A reviewer opens files, and three sites in one file is one
// thing to look at rather than three. `changedSymbols` remains as the symbol-side
// table — what changed, and how far the search could see — while `impactedFiles`
// is what a reader works through.

import { z } from 'zod'
import { RepositoryRelativePathSchema } from '../../shared/contracts/index.js'
import { LaneUsageSchema } from '../costs/index.js'

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

// How the FILE carrying a symbol changed, straight from intake.
export const ChangedFileChangeKindSchema = z.enum([
  'new',
  'modified',
  'deleted'
])

// How the SYMBOL changed, after removals have been paired against the
// declarations the same change adds.
//
// `moved` exists because the file-level kind cannot express it. A pure rename or
// move of a file makes every symbol it declared look deleted — the most severe
// category this report has — while the symbol is present, under the same name, at
// a new address. Spec 22 requires the pairing to run BEFORE a removal may be
// reported, and this is where its outcome lands.
export const ChangedSymbolChangeKindSchema = z.enum([
  'new',
  'modified',
  'deleted',
  'moved'
])

// The declaration a removal paired with.
const PairedDeclarationSchema = z.strictObject({
  name: z.string().min(1),
  path: RepositoryRelativePathSchema,
  line: z.int().min(1)
})

// What the pairing search concluded about a removed declaration.
//
// The three outcomes are three different statements and a reader must be able to
// tell them apart:
//
// - `same-name` — this change adds a declaration of the same name elsewhere. The
//   symbol was relocated, not removed. Reporting it as a deletion would be the
//   most severe category applied to a refactoring.
// - `none` — every declaration this change adds, in every file this engine can
//   read, was searched, and none carries this name. A confident removal. The
//   qualifier is load-bearing: a symbol moved into a file in a language the
//   registry does not cover leaves no declaration to pair with, which is why the
//   known-not-reported list names that case.
// - `inconclusive` — the set of added declarations could NOT be read in full, so
//   finding no match is absence of evidence rather than evidence of absence. It
//   is reported as a removal, because that is the safe direction, but it is not
//   the same claim as `none`. This distinction is the whole reason the union
//   exists: a missing input must never silently produce the confident answer.
export const RemovalPairingSchema = z.discriminatedUnion('match', [
  z.strictObject({
    match: z.literal('same-name'),
    declaration: PairedDeclarationSchema
  }),
  z.strictObject({ match: z.literal('none') }),
  z.strictObject({
    match: z.literal('inconclusive'),
    // What stopped the search from covering every added declaration, in the words
    // the report shows the reader.
    reason: z.string().min(1)
  })
])

const ReferenceSiteSchema = z.strictObject({
  line: z.int().min(1),
  // The matched line, redacted by `context-retrieval` before it ever leaves the
  // filesystem seam, then capped.
  text: z.string().max(MAX_REFERENCE_TEXT_LENGTH)
})

// One changed symbol reaching one destination file, with the sites it reaches it
// at. The symbol is identified by the same triple `changed-symbols` uses to keep
// two same-named symbols in one file distinct, so a consumer can join this back
// onto `changedSymbols` without guessing.
const ImpactedFileSymbolSchema = z.strictObject({
  name: z.string().min(1),
  definitionPath: RepositoryRelativePathSchema,
  definitionLine: z.int().min(1),
  sites: z.array(ReferenceSiteSchema).min(1)
})

// A file that references at least one changed symbol.
//
// Files carry no contract statement of their own: what changed is a property of
// the symbol, and it is stated once in `changedSymbols` rather than copied onto
// every file that reaches it.
export const ImpactedFileSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  symbols: z.array(ImpactedFileSymbolSchema).min(1)
})

// COMPATIBILITY CLASS, NOT SEVERITY. Spec 22 recorded this as an open decision and
// it is now resolved this way, for two reasons.
//
// None of the established breaking-change tools rates by severity. japicmp, Revapi
// and `cargo-semver-checks` all rate on a COMPATIBILITY axis and leave the
// consequence to the consumer; Revapi's `Potentially Breaking` means precisely "a
// human must look", which is this capability's stated output shape.
//
// And spec 05's rubric answers a different question — "how bad is this defect" —
// calibrated so that a LOUD failure rates below a silent one, because a loud
// failure is detectable. Change-impact damage is loud almost by definition, so
// routing it through that rubric produced a recorded tension: four of the first
// seven mined expectations rated `low` against a `medium` actionable threshold. A
// separate axis removes the tension without relabelling anything.
//
// The axis is mechanism, not judgement:
//
// - `breaks-on-build` — the declaration the dependent names is gone. Nothing about
//   how the dependent USES it matters; the reference cannot resolve.
// - `breaks-at-runtime` — the declaration is still there under the same name, so a
//   build sees nothing; what moved is behaviour, and this dependent was shown to
//   rely on the part that moved.
// - `may-break` — the mechanism is known and the outcome is not. A relocation, or
//   a removal this run could not verify. Revapi's third value, and it means "a
//   human must look" rather than a hedge.
// - `no-impact` — this engine has no evidence that the dependent relies on a
//   changed part of the contract. NEVER "safe": it is a statement about what was
//   shown, and it is the reason findings can be excluded rather than reported.
//
// `no-impact` is in the vocabulary because adjudication produces it; it is
// excluded from a FINDING below, because a finding is a thing to look at.
export const CompatibilityClassSchema = z.enum([
  'breaks-on-build',
  'breaks-at-runtime',
  'may-break',
  'no-impact'
])

// Which adjudicator reached the answer. Carried on the reliance rather than on the
// finding because one finding can mix the two: a file can reference both a removed
// symbol (settled in code) and a modified one (settled by a model call). A reader
// weighing the report needs to know which sentence cost a provider call and which
// is a deterministic consequence of the declaration being gone.
export const AdjudicatedBySchema = z.enum(['deterministic', 'model'])

// One reason a dependent file is on the list.
//
// Spec 22: "Findings MUST carry the dependent's path and line, the contract
// element relied upon, and the consequence." The path is on the finding, because
// the finding is the file; the other three are here, because one file can rely on
// several changed symbols for several different reasons and flattening them would
// lose which line goes with which claim.
export const ImpactRelianceSchema = z.strictObject({
  // The changed symbol, identified by the same triple `changedSymbols` uses, so a
  // consumer can join a reliance back onto what changed without guessing.
  symbolName: z.string().min(1),
  definitionPath: RepositoryRelativePathSchema,
  definitionLine: z.int().min(1),
  // The line IN THE DEPENDENT. It is always one of the sites discovery found in
  // this file — the admission gate rejects a reliance whose line is not, so a
  // finding can never point at a line nobody located.
  line: z.int().min(1),
  // WHAT is relied upon: the changed symbol and the observable change to it, in one
  // sentence a reviewer can act on.
  contractElement: z.string().min(1).max(300),
  // WHAT GOES WRONG if the reliance holds. Composed in code from the contract
  // dimension, never written by a model — see `instructions.ts` for the measured
  // reason a judging call is never also asked to justify itself.
  consequence: z.string().min(1).max(300),
  adjudicatedBy: AdjudicatedBySchema
})

// A dependent FILE shown to rely on something this change altered.
//
// The unit is the file, not the site. Spec 22's prior art records the measured
// reason: scoring the identical predictions at file granularity rather than at
// method granularity moved precision 28.2% -> 60.9% and F1 25.0 -> 54.6. The
// individual lines are nested inside `reliances` for the same reason they are
// nested under `impactedFiles` — a reviewer opens a file.
export const ImpactFindingSchema = z.strictObject({
  id: z.string().min(1),
  // The DEPENDENT's path. Spec 22: "A finding without a named dependent is not a
  // change-impact finding" and MUST be rejected. This field is why the gate can
  // enforce that structurally rather than by convention.
  path: RepositoryRelativePathSchema,
  // Production or test. A test that calls a changed symbol is a real dependent and
  // breaks in CI rather than in production, which is different news; the reference
  // lists keep them apart and so does this one.
  destination: z.enum(['production', 'test']),
  // The strongest class across the reliances below. `no-impact` is excluded by
  // construction: it is an adjudication outcome, not something to report, and a
  // report that carried it would be manufacturing a finding to fill a page.
  compatibilityClass: CompatibilityClassSchema.exclude(['no-impact']),
  reliances: z.array(ImpactRelianceSchema).min(1)
})

export const ChangedSymbolReportSchema = z
  .strictObject({
    name: z.string().min(1),
    kind: ChangedSymbolKindSchema,
    language: z.string().min(1),
    // Where the symbol is defined, and how it changed.
    definitionPath: RepositoryRelativePathSchema,
    definitionLine: z.int().min(1),
    changeKind: ChangedSymbolChangeKindSchema,
    // The evidence behind a removal. Present exactly when the declaration was
    // removed — `deleted` or `moved` — and absent otherwise, which the check
    // below enforces so the two can never drift into disagreeing.
    removalPairing: RemovalPairingSchema.optional(),
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
    // References inside the defining file. Counted, never listed: a file referring
    // to its own symbol is not a dependent, and the count is a real signal
    // ("nothing outside this file uses it").
    referencesInDefinitionFile: z.int().min(0),
    // Reference sites in files no language adapter recognises as source —
    // documentation, specification prose, fixture data, snapshots. Counted, never
    // listed: they are textual coincidence, not dependency. The count is here so
    // the report cannot look cleaner than the search actually was.
    referencesInNonSourceFiles: z.int().min(0),
    // True when the per-symbol cap cut this symbol's reference list short, so a
    // reader can never mistake a bounded list for a complete one. The cap applies
    // to the search, ahead of the destination classification, so a truncated list
    // can be short in any bucket.
    referencesTruncated: z.boolean()
  })
  // `changeKind` and `removalPairing` are two views of one decision, so the
  // schema refuses to hold a pair that disagrees. Without this the producer could
  // report `deleted` while carrying the declaration that proves it was a move,
  // and every reader would believe the more severe half.
  .superRefine((symbol, context) => {
    const reject = (message: string): void => {
      context.addIssue({ code: 'custom', message })
    }
    const pairing = symbol.removalPairing

    if (symbol.changeKind === 'moved') {
      if (pairing?.match !== 'same-name') {
        reject(
          'A symbol reported as moved must carry the declaration it was paired with.'
        )
      }

      return
    }

    if (symbol.changeKind === 'deleted') {
      if (pairing === undefined) {
        reject(
          'A removed symbol must carry the outcome of the removal pairing search.'
        )
      } else if (pairing.match === 'same-name') {
        reject(
          'A removal paired with an added declaration is a move, not a deletion.'
        )
      }

      return
    }

    if (pairing !== undefined) {
      reject('Only a removed symbol carries a removal pairing.')
    }
  })

// Why adjudication produced the findings it did — or why it produced none.
//
// This exists because spec 22 requires the command to be able to report NO IMPACT
// and forbids it from manufacturing findings to fill a report. An empty
// `impactFindings` has three completely different meanings, and a reader who
// cannot tell them apart has been told nothing:
//
// - `disabled` — nothing was adjudicated. `changeImpact.adjudication.enabled` is
//   off, which is the default until this layer is measured.
// - `no-model` — the deterministic tier ran and the residue did not. Findings that
//   need no model are present; everything that needed one is counted as
//   unadjudicated, NOT reported as a maybe. Reporting the residue would restate the
//   ~90% noise adjudication exists to remove.
// - `completed` — both tiers were EQUIPPED to run. An empty list here is a real
//   answer: nothing among the dependents was shown to rely on the part of the
//   contract that changed. It is not by itself a statement that the model ran —
//   `summary.adjudicationCallCount` is, and a `completed` run with zero calls is a
//   run the deterministic tier settled on its own.
export const AdjudicationStatusSchema = z.enum([
  'disabled',
  'no-model',
  'completed'
])

// The model's own three answers, counted. Reported because a degenerate
// distribution is the cheapest bug signature this layer has: spec 22's voided
// first measurement needed a bespoke replay probe to establish what the model had
// answered, because the report carried nothing about it.
export const ModelVerdictCountsSchema = z.strictObject({
  relies: z.int().min(0),
  // The MODEL tier's `no-impact` count. Kept here, once, rather than mirrored into
  // a second summary field that could disagree with it.
  'does-not-rely': z.int().min(0),
  // Includes an answer that did not parse and a `relies` answer citing a line the
  // search never located. Those pairs are unadjudicated and reported nowhere.
  undetermined: z.int().min(0)
})

export const ChangeImpactReferenceReportSchema = z.strictObject({
  // 3.0 adds the adjudicated layer: `impactFindings`, `adjudicationStatus`, the
  // adjudication counters in `summary`, and an optional `usage` block, because
  // this stage can now spend. Breaking: a 2.x consumer reading a 3.0 report sees
  // a list it does not know how to read, and — worse — cannot tell an empty
  // finding list from an absent one.
  //
  // 2.0 moved the primary list from changed symbols to destination FILES and
  // resolved a removal against the declarations the same change adds.
  schemaVersion: z.literal('3.0'),
  // `disabled` is a first-class outcome: the capability is off by default until
  // measured (spec 22), and saying so plainly beats emitting an empty report that
  // looks like "nothing depends on your change".
  status: z.enum(['completed', 'disabled']),
  adjudicationStatus: AdjudicationStatusSchema,
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
    // The headline of a file-granular report: how many files a reader has to
    // look at. Tests are counted beside it rather than folded into it.
    impactedFileCount: z.int().min(0),
    impactedTestFileCount: z.int().min(0),
    // Production reference sites. Deliberately excludes tests and non-source
    // destinations; the other two are reported beside it rather than folded in.
    referenceCount: z.int().min(0),
    testReferenceCount: z.int().min(0),
    // Withheld, not hidden: how many matches landed in files no language adapter
    // recognises as source.
    nonSourceReferenceCount: z.int().min(0),
    // ADJUDICATION COUNTERS. The unit is a (destination file, changed symbol) PAIR
    // — one dependent's use of one changed symbol — because that is the question
    // adjudication answers. Findings are grouped per file above it.
    //
    // The pair counters partition every pair exactly once —
    // `reliedUponPairCount + deterministicNoImpactPairCount +
    // modelVerdictCounts['does-not-rely'] + unadjudicatedPairCount` — so a reader
    // can check the report against itself: adjudicating nothing and adjudicating
    // everything to `no-impact` both yield zero findings and are told apart here.
    //
    // THERE IS NO POOLED `no-impact` FIELD, deliberately. One used to exist, and
    // pooling the deterministic tier's answer with the model's is what let spec
    // 22's first adjudication measurement read as a judge that rejected everything
    // when the judge had not been called at all.
    impactFindingCount: z.int().min(0),
    // Pairs shown to rely on a changed part of the contract, by either tier. Not
    // the same as `impactFindingCount`: one file can rely on several changed
    // symbols.
    reliedUponPairCount: z.int().min(0),
    // Pairs the DETERMINISTIC tier settled as no-impact, in code, with no call: a
    // newly added symbol, or a modified symbol carrying no caller-observable
    // contract change. Nothing here was looked at by a model.
    deterministicNoImpactPairCount: z.int().min(0),
    // Pairs no adjudicator settled: no model was available, a call failed, the
    // model could not tell, or the call cap bound the run. Counted rather than
    // reported as a weak finding.
    unadjudicatedPairCount: z.int().min(0),
    // MODEL CALLS ACTUALLY SPENT, failures included. Zero means the judge never
    // ran on this change, whatever `adjudicationStatus` says, and every removal
    // from the reference list is then the deterministic tier's.
    adjudicationCallCount: z.int().min(0),
    // Of those, the calls that threw. A failing provider must be visible as a
    // failing provider rather than as a quiet run that found nothing.
    failedAdjudicationCallCount: z.int().min(0),
    // What the model answered, over the calls that returned.
    modelVerdictCounts: ModelVerdictCountsSchema,
    // True when `changeImpact.adjudication.maxCalls` bound the residue, so a short
    // finding list is never mistaken for a fully triaged one.
    adjudicationCallsTruncated: z.boolean(),
    // Candidate findings the impact admission gate refused. Counted so a gate that
    // silently ate everything is visible rather than indistinguishable from
    // "nothing relies on this change".
    rejectedFindingCount: z.int().min(0)
  }),
  // THE ADJUDICATED LAYER. Empty is a legitimate and expected answer; read it with
  // `adjudicationStatus`, which is the field that says whether the emptiness is an
  // answer or an absence.
  impactFindings: z.array(ImpactFindingSchema),
  // The symbol-side table: what the change altered, and how far the search could
  // see. It carries no reference sites — those live on the files below.
  changedSymbols: z.array(ChangedSymbolReportSchema),
  // Production destination files, most likely to matter first.
  impactedFiles: z.array(ImpactedFileSchema),
  // Test destination files, in the same shape and in their own list. A test that
  // calls a changed symbol IS a dependent and will break; it is a different KIND
  // of dependent (breakage shows up in CI, not in production), so it gets its own
  // list instead of diluting the one above. Separate arrays rather than a tag on
  // one array, so the two can never be read as a single list by accident.
  impactedTestFiles: z.array(ImpactedFileSchema),
  // Non-fatal conditions worth telling the user about, for example a language
  // the deterministic signal extractors do not cover.
  warnings: z.array(z.string()),
  // Tokens and cost, when a provider call was made. Absent — never zero-valued —
  // when no call was made, so a report can never carry an all-zero usage block
  // that reads as "a provider ran and cost nothing". The deterministic tier is
  // free, and a run that only used it says so by omitting this.
  usage: LaneUsageSchema.optional()
})

/**
 * The identity of a changed symbol, for in-process joins.
 *
 * THE ONE DEFINITION. `changedSymbolKey` delegates here rather than formatting its
 * own; two spellings of one identity is not a style question, because the only
 * symptom of a disagreement is a lookup that quietly misses. That happened: this
 * key joined on spaces while `changedSymbolKey` joined on the separator below, and
 * every contract delta silently vanished on the way into adjudication — a missing
 * input producing a plausible empty answer, which is this repository's recorded
 * recurring defect class.
 *
 * The report is normalized — `impactedFiles` names the symbols reaching each file
 * and `changedSymbols` says what changed about them — so joining the two needs the
 * full triple: two symbols can share a name in one file, and two files can each
 * declare the same name.
 *
 * The separator is a character no path, identifier or number can contain, so no
 * pair of distinct triples can collide. It is a runtime key and never serialised.
 */
export const impactedSymbolKey = (symbol: {
  readonly name: string
  readonly definitionPath: string
  readonly definitionLine: number
}): string =>
  [symbol.definitionPath, symbol.name, symbol.definitionLine].join('\u0000')

export type ReferenceSite = z.infer<typeof ReferenceSiteSchema>
export type ImpactedFileSymbol = z.infer<typeof ImpactedFileSymbolSchema>
export type ImpactedFile = z.infer<typeof ImpactedFileSchema>
export type RemovalPairing = z.infer<typeof RemovalPairingSchema>
export type CompatibilityClass = z.infer<typeof CompatibilityClassSchema>
export type ReportableCompatibilityClass =
  z.infer<typeof ImpactFindingSchema>['compatibilityClass']
export type AdjudicationStatus = z.infer<typeof AdjudicationStatusSchema>
export type ModelVerdictCounts = z.infer<typeof ModelVerdictCountsSchema>
export type ImpactReliance = z.infer<typeof ImpactRelianceSchema>
export type ImpactFinding = z.infer<typeof ImpactFindingSchema>
export type ChangedSymbolReport = z.infer<typeof ChangedSymbolReportSchema>
export type ChangeImpactReferenceReport = z.infer<
  typeof ChangeImpactReferenceReportSchema
>
