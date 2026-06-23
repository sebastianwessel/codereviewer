import type {
  SupportSignalDetection,
  SupportedSignalLanguage,
  DeterministicSignalExtraction,
  SupportSignalFile,
  SupportSignalSourceFile,
  SupportSignalTestMapping
} from './deterministic-signal-types.js'

export type SupportSignalExtractorAdapter<TLanguage extends SupportedSignalLanguage> = {
  readonly language: TLanguage
  readonly detect: (
    files: readonly SupportSignalFile[]
  ) => SupportSignalDetection
  readonly analyze: (
    files: readonly SupportSignalSourceFile[]
  ) => DeterministicSignalExtraction
  readonly discoverTests: (
    files: readonly SupportSignalFile[]
  ) => readonly SupportSignalTestMapping[]
}
