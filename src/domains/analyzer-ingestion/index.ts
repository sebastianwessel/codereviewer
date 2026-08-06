// Public entry point for analyzer-artifact ingestion (spec 15, Mechanism 2).
//
// Consumers see canonical alerts, evidence records, per-artifact metrics, and the
// rendered packet section. The SARIF reader, the schema, and the path resolver stay
// private: a second artifact format must be addable without any consumer changing.

export {
  ingestAnalyzerArtifacts,
  createAnalyzerPathResolver,
  type AnalyzerIngestionResult
} from './ingest.js'
export {
  analyzerSignalsFraming,
  analyzerSignalsSectionHeader,
  renderAnalyzerSignalsSection
} from './analyzer-section.js'
export {
  analyzerEvidenceFor,
  analyzerEvidenceForAlerts,
  analyzerEvidenceId
} from './analyzer-evidence.js'
export {
  attributeAlertsToChange,
  indexChangedRanges,
  rankAttributedAlerts,
  type AttributionResult,
  type ChangedLineRange
} from './changed-side-attribution.js'
export {
  ANALYZER_MESSAGE_MAX,
  AnalyzerAlertSchema,
  AnalyzerArtifactMetricSchema,
  AnalyzerArtifactProvenanceSchema,
  AttributedAnalyzerAlertSchema,
  type AnalyzerAlert,
  type AnalyzerArtifactMetric,
  type AnalyzerArtifactProvenance,
  type AnalyzerAttribution,
  type AnalyzerIdentity,
  type AttributedAnalyzerAlert
} from './contracts.js'
export { MAX_ANALYZER_RESULTS_PER_ARTIFACT } from './artifact-reader.js'
