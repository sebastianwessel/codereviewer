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
