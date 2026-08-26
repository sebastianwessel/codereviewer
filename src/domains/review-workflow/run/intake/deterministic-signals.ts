import {
  EvidenceRecordSchema,
  type EvidenceRecord
} from '../../../../shared/contracts/index.js'
import {
  assertDeterministicSignalEvidenceOwnsPath,
  assertSupportSignalFactOwnsPath,
  astGrepVersion,
  discoverDeterministicSignalTestMappings,
  extractDeterministicSignals,
  type DeterministicSignalExtraction,
  type SupportSignalSourceFile,
  type SupportSignalTestMapping
} from '../../../deterministic-signals/index.js'

// Written into `observability.json` on every run, so it has to name the engine
// that actually ran. It said `typescript-compiler+ast-grep` after the TypeScript
// extractor was deleted and ast-grep became the single engine for all supported
// languages -- provenance describing a component that no longer exists.
const structuralEngine = 'ast-grep' as const
const astGrepVersionAttribute = `ast-grep@${astGrepVersion}`

export type DeterministicSignalStepStartAttributes = {
  readonly structuralEngine: typeof structuralEngine
  readonly astGrepVersion: string
  readonly fileCount: number
}

export type DeterministicSignalStepMetrics = {
  readonly factCount: number
  readonly evidenceCount: number
  readonly languageCount: number
  readonly testMappingCount: number
  readonly structuralEngine: typeof structuralEngine
  readonly astGrepVersion: string
}

export type ReviewRunnerDeterministicSignalState = {
  readonly analysis: DeterministicSignalExtraction
  readonly evidence: readonly EvidenceRecord[]
  readonly testMappings: readonly SupportSignalTestMapping[]
  readonly startAttributes: DeterministicSignalStepStartAttributes
  readonly metrics: DeterministicSignalStepMetrics
}

export const deterministicSignalStepStartAttributes = (
  sourceFiles: readonly SupportSignalSourceFile[]
): DeterministicSignalStepStartAttributes => ({
  structuralEngine,
  astGrepVersion: astGrepVersionAttribute,
  fileCount: sourceFiles.length
})

export const prepareReviewRunnerDeterministicSignals = (
  sourceFiles: readonly SupportSignalSourceFile[]
): ReviewRunnerDeterministicSignalState => {
  const extracted = extractDeterministicSignals(sourceFiles)
  // STAGE 1 DOES NOT RECEIVE ECMASCRIPT DECLARATION FACTS, and this exclusion is
  // held in place by a measurement rather than an opinion.
  //
  // `9cc4fa6` gave TypeScript and JavaScript the `declaration`/`public-symbol`
  // facts the other five languages already emitted, because without them
  // `impact check` could not seed a blast radius on this project's primary
  // languages at all (a 646-line file offered three facts, all on its last line).
  // That fixed stage 3 — out-of-diff coverage 66.7% → 74.1% — and regressed
  // stage 1 on the same corpus, against a baseline pinned to the same dependency
  // digest:
  //
  //     in-diff recall      68.3% → 58.3%   (−10.0pp, past the ±4.8pp band)
  //     adjusted precision  100%  → 94.6%
  //     input tokens        1 145 250 → 1 192 875
  //
  // The packet is where it landed: stage 1's input already dominates output 23:1,
  // and 47 625 extra tokens of declaration facts bought it nothing it did not
  // already read in the file content it is shown in full.
  //
  // Stages 3 and 4 call the extractor directly and are unaffected, so both results
  // are kept. This is scoped to ECMAScript deliberately: the other five languages
  // have always fed these facts to stage 1 and their numbers were measured WITH
  // them, so removing theirs would be an unmeasured change dressed as consistency.
  // If a later run shows stage 1 is indifferent to declaration facts generally,
  // the honest simplification is to drop them for every language, not to add
  // ECMAScript's back.
  const analysis = {
    ...extracted,
    facts: extracted.facts.filter(
      (fact) =>
        !(
          (fact.language === 'typescript' || fact.language === 'javascript') &&
          (fact.kind === 'declaration' || fact.kind === 'public-symbol')
        )
    )
  }
  const testMappings = discoverDeterministicSignalTestMappings(sourceFiles)

  for (const fact of analysis.facts) {
    assertSupportSignalFactOwnsPath(fact)
  }

  const evidence = analysis.evidence.map((record) =>
    EvidenceRecordSchema.parse(record)
  )

  for (const record of evidence) {
    assertDeterministicSignalEvidenceOwnsPath(record)
  }

  return {
    analysis,
    evidence,
    testMappings,
    startAttributes: deterministicSignalStepStartAttributes(sourceFiles),
    metrics: {
      factCount: analysis.facts.length,
      evidenceCount: evidence.length,
      languageCount: new Set(analysis.facts.map((fact) => fact.language)).size,
      testMappingCount: testMappings.length,
      structuralEngine,
      astGrepVersion: astGrepVersionAttribute
    }
  }
}
