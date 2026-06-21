import type {
  FirstClassLanguage,
  LanguageAnalyzerFile,
  LanguageSourceFile
} from './language-analyzer-types.js'
import {
  firstClassLanguages,
  hasLanguageExtension,
  normalizeAnalyzerPath
} from './language-analyzer-utils.js'

export type RoutedLanguageFiles<TFile extends LanguageAnalyzerFile> = {
  readonly language: FirstClassLanguage
  readonly files: readonly TFile[]
}

export type LanguageRoutingResult<TFile extends LanguageAnalyzerFile> = {
  readonly groups: readonly RoutedLanguageFiles<TFile>[]
  readonly unsupportedFiles: readonly TFile[]
}

export const languageForPath = (
  path: string
): FirstClassLanguage | undefined => {
  const normalizedPath = normalizeAnalyzerPath(path)

  return firstClassLanguages.find((language) =>
    hasLanguageExtension(language, normalizedPath)
  )
}

export const routeFilesByLanguage = <TFile extends LanguageAnalyzerFile>(
  files: readonly TFile[]
): LanguageRoutingResult<TFile> => {
  const filesByLanguage = new Map<FirstClassLanguage, TFile[]>(
    firstClassLanguages.map((language) => [language, []])
  )
  const unsupportedFiles: TFile[] = []

  for (const file of files) {
    const normalizedFile = {
      ...file,
      path: normalizeAnalyzerPath(file.path)
    }
    const language = languageForPath(normalizedFile.path)

    if (language === undefined) {
      unsupportedFiles.push(normalizedFile)
      continue
    }

    filesByLanguage.get(language)?.push(normalizedFile)
  }

  return {
    groups: firstClassLanguages
      .map((language) => ({
        language,
        files: filesByLanguage.get(language) ?? []
      }))
      .filter((group) => group.files.length > 0),
    unsupportedFiles
  }
}

export const routeSourceFilesByLanguage = (
  files: readonly LanguageSourceFile[]
): LanguageRoutingResult<LanguageSourceFile> => routeFilesByLanguage(files)
