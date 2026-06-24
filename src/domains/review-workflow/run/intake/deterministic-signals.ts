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

const structuralEngine = 'typescript-compiler+ast-grep' as const
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
  const analysis = extractDeterministicSignals(sourceFiles)
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
