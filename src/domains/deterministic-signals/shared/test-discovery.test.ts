import { describe, expect, test } from 'vitest'
import {
  isLanguageTestFile,
  isTestSideFile,
  isTestTreePath
} from './test-discovery.js'

// TWO QUESTIONS, TWO ANSWERS.
//
// The engine used to ask only "does this file hold test cases", by filename affix,
// and use the answer wherever it needed "is this production code". Everything a
// test tree holds that is not itself a test — fixtures, harnesses, shared assertion
// helpers — therefore read as PRODUCTION, wherever the distinction is drawn: the
// production/test split of the impact report, and the production surface the
// signal extractors report.
//
// The cases below are the measured ones. Every language ships this shape, and
// Maven's and Gradle's entire `src/test/java` source set is it.
describe('the two file-level questions', () => {
  test.each([
    ['java', 'src/test/java/com/example/StoreSupport.java'],
    ['go', 'test/helpers.go'],
    ['rust', 'axum/src/routing/tests/mod.rs'],
    ['python', 'tests/helpers.py'],
    ['typescript', 'test/utils/helper.ts'],
    ['javascript', 'test/logger/logger-test-utils.js'],
    ['ruby', 'test/helper.rb']
  ] as const)(
    '%s: %s holds no test case and is still test-side',
    (language, path) => {
      expect(isLanguageTestFile(language, path)).toBe(false)
      expect(isTestSideFile(language, path)).toBe(true)
    }
  )

  test.each([
    ['typescript', 'src/domains/change-impact/impact-run.test.ts'],
    ['go', 'pkg/store_test.go'],
    ['python', 'app/store_test.py'],
    ['ruby', 'lib/rack/request_test.rb'],
    ['java', 'src/main/java/com/example/StoreTest.java'],
    ['rust', 'src/lib_test.rs']
  ] as const)(
    '%s: %s holds test cases wherever it sits, so both questions say yes',
    (language, path) => {
      expect(isLanguageTestFile(language, path)).toBe(true)
      expect(isTestSideFile(language, path)).toBe(true)
    }
  )

  test.each([
    ['typescript', 'src/shared/testing/scripted-provider.ts'],
    ['python', 'src/testdata.py'],
    ['go', 'internal/testutil/fake.go'],
    ['ruby', 'lib/rack/request.rb'],
    ['rust', 'axum-extra/src/response/attachment.rs'],
    ['java', 'src/main/java/com/example/Store.java']
  ] as const)('%s: %s is production to both questions', (language, path) => {
    // Demoting production code is the costlier mistake, and it is the one a wider
    // location rule would make: a directory named `testing` or `testutil` is as
    // often a production helper library about tests as it is a test tree. Only the
    // roots a test runner discovers by are test trees.
    expect(isLanguageTestFile(language, path)).toBe(false)
    expect(isTestSideFile(language, path)).toBe(false)
  })

  test('a file no adapter claims by extension is neither', () => {
    expect(isTestSideFile('typescript', 'test/fixtures/case.json')).toBe(false)
    expect(isLanguageTestFile('typescript', 'test/fixtures/case.json')).toBe(false)
  })
})

describe('test trees', () => {
  test.each([
    'src/test/java/com/example/Support.java',
    'tests/helpers.py',
    'spec/support/shared.rb',
    'specs/support/shared.rb',
    'src/__tests__/setup.ts',
    'axum/src/routing/tests/mod.rs'
  ])('%s lies inside a test tree', (path) => {
    expect(isTestTreePath(path)).toBe(true)
  })

  test.each([
    'src/store.ts',
    'src/testing/provider.ts',
    'src/testdata/loader.go',
    // Only DIRECTORY segments count: the file's own name is answered by its
    // ecosystem's naming rule, not by this one.
    'src/test.ts',
    'src/spec.rb'
  ])('%s does not', (path) => {
    expect(isTestTreePath(path)).toBe(false)
  })

  test('is decided on normalized paths, whatever separator the caller used', () => {
    expect(isTestTreePath('src\\test\\java\\Support.java')).toBe(true)
    expect(isTestTreePath('./tests/helpers.py')).toBe(true)
  })
})
