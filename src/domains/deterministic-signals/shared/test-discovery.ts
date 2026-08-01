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

// Ruby has three live conventions and no single blessed one: minitest's
// `*_test.rb`, RSpec's `*_spec.rb`, and the older `test_*.rb` / `spec_*.rb` prefix
// form that predates both and is still what Rack ships.
//
// It had NO predicate at all before, so `.rb` fell through to the JUnit rules,
// which never match a Ruby filename. Everything a Ruby test referenced was
// therefore reported as a PRODUCTION dependent: on Rack, all 22 sites in
// `test/spec_request.rb` rendered under "Dependents" while the test count read 0.
// That is worse than a missing feature — the production/test split is the sharpest
// distinction the impact report draws, and it was inverted for a whole language.
//
// A bare `test`/`spec` directory segment is deliberately NOT sufficient, for the
// same reason the Java rule rejects it: those directories hold fixtures and
// helpers that are not themselves tests.
const isRubyTestPath = (path: string): boolean => {
  const name = path.split('/').at(-1) ?? path

  // The SUFFIX form is unambiguous and stands on its own.
  if (/_(?:test|spec)\.rb$/u.test(name)) {
    return true
  }

  // The PREFIX form is not. `spec_helper.rb` is RSpec's shared setup file, not a
  // test, and it sits right beside the tests that require it — so the prefix only
  // counts inside a test directory, and even then `spec_helper` is excluded by
  // name. Demoting a production caller into the test bucket is the costlier
  // mistake, so the ambiguous form gets the stricter rule.
  return (
    /^(?:test|spec)_.+\.rb$/u.test(name) &&
    !/^spec_helper/u.test(name) &&
    (pathHasSegment(path, 'test') || pathHasSegment(path, 'spec'))
  )
}

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

  if (language === 'ruby') {
    return stem
      .replace(/^(?:test|spec)_/u, '')
      .replace(/_(?:test|spec)$/u, '')
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

  if (language === 'ruby') {
    return isRubyTestPath(path)
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

