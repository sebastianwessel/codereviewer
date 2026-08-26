// Spec 22 design step 3: for each dependent, decide whether it relies on the part
// of the contract that changed, and what goes wrong if it does.
//
// WHY THIS IS THE WHOLE PRECISION LEVER. Across 119,879 dependency upgrades and
// 293,817 clients only 7.9% of clients are affected by a breaking change; another
// study puts it at 2.54%. So a raw reference list is roughly 90% noise BY
// CONSTRUCTION, and spec 22 says so plainly: without this step the command is a
// bounded, deduplicated grep. This module is what makes the list mean something.
//
// DETERMINISTIC FIRST, MODEL ONLY FOR THE RESIDUE. Spec 22's prior art records
// that of roughly 40 contract categories about 24 have a deterministic reliance
// predicate and "beat a grep with no model involved", and that the model's job
// "collapses to roughly ten named yes/no questions", concentrated in nullability,
// ordering, error behaviour, mutation and serialised values. The split here follows
// exactly that line, and it is not a heuristic about cost:
//
//   A STRUCTURAL change — the declaration is gone, relocated, or newly added — has
//   a reliance predicate that is already answered. Discovery established that this
//   file names the symbol; there is no second question about HOW it uses it,
//   because the thing that changed is whether the name resolves at all. Sending
//   that to a model would pay for an answer already in hand and add a way to get it
//   wrong.
//
//   A BEHAVIOURAL change — the declaration survives under the same name and what
//   moved is what it does — has a reliance predicate that is exactly "does this
//   use touch the part that moved", which is a reading question about the call
//   site. That is the residue, and it is the only thing that costs a call.
//
// COMPATIBILITY CLASS, NOT SEVERITY, and the axis is MECHANISM. `breaks-on-build`
// when the name cannot resolve; `breaks-at-runtime` when the name resolves and the
// behaviour behind it moved, so no build can catch it; `may-break` when the
// mechanism is known and the outcome is not; `no-impact` when nothing was shown.
// See `CompatibilityClassSchema` for why spec 05's severity rubric is the wrong
// instrument here.
//
// WHAT IS NEVER REPORTED. An unadjudicated pair — no model available, a call that
// failed, an answer that could not decide, or a pair past the call cap — is
// COUNTED and never turned into a weak finding. Filling the list with maybes would
// restate the ~90% noise this module exists to remove, and spec 22 forbids
// manufacturing findings to fill a report.
//
// It is pure with respect to the repository: symbols and sites in, candidate
// findings out. No filesystem, no git, no provider resolution — the judge is a seam
// the caller supplies, which is what lets every test here run hermetically.

import type { ContractChange } from './contract-delta.js'
import {
  impactedSymbolKey,
  type ChangedSymbolReport,
  type ImpactedFile,
  type ReferenceSite,
  type ReportableCompatibilityClass
} from './impact-report.js'
import {
  relianceJudgementInputFor,
  verifyRelianceJudgement,
  type RelianceJudgement,
  type RelianceJudgementRunner,
  type RelianceVerdict,
  type RelianceVerdictCounts
} from './reliance-judgement.js'

// One dependent's use of one changed symbol: the unit adjudication answers about.
//
// It is NOT a site. Spec 22 requires the report to be file-granular on measured
// grounds — the identical predictions scored per file rather than per method moved
// precision 28.2% -> 60.9% — so a pair covers every site of that symbol in that
// file at once, and the finding it produces anchors on the first of them while the
// complete site list stays in `impactedFiles`.
export type AdjudicationPair = {
  readonly path: string
  readonly destination: 'production' | 'test'
  readonly symbol: ChangedSymbolReport
  readonly sites: readonly ReferenceSite[]
}

// A reliance before the admission gate has seen it. Deliberately a plain record
// rather than the schema type: the gate parses `unknown`, so nothing here can
// assert its own admissibility.
export type CandidateReliance = {
  readonly symbolName: string
  readonly definitionPath: string
  readonly definitionLine: number
  readonly line: number
  readonly contractElement: string
  readonly consequence: string
  readonly adjudicatedBy: 'deterministic' | 'model'
}

export type CandidateImpactFinding = {
  readonly path: string
  readonly destination: 'production' | 'test'
  readonly compatibilityClass: ReportableCompatibilityClass
  readonly reliances: readonly CandidateReliance[]
}

// WHY NO-IMPACT IS COUNTED BY TIER, AND WHY THE CALLS ARE COUNTED AT ALL.
//
// A pooled `no-impact` counter pools two different events: "code settled it" and
// "the model looked and said no". On 2026-08-06 that pooling let a run in which the
// model was called ZERO times read as a run in which the model rejected everything
// — the deterministic tier had swept every dependent through its `no-impact` branch
// because a defective contract delta was empty, and nothing on the page said so.
// Spec 22 records the incident and requires the split and the call count.
//
// The MODEL tier's no-impact count is `modelVerdictCounts['does-not-rely']`. It is
// stored once, there, rather than mirrored into a second field that could disagree
// with it; the pooled total is the sum of the two and is derived where it is shown,
// never stored.
export type AdjudicationCounts = {
  readonly reliedUponPairCount: number
  // Pairs the DETERMINISTIC tier settled as `no-impact`: a newly added symbol, or
  // a modified symbol with no caller-observable contract change. No call was spent
  // on any of them and none of them is a model judgement.
  readonly deterministicNoImpactPairCount: number
  readonly unadjudicatedPairCount: number
  readonly callsTruncated: boolean
  // Calls that threw. Counted separately from the other unadjudicated causes so a
  // failing provider is visible as a failing provider rather than as a quiet run
  // that found nothing.
  readonly failedCallCount: number
  // Model calls ATTEMPTED, failures included. Zero is the load-bearing value: it
  // means the judge never ran, and no count in this record may then be read as
  // something a model decided.
  readonly modelCallCount: number
  // What the model answered, over the calls that returned.
  readonly modelVerdictCounts: RelianceVerdictCounts
}

export type AdjudicationOutcome = AdjudicationCounts & {
  readonly candidates: readonly CandidateImpactFinding[]
}

// Strongest first. Used to fold several reliances in one file into that file's one
// class: a file that both loses a declaration and depends on a behaviour change is
// a build break, and reporting the weaker of the two would understate it.
const CLASS_RANK: Readonly<Record<ReportableCompatibilityClass, number>> = {
  'breaks-on-build': 0,
  'breaks-at-runtime': 1,
  'may-break': 2
}

// What the deterministic tier concluded about one pair.
export type DeterministicVerdict =
  | {
      readonly outcome: 'relies'
      readonly compatibilityClass: ReportableCompatibilityClass
      readonly contractElement: string
      readonly consequence: string
    }
  | { readonly outcome: 'no-impact' }
  // Needs the model: a symbol that still exists, whose behaviour moved.
  | { readonly outcome: 'residue'; readonly changes: readonly ContractChange[] }

/**
 * The deterministic reliance predicate, over one changed symbol.
 *
 * Every branch here is a STRUCTURAL fact about the declaration, which is why none
 * of them needs to look at how the dependent uses it:
 *
 * - Removed, and this change declares the name nowhere it could read: the
 *   reference cannot resolve. `breaks-on-build`, with no reading required.
 * - Removed, but the search for a replacement was incomplete: the mechanism is
 *   known, the outcome is not. `may-break` — claiming a build break would be a
 *   confident answer built on the missing input, which is this repository's
 *   recorded recurring defect class.
 * - Moved: the name resolves at a new address and the old address does not. Which
 *   of the two this dependent is bound to cannot be decided from a text match, so
 *   `may-break` — Revapi's third value, meaning "a human must look".
 * - New: the symbol did not exist before this change, so no dependent can have
 *   relied on a prior contract of it. `no-impact`, and this is a real precision
 *   win rather than a technicality: a new symbol referenced by the same change
 *   otherwise contributes pure noise to the reference list.
 * - Modified with nothing caller-observable detected: there is no changed part of
 *   the contract for anything to rely on, so there is no question to ask a model.
 *   `no-impact` here means "nothing was SHOWN" and never "safe" — the file stays
 *   in the reference list, which is where a reader can still judge it.
 */
export const adjudicateDeterministically = (input: {
  readonly symbol: ChangedSymbolReport
  readonly changes: readonly ContractChange[]
}): DeterministicVerdict => {
  const { symbol } = input
  const pairing = symbol.removalPairing

  if (symbol.changeKind === 'moved') {
    const moved =
      pairing?.match === 'same-name' ? pairing.declaration : undefined

    return {
      outcome: 'relies',
      compatibilityClass: 'may-break',
      contractElement:
        moved === undefined
          ? `the declaration of ${symbol.name}, which this change relocates`
          : `the declaration of ${symbol.name}, which this change relocates to ${moved.path}:${moved.line}`,
      consequence:
        'the name still resolves at its new location; a reference bound to the old location does not'
    }
  }

  if (symbol.changeKind === 'deleted') {
    const verified = pairing?.match === 'none'

    return {
      outcome: 'relies',
      compatibilityClass: verified ? 'breaks-on-build' : 'may-break',
      contractElement: `the declaration of ${symbol.name}, which this change removes`,
      consequence: verified
        ? 'this file references a name the change no longer declares, so the reference does not resolve'
        : 'this file references a name the change removes; whether the change re-declares it elsewhere could not be determined, so check before concluding either way'
    }
  }

  if (symbol.changeKind === 'new' || input.changes.length === 0) {
    return { outcome: 'no-impact' }
  }

  return { outcome: 'residue', changes: input.changes }
}

/**
 * Every (dependent file, changed symbol) pair, production first.
 *
 * Production before tests is not cosmetic: it is the order the call cap is spent
 * in, so a bounded run spends its budget on the dependents that break in
 * production rather than on the ones that break in CI. Within each bucket the
 * order discovery produced is kept — files this change also touched come first.
 */
export const collectAdjudicationPairs = (input: {
  readonly impactedFiles: readonly ImpactedFile[]
  readonly impactedTestFiles: readonly ImpactedFile[]
  readonly changedSymbols: readonly ChangedSymbolReport[]
}): readonly AdjudicationPair[] => {
  const symbolsByKey = new Map(
    input.changedSymbols.map((symbol) => [
      impactedSymbolKey({
        name: symbol.name,
        definitionPath: symbol.definitionPath,
        definitionLine: symbol.definitionLine
      }),
      symbol
    ])
  )
  const pairsIn = (
    files: readonly ImpactedFile[],
    destination: 'production' | 'test'
  ): readonly AdjudicationPair[] =>
    files.flatMap((file) =>
      file.symbols.flatMap((fileSymbol) => {
        const symbol = symbolsByKey.get(impactedSymbolKey(fileSymbol))

        // Unreachable through `runChangeImpact`, which builds both lists from one
        // set of symbols. Dropped rather than adjudicated on a guess: nothing can
        // be said about a change nobody recorded.
        return symbol === undefined
          ? []
          : [{ path: file.path, destination, symbol, sites: fileSymbol.sites }]
      })
    )

  return [
    ...pairsIn(input.impactedFiles, 'production'),
    ...pairsIn(input.impactedTestFiles, 'test')
  ]
}

const groupByFile = (
  reliances: readonly {
    readonly path: string
    readonly destination: 'production' | 'test'
    readonly compatibilityClass: ReportableCompatibilityClass
    readonly reliance: CandidateReliance
  }[]
): readonly CandidateImpactFinding[] => {
  const byPath = new Map<
    string,
    {
      readonly path: string
      readonly destination: 'production' | 'test'
      compatibilityClass: ReportableCompatibilityClass
      readonly reliances: CandidateReliance[]
    }
  >()

  for (const entry of reliances) {
    const existing = byPath.get(entry.path)

    if (existing === undefined) {
      byPath.set(entry.path, {
        path: entry.path,
        destination: entry.destination,
        compatibilityClass: entry.compatibilityClass,
        reliances: [entry.reliance]
      })
      continue
    }

    existing.reliances.push(entry.reliance)

    if (
      CLASS_RANK[entry.compatibilityClass] <
      CLASS_RANK[existing.compatibilityClass]
    ) {
      existing.compatibilityClass = entry.compatibilityClass
    }
  }

  return [...byPath.values()].map((file) => ({
    path: file.path,
    destination: file.destination,
    compatibilityClass: file.compatibilityClass,
    reliances: file.reliances
  }))
}

export type RunAdjudicationInput = {
  readonly pairs: readonly AdjudicationPair[]
  // What changed about each symbol, keyed by `impactedSymbolKey`. Structured
  // rather than the rendered sentences, because the compatibility class and the
  // consequence are properties of the DIMENSION and deriving either by matching on
  // English would make the report's prose load-bearing.
  readonly contractChanges: ReadonlyMap<string, readonly ContractChange[]>
  // The model seam. Absent means the residue goes unadjudicated and is counted;
  // it does NOT mean the deterministic tier is skipped, and it never means a pair
  // is reported as a maybe.
  readonly judge?: RelianceJudgementRunner
  // Upper bound on model calls for this run. Deterministic verdicts are free and
  // are never bounded by it.
  readonly maxCalls: number
  readonly signal?: AbortSignal
}

/**
 * Adjudicates every pair and returns the candidate findings, ungated.
 *
 * Nothing here decides admissibility. The candidates go through
 * `admitImpactFinding`, which is where spec 22's "a finding without a named
 * dependent MUST be rejected" is enforced — this module could not enforce it
 * honestly, because it is the thing that would be producing the bad finding.
 */
export const runAdjudication = async (
  input: RunAdjudicationInput
): Promise<AdjudicationOutcome> => {
  const reliances: {
    readonly path: string
    readonly destination: 'production' | 'test'
    readonly compatibilityClass: ReportableCompatibilityClass
    readonly reliance: CandidateReliance
  }[] = []
  let deterministicNoImpactPairCount = 0
  let unadjudicatedPairCount = 0
  let failedCallCount = 0
  let callsTruncated = false
  let callsSpent = 0
  const modelVerdictCounts: Record<RelianceVerdict, number> = {
    relies: 0,
    'does-not-rely': 0,
    undetermined: 0
  }

  for (const pair of input.pairs) {
    const key = impactedSymbolKey({
      name: pair.symbol.name,
      definitionPath: pair.symbol.definitionPath,
      definitionLine: pair.symbol.definitionLine
    })
    const changes = input.contractChanges.get(key) ?? []
    const verdict = adjudicateDeterministically({
      symbol: pair.symbol,
      changes
    })
    // Every pair has at least one site — `ImpactedFileSymbolSchema` requires it —
    // so the anchor below always exists. The finding is about the FILE, and the
    // first site is where a reader starts reading it.
    const anchor = pair.sites[0]

    // Both branches are settled in code without a call, so both belong to the
    // deterministic tier's count. (The second is unreachable through
    // `runChangeImpact` — `ImpactedFileSymbolSchema` requires a site — and is kept
    // as a guard rather than as a claim about a dependent.)
    if (verdict.outcome === 'no-impact' || anchor === undefined) {
      deterministicNoImpactPairCount += 1
      continue
    }

    if (verdict.outcome === 'relies') {
      reliances.push({
        path: pair.path,
        destination: pair.destination,
        compatibilityClass: verdict.compatibilityClass,
        reliance: {
          symbolName: pair.symbol.name,
          definitionPath: pair.symbol.definitionPath,
          definitionLine: pair.symbol.definitionLine,
          line: anchor.line,
          contractElement: verdict.contractElement,
          consequence: verdict.consequence,
          adjudicatedBy: 'deterministic'
        }
      })
      continue
    }

    if (input.judge === undefined) {
      unadjudicatedPairCount += 1
      continue
    }

    if (callsSpent >= input.maxCalls) {
      callsTruncated = true
      unadjudicatedPairCount += 1
      continue
    }

    callsSpent += 1

    let judged: RelianceJudgement

    try {
      judged = await input.judge(
        relianceJudgementInputFor({
          symbolName: pair.symbol.name,
          contractChanges: verdict.changes.map((change) => change.statement),
          dependentPath: pair.path,
          sites: pair.sites
        }),
        input.signal
      )
    } catch {
      // A provider failure is not a verdict, and it is not fatal. Spec 22 requires
      // a failed impact review to leave the pipeline and the diff review alone;
      // this is the finest-grained form of that — one failed call costs one pair.
      failedCallCount += 1
      unadjudicatedPairCount += 1
      continue
    }

    const verified = verifyRelianceJudgement(judged, pair.sites)

    // Counted before it is acted on, so the distribution covers every answer the
    // model gave — including the ones that end up reported nowhere.
    modelVerdictCounts[verified.status] += 1

    if (verified.status === 'does-not-rely') {
      continue
    }

    if (verified.status !== 'relies') {
      unadjudicatedPairCount += 1
      continue
    }

    reliances.push({
      path: pair.path,
      destination: pair.destination,
      // The declaration still exists under the same name, so nothing at build time
      // can see this. What moved is behaviour, and this dependent was shown to use
      // the part that moved.
      compatibilityClass: 'breaks-at-runtime',
      reliance: {
        symbolName: pair.symbol.name,
        definitionPath: pair.symbol.definitionPath,
        definitionLine: pair.symbol.definitionLine,
        // The model's own line, verified against the located sites. A finding
        // points where the reliance is, not where the file starts.
        line: verified.line,
        contractElement: `${pair.symbol.name} ${verdict.changes
          .map((change) => change.statement)
          .join('; ')}`,
        // Composed from the dimension, never written by the call that judged. See
        // `instructions.ts` for the measured reason.
        consequence: verdict.changes
          .map((change) => change.consequence)
          .join('; '),
        adjudicatedBy: 'model'
      }
    })
  }

  return {
    candidates: groupByFile(reliances),
    reliedUponPairCount: reliances.length,
    deterministicNoImpactPairCount,
    unadjudicatedPairCount,
    callsTruncated,
    failedCallCount,
    modelCallCount: callsSpent,
    modelVerdictCounts
  }
}
