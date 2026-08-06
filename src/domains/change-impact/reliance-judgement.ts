// The one model seam in this domain: does THIS dependent rely on the part of the
// contract that changed?
//
// It is asked for the RESIDUE only. Spec 22's prior art records that of roughly 40
// contract categories about 24 have a deterministic reliance predicate and "beat a
// grep with no model involved", so "the model's job collapses to roughly ten named
// yes/no questions", concentrated in nullability, ordering, error behaviour,
// mutation and serialised values. `adjudication.ts` settles everything that is a
// structural fact about the declaration — removed, relocated, newly added — in
// code, and only a BEHAVIOURAL change to a symbol that still exists reaches here.
//
// THE OUTPUT SCHEMA CARRIES NO FREE-TEXT FIELD, and that is not stylistic. This
// repository has already measured what happens when a judging call is also asked
// to justify itself: spurious rejection of model requirement-conformance judgement
// runs at 26-36% and rises to 73-88% when the same call explains its verdict or
// proposes a fix. So the model answers a yes/no and points at a line, and the
// CONSEQUENCE sentence — which spec 22 requires every finding to carry — is
// composed in code from the contract dimension. Nothing a model writes reaches the
// report as prose.
//
// The schema is deliberately LOOSE where a model answers in words: `relies` is a
// plain string, normalized in code. A strict enum here turns "Yes, it relies." into
// a provider-side validation error and loses the answer entirely; rich model-bound
// schemas took this engine's provider error rate from 0% to 28.8%. Loose at the
// boundary, authoritative in the normalizer.

import { z } from 'zod'

// The model-bound OUTPUT schema.
export const ModelRelianceJudgementSchema = z.strictObject({
  relies: z.string(),
  // The line in the dependent that relies. Optional in the schema and REQUIRED by
  // the normalizer for a `relies` answer, for the same reason the intent lane
  // requires a citation: spec 22 says a finding must carry the dependent's path
  // and line, so a "yes" that points nowhere cannot become one.
  line: z.coerce.number().optional()
})

// FIELD ORDER IS LOAD-BEARING. The changed symbol and what moved about it are
// identical across every dependent of that symbol and come FIRST, so consecutive
// calls for one symbol share the longest prefix a provider could cache. The
// per-dependent half comes last. Nothing per-run unique appears anywhere: a fresh
// identifier in front of a packet in this repository once cut the shared prefix to
// roughly thirty tokens against a 1024-token cache minimum.
export const RelianceJudgementInputSchema = z.strictObject({
  changedSymbol: z.strictObject({
    name: z.string().min(1),
    // The observable changes, in the words the report shows the reader. Composed
    // by `contract-delta.ts` from the diff text; never a type-system conclusion.
    contractChanges: z.array(z.string().min(1)).min(1)
  }),
  dependent: z.strictObject({
    path: z.string().min(1),
    // Every located reference to the symbol in this file. The model may cite only
    // these lines, and `verifyRelianceJudgement` enforces it.
    sites: z
      .array(
        z.strictObject({
          line: z.int().min(1),
          text: z.string()
        })
      )
      .min(1)
  })
})

export type RelianceJudgementInput = z.infer<typeof RelianceJudgementInputSchema>

/**
 * A normalized answer.
 *
 * A union rather than a record with an optional line, so "a reliance always has a
 * line" is checked by the compiler at every use site instead of being a rule the
 * wiring has to remember.
 */
export type RelianceJudgement =
  | { readonly status: 'relies'; readonly line: number }
  | { readonly status: 'does-not-rely' }
  | { readonly status: 'undetermined' }

// The three answers as one vocabulary, because the report COUNTS them.
//
// A degenerate distribution — every answer `does-not-rely`, or no answer at all —
// is the cheapest bug signature this layer has, and on 2026-08-06 seeing it cost a
// bespoke replay probe: the report carried no distribution and no call count, so a
// run in which the judge never fired was indistinguishable from one in which it
// fired and rejected everything. Spec 22 records that diagnosis.
export const relianceVerdicts = [
  'relies',
  'does-not-rely',
  'undetermined'
] as const

export type RelianceVerdict = (typeof relianceVerdicts)[number]

// Counts over the calls that RETURNED. A call that threw is not a verdict and is
// counted as a failure instead, so `relies + does-not-rely + undetermined` plus the
// failures is exactly the number of calls the run spent.
export type RelianceVerdictCounts = Readonly<Record<RelianceVerdict, number>>

// The distribution of a run that made no call. Named rather than written inline so
// "no verdicts" is one value everywhere, and so a reader of a zeroed distribution
// is always looking at the same object.
export const NO_RELIANCE_VERDICTS: RelianceVerdictCounts = {
  relies: 0,
  'does-not-rely': 0,
  undetermined: 0
}

export type RelianceJudgementRunner = (
  input: RelianceJudgementInput,
  signal: AbortSignal | undefined
) => Promise<RelianceJudgement>

const UNDETERMINED: RelianceJudgement = { status: 'undetermined' }

// Punctuation and case stripped so "Relies.", "relies" and "RELIES" are one
// answer, while a paraphrase stays a different one and falls through to
// `undetermined` rather than being guessed at.
const answerKey = (value: string): string =>
  value.toLowerCase().replaceAll(/[^a-z]+/gu, '')

/**
 * Resolves whatever the call returned into one of the three answers.
 *
 * Everything unusable becomes `undetermined`, INCLUDING a `relies` answer with no
 * line. The direction is deliberate: `undetermined` is counted and never reported,
 * whereas `does-not-rely` would be a second claim — that this dependent is
 * unaffected — made on the strength of an answer that did not parse.
 */
export const normalizeRelianceJudgement = (
  value: unknown
): RelianceJudgement => {
  const parsed = ModelRelianceJudgementSchema.safeParse(value)

  if (!parsed.success) {
    return UNDETERMINED
  }

  const key = answerKey(parsed.data.relies)

  if (key === 'doesnotrely' || key === 'notrely' || key === 'no') {
    return { status: 'does-not-rely' }
  }

  if (key !== 'relies' && key !== 'yes') {
    return UNDETERMINED
  }

  const line =
    parsed.data.line === undefined ? undefined : Math.trunc(parsed.data.line)

  return line === undefined || line < 1
    ? UNDETERMINED
    : { status: 'relies', line }
}

/**
 * Verifies a `relies` answer against the sites the search actually located.
 *
 * A cited line that is not one of the sites this file was given is not a reference
 * to the changed symbol, so a finding anchored on it would point a reviewer at a
 * line nobody found. Such an answer is downgraded to `undetermined` rather than to
 * `does-not-rely`: the model said something relies, and only its address was
 * unusable.
 *
 * This is the same rule the intent lane enforces on its citations, for the same
 * reason — without it "relies" survives on a line number produced from the shape of
 * the question.
 */
export const verifyRelianceJudgement = (
  judgement: RelianceJudgement,
  sites: readonly { readonly line: number }[]
): RelianceJudgement =>
  judgement.status === 'relies' &&
  !sites.some((site) => site.line === judgement.line)
    ? UNDETERMINED
    : judgement

/** Builds the packet for one (dependent file, changed symbol) pair. */
export const relianceJudgementInputFor = (input: {
  readonly symbolName: string
  readonly contractChanges: readonly string[]
  readonly dependentPath: string
  readonly sites: readonly { readonly line: number; readonly text: string }[]
}): RelianceJudgementInput =>
  RelianceJudgementInputSchema.parse({
    changedSymbol: {
      name: input.symbolName,
      contractChanges: [...input.contractChanges]
    },
    dependent: {
      path: input.dependentPath,
      sites: input.sites.map((site) => ({ line: site.line, text: site.text }))
    }
  })
