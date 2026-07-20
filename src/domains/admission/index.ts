export {
  admitCandidate,
  CandidateFindingSchema,
  type AdmissionPolicy,
  type AdmissionResult,
  type AnchorTextResolver,
  type CandidateFinding,
  type ReviewedDiffRange,
  type ReviewedLineRange,
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
  type BaselineFingerprintRecord,
  type BaselineMatchResult
} from './baseline-matcher.js'
export {
  evaluateQualityGate,
  type QualityGateThresholds
} from './quality-gate.js'
