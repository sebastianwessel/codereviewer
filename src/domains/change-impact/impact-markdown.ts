// The human-readable face of the change-impact REFERENCE report.
//
// WHY THIS EXISTS. Every other stage here ends in an artifact a human reads where
// they already look: `review` writes `report.md` into the run directory. `impact
// check` stopped at JSON on stdout, so its output was outside the workflow a
// reviewer actually uses, and JSON is not a thing a person reads while deciding
// what to open next. Spec 22 records that gap as item 2 of "The gap between
// coverage and value"; this module closes it.
//
// WHAT IT LEADS WITH. Files, not symbols. Spec 22's prior-art section records the
// measured reason: scoring the identical predictions at file granularity rather
// than at method granularity moved precision 28.2% -> 60.9%. A reviewer's unit of
// work is a file they open, so that is the unit of the document. The changed
// symbols reaching each file are named on it, with what changed about them, and
// the symbol-side table follows as the answer to "and what about the rest".
//
// WHAT IT MUST NOT BECOME. Rendering does not upgrade evidence into a verdict.
// There is no severity here, no pass/fail, no "safe" and no "risky", because the
// underlying report carries none of those and inventing them in the renderer would
// be the same misrepresentation the schema refuses to make. The document answers
// one question — "what should I look at, and why" — and leaves the judgement to
// the reader.
//
// Pure: it takes a report and returns a string. No filesystem, no clock, no
// configuration. The CLI decides where the string goes.

import { inlineCode, pluralize, safeText } from '../reporting/index.js'
import {
  impactedSymbolKey,
  type ChangeImpactReferenceReport,
  type ChangedSymbolReport,
  type ImpactedFile,
  type ImpactedFileSymbol,
  type ImpactFinding,
  type RemovalPairing,
  type ReportableCompatibilityClass
} from './impact-report.js'

// Stated once, at the top of the document, because every count below it is a
// reference count rather than a defect count and a reader who skims will otherwise
// supply the missing word themselves.
const WHAT_THIS_IS =
  'This report lists DEPENDENTS, not defects. Nothing here carries a severity and nothing can fail a build. The first section names the dependents this run checked against the part of the contract that changed, with the line and the reason; the sections after it are the full, untriaged reference lists. Breaking a dependent is frequently deliberate — deciding whether it matters is your job.'

// The one sentence in the document that is easiest to misread, so it is written
// once and reused everywhere an empty `contractChanges` is rendered. "Nothing
// detected" is a statement about this engine's reach, never about the change.
const NO_CONTRACT_CHANGE_DETECTED =
  'No caller-observable contract change was detected. That means this engine could not show the change reaching a caller from the diff text — it is NOT a statement that the change is safe.'

// `inlineCode` and `pluralize` are shared with the other two Markdown surfaces
// from `../reporting/`: the code-span rule is security-relevant (it is what stops
// untrusted source breaking out of a span) and must not drift between renderers.

const location = (path: string, line: number): string =>
  inlineCode(`${path}:${line}`)

// What the removal-pairing search concluded, in the reader's terms.
//
// The three outcomes are three different claims, and the whole point of pairing
// is that a reader can tell them apart: a relocation is not a deletion, and a
// deletion nobody could verify is not a deletion that was verified.
const describeRemoval = (pairing: RemovalPairing): string => {
  if (pairing.match === 'same-name') {
    return `Removed from this file. A declaration of the same name is added at ${location(pairing.declaration.path, pairing.declaration.line)}, so this is a move or a rewrite rather than a deletion — callers of the name still resolve, callers of the path do not.`
  }

  if (pairing.match === 'none') {
    // "in a file this engine can read" is load-bearing, not hedging. A symbol
    // moved into a file in a language the registry does not cover leaves no
    // declaration to pair with, and the stronger sentence would be a confident
    // claim this search cannot support. See the known-not-reported list.
    return 'Removed, and no declaration of this name is added by this change in any file this engine can read. Everything listed below depends on a symbol that is gone.'
  }

  return `Removed. Whether this change adds a replacement could NOT be determined: ${safeText(pairing.reason)} Treat this as a removal, but check before concluding the symbol is gone.`
}

const renderContractChanges = (
  symbol: ChangedSymbolReport
): readonly string[] => {
  const removal =
    symbol.removalPairing === undefined
      ? []
      : [describeRemoval(symbol.removalPairing)]

  if (symbol.contractChanges.length === 0) {
    return [...removal, NO_CONTRACT_CHANGE_DETECTED]
  }

  return [
    ...removal,
    ...symbol.contractChanges.map((change) => safeText(change))
  ]
}

// One changed symbol as it appears under a destination file: what changed about
// it, then the lines in this file that use it.
const renderFileSymbol = (
  fileSymbol: ImpactedFileSymbol,
  changedSymbols: ReadonlyMap<string, ChangedSymbolReport>
): readonly string[] => {
  const symbol = changedSymbols.get(impactedSymbolKey(fileSymbol))
  const statements =
    symbol === undefined
      ? // Unreachable through `runChangeImpact`, which builds both lists from one
        // set of symbols. Rendered as an absence rather than skipped, because a
        // site with no symbol behind it is a defect the reader should see instead
        // of a line that quietly disappears.
        ['This site references a changed symbol that is missing from the symbol table below.']
      : renderContractChanges(symbol)

  return [
    `- ${inlineCode(fileSymbol.name)} - defined at ${location(fileSymbol.definitionPath, fileSymbol.definitionLine)}`,
    ...statements.map((statement) => `  - ${statement}`),
    ...fileSymbol.sites.map(
      (site) => `  - line ${site.line}: ${inlineCode(site.text)}`
    )
  ]
}

const renderFile = (
  file: ImpactedFile,
  changedSymbols: ReadonlyMap<string, ChangedSymbolReport>
): readonly string[] => {
  const sites = file.symbols.reduce(
    (total, symbol) => total + symbol.sites.length,
    0
  )

  return [
    `### ${inlineCode(file.path)}`,
    '',
    `${pluralize(file.symbols.length, 'changed symbol', 'changed symbols')} used here, at ${pluralize(sites, 'site', 'sites')}.`,
    '',
    ...file.symbols.flatMap((symbol) =>
      renderFileSymbol(symbol, changedSymbols)
    ),
    ''
  ]
}

const hasContractChange = (symbol: ChangedSymbolReport): boolean =>
  symbol.contractChanges.length > 0 || symbol.removalPairing !== undefined

// Whether anything this file uses has a stated contract change. It is the file
// ordering's only input, and it is the same question the symbol-side buckets ask:
// a file using a symbol that visibly moved is what a reviewer must open first.
const reachesAContractChange = (
  file: ImpactedFile,
  changedSymbols: ReadonlyMap<string, ChangedSymbolReport>
): boolean =>
  file.symbols.some((symbol) => {
    const changed = changedSymbols.get(impactedSymbolKey(symbol))

    return changed !== undefined && hasContractChange(changed)
  })

type FileSection = {
  readonly heading: string
  readonly note: string
  readonly files: readonly ImpactedFile[]
}

const renderFileSections = (
  sections: readonly FileSection[],
  changedSymbols: ReadonlyMap<string, ChangedSymbolReport>
): readonly string[] =>
  sections.flatMap((section) =>
    section.files.length === 0
      ? []
      : [
          `## ${section.heading} (${pluralize(section.files.length, 'file', 'files')})`,
          '',
          section.note,
          '',
          ...section.files.flatMap((file) => renderFile(file, changedSymbols))
        ]
  )

// Everything the search could not show in full, per symbol. Spec 22 requires
// withheld sites to be counted rather than dropped, for one reason: a report that
// quietly omitted them would look cleaner than the search actually was, and a
// reader cannot discount a list whose bounds are invisible.
const scopeCaveats = (symbol: ChangedSymbolReport): readonly string[] => {
  const caveats: string[] = []

  if (symbol.referencesTruncated) {
    caveats.push(
      'the per-symbol reference cap was reached, so its list is bounded rather than complete (raise `changeImpact.maxReferencesPerSymbol`)'
    )
  }

  if (symbol.referencesInDefinitionFile > 0) {
    caveats.push(
      `${pluralize(symbol.referencesInDefinitionFile, 'reference', 'references')} inside the defining file, counted but not listed: a file referring to its own symbol is not a dependent`
    )
  }

  if (symbol.referencesInNonSourceFiles > 0) {
    caveats.push(
      `${pluralize(symbol.referencesInNonSourceFiles, 'match', 'matches')} in files no language adapter recognises as source (documentation, specification prose, fixture data, snapshots), counted but not listed: a name in prose is a coincidence, not a dependency`
    )
  }

  return caveats
}

const renderSymbolEntry = (
  symbol: ChangedSymbolReport,
  referencedKeys: ReadonlySet<string>
): readonly string[] => {
  const key = impactedSymbolKey({
    name: symbol.name,
    definitionPath: symbol.definitionPath,
    definitionLine: symbol.definitionLine
  })
  const caveats = scopeCaveats(symbol)

  return [
    `- ${inlineCode(symbol.name)} - ${location(symbol.definitionPath, symbol.definitionLine)} (${safeText(symbol.changeKind)}, ${safeText(symbol.kind)}, ${safeText(symbol.language)})`,
    ...renderContractChanges(symbol).map((statement) => `  - ${statement}`),
    ...(referencedKeys.has(key)
      ? []
      : [
          '  - No listed dependent. Read that with the scope notes below, not as "nothing uses it".'
        ]),
    ...caveats.map((caveat) => `  - Scope: ${caveat}`)
  ]
}

// The symbol-side table. It exists because the file list cannot answer two
// questions a reviewer has: what the change altered about a symbol NOTHING was
// found to use, and how far the search could see for each one.
const renderChangedSymbols = (
  report: ChangeImpactReferenceReport,
  referencedKeys: ReadonlySet<string>
): readonly string[] => {
  if (report.changedSymbols.length === 0) {
    return [
      '## Changed symbols',
      '',
      report.status === 'disabled'
        ? 'Change-impact review is disabled, so nothing was analysed. This is not a report that nothing depends on the change.'
        : 'No changed symbol was seeded from this range, so there is nothing to report. See the warnings above, if any, for why.',
      ''
    ]
  }

  const unreferenced = report.changedSymbols.filter(
    (symbol) =>
      !referencedKeys.has(
        impactedSymbolKey({
          name: symbol.name,
          definitionPath: symbol.definitionPath,
          definitionLine: symbol.definitionLine
        })
      )
  )

  return [
    '## Changed symbols',
    '',
    `${pluralize(report.changedSymbols.length, 'symbol was', 'symbols were')} changed. ${pluralize(unreferenced.length, 'has', 'have')} no listed dependent, which is a real result and not an omission — check the scope notes before reading it as "nothing uses it".`,
    '',
    ...report.changedSymbols.flatMap((symbol) =>
      renderSymbolEntry(symbol, referencedKeys)
    ),
    ''
  ]
}

// The compatibility class in the reader's terms. Written out rather than printed
// as a bare token, because the whole reason spec 22 chose this axis over spec 05's
// severity is that the class states a MECHANISM, and a reader who sees only
// `may-break` has been given a rating instead.
const COMPATIBILITY_CLASS_TEXT: Readonly<
  Record<ReportableCompatibilityClass, string>
> = {
  'breaks-on-build': 'Breaks on build - the name this file uses is gone.',
  'breaks-at-runtime':
    'Breaks at runtime - the name still resolves, so nothing at build time sees this; what moved is behaviour this file was shown to use.',
  'may-break':
    'May break - the mechanism is known and the outcome is not. Someone has to look.'
}

// The one sentence that keeps this section evidence rather than verdict. Spec 22:
// the useful output is "this function has six callers; two rely on the return
// value you changed from nullable to non-null; here they are" - NOT "you broke it".
const FINDINGS_ARE_EVIDENCE =
  'Each entry below is a dependent this run checked against the part of the contract that changed, with the line and the reason. It is evidence, not a verdict: breaking a dependent is frequently deliberate, and whether these matter is your call. This layer is UNMEASURED - no accuracy number exists for it.'

const renderReliances = (finding: ImpactFinding): readonly string[] =>
  finding.reliances.map(
    (reliance) =>
      `- line ${reliance.line}: ${inlineCode(reliance.symbolName)} - relies on ${safeText(reliance.contractElement)}; ${safeText(reliance.consequence)} (${safeText(reliance.adjudicatedBy)})`
  )

const renderFinding = (finding: ImpactFinding): readonly string[] => [
  `### ${inlineCode(finding.path)}`,
  '',
  `${COMPATIBILITY_CLASS_TEXT[finding.compatibilityClass]}${finding.destination === 'test' ? ' This is a test file, so it breaks in CI rather than in production.' : ''}`,
  '',
  ...renderReliances(finding),
  ''
]

// WHY AN EMPTY LIST NEEDS A PARAGRAPH. Spec 22 requires the command to be able to
// report NO IMPACT and forbids it from manufacturing findings to fill a report. An
// empty list has three different meanings and a reader who cannot tell them apart
// has been told nothing, so each one is written out rather than left to inference.
const renderNoFindings = (
  report: ChangeImpactReferenceReport
): readonly string[] => {
  if (report.adjudicationStatus === 'disabled') {
    return [
      'Adjudication is switched off, so NOTHING below was checked against the part of the contract that changed. This is not a report that nothing depends on the change. Set `changeImpact.adjudication.enabled` to true to run it.'
    ]
  }

  const { summary } = report
  const checked = summary.noImpactPairCount + summary.reliedUponPairCount

  if (checked === 0) {
    return [
      'Nothing was checked: no dependent reached an adjudicator. See the scope notes and warnings above for why, and read the reference lists below yourself.'
    ]
  }

  return [
    `${pluralize(checked, 'dependent use was', 'dependent uses were')} checked and none was shown to rely on the part of the contract that changed. That is a real answer, not an empty report — the reference lists below are still there to judge yourself.${summary.unadjudicatedPairCount > 0 ? ` ${pluralize(summary.unadjudicatedPairCount, 'use was', 'uses were')} left unadjudicated and asserted nothing.` : ''}`
  ]
}

const renderFindings = (
  report: ChangeImpactReferenceReport
): readonly string[] => {
  if (report.impactFindings.length === 0) {
    return ['## Dependents shown to rely on the change', '', ...renderNoFindings(report), '']
  }

  return [
    `## Dependents shown to rely on the change (${pluralize(report.impactFindings.length, 'file', 'files')})`,
    '',
    FINDINGS_ARE_EVIDENCE,
    '',
    ...(report.summary.unadjudicatedPairCount > 0
      ? [
          `${pluralize(report.summary.unadjudicatedPairCount, 'dependent use was', 'dependent uses were')} left unadjudicated and is absent from this list. Absence here is not a statement that a dependent is unaffected.`,
          ''
        ]
      : []),
    ...report.impactFindings.flatMap((finding) => renderFinding(finding))
  ]
}

const renderSummary = (
  report: ChangeImpactReferenceReport
): readonly string[] => {
  const { summary } = report
  const changedSymbols = summary.changedSymbolsTruncated
    ? `${summary.changedSymbolCount} (the seed cap was reached, so changed symbols beyond it are absent from this report)`
    : `${summary.changedSymbolCount}`

  return [
    '## Summary',
    '',
    `- Dependents shown to rely on the change: ${summary.impactFindingCount}`,
    `- Dependent uses checked and found not to rely: ${summary.noImpactPairCount}`,
    `- Dependent uses left unadjudicated: ${summary.unadjudicatedPairCount}${summary.adjudicationCallsTruncated ? ' (the adjudication call cap was reached)' : ''}`,
    `- Files to look at: ${summary.impactedFileCount} (plus ${summary.impactedTestFileCount} test)`,
    `- Changed symbols: ${changedSymbols}`,
    `- With a detected contract change: ${report.changedSymbols.filter(hasContractChange).length}`,
    `- Referenced elsewhere: ${summary.referencedSymbolCount}`,
    `- Production reference sites: ${summary.referenceCount}`,
    `- Test reference sites: ${summary.testReferenceCount}`,
    `- Matches withheld as non-source: ${summary.nonSourceReferenceCount}`,
    ''
  ]
}

const renderScope = (
  report: ChangeImpactReferenceReport
): readonly string[] => [
  `- Status: ${safeText(report.status)}`,
  `- Generated: ${safeText(report.generatedAt)}`,
  `- Base: ${inlineCode(report.scope.baseRef)}`,
  `- Head: ${inlineCode(report.scope.headRef)}`,
  ...(report.scope.mergeBaseRef === undefined
    ? []
    : [`- Merge base: ${inlineCode(report.scope.mergeBaseRef)}`]),
  `- Changed files: ${report.scope.changedFileCount}`,
  `- Deleted files: ${report.scope.deletedFileCount}`,
  ''
]

const renderWarnings = (
  report: ChangeImpactReferenceReport
): readonly string[] =>
  report.warnings.length === 0
    ? []
    : [
        '## Warnings',
        '',
        ...report.warnings.map((warning) => `- ${safeText(warning)}`),
        ''
      ]

/**
 * The change-impact reference report as Markdown.
 *
 * Renders every state the schema admits, including the two that carry no symbols:
 * a disabled capability and a range in which nothing changed. Both are statements
 * a reader needs, and an empty document would read as a missing report rather than
 * as an answer.
 */
export const renderChangeImpactMarkdown = (
  report: ChangeImpactReferenceReport
): string => {
  const changedSymbols = new Map(
    report.changedSymbols.map((symbol) => [
      impactedSymbolKey({
        name: symbol.name,
        definitionPath: symbol.definitionPath,
        definitionLine: symbol.definitionLine
      }),
      symbol
    ])
  )
  const referencedKeys = new Set(
    [...report.impactedFiles, ...report.impactedTestFiles].flatMap((file) =>
      file.symbols.map((symbol) => impactedSymbolKey(symbol))
    )
  )
  const withContractChange = report.impactedFiles.filter((file) =>
    reachesAContractChange(file, changedSymbols)
  )
  const withoutContractChange = report.impactedFiles.filter(
    (file) => !reachesAContractChange(file, changedSymbols)
  )

  return `${[
    '# Change Impact Report',
    '',
    WHAT_THIS_IS,
    '',
    ...renderScope(report),
    ...renderSummary(report),
    ...renderWarnings(report),
    // The adjudicated layer leads. It is the shortest list and the only one whose
    // entries were checked against what changed; the reference lists below it are
    // the untriaged floor, and published rates for this task put an untriaged
    // reference list near 90% irrelevant.
    ...renderFindings(report),
    ...renderFileSections(
      [
        {
          heading: 'Files using a symbol whose contract changed',
          note: 'Start here. Something a caller can observe about a symbol these files use has moved.',
          files: withContractChange
        },
        {
          heading: 'Files using a changed symbol, no contract change detected',
          note: 'These files use symbols the change touched, but nothing this engine can read from the diff text shows the change reaching a caller. They are listed so you can judge that yourself.',
          files: withoutContractChange
        },
        {
          // Production first: a broken caller shows up in production, a broken
          // test shows up in CI, and those are different news. The report keeps
          // them in separate lists for the same reason, and a rendering that
          // interleaved them would undo that.
          heading: 'Test files',
          note: 'Tests are real dependents and will break, but they break in CI rather than in production. Listed separately so they never dilute the lists above.',
          files: report.impactedTestFiles
        }
      ],
      changedSymbols
    ),
    ...renderChangedSymbols(report, referencedKeys)
  ].join('\n')}\n`
}
