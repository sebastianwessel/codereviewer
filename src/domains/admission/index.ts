export {
  admitCandidate,
  CandidateFindingSchema,
  type AdmissionPolicy,
  type AdmissionResult,
  type CandidateFinding
} from './admission-gate.js'
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

