// Language-neutral declaration analysis: where a declaration starts and stops,
// what it observably does, and where inside it each of those things sits.
//
// Extracted from `invariant-conformance` when spec 25 needed the same primitives
// inside the diff reviewer. Spec 24's domain may not be imported by
// `review-workflow` — a failed conformance run must not be able to fail a diff
// review — so the shared half lives here, depended on by both and coupling
// neither to the other.
//
// Everything here is lexical and deterministic. It is not a parser: no syntax
// tree, no per-language keyword table beyond the narrow non-call list, and no
// resolution. That is a requirement rather than a shortcut — spec 15's
// language-neutrality Non-Negotiable applies, and a construct table is exactly
// what it forbids.
export {
  blankNonCode,
  codeLinesOfSpan,
  declarationSpanAt,
  toSourceLines,
  type BlankedLine,
  type DeclarationSpan,
  type SourceLines
} from './declaration-span.js'
export {
  declarationTraitKey,
  declarationTraitSubjectKey,
  describeDeclarationTrait,
  describePositionedTrait,
  extractDeclarationTraits,
  isComparableDeclarationHeader,
  type DeclarationTrait,
  type DeclarationTraitKind,
  type DeclarationTraitSubject,
  type ExtractDeclarationTraitsInput
} from './declaration-shape.js'
export {
  describeTraitPosition,
  traitPositionKey,
  traitPositionsOfSpan,
  type TraitDepthBand,
  type TraitPosition,
  type TraitTerminality
} from './trait-position.js'
