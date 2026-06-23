import type {
  SupportedSignalLanguage,
  SupportSignalFile,
  SupportSignalSourceFile
} from './deterministic-signal-types.js'
import {
  supportedSignalLanguages,
  hasLanguageExtension,
  normalizeSignalPath
} from './deterministic-signal-utils.js'

export type RoutedSignalLanguageFiles<TFile extends SupportSignalFile> = {
  readonly language: SupportedSignalLanguage
  readonly files: readonly TFile[]
}

export type SignalLanguageRoutingResult<TFile extends SupportSignalFile> = {
  readonly groups: readonly RoutedSignalLanguageFiles<TFile>[]
  readonly unsupportedFiles: readonly TFile[]
}

export const supportedSignalLanguageForPath = (
  path: string
): SupportedSignalLanguage | undefined => {
  const normalizedPath = normalizeSignalPath(path)

  return supportedSignalLanguages.find((language) =>
    hasLanguageExtension(language, normalizedPath)
  )
}

export const routeFilesBySignalLanguage = <TFile extends SupportSignalFile>(
  files: readonly TFile[]
): SignalLanguageRoutingResult<TFile> => {
  const filesByLanguage = new Map<SupportedSignalLanguage, TFile[]>(
    supportedSignalLanguages.map((language) => [language, []])
  )
  const unsupportedFiles: TFile[] = []

  for (const file of files) {
    const normalizedFile = {
      ...file,
      path: normalizeSignalPath(file.path)
    }
    const language = supportedSignalLanguageForPath(normalizedFile.path)

    if (language === undefined) {
      unsupportedFiles.push(normalizedFile)
      continue
    }

    filesByLanguage.get(language)?.push(normalizedFile)
  }

  return {
    groups: supportedSignalLanguages
      .map((language) => ({
        language,
        files: filesByLanguage.get(language) ?? []
      }))
      .filter((group) => group.files.length > 0),
    unsupportedFiles
  }
}

export const routeSignalSourceFilesByLanguage = (
  files: readonly SupportSignalSourceFile[]
): SignalLanguageRoutingResult<SupportSignalSourceFile> => routeFilesBySignalLanguage(files)
