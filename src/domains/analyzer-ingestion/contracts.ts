// The canonical, tool-neutral model an ingested analyzer artifact is normalized
// into (spec 15, Mechanism 2).
//
// NOTHING TOOL-SPECIFIC MAY REACH A FINDING. An artifact format has its own
// vocabulary — driver objects, rule indices, thread flows, property bags — and none
// of it appears here or in `EvidenceRecord`. A format reader's whole job is to
// produce this shape; everything downstream reads only this shape, so adding a
// second format changes one reader and nothing else.
//
// The model is deliberately language-neutral: an alert is a rule id, a CWE list, a
// severity, a location, and an ordered flow. No field names a language, a
// framework, or an analyzer's internal taxonomy.

import { z } from 'zod'
import {
  CodeLocationSchema,
  DataFlowPathSchema,
  RelatedLocationSchema,
  RepositoryRelativePathSchema
} from '../../shared/contracts/index.js'

// Longest analyzer message text carried into evidence and into the model packet.
// Analyzer messages are untrusted third-party text; a runaway one must be cut at a
// known point rather than sized by whatever produced it.
export const ANALYZER_MESSAGE_MAX = 400

// Why an alert was accepted as belonging to the change under review.
//
// `changed-line` — the alert's own primary location falls on a changed line: the
//   change is the cause the alert names.
// `changed-flow` — a step of the alert's data flow, or one of its related
//   locations, falls on a changed line: the change declares, feeds, or removes a
//   barrier on the path the alert traces, even though the reported sink is older
//   code.
//
// There is no third value, and in particular no "the file was touched somewhere".
// A pre-existing alert in a file whose unrelated lines moved is pre-existing
// repository debt, and reporting it would blame a change for the state it
// inherited.
export const AnalyzerAttributionSchema = z.enum(['changed-line', 'changed-flow'])

export const AnalyzerIdentitySchema = z.strictObject({
  // The producing tool, as the artifact names it. Free text: it identifies a
  // producer for provenance, and is never matched against a known-tool list.
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(80).optional(),
  informationUri: z.url().optional()
})

// Where an alert came from. Untrusted input needs provenance a reader can check:
// which file made the claim, and whether that file is the one a previous run read.
export const AnalyzerArtifactProvenanceSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/)
})

// One normalized analyzer alert.
export const AnalyzerAlertSchema = z.strictObject({
  // Content-derived and stable: the same artifact ingested twice yields the same
  // ids, so evidence ids do not churn between runs.
  id: z.string().regex(/^alert_[a-f0-9]{24}$/),
  artifact: AnalyzerArtifactProvenanceSchema,
  analyzer: AnalyzerIdentitySchema,
  ruleId: z.string().min(1).max(200),
  ruleName: z.string().min(1).max(200).optional(),
  helpUri: z.url().optional(),
  cwe: z.array(z.string().regex(/^CWE-[0-9]+$/)),
  // The producer's own severity band, normalized to a closed set. `none` is kept
  // rather than dropped: an alert a tool downgraded to informational is still an
  // observation, and silently discarding it would make the ingested set differ
  // from the artifact with nothing saying so.
  level: z.enum(['error', 'warning', 'note', 'none']),
  // The producer's 0-10 security severity where it supplies one. Never invented:
  // an artifact without it yields an alert without it.
  securitySeverity: z.number().min(0).max(10).optional(),
  message: z.string().min(1).max(ANALYZER_MESSAGE_MAX),
  location: CodeLocationSchema,
  relatedLocations: z.array(RelatedLocationSchema),
  // Ordered source -> barrier -> sink steps, when the producer supplies them.
  dataFlow: z.array(DataFlowPathSchema)
})

export const AttributedAnalyzerAlertSchema = z.strictObject({
  alert: AnalyzerAlertSchema,
  attribution: AnalyzerAttributionSchema,
  // The changed location that carried the attribution, so a reader can see WHICH
  // part of the change the alert was tied to rather than trusting the verdict.
  attributedPath: RepositoryRelativePathSchema,
  attributedLine: z.int().min(1)
})

// What one artifact contributed, and — equally — what it did not.
//
// Every count here exists because the corresponding loss is invisible in the
// result: an alert dropped as pre-existing, one whose path did not resolve, and one
// cut by the cap all leave an identical (smaller) alert list behind.
export const AnalyzerArtifactMetricSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  analyzer: z.string().min(1),
  analyzerVersion: z.string().optional(),
  bytes: z.int().min(0),
  resultCount: z.int().min(0),
  // Results the reader could not normalize into an alert (no usable location, no
  // rule id, a location outside the repository or outside the eligible path
  // universe).
  unusableCount: z.int().min(0),
  attributedCount: z.int().min(0),
  // Normalized alerts with no changed-side cause: pre-existing repository debt.
  preExistingCount: z.int().min(0)
})

export type AnalyzerAttribution = z.infer<typeof AnalyzerAttributionSchema>
export type AnalyzerIdentity = z.infer<typeof AnalyzerIdentitySchema>
export type AnalyzerArtifactProvenance = z.infer<
  typeof AnalyzerArtifactProvenanceSchema
>
export type AnalyzerAlert = z.infer<typeof AnalyzerAlertSchema>
export type AttributedAnalyzerAlert = z.infer<
  typeof AttributedAnalyzerAlertSchema
>
export type AnalyzerArtifactMetric = z.infer<typeof AnalyzerArtifactMetricSchema>
