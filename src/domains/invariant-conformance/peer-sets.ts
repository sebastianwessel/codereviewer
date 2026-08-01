// Deterministic peer-set derivation: for each declaration the diff adds or
// modifies, the sibling declarations the codebase already holds.
//
// The seed is the same intersection `change-impact/changed-symbols.ts` performs —
// `deterministic-signals` facts of a declaration-shaped kind, intersected with the
// diff's hunks — and it is deliberately performed the same way rather than shared
// as a function. The two domains diverge immediately after the intersection:
// change-impact wants the most VISIBLE kind of a symbol (visibility is what
// decides whether anything outside the file can depend on it) and this domain
// wants the most INCLUSIVE one (a peer set that splits an exported sibling from an
// unexported one compares fewer peers for no benefit). Sharing the collapse would
// force one of the two to be wrong. What is shared is the mechanism underneath:
// both call `extractDeterministicSignals` and neither reads a file.
//
// Spec 24 forbids unbounded search. The bound here is structural: peers come from
// the changed declaration's own file and its own directory, never from a
// repository-wide scan, and the caller supplies the sibling files it already read
// under its own cap.

import type { DiffHunk } from '../repository-intake/index.js'
import {
  groupByKeyInOrder,
  selectSpreadAcrossGroups
} from './bounded-selection.js'
import {
  extractDeterministicSignals,
  normalizeSignalPath,
  type SupportedSignalLanguage,
  type SupportSignalFact,
  type SupportSignalFactKind
} from '../deterministic-signals/index.js'
import {
  declarationSpanAt,
  toSourceLines,
  type DeclarationSpan,
  type SourceLines
} from '../declaration-analysis/declaration-span.js'
import {
  extractDeclarationTraits,
  isComparableDeclarationHeader,
  type DeclarationTrait
} from '../declaration-analysis/declaration-shape.js'

// The fact kinds that name a declaration with a body. `import` names a symbol the
// file consumes rather than one it defines, and `module` is a package clause, not
// a declaration.
const declarationFactKinds = [
  'declaration',
  'public-symbol',
  'export'
] as const satisfies readonly SupportSignalFactKind[]

export type PeerDeclarationKind = (typeof declarationFactKinds)[number]

// How the same declaration reported under several fact kinds collapses. The
// LOWEST-visibility kind wins, which is the opposite of `change-impact`'s rule
// and is deliberate: the polyglot extractors emit `declaration` and
// `public-symbol` at the same line for every public declaration, so ranking
// `declaration` first puts a package's exported and unexported functions in one
// peer set instead of two. Splitting them would halve every peer set and cost
// exactly the comparisons this capability exists to make.
const peerDeclarationKindRank: Readonly<Record<PeerDeclarationKind, number>> = {
  declaration: 0,
  'public-symbol': 1,
  export: 2
}

// Same rule as `change-impact`: a name that cannot be read as an identifier is a
// wildcard re-export or an operator method, and comparing it to anything is
// meaningless.
const comparableNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]*[?!=]?$/u

const isDeclarationFactKind = (
  kind: SupportSignalFactKind
): kind is PeerDeclarationKind =>
  (declarationFactKinds as readonly SupportSignalFactKind[]).includes(kind)

export type ConformanceSourceFile = {
  readonly path: string
  readonly content: string
  // Diff hunks for a file the change touched, in the line space of the side the
  // content came from. Absent for a sibling file read only to supply peers.
  readonly hunks?: readonly DiffHunk[]
  // True when the whole file is new, so every declaration in it is attributable
  // to the change even where the hunk arithmetic would not reach.
  readonly isNewFile?: boolean
}

export type PeerDeclaration = {
  readonly path: string
  readonly name: string
  readonly kind: PeerDeclarationKind
  readonly language: SupportedSignalLanguage
  readonly span: DeclarationSpan
  readonly traits: readonly DeclarationTrait[]
  // Whether the change added or modified this declaration. A declaration the
  // change did not touch can still be the odd one out in its peer set; spec 24
  // permits reporting that and requires it to be labelled separately.
  readonly changeAttributed: boolean
}

export type PeerSet = {
  // The declaration the diff added or modified, which seeded this set.
  readonly subject: PeerDeclaration
  // How the peers were found. `file` when the subject's own file supplied enough
  // of them, `directory` when siblings in the same directory were needed too.
  readonly scope: 'file' | 'directory'
  // Every declaration compared, INCLUDING the subject. Spec 24's majority is over
  // the peers a divergence is measured against, and the subject is one of the
  // declarations a pre-existing divergence can be reported for.
  readonly members: readonly PeerDeclaration[]
  readonly truncated: boolean
}

const directoryOf = (path: string): string => {
  const lastSlash = path.lastIndexOf('/')

  return lastSlash === -1 ? '' : path.slice(0, lastSlash)
}

// Whether a declaration's line falls inside a hunk. Mirrors
// `change-impact/changed-symbols.ts`: a pure-deletion hunk reports
// `newLineCount === 0`, and `newStartLine` is then the surviving line the removal
// sits after, which is the closest anchor a declaration that lost code has.
const hunkTouchesLine = (hunk: DiffHunk, line: number): boolean => {
  const firstLine = hunk.newStartLine
  const lastLine =
    hunk.newLineCount === 0
      ? hunk.newStartLine
      : hunk.newStartLine + hunk.newLineCount - 1

  return line >= firstLine && line <= lastLine
}

// A declaration is change-attributed when the change touched its BODY, not only
// its header line. A guard removed from the middle of a function leaves the
// header untouched, and that is the shape spec 24 exists to catch.
const spanIsChanged = (
  file: ConformanceSourceFile,
  span: DeclarationSpan
): boolean => {
  if (file.isNewFile === true) {
    return true
  }

  const hunks = file.hunks

  if (hunks === undefined) {
    return false
  }

  return hunks.some((hunk) => {
    for (let line = span.startLine; line <= span.endLine; line += 1) {
      if (hunkTouchesLine(hunk, line)) {
        return true
      }
    }

    return false
  })
}

type FileDeclarations = {
  readonly path: string
  readonly declarations: readonly PeerDeclaration[]
}

const compareDeclarations = (
  left: PeerDeclaration,
  right: PeerDeclaration
): number =>
  left.path.localeCompare(right.path) ||
  left.span.startLine - right.span.startLine ||
  left.name.localeCompare(right.name)

/**
 * Collapses the facts of one file into comparable declarations.
 *
 * Three shapes are dropped rather than compared.
 *
 * A line carrying more than one distinct name is a re-export list
 * (`export { readOne, readAll }`) — several facts, one construct, no body.
 * A fact whose header line is blank after comment blanking cannot be located in
 * the source at all.
 *
 * And a declaration with NO extracted trait is dropped, which is the load-bearing
 * one. A type alias, a constant, an enum member list: they declare something
 * without doing anything, so there is no sense in which they "fail to call" what
 * their peers call — every majority pattern diverges from them trivially, and
 * they would be the loudest thing in the report while carrying no information.
 * The first real run of this capability produced 28 divergences and every single
 * one was this shape. They are also excluded from the peer DENOMINATOR, which
 * matters just as much: a file where half the exports are type aliases would
 * otherwise dilute a unanimous convention among its functions down below the
 * majority threshold.
 *
 * The rule is about the method rather than about any one language: a declaration
 * with no observable behaviour cannot be compared on behaviour. What it costs is
 * an empty function body that genuinely should have had a guard — reported by
 * nothing here, and a stub that calls nothing is not the case this capability is
 * built for.
 */
const declarationsOfFile = (
  file: ConformanceSourceFile,
  lines: SourceLines,
  facts: readonly SupportSignalFact[]
): readonly PeerDeclaration[] => {
  const namesByLine = new Map<number, Set<string>>()
  const strongestByLine = new Map<number, SupportSignalFact>()

  for (const fact of facts) {
    if (
      !isDeclarationFactKind(fact.kind) ||
      !comparableNamePattern.test(fact.name) ||
      // A re-export names a symbol defined elsewhere; its "body" is another file.
      fact.moduleSpecifier !== undefined
    ) {
      continue
    }

    const names = namesByLine.get(fact.line) ?? new Set<string>()

    names.add(fact.name)
    namesByLine.set(fact.line, names)

    const existing = strongestByLine.get(fact.line)

    if (
      existing === undefined ||
      peerDeclarationKindRank[fact.kind as PeerDeclarationKind] <
        peerDeclarationKindRank[existing.kind as PeerDeclarationKind]
    ) {
      strongestByLine.set(fact.line, fact)
    }
  }

  const declarations: PeerDeclaration[] = []

  for (const [line, fact] of strongestByLine) {
    if (
      (namesByLine.get(line)?.size ?? 0) > 1 ||
      !isComparableDeclarationHeader(lines, line)
    ) {
      continue
    }

    const span = declarationSpanAt(lines, line)

    if (span === undefined) {
      continue
    }

    const traits = extractDeclarationTraits({
      lines,
      span,
      declarationName: fact.name
    })

    if (traits.length === 0) {
      continue
    }

    declarations.push({
      path: fact.path,
      name: fact.name,
      kind: fact.kind as PeerDeclarationKind,
      language: fact.language,
      span,
      traits,
      changeAttributed: spanIsChanged(file, span)
    })
  }

  return declarations.sort(compareDeclarations)
}

export type DerivePeerSetsInput = {
  // Files the change touched, carrying their hunks, plus sibling files read only
  // to supply peers. Both arrive already read by the caller through the mediated
  // retrieval seam; this module opens nothing.
  readonly files: readonly ConformanceSourceFile[]
  readonly maxChangedDeclarations: number
  readonly maxPeersPerDeclaration: number
}

export type DerivePeerSetsResult = {
  readonly peerSets: readonly PeerSet[]
  // True when `maxChangedDeclarations` cut the seed short. Reported rather than
  // swallowed: a reader must be able to tell a small change from a bounded one.
  readonly changedDeclarationsTruncated: boolean
  readonly changedDeclarationCount: number
}

// A peer must be the same kind, in the same language, at the same indentation
// column. Indentation is the language-neutral proxy for "sibling": it separates a
// Python module-level function from a method inside a class, and a Rust free
// function from one inside an `impl`, without a per-language nesting rule.
// Deliberately NOT gated on `kind`.
//
// The collapse above already picks the most inclusive kind precisely so that "a
// peer set that splits an exported sibling from an unexported one compares fewer
// peers for no benefit". Requiring the kinds to match here undid that: it only
// looked harmless while a language reported every declaration under the same kind.
//
// The moment ECMAScript gained `declaration` facts, the schema builders (still
// `export`, being bound to a call rather than a function) split from the functions
// and classes (now `declaration`), and a 7-peer set became a 5-peer set. That
// shrank denominator PROMOTED patterns that were correctly sub-majority: `3 of 7`
// is not a majority, `3 of 5` is, so two new divergences appeared out of a change
// that added information and removed none. A peer denominator must not depend on
// which fact kind an extractor happens to emit.
const isSibling = (subject: PeerDeclaration, candidate: PeerDeclaration): boolean =>
  candidate.language === subject.language &&
  candidate.span.indentation === subject.span.indentation &&
  !(
    candidate.path === subject.path &&
    candidate.span.startLine === subject.span.startLine
  )

/**
 * Derives one peer set per changed declaration. A declaration whose file and
 * directory hold no siblings yields no peer set at all — spec 24's "a peer set
 * with no majority pattern yields nothing" starts here, with no set to take a
 * majority over.
 */
export const derivePeerSets = (
  input: DerivePeerSetsInput
): DerivePeerSetsResult => {
  const filesByPath = new Map(
    input.files.map((file) => [normalizeSignalPath(file.path), file] as const)
  )
  const linesByPath = new Map(
    input.files.map(
      (file) => [normalizeSignalPath(file.path), toSourceLines(file.content)] as const
    )
  )
  const extraction = extractDeterministicSignals(
    input.files.map((file) => ({ path: file.path, content: file.content }))
  )
  const factsByPath = new Map<string, SupportSignalFact[]>()

  for (const fact of extraction.facts) {
    const bucket = factsByPath.get(fact.path) ?? []

    bucket.push(fact)
    factsByPath.set(fact.path, bucket)
  }

  const perFile: FileDeclarations[] = []

  for (const [path, file] of filesByPath) {
    perFile.push({
      path,
      declarations: declarationsOfFile(
        file,
        linesByPath.get(path) ?? [],
        factsByPath.get(path) ?? []
      )
    })
  }

  const allDeclarations = perFile.flatMap((entry) => entry.declarations)
  const changed = allDeclarations
    .filter((declaration) => declaration.changeAttributed)
    .sort(compareDeclarations)
  // The cap is spread across the changed FILES rather than taken off the front of
  // a path-sorted list, so a change larger than the cap is sampled instead of
  // truncated to whichever files sort first. See `bounded-selection.ts` for what
  // the front-of-list form cost when it bound.
  const seeds = [
    ...selectSpreadAcrossGroups(
      groupByKeyInOrder(changed, (declaration) => declaration.path),
      input.maxChangedDeclarations
    )
  ].sort(compareDeclarations)
  const peerSets: PeerSet[] = []

  for (const subject of seeds) {
    const sameFile = allDeclarations.filter(
      (candidate) =>
        candidate.path === subject.path && isSibling(subject, candidate)
    )
    const subjectDirectory = directoryOf(subject.path)
    const sameDirectory = allDeclarations.filter(
      (candidate) =>
        candidate.path !== subject.path &&
        directoryOf(candidate.path) === subjectDirectory &&
        isSibling(subject, candidate)
    )
    const peers = [...sameFile, ...sameDirectory]

    if (peers.length === 0) {
      continue
    }

    // The cap counts peers, so the subject is added on top of it and the
    // majority arithmetic downstream always has the full peer denominator it was
    // bounded to.
    const bounded = peers.slice(0, input.maxPeersPerDeclaration)

    peerSets.push({
      subject,
      scope: sameDirectory.length === 0 ? 'file' : 'directory',
      members: [subject, ...bounded],
      truncated: peers.length > bounded.length
    })
  }

  return {
    peerSets,
    changedDeclarationsTruncated: changed.length > seeds.length,
    changedDeclarationCount: changed.length
  }
}
