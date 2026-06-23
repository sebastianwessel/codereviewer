export {
  extractDeterministicSignals,
  extractDeterministicSignalsForLanguage,
  detectDeterministicSignalFiles,
  discoverDeterministicSignalTestMappings
} from './deterministic-signal-registry.js'
export {
  extractEcmascriptSignals,
  detectEcmascriptSignalFiles,
  discoverEcmascriptSignalTestMappings
} from './ecmascript/ecmascript-signal-extractor.js'
export {
  extractPolyglotSignals,
  detectPolyglotSignalFiles,
  discoverPolyglotSignalTestMappings
} from './polyglot/polyglot-signal-extractor.js'
export {
  deterministicSignalEvidenceOwnsPath,
  supportSignalFactOwnsPath,
  supportSignalLanguageForSource,
  assertDeterministicSignalEvidenceOwnsPath,
  assertSupportSignalFactOwnsPath,
  supportedSignalLanguages,
  hasLanguageExtension,
  supportedSignalLanguageDefinitions,
  normalizeSignalPath
} from './shared/deterministic-signal-utils.js'
export {
  supportedSignalLanguageForPath,
  routeFilesBySignalLanguage,
  routeSignalSourceFilesByLanguage,
  type SignalLanguageRoutingResult,
  type RoutedSignalLanguageFiles
} from './shared/signal-language-router.js'
export { astGrepVersion } from './ast-grep/ast-grep-parser.js'
export { deterministicSignalExtractorVersions } from './deterministic-signal-metadata.js'
export type {
  SupportSignalDetection,
  SupportedSignalLanguage,
  DeterministicSignalExtraction,
  SupportSignalFile,
  SupportSignalFact,
  SupportSignalFactKind,
  SupportSignalSourceFile,
  SupportSignalTestMapping
} from './shared/deterministic-signal-types.js'
