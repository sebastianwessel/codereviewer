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

