// Spec 29. The one question a thorough human reviewer asks on every pull request
// that this engine had no answer for: DOES THIS CHANGE CARRY TESTS?
//
// It is answered here rather than by a model because the material already exists.
// `discoverDeterministicSignalTestMappings` pairs a changed source file with a
// changed test file using each language's own naming and location convention, and
// until now that pairing was handed to the model packet as context and used for
// nothing else. Reading it costs one pass over a list.
//
// THE WHOLE DESIGN IS THE LIMIT OF WHAT IT SEES. The pairing is drawn from the
// changed file set, so the only question this module can answer is "did a test
// file in THIS CHANGE pair with this source file". It cannot answer "is this file
// tested": the test that covers it may have existed for years and had no reason to
// be touched. Every name here says "in this change" for that reason, and every
// renderer of the result says it in words.
//
// Which is why the output is neutral. No severity, no defect, no gate. A count of
// files a naming convention did not pair is a fact about the change; treating it
// as evidence of missing coverage would be a claim the input cannot support.
//
// LANGUAGE-NEUTRAL BY CONSTRUCTION. There is no extension list and no language
// name below. Which files are source, which are test-side and which cannot be
// classified at all are all answered by the deterministic language-support
// registry — the same registry that decides which files can be analysed in the
// first place, so a language added there widens this signal in the same edit.
// `test-adequacy-genericity.test.ts` holds that in place.

import type {
  SkippedFile,
  TestAdequacySignal
} from '../../../shared/contracts/index.js'
import type {
  SupportSignalFile,
  SupportSignalTestMapping
} from '../shared/deterministic-signal-types.js'
import { normalizeSignalPath } from '../shared/deterministic-signal-utils.js'
import { supportedSignalLanguageForPath } from '../shared/signal-language-router.js'
import { isTestSideFile } from '../shared/test-discovery.js'

export type TestAdequacySignalInput = {
  // Exactly the files the registry analysed, and therefore exactly the files the
  // mappings were computed over. Passing a wider set would produce a source file
  // whose test could not have been discovered even if the change contained it.
  readonly analyzedFiles: readonly SupportSignalFile[]
  // Everything the change touched that never reached the registry. Read only to
  // separate "removed" from "never looked at" — see below.
  readonly skippedFiles: readonly SkippedFile[]
  readonly testMappings: readonly SupportSignalTestMapping[]
}

// A source file is paired when some test file OTHER THAN ITSELF maps to it.
//
// Asking it this way rather than by mapping relation is deliberate: the registry
// emits a `direct` mapping from every test file to itself, and a rule written
// against the relation names would have to be revisited every time a relation is
// added. "A different file's test names this one" is the property that matters and
// it survives new relations.
const pairedSourcePaths = (
  testMappings: readonly SupportSignalTestMapping[]
): ReadonlySet<string> =>
  new Set(
    testMappings
      .filter((mapping) => mapping.sourcePath !== mapping.testPath)
      .map((mapping) => normalizeSignalPath(mapping.sourcePath))
  )

/**
 * Which of the change's source files have no test file paired with them in the
 * same change.
 *
 * Never a finding and never a judgement. Read the result together with the
 * disclosure every renderer prints beside it: an unchanged test may already cover
 * any path this reports.
 */
export const computeTestAdequacySignal = (
  input: TestAdequacySignalInput
): TestAdequacySignal => {
  const paired = pairedSourcePaths(input.testMappings)
  const unpairedPaths: string[] = []
  let consideredFileCount = 0
  let pairedFileCount = 0
  let changedTestFileCount = 0
  let unsupportedLanguageFileCount = 0

  for (const file of input.analyzedFiles) {
    const path = normalizeSignalPath(file.path)
    const language = supportedSignalLanguageForPath(path)

    if (language === undefined) {
      // No adapter claims this file, so nothing can be parsed out of it and no
      // test could have been paired to it. UNKNOWN, not untested. This is the
      // branch that keeps a documentation-only change silent instead of reporting
      // every prose file as missing a test.
      unsupportedLanguageFileCount += 1
      continue
    }

    if (isTestSideFile(language, path)) {
      // Test material does not need a test of its own, and a change made entirely
      // of tests must not be reported as a change that carries none.
      changedTestFileCount += 1
      continue
    }

    consideredFileCount += 1

    if (paired.has(path)) {
      pairedFileCount += 1
      continue
    }

    unpairedPaths.push(path)
  }

  // A file the change REMOVES has nothing at head that could carry a test, so it
  // is dropped outright rather than counted as unknown. Everything else that never
  // reached the registry is unknown: the pairing was computed without it, so its
  // absence from the mappings says nothing about whether a test exists.
  const notAnalysedFileCount = input.skippedFiles.filter(
    (skipped) => skipped.reason !== 'deleted'
  ).length

  return {
    consideredFileCount,
    pairedFileCount,
    // Sorted so the same change always produces the same report, whatever order
    // intake happened to read the files in.
    unpairedPaths: [...unpairedPaths].sort((left, right) =>
      left.localeCompare(right)
    ),
    changedTestFileCount,
    unknown: {
      unsupportedLanguageFileCount,
      notAnalysedFileCount
    }
  }
}
