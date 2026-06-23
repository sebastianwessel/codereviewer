import { type EvidenceRecord } from '../../shared/contracts/index.js'

export type ProofEvidenceSignals = {
  readonly staticAnalysisDuplicate: boolean
  readonly deterministicContradiction: boolean
}

const normalizedEvidenceText = (record: EvidenceRecord): string =>
  [record.kind, record.source, record.ruleId ?? '', record.summary]
    .join(' ')
    .toLowerCase()

const hasStaticAnalysisDuplicateEvidence = (
  evidence: readonly EvidenceRecord[]
): boolean =>
  evidence.some((record) => {
    const text = normalizedEvidenceText(record)

    return (
      text.includes('static-analysis-duplicate') ||
      text.includes('codeql') ||
      text.includes('linter') ||
      text.includes('formatter') ||
      text.includes('build-test-duplicate') ||
      text.includes('unit-test-duplicate')
    )
  })

const hasDeterministicContradictionEvidence = (
  evidence: readonly EvidenceRecord[]
): boolean =>
  evidence.some((record) => {
    const text = normalizedEvidenceText(record)

    return (
      text.includes('deterministic-contradiction') ||
      text.includes('contradiction')
    )
  })

export const proofEvidenceSignalsFor = (
  evidence: readonly EvidenceRecord[]
): ProofEvidenceSignals => ({
  staticAnalysisDuplicate: hasStaticAnalysisDuplicateEvidence(evidence),
  deterministicContradiction: hasDeterministicContradictionEvidence(evidence)
})
