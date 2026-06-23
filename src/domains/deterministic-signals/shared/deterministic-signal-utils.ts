import { sha256 } from '../../../shared/hash/hash.js'
import { normalizeRepositoryRelativePath } from '../../../platform/repository-path.js'
import type { EvidenceRecord } from '../../../shared/contracts/index.js'
import type {
  SupportSignalDetection,
  SupportedSignalLanguage,
  SupportSignalFile,
  SupportedSignalLanguageDefinition,
  SupportSignalFact,
  SupportSignalFactKind
} from './deterministic-signal-types.js'

export const supportedSignalLanguageDefinitions = [
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
  },
  {
    id: 'ruby',
    extensions: ['.rb']
  }
] as const satisfies readonly SupportedSignalLanguageDefinition[]

export const supportedSignalLanguages = supportedSignalLanguageDefinitions.map(
  (definition) => definition.id
) as readonly SupportedSignalLanguage[]

export const languageDefinitionFor = (
  language: SupportedSignalLanguage
): SupportedSignalLanguageDefinition => {
  const definition = supportedSignalLanguageDefinitions.find((candidate) => candidate.id === language)

  if (definition === undefined) {
    throw new TypeError(`Unsupported deterministic support signal language: ${language}`)
  }

  return definition
}

export { sha256 }

export const hashSegment = (value: string): string => sha256(value).slice(0, 16)

export const normalizeSignalPath = (path: string): string =>
  normalizeRepositoryRelativePath(path)

export const hasLanguageExtension = (
  language: SupportedSignalLanguage,
  path: string
): boolean =>
  languageDefinitionFor(language).extensions.some((extension) =>
    path.toLowerCase().endsWith(extension)
  )

export const supportSignalLanguageForSource = (
  source: string
): SupportedSignalLanguage | undefined => {
  const match = /^([a-z]+)-support-signal$/u.exec(source)
  const language = match?.[1]

  return supportedSignalLanguages.find((candidate) => candidate === language)
}

export const deterministicSignalEvidenceOwnsPath = (
  record: EvidenceRecord
): boolean => {
  const language = supportSignalLanguageForSource(record.source)

  if (language === undefined || record.location === undefined) {
    return true
  }

  return hasLanguageExtension(language, normalizeSignalPath(record.location.path))
}

export const supportSignalFactOwnsPath = (fact: SupportSignalFact): boolean =>
  hasLanguageExtension(fact.language, normalizeSignalPath(fact.path))

export const assertSupportSignalFactOwnsPath = (
  fact: SupportSignalFact
): void => {
  if (!supportSignalFactOwnsPath(fact)) {
    throw new TypeError(
      `Support signal fact "${fact.id}" for "${fact.language}" does not own "${fact.path}".`
    )
  }
}

export const assertDeterministicSignalEvidenceOwnsPath = (
  record: EvidenceRecord
): void => {
  if (!deterministicSignalEvidenceOwnsPath(record)) {
    throw new TypeError(
      `Support signal evidence "${record.id}" from "${record.source}" does not own "${record.location?.path ?? ''}".`
    )
  }
}

export const detectSupportSignalFiles = (
  language: SupportedSignalLanguage,
  files: readonly SupportSignalFile[]
): SupportSignalDetection => {
  const normalizedPaths = files.map((file) => normalizeSignalPath(file.path))
  const supportedFileCount = normalizedPaths.filter((path) =>
    hasLanguageExtension(language, path)
  ).length

  return {
    extractorId: language,
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

export const createSupportSignalFact = (input: {
  readonly language: SupportedSignalLanguage
  readonly kind: SupportSignalFactKind
  readonly path: string
  readonly name: string
  readonly moduleSpecifier?: string
  readonly line: number
  readonly contentHash: string
}): SupportSignalFact => {
  const moduleText =
    input.moduleSpecifier === undefined ? '' : ` from ${input.moduleSpecifier}`
  const actionByKind = {
    import: 'Imports',
    export: 'Exports',
    declaration: 'Declares',
    'public-symbol': 'Exposes public symbol',
    module: 'Defines module'
  } satisfies Record<SupportSignalFactKind, string>

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
  const extension = supportedSignalLanguageDefinitions
    .flatMap((definition) => definition.extensions)
    .find((candidate) => fileName.endsWith(candidate))

  return extension === undefined ? fileName : fileName.slice(0, -extension.length)
}

export const directoryName = (path: string): string => {
  const parts = path.split('/')

  return parts.length === 1 ? '' : parts.slice(0, -1).join('/')
}
