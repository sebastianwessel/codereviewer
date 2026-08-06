// Canonical alerts -> `EvidenceRecord`s.
//
// This is what spec 15's Mechanism 2 means by "populating the already-defined but
// unused contract fields": `ruleId`, `cwe`, `helpUri`, `relatedLocations`, ordered
// `dataFlow`, and `securitySeverity` had no producer at all before this. They are
// filled from the artifact and from nowhere else — an absent field in the artifact
// stays absent here.
//
// An evidence record is a RECORD OF AN OBSERVATION, not a finding. Nothing in this
// module produces a candidate, a severity, or an admission input; the records are
// carried in the run's evidence set so a report can show what the review was shown,
// and the model decides what, if anything, is a defect.

import {
  EvidenceRecordSchema,
  type EvidenceRecord
} from '../../shared/contracts/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import type { AttributedAnalyzerAlert } from './contracts.js'

// `EvidenceRecord.summary` is capped at 500; the prefix below is fixed-width enough
// that a cut can only ever fall inside the analyzer's own message.
const EVIDENCE_SUMMARY_MAX = 500

const attributionPhrase: Readonly<
  Record<AttributedAnalyzerAlert['attribution'], string>
> = {
  'changed-line': 'reported on a changed line',
  'changed-flow': 'reported on a path whose steps include a changed line'
}

export const analyzerEvidenceId = (alertId: string): string =>
  `evsec_${sha256(alertId).slice(0, 24)}`

export const analyzerEvidenceFor = (
  attributed: AttributedAnalyzerAlert
): EvidenceRecord => {
  const { alert } = attributed
  const summary =
    `${alert.analyzer.name} rule ${alert.ruleId} ${attributionPhrase[attributed.attribution]} ` +
    `(${attributed.attributedPath}:${attributed.attributedLine}): ${alert.message}`

  return EvidenceRecordSchema.parse({
    id: analyzerEvidenceId(alert.id),
    // The alert IS a third-party diagnostic; the kind says so rather than dressing
    // it as a deterministic signal this engine computed.
    kind: 'diagnostic',
    summary:
      summary.length > EVIDENCE_SUMMARY_MAX
        ? `${summary.slice(0, EVIDENCE_SUMMARY_MAX - 1)}…`
        : summary,
    location: alert.location,
    // Provenance names the producing tool, so a reader of the report can tell which
    // analyzer made a claim without the finding contract learning any tool-specific
    // field.
    source: `analyzer:${alert.analyzer.name}`,
    ...(alert.analyzer.version === undefined
      ? {}
      : { sourceVersion: alert.analyzer.version }),
    // The artifact's own bytes, not the reported source. Provenance for an
    // untrusted input: it names the document that made this claim, so a reader can
    // tell a re-run against a refreshed scan from one against a stale file.
    contentHash: alert.artifact.contentHash,
    rawContentRef: alert.artifact.path,
    // Redaction ran on every text field during normalization, before the message
    // could reach a model or an artifact.
    redactionApplied: true,
    ruleId: alert.ruleId,
    ...(alert.helpUri === undefined ? {} : { helpUri: alert.helpUri }),
    ...(alert.cwe.length === 0 ? {} : { cwe: [...alert.cwe] }),
    ...(alert.securitySeverity === undefined
      ? {}
      : { securitySeverity: alert.securitySeverity }),
    ...(alert.relatedLocations.length === 0
      ? {}
      : { relatedLocations: alert.relatedLocations }),
    ...(alert.dataFlow.length === 0 ? {} : { dataFlow: alert.dataFlow })
  })
}

export const analyzerEvidenceForAlerts = (
  alerts: readonly AttributedAnalyzerAlert[]
): readonly EvidenceRecord[] => alerts.map(analyzerEvidenceFor)
