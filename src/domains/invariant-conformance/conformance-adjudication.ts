// The adjudication boundary: what the model is shown, what it may answer, and how
// an answer becomes (or fails to become) a reported divergence.
//
// Spec 24 design step 4 is one model call per divergence, and the model "MUST
// receive a divergence to judge, never a repository to search". Everything here is
// built from an already-extracted divergence: there is no path, budget or tool by
// which this packet can grow, and no tool is attached to the agent that consumes
// it.
//
// THE ONE-WAY VALVE. Three verdicts exist, and only `convention` can ever become a
// reported divergence:
//
//   - `convention` must be stated exactly, and with a reason. Nothing else
//     produces it: a synonym, a sentence, an empty answer, a missing field, a
//     malformed response and a thrown call all resolve to `undetermined`.
//   - `undetermined` is the absorbing state, so every failure mode of this layer
//     fails towards silence rather than towards a report.
//   - `ConformanceAdjudicationRecordSchema` in the report can only hold the
//     literal `convention`, so an `undetermined` verdict has no representation in
//     a divergence entry even if a caller tried to write one there.
//
// That last point is why this is not "filter the list and hope". The type below is
// a discriminated union in which only the `convention` member carries a reason, so
// the code that attaches an adjudication to a divergence cannot compile unless it
// has narrowed to that member first.

import { z } from 'zod'
import {
  ConformancePatternKindSchema,
  DeclarationSiteSchema,
  MINIMUM_CITED_PEERS,
  PeerDeclarationKindSchema,
  type ConformanceDivergence
} from './conformance-report.js'

export const ConformanceAdjudicationVerdictSchema = z.enum([
  // The peers share the trait because of what they are, so a reader would expect
  // any declaration of that role to have it.
  'convention',
  // The peers share the trait for a reason other than a practice.
  'incidental',
  // The material did not permit a decision. A real answer, per the instructions,
  // and the value every unusable response resolves to.
  'undetermined'
])

export type ConformanceAdjudicationVerdict = z.infer<
  typeof ConformanceAdjudicationVerdictSchema
>

/**
 * A normalized adjudication.
 *
 * A union rather than a record with an optional reason, so "a convention verdict
 * always carries its reason" is checked by the compiler at every use site instead
 * of being a rule the wiring has to remember.
 */
export type ConformanceAdjudication =
  | { readonly verdict: 'convention'; readonly reason: string }
  | {
      readonly verdict: Exclude<ConformanceAdjudicationVerdict, 'convention'>
      readonly reason?: string
    }

export type ConformanceAdjudicationRunner = (
  input: ConformanceAdjudicationInput,
  signal: AbortSignal | undefined
) => Promise<ConformanceAdjudication>

// FIELD ORDER IS LOAD-BEARING. The packet is serialized in declaration order, so
// the fields that are stable across divergences and across runs come first and the
// per-divergence specifics come last, giving consecutive calls the longest shared
// prefix a provider could cache.
//
// Nothing per-run unique appears anywhere, and no identifier appears at all. That
// is not an oversight: a fresh UUID in front of a packet in this repository cut the
// shared prefix to roughly thirty tokens against a 1024-token cache minimum and
// bought a guaranteed miss on every call. The divergence id is stable rather than
// random, but the model has no use for it and never echoes it back — one call
// judges one divergence, and the caller holds the binding — so it stays out.
export const ConformanceAdjudicationInputSchema = z.strictObject({
  // Same for every divergence in a single-language change.
  language: z.string().min(1),
  declarationKind: PeerDeclarationKindSchema,
  peerScope: z.enum(['file', 'directory']),
  peerCount: z.int().min(MINIMUM_CITED_PEERS),
  citedPeerCount: z.int().min(MINIMUM_CITED_PEERS),
  // The trait under judgement, as a phrase rather than as a comparison key.
  trait: z.strictObject({
    kind: ConformancePatternKindSchema,
    symbol: z.string().min(1),
    argument: z.string().optional(),
    description: z.string().min(1)
  }),
  // What ELSE a majority of the peers do. This is the group's identity, and it is
  // the difference between an answerable question and a guess: "these peers all
  // build a schema" and "these peers all load a record and deny a request" are
  // the two cases the model exists to separate, and neither is visible from the
  // divergent trait alone.
  sharedPeerTraits: z.array(z.string()),
  citedPeers: z.array(DeclarationSiteSchema).min(MINIMUM_CITED_PEERS),
  // The declaration, and what it does instead. Present so the model can see that
  // the declaration belongs to the group before deciding what the group expects.
  declaration: DeclarationSiteSchema.extend({
    traits: z.array(z.string())
  }),
  // The fact and the question, last: they restate the fields above in prose, so
  // they are the part a longer packet should not push a shared prefix past.
  statement: z.string().min(1),
  question: z.string().min(1)
})

export type ConformanceAdjudicationInput = z.infer<
  typeof ConformanceAdjudicationInputSchema
>

// The model-bound OUTPUT schema, loose on purpose.
//
// `verdict` is a plain string rather than the three-value enum above, and the
// enum lives in the normalizer below instead. With an enum here, a model answering
// "Convention." fails provider-side validation, the call throws, and a genuine
// convention is lost — a schema that is stricter than the normalizer converts a
// recoverable answer into silence. Loose here, authoritative in code, which is the
// same division the refutation and merge results use for the same measured reason:
// rich model-bound schemas raised this engine's provider error rate from 0% to
// 28.8%.
export const ModelConformanceAdjudicationSchema = z.strictObject({
  verdict: z.string(),
  reason: z.string().optional()
})

export type ModelConformanceAdjudication = z.infer<
  typeof ModelConformanceAdjudicationSchema
>

// Longer than this and the "short reason" is an argument; it is truncated rather
// than rejected, because the verdict is the part that matters.
const MAX_REASON_LENGTH = 400

const UNDETERMINED: ConformanceAdjudication = { verdict: 'undetermined' }

// Lowercased, punctuation-stripped comparison key. Deliberately the only tolerance
// applied: casing and a trailing full stop are formatting, whereas a paraphrase is
// a different answer and is not read as one of the three.
const verdictKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/gu, '')

/**
 * Resolves whatever the adjudicator returned into one of the three verdicts.
 *
 * Every unusable response resolves to `undetermined`, including a `convention`
 * answer with no reason: the instructions ask for the answer AND the basis for it,
 * and an assertion with no stated basis is not a decidable answer. The cost of
 * that strictness is a lost report line; the cost of the opposite is a divergence
 * reported as a convention violation on the strength of one word.
 */
export const normalizeConformanceAdjudication = (
  value: unknown
): ConformanceAdjudication => {
  const parsed = ModelConformanceAdjudicationSchema.safeParse(value)

  if (!parsed.success) {
    return UNDETERMINED
  }

  const key = verdictKey(parsed.data.verdict)
  const reason = parsed.data.reason?.trim().slice(0, MAX_REASON_LENGTH) ?? ''

  if (key === 'convention') {
    return reason.length === 0 ? UNDETERMINED : { verdict: 'convention', reason }
  }

  if (key === 'incidental') {
    return reason.length === 0
      ? { verdict: 'incidental' }
      : { verdict: 'incidental', reason }
  }

  return UNDETERMINED
}

export type ConformanceAdjudicationContext = {
  // Traits a majority of the peers hold and the divergent one is not among.
  readonly sharedPeerTraits: readonly string[]
  // Traits the diverging declaration itself holds.
  readonly declarationTraits: readonly string[]
}

/**
 * Builds the packet for one divergence.
 *
 * Everything in it is already-extracted, deterministic output: the divergence, the
 * peers it cites, and the two trait lists the extraction computed on the way to
 * finding it. Nothing is read, searched or inferred here.
 */
export const conformanceAdjudicationInputFor = (
  divergence: ConformanceDivergence,
  context: ConformanceAdjudicationContext,
  traitDescription: string
): ConformanceAdjudicationInput =>
  ConformanceAdjudicationInputSchema.parse({
    language: divergence.declaration.language,
    declarationKind: divergence.declaration.kind,
    peerScope: divergence.peerScope,
    peerCount: divergence.peerCount,
    citedPeerCount: divergence.citedPeerCount,
    trait: {
      kind: divergence.pattern.kind,
      symbol: divergence.pattern.symbol,
      ...(divergence.pattern.argument === undefined
        ? {}
        : { argument: divergence.pattern.argument }),
      description: traitDescription
    },
    sharedPeerTraits: [...context.sharedPeerTraits],
    citedPeers: divergence.citedPeers,
    declaration: {
      path: divergence.declaration.path,
      line: divergence.declaration.line,
      name: divergence.declaration.name,
      traits: [...context.declarationTraits]
    },
    statement: divergence.statement,
    question: divergence.question
  })
