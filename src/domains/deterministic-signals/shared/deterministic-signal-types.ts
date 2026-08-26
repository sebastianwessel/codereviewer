import type { EvidenceRecord } from '../../../shared/contracts/index.js'

// THE ONE LIST. Every other statement of "which languages does this engine
// support" is derived from this union or checked against it, and none of them may
// be a fourth independent copy:
//
// - the extension table (`deterministic-signal-utils.ts`) is checked against it by
//   `EverySignalLanguageCovered` below;
// - the adapter registry (`deterministic-signal-registry.ts`) is a mapped type over
//   it, so it is checked structurally;
// - the fact-extractor dispatch (`polyglot/polyglot-signal-extractor.ts`) is a
//   `Record` over it, so it is checked structurally;
// - the ast-grep grammar registration (`ast-grep/ast-grep-parser.ts`) is a `Record`
//   over it minus the two grammars ast-grep ships built in.
//
// The reason this is written down rather than left to be rediscovered: the
// extractor dispatch used to be an if-chain that ENDED in an unguarded
// `return extractJavaFacts(...)`. An eighth member added to this union would have
// compiled, parsed with its own grammar, and then been read by Java's extractor —
// producing confidently wrong facts for a file that is not Java, rather than no
// facts or an error. That is the silent-optimism failure this repository keeps
// re-finding, and adding a language is exactly the moment it would fire.
export type SupportedSignalLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'ruby'

/**
 * Compile-time assertion that some other list covers every
 * `SupportedSignalLanguage`.
 *
 * Instantiate it with what that list LEAVES OUT — `Exclude<SupportedSignalLanguage,
 * …the ids the list actually contains…>`. The instantiation compiles only when the
 * leftover is `never`, and when it is not, the compiler error names the language
 * that was left out rather than reporting a generic mismatch.
 *
 * Needed only where the list's shape hides its coverage from the type system. A
 * `Record<SupportedSignalLanguage, …>` is already checked by construction and must
 * NOT be wrapped in this; an array of `{ id }` objects is not, because nothing in
 * an array type requires a particular `id` to be present.
 *
 * Exported rather than left as a file-local alias only because `noUnusedLocals`
 * reports an unreferenced local type, and the assertion's whole value is that it is
 * never referenced again.
 */
export type EverySignalLanguageCovered<TUncovered extends never> = TUncovered

export type SupportSignalFile = {
  readonly path: string
  readonly content?: string
}

export type SupportSignalSourceFile = SupportSignalFile & {
  readonly content: string
}

export type SupportSignalDetection = {
  readonly extractorId: SupportedSignalLanguage
  readonly detected: boolean
  readonly supportedFileCount: number
  readonly unsupportedFiles: readonly string[]
}

export type SupportSignalFactKind =
  | 'import'
  | 'export'
  | 'declaration'
  | 'public-symbol'
  | 'module'

export type SupportSignalFact = {
  readonly id: string
  readonly language: SupportedSignalLanguage
  readonly kind: SupportSignalFactKind
  readonly path: string
  readonly name: string
  readonly moduleSpecifier?: string
  readonly line: number
  // Last line the construct that produced this fact occupies, read from the AST
  // node's own range rather than guessed from the next declaration below it.
  //
  // It is REQUIRED, not optional. A consumer asking "which changed lines does this
  // symbol own" has no sound default for an absent end: assuming the declaration
  // line owns only itself hides every body change, and assuming it owns everything
  // to the next sibling credits it with lines belonging to a nested declaration or
  // to no declaration at all. Both are confident wrong answers, which is the defect
  // class this repository keeps re-finding.
  //
  // Always `>= line`. For a nested declaration the enclosing one's range CONTAINS
  // it, so a line inside a method is owned by the method and by its class — which
  // is the fact that makes a type reachable as a changed symbol when only a member
  // moved.
  readonly endLine: number
  readonly summary: string
  readonly contentHash: string
}

export type DeterministicSignalExtraction = {
  readonly facts: readonly SupportSignalFact[]
  readonly evidence: readonly EvidenceRecord[]
}

export type SupportSignalTestMapping = {
  readonly language: SupportedSignalLanguage
  readonly sourcePath: string
  readonly testPath: string
  readonly relation: 'direct' | 'same-directory'
}

export type SupportedSignalLanguageDefinition = {
  readonly id: SupportedSignalLanguage
  readonly extensions: readonly string[]
}

