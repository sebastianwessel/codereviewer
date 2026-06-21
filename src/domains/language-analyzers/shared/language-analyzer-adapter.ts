import type {
  AnalyzerDetection,
  FirstClassLanguage,
  LanguageAnalyzerAnalysis,
  LanguageAnalyzerFile,
  LanguageSourceFile,
  TestMapping
} from './language-analyzer-types.js'

export type LanguageAnalyzerAdapter<TLanguage extends FirstClassLanguage> = {
  readonly language: TLanguage
  readonly detect: (
    files: readonly LanguageAnalyzerFile[]
  ) => AnalyzerDetection
  readonly analyze: (
    files: readonly LanguageSourceFile[]
  ) => LanguageAnalyzerAnalysis
  readonly discoverTests: (
    files: readonly LanguageAnalyzerFile[]
  ) => readonly TestMapping[]
}
