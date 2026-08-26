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
// "Test" asks `isTestSideFile`, which is the question this bucket is for: not "does
// this file hold test cases" but "is this a production dependent". A Go `_test.go`,
// a Python `test_*.py` and a Vitest `*.test.ts` are recognised by the rules their
// own ecosystems use; a fixture or a shared helper inside a test tree —
// `test/helpers.go`, `src/test/java/…/Support.java` — carries no test of its own and
// is recognised by its location. Both are test-side, and the previous rule saw only
// the first: everything under Maven's and Gradle's entire test source set read as a
// PRODUCTION dependent, which is the inversion this bucket exists to prevent.

import {
  isTestSideFile,
  supportedSignalLanguageForPath
} from '../deterministic-signals/index.js'

// THREE BUCKETS, AND A THIRD FILE-LEVEL CLASSIFICATION WAS MEASURED AND REJECTED.
//
// A residual finding from the withdrawn conformance stage observed that 216 of its
// 647 divergences sat in auxiliary trees — `playground/`, `benches/`, `examples/`,
// `benchmarks/`, `scripts/`, `docs/` — and asked whether the engine needed a
// "production surface" classification distinct from both "is a test" and "is
// test-side".
//
// It does not, on two counts.
//
// The evidence was about a capability that no longer exists. Those 216 were
// CONFORMANCE divergences, and there the auxiliary trees were genuinely noise: a
// benchmark's siblings are other benchmarks, so "7 of 12 siblings call `black_box`"
// is harness vocabulary wearing the shape of a convention. Conformance is
// withdrawn, and reusing its numbers to justify a rule in a different stage would
// be reasoning about the wrong thing.
//
// Measured here instead, over all 37 hydrated slices: 26 of 430 production-bucket
// reference sites (6.0%) sit in an auxiliary tree, concentrated in TWO cases —
// `tokio-util`'s `benches/copy.rs` and `werkzeug`'s `examples/coolmagic/`. Three of
// the five candidate trees (`playground`, `benchmarks`, `scripts`) produced no
// references at all, and `docs/` never reaches this bucket because markdown has no
// language adapter and is already `non-source`.
//
// And unlike a conformance peer, an auxiliary-tree reference is a REAL DEPENDENT.
// A werkzeug example that calls a changed function breaks when its contract moves;
// listing it under production is correct, not misleading. The test bucket exists
// because a broken test surfaces in CI while a broken caller surfaces in
// production — a genuine difference in where the failure lands. No such difference
// separates an example from a library caller: both break at the same moment, for
// the same reason.
//
// A priority ordering within the production bucket might still be worth having one
// day. That is a presentation question for the renderer, not a fourth destination
// kind, and 6% concentrated in two repositories does not justify either yet.
export type ReferenceDestinationKind = 'source' | 'test' | 'non-source'

/**
 * Classifies a repository-relative reference-site path.
 *
 * Path-only, and that is now the whole of the file-level convention rather than a
 * degraded form of it: no language decides testhood from content any more. What a
 * path cannot express — a reference landing inside an inline `#[cfg(test)] mod`
 * in an otherwise production Rust file — is still bucketed as `source`. That errs
 * in the safe direction, as it always did: a misclassified test is a real
 * dependent listed in the wrong bucket, while erring the other way would demote a
 * production caller out of the reader's sight.
 */
export const classifyReferenceDestination = (
  referencePath: string
): ReferenceDestinationKind => {
  const language = supportedSignalLanguageForPath(referencePath)

  if (language === undefined) {
    return 'non-source'
  }

  return isTestSideFile(language, referencePath) ? 'test' : 'source'
}
