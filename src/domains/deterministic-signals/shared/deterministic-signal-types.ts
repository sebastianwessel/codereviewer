import type { EvidenceRecord } from '../../../shared/contracts/index.js'

export type SupportedSignalLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'ruby'

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

