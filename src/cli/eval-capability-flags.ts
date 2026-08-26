// The CLI's half of eval provenance: reading the effective optional-capability
// toggles off the merged configuration so an archived report can NAME what was
// enabled. The evaluation domain owns the report's shape but deliberately does
// not import the configuration domain, so — exactly like
// `resolveEvalRegressionGateThresholds` beside this file — the translation from
// config to domain input lives with the command that resolves the config.
import type { EvalReportCapabilityFlags } from '../domains/evaluation/index.js'
import type { CodeReviewerConfig } from '../shared/contracts/index.js'

// Written out flag by flag rather than derived by walking the config object.
// TypeScript then checks this against `EvalReportCapabilityFlags`, so a key
// added to the provenance contract and forgotten here fails to compile, and a
// key spelled wrong fails too. A generic walk would satisfy the type with
// whatever it happened to find and could silently record a different flag under
// a familiar name.
//
// The remaining hole — a capability added to the CONFIG schema that reaches
// neither this function nor the contract — is what `eval-capability-flags.test.ts`
// closes, because no type can see it.
export const evalReportCapabilityFlags = (
  config: CodeReviewerConfig
): EvalReportCapabilityFlags => ({
  'review.crossFileRetrieval.enabled': config.review.crossFileRetrieval.enabled,
  'review.signalFacts.enabled': config.review.signalFacts.enabled,
  'review.citations.enabled': config.review.citations.enabled,
  'skills.enabled': config.skills.enabled,
  'baseline.enabled': config.baseline.enabled,
  'aiReview.enabled': config.aiReview.enabled,
  'contextSources.enabled': config.contextSources.enabled,
  'verification.enabled': config.verification.enabled,
  'changeImpact.enabled': config.changeImpact.enabled,
  'changeImpact.adjudication.enabled': config.changeImpact.adjudication.enabled,
  'intentFulfilment.enabled': config.intentFulfilment.enabled,
  'fix.enabled': config.fix.enabled,
  'security.dedicatedPass.enabled': config.security.dedicatedPass.enabled,
  'security.signals.enabled': config.security.signals.enabled,
  'reporting.reviewComments.enabled': config.reporting.reviewComments.enabled,
  'drift.enabled': config.drift.enabled,
  'observability.openTelemetry.enabled':
    config.observability.openTelemetry.enabled,
  'reviewConversation.enabled': config.reviewConversation.enabled
})
