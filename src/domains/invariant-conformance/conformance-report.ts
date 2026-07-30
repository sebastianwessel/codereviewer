// The invariant-conformance DIVERGENCE report.
//
// Read the name literally, because the distinction is the whole point. A
// divergence is *"these N peers do X; this declaration does not"*. It is not a
// finding: it carries no verdict, no severity, no claim about exploitability, and
// it passes through no admission gate. Spec 24 states the contract directly —
// output is "a substantiated fact plus a question, not a verdict". We can prove
// the divergence. We cannot prove the consequence, and a schema that offered
// somewhere to record one would invite exactly the claim the spec forbids.
//
// Consequently there is no `findings`, no `severity`, no `passed`, no
// `qualityGate` and no `blocking` anywhere below, and `conformance check` always
// exits 0. Spec 24 is advisory only: it MUST NOT be able to fail a pipeline.
//
// The schema is this capability's own rather than a reuse of `ReviewReportSchema`
// or of change-impact's report: spec 24 forbids sharing the diff reviewer's report
// schema, and one schema serving several capabilities means a change to one bumps
// the other's contract.
//
// The two divergence lists are separate ARRAYS, not one array with a flag,
// because spec 24 requires pre-existing divergences to be "labelled and reported
// separately, so they never inflate a change-attributed count". Separate arrays
// make that structural: a consumer cannot sum them by accident. Each entry
// additionally carries its own `attribution`, so a consumer that does flatten
// them cannot lose the label.

import { z } from 'zod'
import { RepositoryRelativePathSchema } from '../../shared/contracts/index.js'

// Spec 24: "A finding MUST cite at least three peer sites by path and line. Below
// that threshold there is no pattern, only a coincidence." Enforced twice — by
// the schema below, so no report can carry a weaker citation, and by the
// extraction that builds the list.
export const MINIMUM_CITED_PEERS = 3

export const PeerDeclarationKindSchema = z.enum([
  'declaration',
  'public-symbol',
  'export'
])

export const DivergenceAttributionSchema = z.enum([
  // The change added or modified this declaration.
  'change-attributed',
  // The change did not touch this declaration; it is the odd one out in a peer
  // set the change happened to surface. Spec 24 permits reporting these and
  // requires them to be counted apart.
  'pre-existing'
])

export const ConformancePatternKindSchema = z.enum([
  // The peers call a symbol.
  'call',
  // The peers call a symbol in a conditional position.
  'guard',
  // The peers call a symbol with a particular first argument.
  'call-argument'
])

export const DeclarationSiteSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  line: z.int().min(1),
  name: z.string().min(1)
})

// The adjudication a REPORTED divergence carries, and the reason `undetermined`
// cannot be mistaken for a violation anywhere downstream.
//
// `verdict` is a literal, not the three-value enum the model answers with. The
// adjudicator can answer `convention`, `incidental` or `undetermined`, and only
// the first has a representation here: an `incidental` or `undetermined` verdict
// cannot be written into a divergence entry at all, because the schema would
// reject it. That is deliberately stronger than filtering the lists and then
// trusting the filter — a future caller that forgets the filter gets a parse
// error, not a mislabelled divergence. The other two verdicts exist in the report
// only as integer counts in `summary.adjudication`, where there is nothing for a
// consumer to mistake for a divergence.
//
// The field is optional because a report produced by spec 24's deterministic
// baseline arm carries no adjudication at all. Which arm ran is stated once, in
// `summary.adjudication.mode`, rather than inferred from the presence of a field.
export const ConformanceAdjudicationRecordSchema = z.strictObject({
  verdict: z.literal('convention'),
  // Short, and bounded: the model is asked for a sentence naming what the peers
  // have in common, not for an argument.
  reason: z.string().min(1).max(400)
})

export const ConformanceDivergenceSchema = z.strictObject({
  id: z.string().min(1),
  attribution: DivergenceAttributionSchema,
  // The declaration that does not hold the pattern.
  declaration: DeclarationSiteSchema.extend({
    kind: PeerDeclarationKindSchema,
    language: z.string().min(1),
    endLine: z.int().min(1)
  }),
  pattern: z.strictObject({
    kind: ConformancePatternKindSchema,
    symbol: z.string().min(1),
    // Present only for `call-argument`.
    argument: z.string().optional()
  }),
  // How the peers were found: the declaration's own file, or its directory.
  peerScope: z.enum(['file', 'directory']),
  // Every sibling compared against, and how many of them hold the pattern. Both
  // numbers are reported because the majority is the claim: "13 of 15" is
  // evidence and "13" alone is not.
  peerCount: z.int().min(MINIMUM_CITED_PEERS),
  citedPeerCount: z.int().min(MINIMUM_CITED_PEERS),
  // The peers that hold the pattern, by path and line. This is the evidence, and
  // it is why the output is evidence by construction rather than by assertion.
  citedPeers: z.array(DeclarationSiteSchema).min(MINIMUM_CITED_PEERS),
  // True when the peer-set cap bounded the comparison, so a reader can never
  // mistake a bounded majority for a complete one.
  peersTruncated: z.boolean(),
  // The substantiated fact.
  statement: z.string().min(1),
  // And the question. It is a field rather than a docs convention so the shape
  // spec 24 requires is structurally present in the artifact: nothing here
  // asserts what the divergence means.
  question: z.string().min(1),
  // Present only when the adjudicated arm ran AND answered `convention`. See the
  // schema above for why no other verdict is representable here.
  adjudication: ConformanceAdjudicationRecordSchema.optional()
})

// How the adjudication layer spent itself, and what it filtered. Spec 24 requires
// the command to be able to report nothing; these counts are what stops "nothing"
// from being indistinguishable between "the peers agreed with the change", "the
// model called every pattern incidental" and "the bound ran out".
//
// `requestedCount` equals `conventionCount + incidentalCount + undeterminedCount +
// failedCount`, and `requestedCount + unadjudicatedCount` equals every divergence
// the deterministic core produced within its own caps. Both identities are
// asserted by a test, because a count a reader cannot reconcile is worse than no
// count.
export const ConformanceAdjudicationSummarySchema = z.strictObject({
  // `deterministic` is spec 24's baseline arm: no model call, nothing filtered,
  // every divergence reported as the fact it is.
  mode: z.enum(['deterministic', 'model']),
  requestedCount: z.int().min(0),
  conventionCount: z.int().min(0),
  incidentalCount: z.int().min(0),
  undeterminedCount: z.int().min(0),
  // Calls that threw. Counted apart from `undeterminedCount` so "the model did not
  // decide" is never confused with "the call did not happen"; both outcomes filter
  // the divergence out.
  failedCount: z.int().min(0),
  // Divergences the adjudication bound left unjudged. They are NOT reported.
  unadjudicatedCount: z.int().min(0)
})

// Token usage and cost of the adjudication calls, when the adjudicated arm ran.
//
// Deliberately this capability's own schema rather than a reuse of the
// verification lane's: spec 24 forbids sharing the diff reviewer's report schema,
// and every field here is a provider-usage primitive rather than shared behaviour,
// so a shared helper would couple two independent report contracts to buy nothing.
export const ConformanceUsageSchema = z.strictObject({
  inputTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  // A SUBSET of `inputTokens`, already counted there.
  cachedInputTokens: z.int().min(0).optional(),
  reasoningTokens: z.int().min(0).optional(),
  costUsd: z.number().min(0).optional()
})

export const InvariantConformanceReportSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  // `disabled` is a first-class outcome: the capability is off by default until
  // measured (spec 24), and saying so plainly beats emitting an empty report that
  // reads as "no divergences".
  status: z.enum(['completed', 'disabled']),
  generatedAt: z.iso.datetime(),
  scope: z.strictObject({
    baseRef: z.string().min(1),
    headRef: z.string().min(1),
    mergeBaseRef: z.string().min(1).optional(),
    changedFileCount: z.int().min(0),
    // Sibling files read only to supply peers. Reported so the traversal the run
    // actually performed is visible rather than implied.
    peerFileCount: z.int().min(0),
    peerFilesTruncated: z.boolean()
  }),
  summary: z.strictObject({
    changedDeclarationCount: z.int().min(0),
    changedDeclarationsTruncated: z.boolean(),
    peerSetCount: z.int().min(0),
    changeAttributedDivergenceCount: z.int().min(0),
    preExistingDivergenceCount: z.int().min(0),
    changeAttributedDivergencesTruncated: z.boolean(),
    preExistingDivergencesTruncated: z.boolean(),
    adjudication: ConformanceAdjudicationSummarySchema
  }),
  changeAttributedDivergences: z.array(ConformanceDivergenceSchema),
  preExistingDivergences: z.array(ConformanceDivergenceSchema),
  warnings: z.array(z.string()),
  // Present only when the adjudicated arm actually issued a call.
  usage: ConformanceUsageSchema.optional()
})

export type DeclarationSite = z.infer<typeof DeclarationSiteSchema>
export type ConformanceDivergence = z.infer<typeof ConformanceDivergenceSchema>
export type ConformanceAdjudicationRecord = z.infer<
  typeof ConformanceAdjudicationRecordSchema
>
export type ConformanceAdjudicationSummary = z.infer<
  typeof ConformanceAdjudicationSummarySchema
>
export type ConformanceUsage = z.infer<typeof ConformanceUsageSchema>
export type DivergenceAttribution = z.infer<typeof DivergenceAttributionSchema>
export type InvariantConformanceReport = z.infer<
  typeof InvariantConformanceReportSchema
>
