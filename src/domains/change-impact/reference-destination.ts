// What kind of file a reference site landed in.
//
// This is the policy spec 22 added after its first deterministic run: only about
// two thirds of reference sites were source, and the rest were prose, fixture
// data and snapshots that happen to contain the identifier. Identifier-boundary
// matching removed substring noise; it cannot tell code from prose. A reader who
// has to filter the list by hand gains nothing over the `grep` this capability
// must beat, so the filtering happens here.
//
// "Source" is deliberately NOT an extension allowlist owned by this module. It is
// exactly the set of files a `deterministic-signals` language adapter claims —
// the same registry that decides which files can seed a changed symbol in the
// first place. Two consequences follow, both wanted: a destination no adapter can
// parse could never have produced a seed either, so the two ends of the lookup
// agree by construction; and adding a language adapter widens both ends at once,
// with no list here to rot. Spec 15's Non-Negotiable forbids the alternative.
//
// "Test" reuses the adapter-owned test-file convention (`discoverSignalLanguageTests`
// uses the same predicate), so a Go `_test.go`, a Python `test_*.py` and a Vitest
// `*.test.ts` are recognised by the rules their own ecosystems use rather than by
// a guess made here.

import {
  isLanguageTestFile,
  supportedSignalLanguageForPath
} from '../deterministic-signals/index.js'

export type ReferenceDestinationKind = 'source' | 'test' | 'non-source'

/**
 * Classifies a repository-relative reference-site path.
 *
 * Path-only: a reference site carries the matched line, never the destination's
 * full content, so a content-sensitive test convention (a Rust file that is a
 * test only because it declares `#[test]`) degrades to that language's path
 * convention. That errs towards `source`, which is the safe direction: a
 * misclassified test is still a real dependent and still listed, only in the
 * wrong bucket, whereas erring towards `test` would demote a production caller.
 */
export const classifyReferenceDestination = (
  referencePath: string
): ReferenceDestinationKind => {
  const language = supportedSignalLanguageForPath(referencePath)

  if (language === undefined) {
    return 'non-source'
  }

  return isLanguageTestFile(language, { path: referencePath })
    ? 'test'
    : 'source'
}
