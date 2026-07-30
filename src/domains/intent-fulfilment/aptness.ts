// Step 2b of spec 23 (Second Amendment, 2026-07-31): is a verified citation
// actually EVIDENCE for the obligation it was attached to?
//
// `verifyJudgement` asks "is this a line the change touched?". That question has a
// definite, cheap, structural answer and it is not the question that matters. The
// measured failure lives in the gap:
//
//   Obligation: "make runs that request the withdrawn context kind by name fail
//               intake with exit code 2"
//   Reported:   addressed
//   Citations:  two REMOVED lines - an enum member, and a comparison against it
//   Reality:    the commit removes the kind and adds no intake check, no exit path
//
// Both citations were real lines the change really touched, so every structural
// guard passed: `unevidencedAddressedCount` and `uncitedObligationCount` were zero
// in all 34 measured runs. The address was valid and attached to the wrong claim.
//
// WHY THIS IS A SEPARATE CALL. Same reason explanation is. Spec 23's binding
// constraint is that a model must not justify a verdict in the same breath as
// reaching it — measured spurious rejection rises from 26-36% to 73-88% when it
// does. So this call receives a judgement that is already frozen: it cannot change
// a status to `addressed`, it cannot see an unaddressed obligation, and it returns
// no prose.
//
// WHY IT CANNOT SAY "unaddressed". Inapt evidence is not evidence that nothing
// addresses the obligation — that would be a second claim built on the failure of
// the first. Spec 23 fixes the direction: an inapt citation downgrades to
// `undetermined`.
//
// WHY `undetermined` FROM THIS CALL LEAVES THE VERDICT ALONE. The capability
// measured 90% unaddressed detection. A check that suppressed every verdict it was
// unsure about would trade a demonstrated strength for a fix to a 5.8% failure
// rate. It only acts when it positively judges the evidence inapt.

import { z } from 'zod'
import type { ChangeCitation } from './intent-fulfilment-report.js'
import type { VerifiedJudgement } from './judgement.js'

// Loose for the measured provider-error reason (rich model-bound schemas took this
// engine's provider error rate from 0% to 28.8%); the enum lives in the normalizer.
//
// NOTE the absence of a reason field, and keep it absent. A schema-shape test
// asserts `verdict` is the ONLY string here.
export const ModelCitationAptnessSchema = z.strictObject({
  verdict: z.string()
})

export type ModelCitationAptness = z.infer<typeof ModelCitationAptnessSchema>

export const CitationAptnessInputSchema = z.strictObject({
  // The obligation, and the citations already verified against the change. Both
  // arrive decided; there is nothing here for the call to re-open.
  obligation: z.string().min(1),
  citedLines: z.array(
    z.strictObject({
      path: z.string().min(1),
      line: z.int().min(1),
      side: z.enum(['added', 'removed']),
      text: z.string()
    })
  )
})

export type CitationAptnessInput = z.infer<typeof CitationAptnessInputSchema>

export type CitationAptness = 'apt' | 'inapt' | 'undetermined'

export type CitationAptnessRunner = (
  input: CitationAptnessInput,
  signal: AbortSignal | undefined
) => Promise<CitationAptness>

const aptnessKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/gu, '')

/**
 * Resolves the answer into one of the three verdicts.
 *
 * Anything unusable becomes `undetermined`, which by the rule above LEAVES THE
 * VERDICT STANDING. That is the deliberate direction: a malformed aptness answer
 * must not be able to suppress a correct `addressed`.
 */
export const normalizeCitationAptness = (value: unknown): CitationAptness => {
  const parsed = ModelCitationAptnessSchema.safeParse(value)

  if (!parsed.success) {
    return 'undetermined'
  }

  const key = aptnessKey(parsed.data.verdict)

  return key === 'apt' || key === 'inapt' ? key : 'undetermined'
}

export const citationAptnessInputFor = (
  obligation: string,
  citations: readonly ChangeCitation[]
): CitationAptnessInput =>
  CitationAptnessInputSchema.parse({
    obligation,
    citedLines: citations.map((citation) => ({
      path: citation.path,
      line: citation.line,
      side: citation.side,
      text: citation.text
    }))
  })

export type AptnessOutcome = {
  readonly judgement: VerifiedJudgement
  // True only when a positively-inapt answer downgraded the verdict. Counted in
  // the report so the rate is visible rather than absorbed.
  readonly downgraded: boolean
}

/**
 * Applies an aptness verdict to an already-verified judgement.
 *
 * Only `inapt` changes anything, and only ever `addressed` -> `undetermined`. A
 * non-addressed judgement is returned untouched: this call never sees one, and the
 * guard makes that structural rather than a convention the wiring must remember.
 */
export const applyCitationAptness = (
  judgement: VerifiedJudgement,
  aptness: CitationAptness
): AptnessOutcome =>
  judgement.status === 'addressed' && aptness === 'inapt'
    ? { judgement: { status: 'undetermined' }, downgraded: true }
    : { judgement, downgraded: false }
