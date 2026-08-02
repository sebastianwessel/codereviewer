// The human-readable face of the change-impact REFERENCE report.
//
// WHY THIS EXISTS. Every other stage here ends in an artifact a human reads where
// they already look: `review` writes `report.md` into the run directory. `impact
// check` stopped at JSON on stdout, so its output was outside the workflow a
// reviewer actually uses, and JSON is not a thing a person reads while deciding
// what to open next. Spec 22 records that gap as item 2 of "The gap between
// coverage and value"; this module closes it.
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
import type {
  ChangeImpactReferenceReport,
  ChangedSymbolReferences,
  SymbolReferenceSiteReport
} from './impact-report.js'

// Stated once, at the top of the document, because every count below it is a
// reference count rather than a defect count and a reader who skims will otherwise
// supply the missing word themselves.
const WHAT_THIS_IS =
  'This report lists DEPENDENTS, not defects. Nothing here is a finding: no severity, no verdict, nothing to act on automatically. It names what a change altered about a symbol and where that symbol is used, so you can decide what to open.'

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

// Sites grouped by the file they landed in, first-appearance order preserved.
//
// Spec 22 records file granularity as a requirement with a measured reason: the
// published result it cites scores the IDENTICAL predictions at file granularity
// rather than per site and more than doubles precision. A reviewer opens files,
// not line numbers, and three hits in one file is one thing to look at rather than
// three. Preserving first-appearance order matters because discovery has already
// ranked the sites (files this change also touched come first) and re-sorting here
// would silently discard that ranking.
const groupByFile = (
  sites: readonly SymbolReferenceSiteReport[]
): readonly (readonly [string, readonly SymbolReferenceSiteReport[]])[] => {
  const byFile = new Map<string, SymbolReferenceSiteReport[]>()

  for (const site of sites) {
    const existing = byFile.get(site.path)

    if (existing === undefined) {
      byFile.set(site.path, [site])
      continue
    }

    existing.push(site)
  }

  return [...byFile.entries()]
}

const renderSiteList = (
  sites: readonly SymbolReferenceSiteReport[]
): readonly string[] =>
  groupByFile(sites).flatMap(([path, fileSites]) => [
    `- ${inlineCode(path)}`,
    ...fileSites.map((site) => `  - line ${site.line}: ${inlineCode(site.text)}`)
  ])

const renderReferenceSection = (
  input: {
    readonly heading: string
    readonly note: string
    readonly sites: readonly SymbolReferenceSiteReport[]
  }
): readonly string[] => {
  if (input.sites.length === 0) {
    return []
  }

  const fileCount = groupByFile(input.sites).length

  return [
    `#### ${input.heading} (${pluralize(input.sites.length, 'site', 'sites')} in ${pluralize(fileCount, 'file', 'files')})`,
    '',
    input.note,
    '',
    ...renderSiteList(input.sites),
    ''
  ]
}

// Everything the search could not show in full, per symbol. Spec 22 requires
// withheld sites to be counted rather than dropped, for one reason: a report that
// quietly omitted them would look cleaner than the search actually was, and a
// reader cannot discount a list whose bounds are invisible.
const renderScopeCaveats = (
  symbol: ChangedSymbolReferences
): readonly string[] => {
  const caveats: string[] = []

  if (symbol.referencesTruncated) {
    caveats.push(
      'The per-symbol reference cap was reached, so this list is bounded rather than complete. Raise `changeImpact.maxReferencesPerSymbol` to see more.'
    )
  }

  if (symbol.referencesInDefinitionFile > 0) {
    caveats.push(
      `${pluralize(symbol.referencesInDefinitionFile, 'reference', 'references')} inside the defining file, counted but not listed: a file referring to its own symbol is not a dependent.`
    )
  }

  if (symbol.referencesInNonSourceFiles > 0) {
    caveats.push(
      `${pluralize(symbol.referencesInNonSourceFiles, 'match', 'matches')} in files no language adapter recognises as source (documentation, specification prose, fixture data, snapshots), counted but not listed: a name in prose is a coincidence, not a dependency.`
    )
  }

  return caveats.length === 0
    ? []
    : ['Scope of this search:', '', ...caveats.map((caveat) => `- ${caveat}`), '']
}

const renderContractChanges = (
  symbol: ChangedSymbolReferences
): readonly string[] =>
  symbol.contractChanges.length === 0
    ? [NO_CONTRACT_CHANGE_DETECTED, '']
    : [
        'What changed that a caller could observe:',
        '',
        ...symbol.contractChanges.map((change) => `- ${safeText(change)}`),
        ''
      ]

const renderSymbol = (symbol: ChangedSymbolReferences): readonly string[] => [
  `### ${inlineCode(symbol.name)} - ${location(symbol.definitionPath, symbol.definitionLine)}`,
  '',
  `- Change: ${safeText(symbol.changeKind)}`,
  `- Symbol kind: ${safeText(symbol.kind)}`,
  `- Language: ${safeText(symbol.language)}`,
  '',
  ...renderContractChanges(symbol),
  // Production dependents first: a broken caller shows up in production, a broken
  // test shows up in CI, and those are different news. Spec 22 keeps them in
  // separate buckets in the data for the same reason, and a rendering that
  // interleaved them would undo that.
  ...renderReferenceSection({
    heading: 'Dependents',
    note: 'Production code outside the defining file. A contract change here reaches whatever runs this.',
    sites: symbol.references
  }),
  ...renderReferenceSection({
    heading: 'Tests',
    note: 'Tests are real dependents and will break, but they break in CI rather than in production. Listed separately so they never dilute the list above.',
    sites: symbol.testReferences
  }),
  ...renderScopeCaveats(symbol)
]

const hasDependents = (symbol: ChangedSymbolReferences): boolean =>
  symbol.references.length > 0 || symbol.testReferences.length > 0

const hasContractChange = (symbol: ChangedSymbolReferences): boolean =>
  symbol.contractChanges.length > 0

// The whole point of the ordering: a symbol whose contract moved AND which has
// dependents is what a reviewer must read first, and everything else is a
// diminishing series after it.
//
// Deliberately NOT ordered on reference count or on how many contract changes were
// detected. Discovery already refuses to rank symbols that way — a symbol used
// everywhere is not riskier than one used once in the wrong place, and the number
// of detected dimensions is a property of the diff text, not of the risk — so
// within a bucket the engine's own order is preserved rather than replaced by a
// ranking nothing here can justify.
type SymbolBucket = {
  readonly heading: string
  readonly note: string
  readonly symbols: readonly ChangedSymbolReferences[]
}

const bucketSymbols = (
  symbols: readonly ChangedSymbolReferences[]
): readonly SymbolBucket[] => [
  {
    heading: 'Contract changed, and it has dependents',
    note: 'Start here. Something a caller can observe about these symbols moved, and there is code that uses them.',
    symbols: symbols.filter(
      (symbol) => hasContractChange(symbol) && hasDependents(symbol)
    )
  },
  {
    heading: 'Contract changed, no dependent found',
    note: 'Something observable moved, but this bounded search found no code using the symbol. Check the scope notes under each one before reading that as "nothing uses it".',
    symbols: symbols.filter(
      (symbol) => hasContractChange(symbol) && !hasDependents(symbol)
    )
  },
  {
    heading: 'Dependents found, no contract change detected',
    note: 'These symbols were changed and are used elsewhere, but nothing this engine can read from the diff text shows the change reaching a caller. The dependents are listed so you can judge that yourself.',
    symbols: symbols.filter(
      (symbol) => !hasContractChange(symbol) && hasDependents(symbol)
    )
  }
]

// The tail of the report: changed, no detected contract change, no listed
// dependent. Named rather than dropped — a reader must be able to see that the
// engine looked at them — but listed one line each, because expanding them would
// bury the sections above under the ordinary case.
const renderRemainder = (
  symbols: readonly ChangedSymbolReferences[]
): readonly string[] => {
  if (symbols.length === 0) {
    return []
  }

  return [
    '## Other changed symbols',
    '',
    `${pluralize(symbols.length, 'symbol was', 'symbols were')} changed with no detected contract change and no listed dependent. ${NO_CONTRACT_CHANGE_DETECTED}`,
    '',
    ...symbols.map(
      (symbol) =>
        `- ${inlineCode(symbol.name)} - ${location(symbol.definitionPath, symbol.definitionLine)} (${safeText(symbol.changeKind)})`
    ),
    ''
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
    `- Changed symbols: ${changedSymbols}`,
    `- With a detected contract change: ${report.symbols.filter(hasContractChange).length}`,
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
  const lines: string[] = [
    '# Change Impact Report',
    '',
    WHAT_THIS_IS,
    '',
    ...renderScope(report),
    ...renderSummary(report),
    ...renderWarnings(report)
  ]

  if (report.symbols.length === 0) {
    lines.push(
      '## Changed symbols',
      '',
      report.status === 'disabled'
        ? 'Change-impact review is disabled, so nothing was analysed. This is not a report that nothing depends on the change.'
        : 'No changed symbol was seeded from this range, so there is nothing to report. See the warnings above, if any, for why.',
      ''
    )

    return `${lines.join('\n')}\n`
  }

  const buckets = bucketSymbols(report.symbols)

  for (const bucket of buckets) {
    if (bucket.symbols.length === 0) {
      continue
    }

    lines.push(`## ${bucket.heading}`, '', bucket.note, '')

    for (const symbol of bucket.symbols) {
      lines.push(...renderSymbol(symbol))
    }
  }

  const bucketed = new Set(buckets.flatMap((bucket) => bucket.symbols))

  lines.push(
    ...renderRemainder(report.symbols.filter((symbol) => !bucketed.has(symbol)))
  )

  return `${lines.join('\n')}\n`
}
