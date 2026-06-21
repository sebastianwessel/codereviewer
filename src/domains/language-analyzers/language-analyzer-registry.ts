import {
  analyzeEcmascriptFiles,
  detectEcmascriptFiles,
  discoverEcmascriptTests
} from './ecmascript/ecmascript-analyzer.js'
import {
  analyzePolyglotFiles,
  detectPolyglotFiles,
  discoverPolyglotTests
} from './polyglot/polyglot-analyzer.js'
import type { LanguageAnalyzerAdapter } from './shared/language-analyzer-adapter.js'
import type {
  AnalyzerDetection,
  FirstClassLanguage,
  LanguageAnalyzerAnalysis,
  LanguageAnalyzerFile,
  LanguageSourceFile,
  TestMapping
} from './shared/language-analyzer-types.js'
import {
  assertAnalyzerEvidenceOwnsPath,
  assertAnalyzerFactOwnsPath,
  firstClassLanguages
} from './shared/language-analyzer-utils.js'
import { routeFilesByLanguage, routeSourceFilesByLanguage } from './shared/language-router.js'

// The two analysis engines (ecmascript via the TypeScript compiler, polyglot via
// ast-grep) own all six first-class languages. Each adapter binds an engine to a
// language so the registry stays a thin, single-owner dispatch table instead of
// six near-identical wrapper modules.
const ecmascriptAdapter = <TLanguage extends 'typescript' | 'javascript'>(
  language: TLanguage
): LanguageAnalyzerAdapter<TLanguage> => ({
  language,
  detect: (files) => detectEcmascriptFiles(language, files),
  analyze: (files) => analyzeEcmascriptFiles(language, files),
  discoverTests: (files) => discoverEcmascriptTests(language, files)
})

const polyglotAdapter = <TLanguage extends 'python' | 'go' | 'rust' | 'java'>(
  language: TLanguage
): LanguageAnalyzerAdapter<TLanguage> => ({
  language,
  detect: (files) => detectPolyglotFiles(language, files),
  analyze: (files) => analyzePolyglotFiles(language, files),
  discoverTests: (files) => discoverPolyglotTests(language, files)
})

const languageAnalyzerAdapters = {
  typescript: ecmascriptAdapter('typescript'),
  javascript: ecmascriptAdapter('javascript'),
  python: polyglotAdapter('python'),
  go: polyglotAdapter('go'),
  rust: polyglotAdapter('rust'),
  java: polyglotAdapter('java')
} as const satisfies {
  readonly [TLanguage in FirstClassLanguage]: LanguageAnalyzerAdapter<TLanguage>
}

const adapterFor = (
  language: FirstClassLanguage
): LanguageAnalyzerAdapter<FirstClassLanguage> => languageAnalyzerAdapters[language]

const assertAnalysisOwnership = (analysis: LanguageAnalyzerAnalysis): void => {
  for (const fact of analysis.facts) {
    assertAnalyzerFactOwnsPath(fact)
  }

  for (const evidence of analysis.evidence) {
    assertAnalyzerEvidenceOwnsPath(evidence)
  }
}

export const detectFirstClassLanguageFiles = (
  files: readonly LanguageAnalyzerFile[]
): readonly AnalyzerDetection[] => {
  const routing = routeFilesByLanguage(files)
  const filesByLanguage = new Map(
    routing.groups.map((group) => [group.language, group.files])
  )

  return firstClassLanguages.map((language) => {
    const ownedFiles = filesByLanguage.get(language) ?? []

    return adapterFor(language).detect(ownedFiles)
  })
}

export const analyzeLanguageFiles = (
  language: FirstClassLanguage,
  files: readonly LanguageSourceFile[]
): LanguageAnalyzerAnalysis => {
  const routing = routeSourceFilesByLanguage(files)
  const ownedGroup = routing.groups.find((group) => group.language === language)
  const ownedFiles = ownedGroup?.files ?? []

  if (
    routing.unsupportedFiles.length > 0 ||
    routing.groups.some((group) => group.language !== language) ||
    ownedFiles.length !== files.length
  ) {
    throw new TypeError(
      `Analyzer "${language}" received files outside its language ownership.`
    )
  }

  const result = adapterFor(language).analyze(ownedFiles)
  assertAnalysisOwnership(result)

  return result
}

export const analyzeFirstClassLanguageFiles = (
  files: readonly LanguageSourceFile[]
): LanguageAnalyzerAnalysis => {
  const facts: LanguageAnalyzerAnalysis['facts'][number][] = []
  const evidence: LanguageAnalyzerAnalysis['evidence'][number][] = []
  const routing = routeSourceFilesByLanguage(files)

  for (const group of routing.groups) {
    const result = adapterFor(group.language).analyze(group.files)
    assertAnalysisOwnership(result)
    facts.push(...result.facts)
    evidence.push(...result.evidence)
  }

  return { facts, evidence }
}

export const discoverFirstClassLanguageTests = (
  files: readonly LanguageAnalyzerFile[]
): readonly TestMapping[] =>
  routeFilesByLanguage(files).groups.flatMap((group) =>
    adapterFor(group.language).discoverTests(group.files)
  )
