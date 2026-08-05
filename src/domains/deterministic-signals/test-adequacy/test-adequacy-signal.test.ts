// Spec 29's verification matrix. Every exclusion below is a case where a naive
// implementation would report a file as carrying no test, and each is asserted
// rather than assumed.
//
// The mappings are produced by the real registry rather than written by hand,
// because the property under test is that this signal reads the SAME pairing the
// engine already computes. A hand-written mapping would let the two drift apart
// and still pass.

import { describe, expect, test } from 'vitest'
import { discoverDeterministicSignalTestMappings } from '../deterministic-signal-registry.js'
import type { SupportSignalFile } from '../shared/deterministic-signal-types.js'
import { computeTestAdequacySignal } from './test-adequacy-signal.js'

const signalFor = (
  paths: readonly string[],
  skippedFiles: Parameters<typeof computeTestAdequacySignal>[0]['skippedFiles'] = []
) => {
  const analyzedFiles: readonly SupportSignalFile[] = paths.map((path) => ({
    path
  }))

  return computeTestAdequacySignal({
    analyzedFiles,
    skippedFiles,
    testMappings: discoverDeterministicSignalTestMappings(analyzedFiles)
  })
}

describe('test adequacy signal', () => {
  test('reports a changed source file with no test file in the same change', () => {
    const signal = signalFor(['src/alpha.ts'])

    expect(signal.consideredFileCount).toBe(1)
    expect(signal.pairedFileCount).toBe(0)
    expect(signal.unpairedPaths).toEqual(['src/alpha.ts'])
    expect(signal.changedTestFileCount).toBe(0)
  })

  test('does not report a source file whose test file is in the same change', () => {
    const signal = signalFor(['src/alpha.ts', 'src/alpha.test.ts'])

    expect(signal.consideredFileCount).toBe(1)
    expect(signal.pairedFileCount).toBe(1)
    expect(signal.unpairedPaths).toEqual([])
    expect(signal.changedTestFileCount).toBe(1)
  })

  // The pairing is per language and comes from the registry, so the signal must
  // pair a file in any supported language without naming one.
  test('pairs by each language own convention, not by one language convention', () => {
    const signal = signalFor([
      'pkg/alpha.go',
      'pkg/alpha_test.go',
      'app/beta.py',
      'app/test_beta.py',
      'lib/gamma.rb',
      'lib/gamma_spec.rb'
    ])

    expect(signal.consideredFileCount).toBe(3)
    expect(signal.pairedFileCount).toBe(3)
    expect(signal.unpairedPaths).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // The deliberate exclusions. Each one is a case the signal must stay silent on.

  test('does not fire for a change with no source files at all', () => {
    const signal = signalFor(['docs/guide.md', 'README.md', 'package.json'])

    expect(signal.consideredFileCount).toBe(0)
    expect(signal.unpairedPaths).toEqual([])
    expect(signal.unknown.unsupportedLanguageFileCount).toBe(3)
  })

  test('does not fire for a test-only change', () => {
    const signal = signalFor([
      'src/alpha.test.ts',
      'tests/test_beta.py',
      'pkg/gamma_test.go'
    ])

    expect(signal.consideredFileCount).toBe(0)
    expect(signal.unpairedPaths).toEqual([])
    expect(signal.changedTestFileCount).toBe(3)
  })

  // A helper inside a test tree holds no test case of its own and is still not
  // production code. It must not be reported as a source file needing one.
  test('does not report a test-side helper that holds no test case', () => {
    const signal = signalFor(['test/helpers.go', 'src/test/java/Support.java'])

    expect(signal.consideredFileCount).toBe(0)
    expect(signal.unpairedPaths).toEqual([])
    expect(signal.changedTestFileCount).toBe(2)
  })

  test('does not report a file the change deleted', () => {
    const signal = signalFor(
      ['src/alpha.ts', 'src/alpha.test.ts'],
      [{ path: 'src/removed.ts', reason: 'deleted' }]
    )

    expect(signal.unpairedPaths).toEqual([])
    // A removed path has nothing at head to carry a test, so it is dropped
    // outright rather than counted among the files nothing is known about.
    expect(signal.unknown.notAnalysedFileCount).toBe(0)
  })

  test('reports a file in an unsupported language as unknown, never as untested', () => {
    const signal = signalFor(['src/alpha.ts', 'src/legacy.cbl', 'infra/main.tf'])

    expect(signal.unpairedPaths).toEqual(['src/alpha.ts'])
    expect(signal.unknown.unsupportedLanguageFileCount).toBe(2)
    expect(signal.consideredFileCount).toBe(1)
  })

  // The pairing is computed over the files that were analysed. A file that never
  // reached the registry has no answer, and answering "no test" for it would be
  // the optimistic-default failure this contract is written against.
  test('reports a changed file that never reached the registry as unknown', () => {
    const signal = signalFor(
      ['src/alpha.ts'],
      [
        { path: 'src/huge.ts', reason: 'too-large' },
        { path: 'assets/logo.png', reason: 'binary' },
        { path: 'dist/bundle.js', reason: 'excluded' }
      ]
    )

    expect(signal.unpairedPaths).toEqual(['src/alpha.ts'])
    expect(signal.unknown.notAnalysedFileCount).toBe(3)
    expect(signal.consideredFileCount).toBe(1)
  })

  // ---------------------------------------------------------------------------

  test('orders the unpaired paths so the same change always reports the same list', () => {
    const forward = signalFor(['src/c.ts', 'src/a.ts', 'src/b.ts'])
    const reversed = signalFor(['src/b.ts', 'src/a.ts', 'src/c.ts'])

    expect(forward.unpairedPaths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
    expect(reversed.unpairedPaths).toEqual(forward.unpairedPaths)
  })

  test('normalizes a Windows-style path before pairing and before reporting', () => {
    const signal = signalFor(['src\\alpha.ts', 'src\\alpha.test.ts', 'src\\beta.ts'])

    expect(signal.unpairedPaths).toEqual(['src/beta.ts'])
    expect(signal.pairedFileCount).toBe(1)
  })

  // The registry emits a `direct` mapping from every test file to ITSELF. Reading
  // that as a pairing would make every test file look like a covered source file,
  // and would make the counts disagree with the list.
  test('a test file does not pair with itself into the considered set', () => {
    const signal = signalFor(['src/alpha.test.ts'])

    expect(signal.consideredFileCount).toBe(0)
    expect(signal.pairedFileCount).toBe(0)
  })
})
