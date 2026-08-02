// Where "this is test code" is decided, at every granularity the engine needs.
//
// THERE ARE TWO FILE-LEVEL QUESTIONS, AND THEY HAVE DIFFERENT ANSWERS.
//
// "Is this file a TEST?" — does it hold test cases the ecosystem's own runner
// discovers? That is a naming convention, and it is what pairs a source file with
// the test that exercises it.
//
// "Is this file on the TEST SIDE?" — does it belong to the test half of the
// codebase at all? A fixture, a harness, a shared assertion helper holds no test
// case and is still not production code. `test/helpers.go`, `tests/helpers.py`,
// `test/utils/helper.ts` and every file under Maven's `src/test/java` answer NO to
// the first question and YES to this one.
//
// Overloading one predicate with both made the second question unanswerable and
// silently answered it "production": a test helper counted as a production
// dependent in the impact report and as a production peer in conformance. So the
// two are modelled separately, and the naming rules stay exactly as strict as they
// were — the widening happens in the location rule, where it belongs.
//
// A DECLARATION is test-side when the language builds it only for its test
// configuration, wherever the file it sits in lives. That granularity exists
// because one file-level answer is not always available: Rust's dominant form is
// an inline `#[cfg(test)] mod tests { … }` INSIDE the production file it tests, so
// production surface and test suite share a path and only the declaration can be
// asked.
//
// All of them live here so there is ONE definition of "test" in the engine. The
// impact report's production/test split, conformance's peer exclusion and the
// signal extractors all read it from this module.

import type { SgNode } from '@ast-grep/napi'
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

// Python names a test module in three forms, and the third was missing.
//
// `test_<subject>.py` and `<subject>_test.py` carry the subject in the filename. A
// module whose ENTIRE stem is `test`/`tests` carries it in the package instead:
// `<package>/tests.py` is the test module of that package, and there is no subject
// left in the name for an affix to attach to. It is the same convention with the
// subject moved one level up, and the language's own test discovery walks the
// package looking for exactly this shape.
//
// The stem is matched EXACTLY rather than as a prefix. `testing.py`, `testutils.py`
// and `testdata.py` are production helpers *about* tests, and a `test*` prefix would
// sweep them in. Demoting production code into the test bucket is the costlier
// mistake, so the widening stops at the bare stem.
const isPythonTestPath = (path: string): boolean => {
  const name = path.split('/').at(-1) ?? path

  return (
    /^test_.+\.py$/u.test(name) ||
    /_test\.py$/u.test(name) ||
    /^tests?\.py$/u.test(name)
  )
}

const isGoTestPath = (path: string): boolean => path.endsWith('_test.go')

// Shared helper modules under a Rust integration-test crate carry no test of
// their own, so the directory rule below must not sweep them in.
const rustTestHelperModules = new Set(['mod.rs', 'common.rs'])

// Only `*_test.rs` and the integration-test directory. Rust's OTHER convention —
// the inline `#[cfg(test)] mod tests` — is deliberately NOT a file-level answer,
// because it is the convention of a PRODUCTION file: `axum-extra/src/response/`
// ships four of them, and a file rule that reads the content classified all four
// as tests, dropping their production declarations from conformance entirely and
// shrinking the peer denominator until sub-majority patterns read as majorities.
// That convention is answered per declaration, further down this file.
const isRustTestPath = (path: string): boolean => {
  const name = path.split('/').at(-1) ?? path

  return (
    path.endsWith('_test.rs') ||
    (pathHasSegment(path, 'tests') && !rustTestHelperModules.has(name))
  )
}

const isJavaTestPath = (path: string): boolean => {
  const name = path.split('/').at(-1) ?? path

  // JUnit naming conventions only. A `test` path segment (e.g. the Maven/Gradle
  // `src/test/java` source set) also contains non-test helpers, so it is not by
  // itself a signal that this file HOLDS TESTS. It is a signal that the file is on
  // the test side, which is the separate question `isTestSideFile` answers.
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
// A bare `test`/`spec` directory segment is deliberately NOT sufficient here, for
// the same reason the Java rule rejects it: those directories hold fixtures and
// helpers that are not themselves tests. They are still test-side, which is what
// `isTestSideFile` says and this predicate does not.
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

/**
 * Whether a path is a test file by its own ecosystem's naming or layout rule.
 *
 * Takes a PATH and nothing else. No language decides this from file content any
 * more, and the parameter is gone rather than ignored: while it existed, the same
 * file answered differently depending on whether its caller happened to have read
 * it, so `conformance check` and `impact check` disagreed about the same Rust file
 * by construction. A content-sensitive test convention is a declaration-level
 * question — see `isTestOnlyDeclaration`.
 */
export const isLanguageTestFile = (
  language: SupportedSignalLanguage,
  filePath: string
): boolean => {
  const path = normalizeSignalPath(filePath)

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
    return isRustTestPath(path)
  }

  if (language === 'ruby') {
    return isRubyTestPath(path)
  }

  return isJavaTestPath(path)
}

// ---------------------------------------------------------------------------
// File-level, second question: which SIDE of the codebase is this file on?

// A directory whose name declares the tree beneath it to be the test half of the
// project. Every supported ecosystem uses one of these and no other: Maven and
// Gradle's `src/test/java`, Cargo's `tests/`, Go's `test/`, pytest's `tests/`,
// RSpec's `spec/`, minitest's `test/`, Jest's `__tests__/`.
//
// The list is of TEST ROOTS, and it is deliberately short. `testing/`, `testutil/`
// and `testdata/` are NOT here: a directory named `testing` is as often a
// production helper library about tests (this repository ships one) as it is a test
// tree, and demoting production code is the costlier mistake — the same asymmetry
// every naming rule above is written under.
//
// Only DIRECTORY segments are considered. A file named `test.ts` is answered by
// its ecosystem's naming rule, not by this one.
const testTreeDirectoryNames = new Set([
  '__tests__',
  'spec',
  'specs',
  'test',
  'tests'
])

/**
 * Whether a path lies inside a test tree, whatever the file itself is named.
 *
 * Path-shaped and language-free: a directory declares its contents test-side for
 * every language at once, and the fixture beside a Java test is on the same side of
 * the codebase as the fixture beside a Go one.
 */
export const isTestTreePath = (filePath: string): boolean => {
  const segments = normalizeSignalPath(filePath).split('/')

  // The last segment is the file name, which this rule has no opinion about.
  return segments
    .slice(0, -1)
    .some((segment) => testTreeDirectoryNames.has(segment))
}

/**
 * Whether a file belongs to the test side of the codebase.
 *
 * This is the question every consumer of the production/test split is actually
 * asking: `impact check` separating production dependents from test dependents, and
 * `conformance check` deciding whose peers are production peers. Neither is asking
 * whether the file holds test cases — a helper under `src/test/java` is not a
 * production dependent of anything, and its siblings are other test helpers.
 *
 * A file is test-side when its own ecosystem calls it a test OR it sits inside a
 * test tree. The first half is unchanged and stays as strict as it was; the second
 * is what a filename affix cannot see.
 */
export const isTestSideFile = (
  language: SupportedSignalLanguage,
  filePath: string
): boolean => {
  const path = normalizeSignalPath(filePath)

  if (!hasLanguageExtension(language, path)) {
    return false
  }

  return isLanguageTestFile(language, path) || isTestTreePath(path)
}

// ---------------------------------------------------------------------------
// Declaration-level: is this declaration built only for the test configuration?
//
// The rule is about a MECHANISM rather than about a language: where a language can
// compile part of a file only under its test configuration, the declarations in
// that part are not the file's production surface. Nothing that reasons about that
// surface — conformance peer sets, changed public symbols — may see them, however
// the file itself is named.
//
// Rust is the only supported language with that mechanism today, so it is the only
// implementation. Another language that grows one adds a branch here rather than a
// second notion of "test" somewhere else.

const rustCommentKinds = new Set(['line_comment', 'block_comment'])

const nodeKind = (node: SgNode): string => String(node.kind())

// Every `identifier` under a node, which is how a `cfg` predicate is read without
// resorting to its text. `#[cfg(feature = "test-utils")]` mentions no `test`
// identifier at all, while a text match on it would see one.
const identifiersUnder = (node: SgNode): readonly string[] => {
  const names: string[] = []
  const stack: SgNode[] = [node]

  while (stack.length > 0) {
    const current = stack.pop()!

    if (nodeKind(current) === 'identifier') {
      names.push(current.text())
    }

    stack.push(...current.children())
  }

  return names
}

// The two markers, both compiler built-ins rather than library macros:
//
//   `#[cfg(test)]` — the item exists ONLY in the test build. Applied to the
//     `mod tests` block, it covers every declaration inside whatever attribute
//     those declarations carry, so `#[tokio::test]`, `#[rstest]` and plain test
//     helpers are all handled without naming any of them. That is why this is the
//     reliable marker and `#[test]` is not.
//   `#[test]` — the item IS a test. Needed only for a test function written
//     outside a `cfg(test)` module; inside one the module already answered.
//
// Third-party attribute macros are deliberately not enumerated. The list has no
// end, and in the place they are actually written — inside a `cfg(test)` module —
// enumerating them would buy nothing. The cost is a `#[tokio::test]` function
// written at a production file's top level, which is not a form Rust code takes.
//
// `cfg(not(test))` is the inverse: the item exists in every build EXCEPT the test
// one, so any `not` in the predicate disqualifies it. Erring towards production is
// the safe direction here, exactly as it is for the file-level rules.
const isRustTestBuildAttribute = (attributeItem: SgNode): boolean => {
  const attribute = attributeItem
    .children()
    .find((child) => nodeKind(child) === 'attribute')

  if (attribute === undefined) {
    return false
  }

  const name = attribute.children()[0]

  if (name === undefined) {
    return false
  }

  const nameText = name.text().trim()

  if (nameText === 'test') {
    return true
  }

  if (nameText !== 'cfg') {
    return false
  }

  const predicate = identifiersUnder(attribute)

  return predicate.includes('test') && !predicate.includes('not')
}

// An attribute is a SIBLING of the item it annotates in this grammar, not a child
// of it, so the item's own attributes are the run of `attribute_item` nodes
// immediately before it. Comments are stepped over: they sit between an attribute
// and its item often enough that stopping at one would silently lose the marker.
const carriesRustTestBuildAttribute = (node: SgNode): boolean => {
  let sibling = node.prev()

  while (sibling !== null && sibling !== undefined) {
    const kind = nodeKind(sibling)

    if (kind === 'attribute_item') {
      if (isRustTestBuildAttribute(sibling)) {
        return true
      }
    } else if (!rustCommentKinds.has(kind)) {
      return false
    }

    sibling = sibling.prev()
  }

  return false
}

// An ancestor walk, the same shape as the Ruby runtime-scope guard in the
// extractor: the marker is on the enclosing `mod`, and every declaration below it
// inherits the answer however deeply it is nested.
const isInsideRustTestBuildScope = (node: SgNode): boolean => {
  let current: SgNode | null | undefined = node

  while (current !== null && current !== undefined) {
    if (carriesRustTestBuildAttribute(current)) {
      return true
    }

    current = current.parent()
  }

  return false
}

/**
 * Whether a declaration node belongs to the test build rather than to the file's
 * production surface.
 *
 * Takes the declaration's own AST node because the answer is positional: the same
 * file holds both, and only the node knows which side of it a declaration is on.
 */
export const isTestOnlyDeclaration = (
  language: SupportedSignalLanguage,
  node: SgNode
): boolean => (language === 'rust' ? isInsideRustTestBuildScope(node) : false)

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
  const testFiles = languageFiles.filter((file) => isLanguageTestFile(language, file.path))
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
    (file) => !isLanguageTestFile(language, file.path)
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

