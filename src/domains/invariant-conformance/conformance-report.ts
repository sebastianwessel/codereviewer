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
  question: z.string().min(1)
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
    preExistingDivergencesTruncated: z.boolean()
  }),
  changeAttributedDivergences: z.array(ConformanceDivergenceSchema),
  preExistingDivergences: z.array(ConformanceDivergenceSchema),
  warnings: z.array(z.string())
})

export type DeclarationSite = z.infer<typeof DeclarationSiteSchema>
export type ConformanceDivergence = z.infer<typeof ConformanceDivergenceSchema>
export type DivergenceAttribution = z.infer<typeof DivergenceAttributionSchema>
export type InvariantConformanceReport = z.infer<
  typeof InvariantConformanceReportSchema
>
