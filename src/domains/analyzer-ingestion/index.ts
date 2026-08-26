// Public entry point for analyzer-artifact ingestion (spec 15, Mechanism 2).
//
// Consumers see canonical alerts, evidence records, per-artifact metrics, and the
// rendered packet section. The SARIF reader, the schema, and the path resolver stay
// private: a second artifact format must be addable without any consumer changing.

export {
  ingestAnalyzerArtifacts,
  createAnalyzerPathResolver
} from './ingest.js'
export {
  analyzerSignalsFraming,
  renderAnalyzerSignalsSection
} from './analyzer-section.js'
export {
  analyzerEvidenceFor,
  analyzerEvidenceForAlerts
} from './analyzer-evidence.js'
export {
  attributeAlertsToChange,
  indexChangedRanges,
  rankAttributedAlerts,
  type ChangedLineRange
} from './changed-side-attribution.js'
export {
  ANALYZER_MESSAGE_MAX,
  AnalyzerAlertSchema,
  AnalyzerArtifactMetricSchema,
  AttributedAnalyzerAlertSchema,
  type AnalyzerAlert,
  type AnalyzerArtifactMetric,
  type AnalyzerIdentity,
  type AttributedAnalyzerAlert
} from './contracts.js'
