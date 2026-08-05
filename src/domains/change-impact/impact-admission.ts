// The change-impact admission gate.
//
// IT IS THIS CAPABILITY'S OWN GATE, ON PURPOSE. Spec 22: "The command MUST NOT
// extend the diff reviewer's admission gate. That gate requires a finding to sit
// inside the reviewed paths, and a change-impact finding is outside them by
// construction; admitting one there would either loosen the diff reviewer's scope
// guard or add a mode flag, which is the same thing named. Impact findings pass
// their own gate, composed from the shared primitives."
//
// So this file imports nothing from `admission` and everything it shares with it
// comes from `shared/`: the redactor, the field-bound truncation, the hash. What is
// NOT shared is the policy, because the policies are opposites — the diff gate
// admits a finding INSIDE the reviewed paths, and this one admits a finding about a
// file OUTSIDE them.
//
// THE RULE THIS EXISTS FOR. Spec 22: "A finding without a named dependent is not a
// change-impact finding and MUST be rejected." A finding here is a claim about a
// specific file at a specific line, and the moment it can be emitted without one it
// stops being evidence and becomes an opinion. Every check below is a way of losing
// the dependent:
//
//   - no path at all, or a path outside the dependents discovery located;
//   - a line the search never found in that file, so nobody could open it;
//   - a reliance naming a changed symbol that does not reach that file;
//   - no contract element or no consequence, so the reader is told a file matters
//     and not what about it;
//   - `no-impact`, which is an adjudication outcome and not something to report.
//
// A rejected candidate is COUNTED and dropped. There is no `RejectedFinding`
// artifact here and no reason to grow one: this lane has no baseline, no
// suppression and no gate to explain a rejection to.

import { z } from 'zod'
import { createRedactor } from '../../shared/redaction/redactor.js'
import { sha256 } from '../../shared/hash/hash.js'
import { truncateToFieldBound } from '../../shared/text/truncate.js'
import {
  ImpactFindingSchema,
  ImpactRelianceSchema,
  impactedSymbolKey,
  type ImpactFinding,
  type ImpactedFile
} from './impact-report.js'

// The candidate shape, loose where the gate is the thing that tightens it.
//
// `path` is `z.string()` rather than `RepositoryRelativePathSchema` so a candidate
// carrying an empty or absolute path reaches the named-dependent check and is
// rejected with a reason a reader can act on, instead of failing as an anonymous
// schema error. Everything else is strict: a candidate is produced in this process
// by `adjudication.ts`, so a shape error is a programming error.
export const CandidateImpactFindingSchema = z.strictObject({
  path: z.string(),
  destination: z.enum(['production', 'test']),
  compatibilityClass: z.string(),
  reliances: z.array(
    z.strictObject({
      symbolName: z.string(),
      definitionPath: z.string(),
      definitionLine: z.int(),
      line: z.int(),
      contractElement: z.string(),
      consequence: z.string(),
      adjudicatedBy: z.enum(['deterministic', 'model'])
    })
  )
})

export type ImpactAdmissionRejectionReason =
  | 'schema-invalid'
  | 'no-named-dependent'
  | 'unknown-dependent'
  | 'unlocated-line'
  | 'unrelated-symbol'
  | 'incomplete-evidence'
  | 'not-reportable-class'
  | 'duplicate'

export type ImpactAdmissionResult =
  | { readonly status: 'admitted'; readonly finding: ImpactFinding }
  | {
      readonly status: 'rejected'
      readonly reason: ImpactAdmissionRejectionReason
      readonly message: string
    }

// What discovery actually located, per destination file. The gate checks a
// candidate against THIS rather than against the repository, so it can never admit
// a finding about a file or a line the search did not produce — including one an
// unrelated bug invented.
export type ImpactAdmissionPolicy = {
  readonly impactedFiles: readonly ImpactedFile[]
  readonly impactedTestFiles: readonly ImpactedFile[]
  readonly admittedFindings: readonly ImpactFinding[]
}

type LocatedDependent = {
  readonly destination: 'production' | 'test'
  // Lines the search located in this file, across every symbol reaching it.
  readonly lines: ReadonlySet<number>
  // `impactedSymbolKey` for every changed symbol that reaches this file.
  readonly symbolKeys: ReadonlySet<string>
}

const locatedDependents = (
  policy: ImpactAdmissionPolicy
): ReadonlyMap<string, LocatedDependent> => {
  const dependents = new Map<string, LocatedDependent>()
  const index = (
    files: readonly ImpactedFile[],
    destination: 'production' | 'test'
  ): void => {
    for (const file of files) {
      dependents.set(file.path, {
        destination,
        lines: new Set(
          file.symbols.flatMap((symbol) =>
            symbol.sites.map((site) => site.line)
          )
        ),
        symbolKeys: new Set(
          file.symbols.map((symbol) => impactedSymbolKey(symbol))
        )
      })
    }
  }

  index(policy.impactedFiles, 'production')
  index(policy.impactedTestFiles, 'test')

  return dependents
}

// Redaction can lengthen text (a configured secret becomes `[REDACTED]`), so the
// result is truncated back to the bound its DESTINATION FIELD declares. The bound
// is read off the schema rather than restated here, so the two cannot drift.
const safeField = (value: string, field: Parameters<typeof truncateToFieldBound>[1]): string =>
  truncateToFieldBound(createRedactor().redact(value), field)

/**
 * Admits one candidate impact finding, or rejects it with a reason.
 *
 * Every rejection is a statement about the CANDIDATE, never about the change: a
 * rejected candidate means this engine could not stand behind the claim, and the
 * dependent it named is still in the reference list where a reader can judge it.
 */
export const admitImpactFinding = (input: {
  readonly candidate: unknown
  readonly policy: ImpactAdmissionPolicy
}): ImpactAdmissionResult => {
  const parsed = CandidateImpactFindingSchema.safeParse(input.candidate)

  if (!parsed.success) {
    return {
      status: 'rejected',
      reason: 'schema-invalid',
      message: `Candidate impact finding failed schema validation. ${parsed.error.issues[0]?.message ?? ''}`.trim()
    }
  }

  const candidate = parsed.data
  const reject = (
    reason: ImpactAdmissionRejectionReason,
    message: string
  ): ImpactAdmissionResult => ({ status: 'rejected', reason, message })

  // SPEC 22'S HARD REQUIREMENT, FIRST AND ON ITS OWN. A finding without a named
  // dependent is not a change-impact finding. It is checked before anything else
  // so the reason a reader is given names the missing dependent rather than
  // whichever downstream check happened to trip on it.
  if (candidate.path.trim().length === 0) {
    return reject(
      'no-named-dependent',
      'An impact finding must name the dependent it is about; this candidate carries no path.'
    )
  }

  if (candidate.reliances.length === 0) {
    return reject(
      'no-named-dependent',
      'An impact finding must state what the dependent relies on; this candidate carries no reliance.'
    )
  }

  const dependents = locatedDependents(input.policy)
  const dependent = dependents.get(candidate.path)

  if (dependent === undefined) {
    return reject(
      'unknown-dependent',
      'The named dependent is not among the files this run located a reference in.'
    )
  }

  if (dependent.destination !== candidate.destination) {
    return reject(
      'unknown-dependent',
      'The candidate disagrees with the search about whether the dependent is production or test.'
    )
  }

  if (
    input.policy.admittedFindings.some(
      (finding) => finding.path === candidate.path
    )
  ) {
    // One finding per dependent file is the whole point of file granularity. A
    // second one for the same path would be the per-site report spec 22 removed,
    // reassembled by accident.
    return reject(
      'duplicate',
      'A finding for this dependent has already been admitted.'
    )
  }

  for (const reliance of candidate.reliances) {
    if (
      reliance.contractElement.trim().length === 0 ||
      reliance.consequence.trim().length === 0
    ) {
      return reject(
        'incomplete-evidence',
        'A reliance must name the contract element relied upon and the consequence.'
      )
    }

    if (!dependent.lines.has(reliance.line)) {
      return reject(
        'unlocated-line',
        'A reliance must point at a line this run located in the dependent.'
      )
    }

    if (
      !dependent.symbolKeys.has(
        impactedSymbolKey({
          name: reliance.symbolName,
          definitionPath: reliance.definitionPath,
          definitionLine: reliance.definitionLine
        })
      )
    ) {
      return reject(
        'unrelated-symbol',
        'A reliance must name a changed symbol this run found in the dependent.'
      )
    }
  }

  const reportable = ImpactFindingSchema.shape.compatibilityClass.safeParse(
    candidate.compatibilityClass
  )

  if (!reportable.success) {
    return reject(
      'not-reportable-class',
      `"${candidate.compatibilityClass}" is not a reportable compatibility class; only a dependent shown to be exposed is reported.`
    )
  }

  const finding = ImpactFindingSchema.safeParse({
    // Content-addressed, so the same dependent under the same change keeps the
    // same id across runs and a consumer can join two reports without a run id.
    id: `impact_${sha256(
      [
        candidate.path,
        reportable.data,
        ...candidate.reliances.map(
          (reliance) =>
            `${reliance.definitionPath}:${reliance.symbolName}:${reliance.line}`
        )
      ].join('|')
    ).slice(0, 24)}`,
    path: candidate.path,
    destination: candidate.destination,
    compatibilityClass: reportable.data,
    reliances: candidate.reliances.map((reliance) => ({
      symbolName: reliance.symbolName,
      definitionPath: reliance.definitionPath,
      definitionLine: reliance.definitionLine,
      line: reliance.line,
      contractElement: safeField(
        reliance.contractElement,
        ImpactRelianceSchema.shape.contractElement
      ),
      consequence: safeField(
        reliance.consequence,
        ImpactRelianceSchema.shape.consequence
      ),
      adjudicatedBy: reliance.adjudicatedBy
    }))
  })

  if (!finding.success) {
    // Reached when a candidate carries something the report contract refuses that
    // the checks above do not name — an absolute path, for example, which
    // `RepositoryRelativePathSchema` rejects and the dependent lookup would only
    // catch by coincidence.
    return reject(
      'schema-invalid',
      `Candidate impact finding does not satisfy the report contract. ${finding.error.issues[0]?.message ?? ''}`.trim()
    )
  }

  return { status: 'admitted', finding: finding.data }
}
