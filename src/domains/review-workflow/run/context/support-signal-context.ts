// What a task's deterministic support signals look like once they are shaped for a
// model rather than for the engine.
//
// Split out of `context.ts` because all three functions answer the same question —
// which of the extractor's facts are worth model bytes, and in what shape — and
// none of them needs anything else assembly holds. The internal
// `SupportSignalFact` stream is untouched by every one of them: this shapes what
// the model is shown, never what the engine reasons over.

import type { CodeReviewerConfig } from '../../../../shared/contracts/index.js'
import { utf8ByteLength } from '../../../../shared/text/utf8-bytes.js'
import type {
  SupportSignalFact,
  SupportSignalTestMapping
} from '../../../deterministic-signals/index.js'
import type { ContextInput } from './workflow-task.js'

// What a MODEL can use out of a deterministic fact, which is not the same thing
// as what the engine stores in one.
//
// `id` and `contentHash` are internal bookkeeping: no prompt refers to a fact id
// (the refuter cites evidence ids, which are a different namespace), and the
// content hash is the file's, so every fact for one file repeats the same
// 64-character hex string. Serializing the raw record put both in front of the
// model, and measurement over the 37-case corpus priced them: the facts document
// was 26.0% of ALL model input bytes, and inside it `contentHash` was 25.6% and
// `id` 8.7% — 3,244 facts carrying just 44 distinct hashes, or 8.9% of every
// byte this engine sends, in opaque hex that tokenizes at roughly one token per
// two characters. Projecting here rather than narrowing `SupportSignalFact`
// keeps the internal record intact for clustering, evidence and change-impact,
// which all need the id.
const modelFacingSupportSignalFact = (
  fact: SupportSignalFact,
  isPublic: boolean
) => ({
  language: fact.language,
  kind: fact.kind,
  path: fact.path,
  name: fact.name,
  ...(fact.moduleSpecifier === undefined
    ? {}
    : { moduleSpecifier: fact.moduleSpecifier }),
  line: fact.line,
  // Visibility as a FLAG on the declaration rather than a second row about it.
  ...(isPublic ? { public: true } : {}),
  summary: fact.summary
})

/**
 * Collapses the `declaration` / `public-symbol` pair the extractors emit for the
 * same symbol into one row carrying `public: true`.
 *
 * Every polyglot adapter reports a public declaration twice, at the identical
 * `(path, name, line)` — once as what it is and once as how visible it is. That
 * is right for the internal fact stream, where change-impact ranks seeds by
 * visibility and needs both kinds to exist. It is pure duplication in the model
 * packet: measured across the 37-case corpus, 893 of 893 `public-symbol` rows
 * duplicated a `declaration` row at the same coordinates and added one bit of
 * information each, for 4.0% of ALL model input.
 *
 * The bit is kept because it is real — whether a caller outside the file can
 * depend on a symbol is exactly the sort of thing a reviewer reasons about — and
 * a row is dropped only when the same symbol is already described at the same
 * line. A `public-symbol` arriving without its declaration is passed through
 * unchanged rather than assumed impossible; nothing here depends on the pairing
 * holding, so a future adapter that emits only one kind cannot silently lose it.
 *
 * The internal `SupportSignalFact` stream is untouched, exactly as with the
 * bookkeeping projection above: this shapes what the model is shown, never what
 * the engine reasons over.
 */
const collapseVisibilityDuplicates = (
  facts: readonly SupportSignalFact[]
): readonly ReturnType<typeof modelFacingSupportSignalFact>[] => {
  // Keyed with `JSON.stringify` rather than a NUL-delimited template.
  // NUL is the ideal separator on paper -- it cannot occur in a path or an
  // identifier -- but embedding it makes this SOURCE FILE binary, and every
  // tool that skips binaries then skips the file in silence: `grep -r` finds
  // no match here, including for this project's own drift checker. That cost
  // real time on 2026-08-03, when a search for a symbol's callers came back
  // empty and the code it lives in was very nearly deleted as unused.
  // `JSON.stringify` is unambiguous for the same reason and stays printable.
  const coordinate = (fact: SupportSignalFact): string =>
    JSON.stringify([fact.path, fact.name, fact.line])
  const publicCoordinates = new Set(
    facts
      .filter((fact) => fact.kind === 'public-symbol')
      .map((fact) => coordinate(fact))
  )
  const declaredCoordinates = new Set(
    facts
      .filter((fact) => fact.kind === 'declaration')
      .map((fact) => coordinate(fact))
  )

  return facts
    .filter(
      (fact) =>
        fact.kind !== 'public-symbol' ||
        !declaredCoordinates.has(coordinate(fact))
    )
    .map((fact) =>
      modelFacingSupportSignalFact(
        fact,
        fact.kind === 'declaration' && publicCoordinates.has(coordinate(fact))
      )
    )
}

export const supportSignalContextsForPaths = (input: {
  // The planner's fact selection for this task, intersected with `pathSet` below.
  readonly factIds: readonly string[]
  readonly pathSet: ReadonlySet<string>
  readonly deterministicSignalMode: CodeReviewerConfig['aiReview']['deterministicSignalMode']
  readonly facts: readonly SupportSignalFact[]
  readonly testMappings: readonly SupportSignalTestMapping[]
}): readonly ContextInput[] => {
  // `deterministicSignalMode: 'disabled'` keeps deterministic facts for free
  // task clustering (already applied by the planner) but does not inject the
  // serialized support-signal facts into the model packet, since that structural
  // summary is largely redundant with the source the model already reads.
  if (input.deterministicSignalMode === 'disabled') {
    return []
  }

  const supportSignalFacts = input.facts.filter(
    (fact) => input.factIds.includes(fact.id) && input.pathSet.has(fact.path)
  )
  const supportSignalTestMappings = input.testMappings.filter(
    (mapping) =>
      input.pathSet.has(mapping.sourcePath) ||
      input.pathSet.has(mapping.testPath)
  )
  const supportSignalContext =
    supportSignalFacts.length === 0 && supportSignalTestMappings.length === 0
      ? ''
      : JSON.stringify({
          facts: collapseVisibilityDuplicates(supportSignalFacts),
          testMappings: supportSignalTestMappings
        })

  return utf8ByteLength(supportSignalContext) === 0
    ? []
    : [
        {
          kind: 'support-signal-output' as const,
          content: supportSignalContext
        }
      ]
}
