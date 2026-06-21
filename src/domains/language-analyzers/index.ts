export {
  analyzeFirstClassLanguageFiles,
  analyzeLanguageFiles,
  detectFirstClassLanguageFiles,
  discoverFirstClassLanguageTests
} from './language-analyzer-registry.js'
export {
  analyzeEcmascriptFiles,
  detectEcmascriptFiles,
  discoverEcmascriptTests
} from './ecmascript/ecmascript-analyzer.js'
export {
  analyzePolyglotFiles,
  detectPolyglotFiles,
  discoverPolyglotTests
} from './polyglot/polyglot-analyzer.js'
export {
  analyzerEvidenceOwnsPath,
  analyzerFactOwnsPath,
  analyzerLanguageForSource,
  assertAnalyzerEvidenceOwnsPath,
  assertAnalyzerFactOwnsPath,
  firstClassLanguages,
  hasLanguageExtension,
  languageDefinitions,
  normalizeAnalyzerPath
} from './shared/language-analyzer-utils.js'
export {
  languageForPath,
  routeFilesByLanguage,
  routeSourceFilesByLanguage,
  type LanguageRoutingResult,
  type RoutedLanguageFiles
} from './shared/language-router.js'
export { astGrepVersion } from './ast-grep/ast-grep-parser.js'
export { languageAnalyzerVersions } from './language-analyzer-metadata.js'
export type {
  AnalyzerDetection,
  FirstClassLanguage,
  LanguageAnalyzerAnalysis,
  LanguageAnalyzerFile,
  LanguageFact,
  LanguageFactKind,
  LanguageSourceFile,
  TestMapping
} from './shared/language-analyzer-types.js'
