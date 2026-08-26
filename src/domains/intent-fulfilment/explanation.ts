// Step 3 of spec 23, and the OTHER half of the requirement that judgement and
// explanation must not share a model call.
//
// This agent receives a mapping that is already decided. Every status in the
// packet below is a literal from the frozen judgement, every citation has already
// been verified against the change, and there is no field in this call's output
// through which a status could be changed: it returns prose and nothing else. The
// separation is what keeps the judgement call free of a rationale field — the
// measured over-rejection (26-36% rising to 73-88%) comes from a model justifying
// a verdict in the same breath as reaching it, so the justification has to happen
// after the verdict is immovable.

import { z } from 'zod'
import { truncateForContract } from '../../shared/text/truncate.js'
import {
  INTENT_EXPLANATION_MAX,
  ObligationStatusSchema,
  type Obligation,
  type ExtraScopeEntry
} from './intent-fulfilment-report.js'

// Loose, for the same measured reason as the other two model-bound schemas: a
// provider-side rejection here would cost the explanation entirely, and the
// mapping is the output this capability exists to produce.
export const ModelFulfilmentExplanationSchema = z.strictObject({
  explanation: z.string().optional()
})

export const FulfilmentExplanationInputSchema = z.strictObject({
  // The frozen mapping. `status` is an enum literal here, not a free string,
  // because it is being REPORTED to this call rather than decided by it.
  obligations: z.array(
    z.strictObject({
      statement: z.string().min(1),
      status: ObligationStatusSchema,
      evidence: z.array(
        z.strictObject({ path: z.string().min(1), line: z.int().min(1) })
      )
    })
  ),
  extraScopePaths: z.array(z.string().min(1))
})

export type FulfilmentExplanationInput = z.infer<
  typeof FulfilmentExplanationInputSchema
>

export type FulfilmentExplanationRunner = (
  input: FulfilmentExplanationInput,
  signal: AbortSignal | undefined
) => Promise<string | undefined>

// The report schema caps the stored value at the same length. Truncated rather
// than rejected: a long explanation is still a usable one, and losing it would
// leave the report with no prose at all.
//
// Marked, through the shared helper that reserves the mark inside the cap so the
// result still satisfies the schema's `.max(2000)`. Prose cut without a mark ends
// on a sentence that simply stops, and this is the section of the report a reader
// most readily takes as the whole account — an explanation whose final clause was
// "…but nothing evidences the audit-log requirement" is one that reads as complete
// after the clause is gone.

/** Resolves whatever the explanation call returned, or `undefined`. */
export const normalizeFulfilmentExplanation = (
  value: unknown
): string | undefined => {
  const parsed = ModelFulfilmentExplanationSchema.safeParse(value)

  if (!parsed.success) {
    return undefined
  }

  const trimmed = parsed.data.explanation?.trim()
  const explanation =
    trimmed === undefined
      ? undefined
      : truncateForContract(trimmed, INTENT_EXPLANATION_MAX)

  return explanation === undefined || explanation.length === 0
    ? undefined
    : explanation
}

/** Builds the explanation packet from the frozen mapping. */
export const fulfilmentExplanationInputFor = (
  obligations: readonly Obligation[],
  extraScope: readonly ExtraScopeEntry[]
): FulfilmentExplanationInput =>
  FulfilmentExplanationInputSchema.parse({
    obligations: obligations.map((obligation) => ({
      statement: obligation.statement,
      status: obligation.status,
      evidence:
        obligation.status === 'evidenced'
          ? obligation.evidence.map((citation) => ({
              path: citation.path,
              line: citation.line
            }))
          : []
    })),
    extraScopePaths: extraScope.map((entry) => entry.path)
  })
