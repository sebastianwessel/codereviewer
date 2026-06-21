import type { EvidenceRecord } from '../../../shared/contracts/index.js'

export type FirstClassLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'

export type LanguageAnalyzerFile = {
  readonly path: string
  readonly content?: string
}

export type LanguageSourceFile = LanguageAnalyzerFile & {
  readonly content: string
}

export type AnalyzerDetection = {
  readonly analyzerId: FirstClassLanguage
  readonly detected: boolean
  readonly supportedFileCount: number
  readonly unsupportedFiles: readonly string[]
}

export type LanguageFactKind =
  | 'import'
  | 'export'
  | 'declaration'
  | 'public-symbol'
  | 'module'

export type LanguageFact = {
  readonly id: string
  readonly language: FirstClassLanguage
  readonly kind: LanguageFactKind
  readonly path: string
  readonly name: string
  readonly moduleSpecifier?: string
  readonly line: number
  readonly summary: string
  readonly contentHash: string
}

export type LanguageAnalyzerAnalysis = {
  readonly facts: readonly LanguageFact[]
  readonly evidence: readonly EvidenceRecord[]
}

export type TestMapping = {
  readonly language: FirstClassLanguage
  readonly sourcePath: string
  readonly testPath: string
  readonly relation: 'direct' | 'same-directory'
}

export type LanguageDefinition = {
  readonly id: FirstClassLanguage
  readonly extensions: readonly string[]
}

