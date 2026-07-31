// Step 2 of spec 23: map ONE obligation to evidence in the change, or to nothing.
//
// THE OUTPUT SCHEMA CARRIES NO FREE-TEXT FIELD. That is the requirement, stated
// by spec 23 in the strongest terms available to it:
//
//   "Two calls where the first still returns a rationale string satisfy the
//    letter of the rule and reproduce the mechanism it exists to prevent: the
//    over-rejection is caused by a model justifying a verdict in the same breath
//    as reaching it, not by the call count."
//
// The measurement behind that: spurious rejection of model requirement-
// conformance judgement runs at 26-36%, and rises to 73-88% when the same call is
// also asked to explain its judgement or propose a fix. So there is no `reason`
// here, no `rationale`, no `note`, and no `summary`. The two string-typed fields
// this schema does have are `status` — an enum, kept loose per the provider-error
// measurement below — and `evidence[].path`, which is a file identifier. A
// schema-shape test in this folder asserts exactly that set and fails if a third
// string appears, because the requirement is one an ordinary edit can undo
// without looking like it changed anything.
//
// Explanation is a separate agent, in `explanation.ts`, and it reads an
// already-frozen judgement.
//
// The obligation id is deliberately absent from BOTH the packet and the answer:
// one call judges one obligation and the caller holds the binding, so there is
// nothing for the model to echo and nothing to mismatch.

import { z } from 'zod'
import { answerKey } from './answer-key.js'
import type { ChangeSurface } from './change-surface.js'
import type { ChangeCitation } from './intent-fulfilment-report.js'

// The model-bound OUTPUT schema, loose on purpose.
//
// `status` is a plain string rather than the three-value enum, and the enum lives
// in the normalizer below: with an enum here a model answering "Addressed." fails
// provider-side validation, the call throws, and the judgement is lost. A schema
// stricter than the normalizer converts a recoverable answer into silence. Loose
// here, authoritative in code — the same division the conformance adjudication and
// refutation results use, for the same measured reason (rich model-bound schemas
// took this engine's provider error rate from 0% to 28.8%).
export const ModelFulfilmentJudgementSchema = z.strictObject({
  status: z.string(),
  evidence: z
    .array(
      z.strictObject({
        path: z.string(),
        line: z.coerce.number(),
        // Enum-valued and normalized in code like `status`, and deliberately
        // optional: an answer that omits it still cites a real address, and the
        // change surface resolves which side that address is on.
        side: z.string().optional()
      })
    )
    .optional()
})

// FIELD ORDER IS LOAD-BEARING. `changedFiles` is identical for every obligation
// in a run and comes first, so consecutive judgement calls share the longest
// prefix a provider could cache; the per-obligation statement comes last. Nothing
// per-run unique appears anywhere: a fresh identifier in front of a packet in this
// repository once cut the shared prefix to roughly thirty tokens against a
// 1024-token cache minimum and bought a guaranteed miss on every call.
export const FulfilmentJudgementInputSchema = z.strictObject({
  changedFiles: z.array(
    z.strictObject({
      path: z.string().min(1),
      changedLines: z.array(
        z.strictObject({
          line: z.int().min(1),
          side: z.enum(['added', 'removed']),
          text: z.string()
        })
      )
    })
  ),
  obligation: z.string().min(1)
})

export type FulfilmentJudgementInput = z.infer<
  typeof FulfilmentJudgementInputSchema
>

/**
 * A normalized judgement.
 *
 * A union rather than a record with an optional evidence array, so "an addressed
 * obligation always carries evidence" is checked by the compiler at every use
 * site instead of being a rule the wiring has to remember.
 */
export type FulfilmentJudgement =
  | {
      readonly status: 'addressed'
      readonly evidence: readonly {
        readonly path: string
        readonly line: number
        readonly side?: 'added' | 'removed'
      }[]
    }
  | { readonly status: 'unaddressed' }
  | { readonly status: 'undetermined' }

export type FulfilmentJudgementRunner = (
  input: FulfilmentJudgementInput,
  signal: AbortSignal | undefined
) => Promise<FulfilmentJudgement>

const UNDETERMINED: FulfilmentJudgement = { status: 'undetermined' }

/**
 * Resolves whatever the judgement returned into one of the three statuses.
 *
 * Everything unusable resolves to `undetermined`, INCLUDING an `addressed` answer
 * with no evidence. The error direction is deliberate and is spec 23's: "The
 * dangerous output is not 'missed an obligation'. It is confidently asserting an
 * obligation is satisfied when it is not, because that stops a human looking."
 * `undetermined` rather than `unaddressed`, because a failed judgement is not
 * evidence that nothing addresses the obligation either — that would be a second
 * claim made on the strength of a malformed answer.
 */
export const normalizeFulfilmentJudgement = (
  value: unknown
): FulfilmentJudgement => {
  const parsed = ModelFulfilmentJudgementSchema.safeParse(value)

  if (!parsed.success) {
    return UNDETERMINED
  }

  const key = answerKey(parsed.data.status)

  if (key === 'unaddressed') {
    return { status: 'unaddressed' }
  }

  if (key !== 'addressed') {
    return UNDETERMINED
  }

  const evidence = (parsed.data.evidence ?? []).flatMap((citation) => {
    const line = Math.trunc(citation.line)
    const path = citation.path.trim()

    if (path.length === 0 || line < 1) {
      return []
    }

    const side = answerKey(citation.side ?? '')

    if (side === 'added' || side === 'removed') {
      return [{ path, line, side }]
    }

    return [{ path, line }]
  })

  return evidence.length === 0 ? UNDETERMINED : { status: 'addressed', evidence }
}

/** Builds the packet for one obligation from the already-bounded change surface. */
export const fulfilmentJudgementInputFor = (
  surface: ChangeSurface,
  obligation: string
): FulfilmentJudgementInput =>
  FulfilmentJudgementInputSchema.parse({
    changedFiles: surface.files.map((file) => ({
      path: file.path,
      changedLines: file.changedLines.map((changedLine) => ({
        line: changedLine.line,
        side: changedLine.side,
        text: changedLine.text
      }))
    })),
    obligation
  })

export type VerifiedJudgement =
  | { readonly status: 'addressed'; readonly evidence: readonly ChangeCitation[] }
  | { readonly status: 'unaddressed' }
  | { readonly status: 'undetermined' }

/**
 * Verifies an `addressed` judgement against the change it claims to have found.
 *
 * Every cited `path:line` must be a line the change actually touched — that is
 * what the change surface holds. Citations that are not are dropped, and an
 * `addressed` judgement left with none is downgraded to `undetermined`.
 *
 * This is spec 23's "an obligation judged addressed MUST cite the change that
 * addresses it", enforced rather than requested. Without it, "addressed" survives
 * on a line number a model produced from the shape of the question, and the
 * report tells a reviewer to stop checking something nobody checked.
 *
 * The cited TEXT is read from the surface, never from the answer, so a report can
 * never quote a line the change does not contain.
 */
export const verifyJudgement = (
  judgement: FulfilmentJudgement,
  surface: ChangeSurface
): VerifiedJudgement => {
  if (judgement.status !== 'addressed') {
    return judgement
  }

  const byPath = new Map(surface.files.map((file) => [file.path, file] as const))
  const seen = new Set<string>()
  const evidence: ChangeCitation[] = []

  for (const citation of judgement.evidence) {
    const candidates = (byPath.get(citation.path)?.changedLines ?? []).filter(
      (candidate) => candidate.line === citation.line
    )
    // A line number can exist on both sides of the same file, so an answer that
    // names its side wins the tie. Without one the added side is preferred: it is
    // the more common evidence and the one a bare citation almost always means.
    const changedLine =
      candidates.find((candidate) => candidate.side === citation.side) ??
      candidates.find((candidate) => candidate.side === 'added') ??
      candidates[0]

    if (changedLine === undefined) {
      continue
    }

    const key = `${citation.path}:${changedLine.side}:${changedLine.line}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    evidence.push({
      path: citation.path,
      line: changedLine.line,
      side: changedLine.side,
      text: changedLine.text.trim()
    })
  }

  return evidence.length === 0
    ? { status: 'undetermined' }
    : { status: 'addressed', evidence }
}
