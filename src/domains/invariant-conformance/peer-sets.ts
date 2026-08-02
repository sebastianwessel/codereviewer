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
  // The header line of the declaration this one is nested in, or undefined at the
  // top level of its file. This is the declaration's SCOPE, and it is what makes
  // two declarations siblings — see `isSibling`.
  readonly containerStartLine?: number
  // How many declarations enclose this one. Zero at a file's top level, one for a
  // method of a top-level class, and so on.
  readonly containerDepth: number
  // Whether the change added or modified this declaration. A declaration the
  // change did not touch can still be the odd one out in its peer set; spec 24
  // permits reporting that and requires it to be labelled separately.
  readonly changeAttributed: boolean
}

export type PeerSet = {
  // The declaration the diff added or modified, which seeded this set.
  readonly subject: PeerDeclaration
  // WHICH SCOPES CONTRIBUTED a peer — not which one was consulted. Both always
  // are: the members are the subject's same-file siblings UNIONED with its
  // same-directory ones. `directory` says the directory held at least one sibling,
  // `file` that it held none and the file is all there was.
  //
  // This used to be documented as a file-FIRST rule with the directory as a
  // fallback — "`file` when the subject's own file supplied enough of them" — which
  // the code never implemented. See `derivePeerSets` for the measurement that says
  // the code was right and the sentence was wrong.
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

// A declaration whose header sits inside another's span and whose body ends no
// later. Strict on the header line so two declarations reported at the SAME line
// — an assignment whose right-hand side is a function, which several extractors
// report twice — are never made parent and child of each other.
const containsDeclaration = (
  outer: DeclarationSpan,
  inner: DeclarationSpan
): boolean =>
  outer.startLine < inner.startLine && inner.endLine <= outer.endLine

type LocatedDeclaration = {
  readonly fact: SupportSignalFact
  readonly span: DeclarationSpan
}

type ScopedDeclaration = LocatedDeclaration & {
  // The innermost declaration of the same file that encloses this one.
  readonly container?: LocatedDeclaration
  readonly containerDepth: number
  // The declarations DIRECTLY inside this one, whose spans together cover every
  // declaration nested anywhere within it.
  readonly children: readonly DeclarationSpan[]
}

/**
 * Resolves the nesting of one file's declarations from their spans.
 *
 * THE SCOPE OF A DECLARATION IS STRUCTURAL AND IS READ HERE, NOT GUESSED.
 *
 * The spans `declaration-span.ts` reconstructs already contain each other exactly
 * as the source nests, so containment is a comparison of two spans and needs no
 * second parser and no per-language nesting rule. What it replaces is an
 * indentation proxy — "same column, same directory, same language, therefore
 * siblings" — which is false in every language that indents two unrelated things
 * to the same depth: ten test functions inside a test module and the methods of an
 * unrelated type both sit one step in, and were peers of each other.
 */
const resolveNesting = (
  located: readonly LocatedDeclaration[]
): readonly ScopedDeclaration[] => {
  const containerOf = new Map<LocatedDeclaration, LocatedDeclaration>()

  for (const declaration of located) {
    let innermost: LocatedDeclaration | undefined

    for (const candidate of located) {
      if (
        candidate === declaration ||
        !containsDeclaration(candidate.span, declaration.span) ||
        // Innermost wins: of two enclosing spans, the one that starts later is
        // inside the other.
        (innermost !== undefined &&
          candidate.span.startLine <= innermost.span.startLine)
      ) {
        continue
      }

      innermost = candidate
    }

    if (innermost !== undefined) {
      containerOf.set(declaration, innermost)
    }
  }

  const depthOf = (declaration: LocatedDeclaration): number => {
    let depth = 0
    let current = containerOf.get(declaration)

    // Bounded by the chain, which cannot cycle: a container always starts on a
    // strictly earlier line than what it contains.
    while (current !== undefined) {
      depth += 1
      current = containerOf.get(current)
    }

    return depth
  }

  return located.map((declaration) => {
    const container = containerOf.get(declaration)
    const children = located
      .filter((candidate) => containerOf.get(candidate) === declaration)
      .map((candidate) => candidate.span)

    return {
      ...declaration,
      ...(container === undefined ? {} : { container }),
      containerDepth: depthOf(declaration),
      children
    }
  })
}

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
 *
 * IT IS ALSO WHAT REMOVES CONTAINERS, now that traits are extracted from a
 * declaration's OWN body rather than from its members' (see
 * `declaration-shape.ts`). A class or module whose body is nothing but
 * declarations is left holding no trait and drops out here, under a rule that was
 * already needed for a different reason. No separate "is this a container" test
 * exists, and none should: a class with real body-level behaviour of its own keeps
 * exactly that behaviour and is compared on it, while one that is only a namespace
 * for its members has nothing to compare and says so.
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

  const located: LocatedDeclaration[] = []

  for (const [line, fact] of strongestByLine) {
    if (
      (namesByLine.get(line)?.size ?? 0) > 1 ||
      !isComparableDeclarationHeader(lines, line)
    ) {
      continue
    }

    const span = declarationSpanAt(lines, line)

    if (span !== undefined) {
      located.push({ fact, span })
    }
  }

  // Nesting is resolved over EVERY located declaration, before the behaviourless
  // ones are dropped. A class removed for having no traits of its own is still the
  // scope its methods share, and forgetting it would make them look top-level.
  const declarations: PeerDeclaration[] = []

  for (const scoped of resolveNesting(located)) {
    const traits = extractDeclarationTraits({
      lines,
      span: scoped.span,
      declarationName: scoped.fact.name,
      nestedSpans: scoped.children
    })

    if (traits.length === 0) {
      continue
    }

    declarations.push({
      path: scoped.fact.path,
      name: scoped.fact.name,
      kind: scoped.fact.kind as PeerDeclarationKind,
      language: scoped.fact.language,
      span: scoped.span,
      traits,
      ...(scoped.container === undefined
        ? {}
        : { containerStartLine: scoped.container.span.startLine }),
      containerDepth: scoped.containerDepth,
      changeAttributed: spanIsChanged(file, scoped.span)
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

// A peer must be in the same language and in the same SCOPE. Deliberately NOT
// gated on `kind`.
//
// SCOPE IS STRUCTURAL, AND USED TO BE POSITIONAL.
//
// The rule was "same indentation column", an indentation proxy for "sibling". It
// is wrong wherever a language indents two unrelated things to the same depth,
// which is everywhere: measured on real repositories, ten `#[tokio::test]`
// functions inside a test module sat at column 4, the methods of an unrelated type
// sat at column 4, and every pair of them was a peer. So did a method of one class
// and a closure nested in a function of another, and two methods of two classes
// that have nothing to do with each other.
//
// The relation the spec actually means is "declared in the same place", and the
// spans already answer it. Inside one file the test is exact: two declarations are
// siblings when the same declaration encloses both, or when neither is enclosed at
// all. Across files there is no shared enclosing declaration to compare, so the
// structural relation available is nesting DEPTH — the top-level declarations of
// two files in a directory are siblings of each other, and so are the members of
// their top-level containers. That is weaker than the same-file test and it is
// stated rather than hidden: it is a claim about structure, which a column is not.
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
  candidate.containerDepth === subject.containerDepth &&
  (candidate.path !== subject.path ||
    candidate.containerStartLine === subject.containerStartLine) &&
  !(
    candidate.path === subject.path &&
    candidate.span.startLine === subject.span.startLine
  )

/**
 * Derives one peer set per changed declaration. A declaration whose file and
 * directory hold no siblings yields no peer set at all — spec 24's "a peer set
 * with no majority pattern yields nothing" starts here, with no set to take a
 * majority over.
 *
 * THE TWO SCOPES ARE UNIONED, AND THE FILE-FIRST ALTERNATIVE WAS MEASURED AND
 * REJECTED.
 *
 * A file-first rule — take the directory only when the subject's own file cannot
 * reach spec 24's floor of three cited peers — is what `scope` used to be
 * documented as, and it is superficially attractive: the same-file sibling test is
 * EXACT (the same declaration encloses both) while the cross-file one is the weaker
 * nesting-depth proxy, and unioning them lets the proxy outvote the exact test.
 * Peer sets of twenty or more members hold 46% of all divergences, and a directory
 * of same-depth declarations is what produces them.
 *
 * Implemented and run over the same 64,201 declarations of the same 37 real
 * repositories, it made the report NEARLY TWICE AS LOUD: 647 divergences became
 * 1,215, spreading from 18 repositories to 25. It removed 105 divergences, 89 of
 * them from sets of twenty peers or more — the bags it was aimed at — and added
 * 673, of which 449 came from sets of twelve peers or fewer and 39 were the bare
 * `3 of 3` a three-peer file can produce and nothing else can.
 *
 * The arithmetic is the reason, and this module already records it one comment
 * further down: a smaller denominator PROMOTES patterns that are correctly
 * sub-majority. `3 of 6` is not a majority and `3 of 3` is, so narrowing the peer
 * set does not filter the weak evidence out — it converts it into findings. The
 * same effect is visible in the negative control at fixture scale, where the file
 * alone turned a sub-majority `describe` into a third reported divergence.
 *
 * So the union stays and the documentation was corrected instead. The large-bag
 * problem is real and remains open, but it is a question about MEMBERSHIP — whether
 * these declarations are peers at all — which spec 24 answers with its membership
 * precondition, not one the denominator can be shrunk out of.
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
      // Reports what the union drew on, which is the only thing it can honestly
      // report: `file` exactly when the directory contributed nothing.
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
