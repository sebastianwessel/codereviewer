import {
  extractPolyglotSignals,
  detectPolyglotSignalFiles,
  discoverPolyglotSignalTestMappings
} from './polyglot/polyglot-signal-extractor.js'
import type { SupportSignalExtractorAdapter } from './shared/deterministic-signal-adapter.js'
import type {
  SupportSignalDetection,
  SupportedSignalLanguage,
  DeterministicSignalExtraction,
  SupportSignalFile,
  SupportSignalSourceFile,
  SupportSignalTestMapping
} from './shared/deterministic-signal-types.js'
import {
  assertDeterministicSignalEvidenceOwnsPath,
  assertSupportSignalFactOwnsPath,
  supportedSignalLanguages
} from './shared/deterministic-signal-utils.js'
import { routeFilesBySignalLanguage, routeSignalSourceFilesByLanguage } from './shared/signal-language-router.js'

// ONE analysis engine owns every supported language. Each adapter binds it to a
// language so the registry stays a thin, single-owner dispatch table instead of
// seven near-identical wrapper modules.
//
// TypeScript and JavaScript used to have an engine of their own, built on the
// TypeScript compiler API. It used that compiler purely as a parser and reached an
// internal field for diagnostics, so two of seven languages were a special case
// resting on a private API — in a tool whose whole claim is to be
// language-neutral. ast-grep supported these grammars natively all along.
const polyglotAdapter = <TLanguage extends SupportedSignalLanguage>(
  language: TLanguage
): SupportSignalExtractorAdapter<TLanguage> => ({
  language,
  detect: (files) => detectPolyglotSignalFiles(language, files),
  analyze: (files) => extractPolyglotSignals(language, files),
  discoverTests: (files) => discoverPolyglotSignalTestMappings(language, files)
})

const supportSignalExtractorAdapters = {
  typescript: polyglotAdapter('typescript'),
  javascript: polyglotAdapter('javascript'),
  python: polyglotAdapter('python'),
  go: polyglotAdapter('go'),
  rust: polyglotAdapter('rust'),
  java: polyglotAdapter('java'),
  ruby: polyglotAdapter('ruby')
} as const satisfies {
  readonly [TLanguage in SupportedSignalLanguage]: SupportSignalExtractorAdapter<TLanguage>
}

const adapterFor = (
  language: SupportedSignalLanguage
): SupportSignalExtractorAdapter<SupportedSignalLanguage> => supportSignalExtractorAdapters[language]

const assertSignalExtractionOwnership = (
  extraction: DeterministicSignalExtraction
): void => {
  for (const fact of extraction.facts) {
    assertSupportSignalFactOwnsPath(fact)
  }

  for (const evidence of extraction.evidence) {
    assertDeterministicSignalEvidenceOwnsPath(evidence)
  }
}

export const detectDeterministicSignalFiles = (
  files: readonly SupportSignalFile[]
): readonly SupportSignalDetection[] => {
  const routing = routeFilesBySignalLanguage(files)
  const filesByLanguage = new Map(
    routing.groups.map((group) => [group.language, group.files])
  )

  return supportedSignalLanguages.map((language) => {
    const ownedFiles = filesByLanguage.get(language) ?? []

    return adapterFor(language).detect(ownedFiles)
  })
}

export const extractDeterministicSignalsForLanguage = (
  language: SupportedSignalLanguage,
  files: readonly SupportSignalSourceFile[]
): DeterministicSignalExtraction => {
  const routing = routeSignalSourceFilesByLanguage(files)
  const ownedGroup = routing.groups.find((group) => group.language === language)
  const ownedFiles = ownedGroup?.files ?? []

  if (
    routing.unsupportedFiles.length > 0 ||
    routing.groups.some((group) => group.language !== language) ||
    ownedFiles.length !== files.length
  ) {
    throw new TypeError(
      `Support signal extractor "${language}" received files outside its language ownership.`
    )
  }

  const result = adapterFor(language).analyze(ownedFiles)
  assertSignalExtractionOwnership(result)

  return result
}

export const extractDeterministicSignals = (
  files: readonly SupportSignalSourceFile[]
): DeterministicSignalExtraction => {
  const facts: DeterministicSignalExtraction['facts'][number][] = []
  const evidence: DeterministicSignalExtraction['evidence'][number][] = []
  const routing = routeSignalSourceFilesByLanguage(files)

  for (const group of routing.groups) {
    const result = adapterFor(group.language).analyze(group.files)
    assertSignalExtractionOwnership(result)
    facts.push(...result.facts)
    evidence.push(...result.evidence)
  }

  return { facts, evidence }
}

export const discoverDeterministicSignalTestMappings = (
  files: readonly SupportSignalFile[]
): readonly SupportSignalTestMapping[] =>
  routeFilesBySignalLanguage(files).groups.flatMap((group) =>
    adapterFor(group.language).discoverTests(group.files)
  )
