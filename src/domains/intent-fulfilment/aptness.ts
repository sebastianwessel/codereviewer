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
// IT ANNOTATES; IT DOES NOT DEMOTE. This is the second design, and the first two
// were measured and rejected:
//
//   1. DEMOTE ON EVERY VERDICT. Measured: five correct verdicts suppressed to
//      remove one wrong one. The call is well calibrated (2.0% false-inapt over 68
//      hand-verified pairs) but ~92% of `addressed` verdicts are already aptly
//      cited, so 2% of a large population beat 14% of a small one — expected
//      downgrade precision ~38%. Base-rate collapse.
//
//   2. DEMOTE, GATED TO ALL-REMOVED CITATIONS. Refuted offline, before any spend,
//      from the 34 stored runs: the gate would engage on 31.5% of verdicts and
//      skip ALL FOUR known false-satisfied ones. Three of the four cite added
//      lines by their nature (a test line, documentation prose, a spec file) and
//      can never be all-removed. Catches zero, still costs ~1.3 false downgrades.
//
// So this design changes no verdict at all. It records a CONCERN beside an
// `addressed` obligation, and a reviewer decides. False downgrades are impossible
// by construction — there is no downgrade — which removes the entire cost side of
// the trade that killed both previous designs. The 90% unaddressed detection the
// capability measured is untouched.
//
// The price is that a wrongly-certified obligation is still reported as addressed.
// This does not fix that. It makes the doubt visible next to it, which is the most
// this stage can honestly buy at ~38% precision.

import { z } from 'zod'
import { answerKey } from './answer-key.js'
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

  const key = answerKey(parsed.data.verdict)

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

/**
 * Whether a concern should be recorded beside this obligation.
 *
 * Note what is absent: any return path that alters the judgement. The verdict is
 * not an input and not an output, so no aptness answer — including a malformed one
 * — can change what the report says was addressed. That is the property both
 * previous designs lacked and the reason this one has no measurable cost.
 */
export const isCitationConcern = (
  judgement: VerifiedJudgement,
  aptness: CitationAptness
): boolean => judgement.status === 'addressed' && aptness === 'inapt'
