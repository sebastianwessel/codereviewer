import { describe, expect, test } from 'vitest'
import {
  supportedSignalLanguageDefinitions
} from '../deterministic-signals/index.js'
import { classifyReferenceDestination } from './reference-destination.js'

describe('reference destination classification', () => {
  test('a file no language adapter claims is not a dependent destination', () => {
    for (const path of [
      'docs/06-reference/cli.md',
      'specs/22-change-impact-review.md',
      'eval/fixtures/slices/case/slice.json',
      'src/domains/evaluation/__snapshots__/report.snap',
      'README',
      'assets/logo.svg'
    ]) {
      expect(classifyReferenceDestination(path)).toBe('non-source')
    }
  })

  test('the source set is the language-adapter registry, not a list owned here', () => {
    // Every extension any adapter claims classifies as source (or test), and the
    // assertion is generated from the registry so adding an adapter cannot leave
    // this module behind.
    for (const definition of supportedSignalLanguageDefinitions) {
      for (const extension of definition.extensions) {
        expect(
          classifyReferenceDestination(`src/module${extension}`)
        ).not.toBe('non-source')
      }
    }

    expect(supportedSignalLanguageDefinitions.length).toBeGreaterThan(1)
  })

  test('recognises each language ecosystem’s own test convention', () => {
    for (const path of [
      'src/domains/change-impact/impact-run.test.ts',
      'src/app.spec.js',
      'pkg/store_test.go',
      'app/tests/test_store.py',
      'app/store_test.py',
      'src/lib_test.rs',
      'src/test/java/com/example/StoreTest.java'
    ]) {
      expect(classifyReferenceDestination(path)).toBe('test')
    }
  })

  test('a production file whose name merely mentions testing stays source', () => {
    // The bucket must not swallow production code: `testing.ts` is a helper
    // module, not a test, and demoting it would hide a real dependent.
    for (const path of [
      'src/shared/testing/scripted-provider.ts',
      'src/latest.ts',
      'src/contest.ts'
    ]) {
      expect(classifyReferenceDestination(path)).toBe('source')
    }
  })

  test('classifies portable paths regardless of separator or casing', () => {
    expect(classifyReferenceDestination('src\\domains\\store.TS')).toBe('source')
    expect(classifyReferenceDestination('./src/store.ts')).toBe('source')
    expect(classifyReferenceDestination('DOCS\\GUIDE.MD')).toBe('non-source')
  })
})

describe('ruby test destinations', () => {
  // Ruby had NO test predicate: `.rb` fell through to the JUnit rules, which never
  // match a Ruby filename, so every reference from a Ruby test was reported as a
  // PRODUCTION dependent. On Rack that put all 22 sites in `test/spec_request.rb`
  // under "Dependents" while the test count read 0 — the production/test split is
  // the sharpest distinction the impact report draws, and it was inverted for a
  // whole language.
  test.each([
    'test/spec_request.rb',
    'spec/request_spec.rb',
    'test/request_test.rb',
    'test/test_request.rb'
  ])('%s is a test destination', (path) => {
    expect(classifyReferenceDestination(path)).toBe('test')
  })

  test.each(['lib/rack/request.rb', 'lib/rack/spec_helper_shim.rb'])(
    '%s is production',
    (path) => {
      // A `spec`/`test` substring inside a library filename is not a convention,
      // and demoting a production caller to the test bucket is the costlier error.
      expect(classifyReferenceDestination(path)).toBe('source')
    }
  )
})

describe('rust test destinations', () => {
  // Rust's file-level conventions, and only those. The language's other and more
  // common form — an inline `#[cfg(test)] mod tests` — belongs to a file that IS
  // production code, so no amount of content may rename it: `axum-extra/src/response/`
  // ships four of them beside their production surface.
  //
  // This classifier never had the content to get that wrong, having always been
  // path-only, so these cases pin a contract rather than record a repair. They are
  // here because the contract is now the whole of the file-level rule instead of a
  // documented degradation of it.
  test.each(['src/lib_test.rs', 'tests/integration.rs'])(
    '%s is a test destination',
    (path) => {
      expect(classifyReferenceDestination(path)).toBe('test')
    }
  )

  test.each([
    'axum-extra/src/response/attachment.rs',
    'tests/common/mod.rs',
    'tests/common.rs'
  ])('%s is production', (path) => {
    // The last two are the shared helpers of an integration-test crate: they carry
    // no test of their own, and a bare directory rule would sweep them in.
    expect(classifyReferenceDestination(path)).toBe('source')
  })
})

describe('python whole-module test naming', () => {
  // The affix forms (`test_x.py`, `x_test.py`) put the subject in the filename. A
  // module whose entire stem is `test`/`tests` puts it in the package: it is the
  // test module OF its package, with nothing left in the name to affix to. It was
  // read as production, which on a large test module misfiled every reference in
  // it at once.
  test.each([
    'tests.py',
    'tests/admin_scripts/tests.py',
    'app/accounts/test.py'
  ])('%s is a test destination', (path) => {
    expect(classifyReferenceDestination(path)).toBe('test')
  })

  test.each([
    'src/testing.py',
    'src/testutils.py',
    'src/testdata.py',
    'src/latest.py'
  ])('%s is production', (path) => {
    // The stem is matched exactly, not as a prefix: these are production helpers
    // about tests, and a `test*` prefix rule would swallow them.
    expect(classifyReferenceDestination(path)).toBe('source')
  })
})
