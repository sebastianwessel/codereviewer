export {
  admitCandidate,
  CandidateFindingSchema,
  type AdmissionPolicy,
  type AnchorTextResolver,
  type CandidateFinding,
  type ReviewedDiffRange,
  type ReviewedLineRange,
  type TaskSourceChunkRange,
  reviewedLineRangeForContent,
  sourceLineCount
} from './admission-gate.js'
export {
  anchorSourceFilesFromChunks,
  createSourceAnchorResolver,
  type AnchorSourceFile
} from './source-anchor.js'
export {
  matchBaselineFindings,
  resolveBaselineFingerprints,
  type BaselineFingerprintRecord
} from './baseline-matcher.js'
export {
  BaselineFileSchema,
  buildBaselineEntries,
  renderBaselineJson,
  type BaselineEntry
} from './baseline-writer.js'
export {
  evaluateQualityGate,
  isUnrecoveredProviderIssue,
  QualityGateThresholdsSchema,
  type QualityGateThresholds
} from './quality-gate.js'
