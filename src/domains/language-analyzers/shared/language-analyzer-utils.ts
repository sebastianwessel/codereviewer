import { sha256 } from '../../../shared/hash/hash.js'
import { normalizeRepositoryRelativePath } from '../../../platform/repository-path.js'
import type { EvidenceRecord } from '../../../shared/contracts/index.js'
import type {
  AnalyzerDetection,
  FirstClassLanguage,
  LanguageAnalyzerFile,
  LanguageDefinition,
  LanguageFact,
  LanguageFactKind
} from './language-analyzer-types.js'

export const languageDefinitions = [
  {
    id: 'typescript',
    extensions: ['.ts', '.tsx', '.mts', '.cts']
  },
  {
    id: 'javascript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs']
  },
  {
    id: 'python',
    extensions: ['.py']
  },
  {
    id: 'go',
    extensions: ['.go']
  },
  {
    id: 'rust',
    extensions: ['.rs']
  },
  {
    id: 'java',
    extensions: ['.java']
  }
] as const satisfies readonly LanguageDefinition[]

export const firstClassLanguages = languageDefinitions.map(
  (definition) => definition.id
) as readonly FirstClassLanguage[]

export const languageDefinitionFor = (
  language: FirstClassLanguage
): LanguageDefinition => {
  const definition = languageDefinitions.find((candidate) => candidate.id === language)

  if (definition === undefined) {
    throw new TypeError(`Unsupported first-class language: ${language}`)
  }

  return definition
}

export { sha256 }

export const hashSegment = (value: string): string => sha256(value).slice(0, 16)

export const normalizeAnalyzerPath = (path: string): string =>
  normalizeRepositoryRelativePath(path)

export const hasLanguageExtension = (
  language: FirstClassLanguage,
  path: string
): boolean =>
  languageDefinitionFor(language).extensions.some((extension) =>
    path.toLowerCase().endsWith(extension)
  )

export const analyzerLanguageForSource = (
  source: string
): FirstClassLanguage | undefined => {
  const match = /^([a-z]+)-analyzer$/u.exec(source)
  const language = match?.[1]

  return firstClassLanguages.find((candidate) => candidate === language)
}

export const analyzerEvidenceOwnsPath = (
  record: EvidenceRecord
): boolean => {
  const language = analyzerLanguageForSource(record.source)

  if (language === undefined || record.location === undefined) {
    return true
  }

  return hasLanguageExtension(language, normalizeAnalyzerPath(record.location.path))
}

export const analyzerFactOwnsPath = (fact: LanguageFact): boolean =>
  hasLanguageExtension(fact.language, normalizeAnalyzerPath(fact.path))

export const assertAnalyzerFactOwnsPath = (
  fact: LanguageFact
): void => {
  if (!analyzerFactOwnsPath(fact)) {
    throw new TypeError(
      `Analyzer fact "${fact.id}" for "${fact.language}" does not own "${fact.path}".`
    )
  }
}

export const assertAnalyzerEvidenceOwnsPath = (
  record: EvidenceRecord
): void => {
  if (!analyzerEvidenceOwnsPath(record)) {
    throw new TypeError(
      `Analyzer evidence "${record.id}" from "${record.source}" does not own "${record.location?.path ?? ''}".`
    )
  }
}

export const detectLanguageFiles = (
  language: FirstClassLanguage,
  files: readonly LanguageAnalyzerFile[]
): AnalyzerDetection => {
  const normalizedPaths = files.map((file) => normalizeAnalyzerPath(file.path))
  const supportedFileCount = normalizedPaths.filter((path) =>
    hasLanguageExtension(language, path)
  ).length

  return {
    analyzerId: language,
    detected: supportedFileCount > 0,
    supportedFileCount,
    unsupportedFiles: normalizedPaths.filter(
      (path) => !hasLanguageExtension(language, path)
    )
  }
}

export const optionalModuleSpecifier = (
  moduleSpecifier: string | undefined
): { readonly moduleSpecifier?: string } =>
  moduleSpecifier === undefined ? {} : { moduleSpecifier }

export const createLanguageFact = (input: {
  readonly language: FirstClassLanguage
  readonly kind: LanguageFactKind
  readonly path: string
  readonly name: string
  readonly moduleSpecifier?: string
  readonly line: number
  readonly contentHash: string
}): LanguageFact => {
  const moduleText =
    input.moduleSpecifier === undefined ? '' : ` from ${input.moduleSpecifier}`
  const actionByKind = {
    import: 'Imports',
    export: 'Exports',
    declaration: 'Declares',
    'public-symbol': 'Exposes public symbol',
    module: 'Defines module'
  } satisfies Record<LanguageFactKind, string>

  return {
    id: `fact_${hashSegment(
      `${input.language}:${input.kind}:${input.path}:${input.name}:${
        input.moduleSpecifier ?? ''
      }:${input.line}`
    )}`,
    language: input.language,
    kind: input.kind,
    path: input.path,
    name: input.name,
    ...(input.moduleSpecifier === undefined
      ? {}
      : { moduleSpecifier: input.moduleSpecifier }),
    line: input.line,
    summary: `${actionByKind[input.kind]} ${input.name}${moduleText}.`,
    contentHash: input.contentHash
  }
}

export const fileStem = (path: string): string => {
  const fileName = path.split('/').at(-1) ?? path
  const extension = languageDefinitions
    .flatMap((definition) => definition.extensions)
    .find((candidate) => fileName.endsWith(candidate))

  return extension === undefined ? fileName : fileName.slice(0, -extension.length)
}

export const directoryName = (path: string): string => {
  const parts = path.split('/')

  return parts.length === 1 ? '' : parts.slice(0, -1).join('/')
}
