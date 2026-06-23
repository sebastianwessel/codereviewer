import type {
  SupportedSignalLanguage,
  SupportSignalFile,
  SupportSignalTestMapping
} from './deterministic-signal-types.js'
import {
  directoryName,
  fileStem,
  hasLanguageExtension,
  normalizeSignalPath
} from './deterministic-signal-utils.js'

const isEcmascriptTestPath = (path: string): boolean =>
  /(?:^|[./_-])(?:test|spec)\.(?:[cm]?[jt]sx?)$/u.test(path)

const isPythonTestPath = (path: string): boolean => {
  const name = path.split('/').at(-1) ?? path

  return /^test_.+\.py$/u.test(name) || /_test\.py$/u.test(name)
}

const isGoTestPath = (path: string): boolean => path.endsWith('_test.go')

// Shared helper modules under a Rust integration-test crate are not tests
// themselves unless they declare a test.
const rustTestHelperModules = new Set(['mod.rs', 'common.rs'])

const isRustTestPath = (file: SupportSignalFile): boolean => {
  const path = normalizeSignalPath(file.path)
  const name = path.split('/').at(-1) ?? path

  if (file.content?.includes('#[test]') === true || path.endsWith('_test.rs')) {
    return true
  }

  return pathHasSegment(path, 'tests') && !rustTestHelperModules.has(name)
}

const isJavaTestPath = (path: string): boolean => {
  const name = path.split('/').at(-1) ?? path

  // JUnit naming conventions only. A `test` path segment (e.g. the Maven/Gradle
  // `src/test/java` source set) also contains non-test helpers, so it is not by
  // itself a test signal.
  return (
    /^Test.+\.java$/u.test(name) ||
    /Tests?\.java$/u.test(name) ||
    /IT\.java$/u.test(name)
  )
}

const pathHasSegment = (path: string, segment: string): boolean =>
  path.split('/').includes(segment)

const normalizedSourceStem = (
  language: SupportedSignalLanguage,
  path: string
): string => {
  const stem = fileStem(path)

  if (language === 'python') {
    return stem.replace(/^test_/u, '').replace(/_test$/u, '')
  }

  if (language === 'go' || language === 'rust') {
    return stem.replace(/_test$/u, '')
  }

  if (language === 'java') {
    return stem.replace(/^Test/u, '').replace(/Test$/u, '')
  }

  return stem.replace(/[._-](?:test|spec)$/u, '')
}

export const isLanguageTestFile = (
  language: SupportedSignalLanguage,
  file: SupportSignalFile
): boolean => {
  const path = normalizeSignalPath(file.path)

  if (!hasLanguageExtension(language, path)) {
    return false
  }

  if (language === 'typescript' || language === 'javascript') {
    return isEcmascriptTestPath(path)
  }

  if (language === 'python') {
    return isPythonTestPath(path)
  }

  if (language === 'go') {
    return isGoTestPath(path)
  }

  if (language === 'rust') {
    return isRustTestPath(file)
  }

  return isJavaTestPath(path)
}

export const discoverSignalLanguageTests = (
  language: SupportedSignalLanguage,
  files: readonly SupportSignalFile[]
): readonly SupportSignalTestMapping[] => {
  const languageFiles = files
    .map((file) => ({
      ...file,
      path: normalizeSignalPath(file.path)
    }))
    .filter((file) => hasLanguageExtension(language, file.path))
  const testFiles = languageFiles.filter((file) => isLanguageTestFile(language, file))
  const mappings: SupportSignalTestMapping[] = []

  for (const testFile of testFiles) {
    mappings.push({
      language,
      sourcePath: testFile.path,
      testPath: testFile.path,
      relation: 'direct'
    })
  }

  for (const sourceFile of languageFiles.filter(
    (file) => !isLanguageTestFile(language, file)
  )) {
    for (const testFile of testFiles) {
      if (
        directoryName(sourceFile.path) === directoryName(testFile.path) &&
        normalizedSourceStem(language, sourceFile.path) ===
          normalizedSourceStem(language, testFile.path)
      ) {
        mappings.push({
          language,
          sourcePath: sourceFile.path,
          testPath: testFile.path,
          relation: 'same-directory'
        })
      }
    }
  }

  // Deterministic order independent of discovery order: direct mappings first,
  // then by source path and test path.
  return [...mappings].sort(
    (left, right) =>
      Number(left.relation === 'same-directory') -
        Number(right.relation === 'same-directory') ||
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.testPath.localeCompare(right.testPath)
  )
}

