import type {
  IntentFulfilmentReport,
  Obligation,
  ObligationStatus
} from '../../intent-fulfilment/index.js'
import type { IntentLineMapEntry } from './intent-corpus-hydration.js'
import {
  intentArms,
  type IntentArm,
  type IntentCorpusCase,
  type OutstandingExpectation
} from './intent-corpus.schema.js'

// The intent-fulfilment scorer (spec 23 §Evaluation).
//
// IT ANSWERS ONE QUESTION FIRST, AND SPEC 23 SAYS WHY. "The dangerous output is not
// 'missed an obligation'. It is confidently asserting an obligation is satisfied
// when it is not, because that stops a human looking." The decision rule fixed
// before the first measurement is *ship only if the false-satisfied rate is low*,
// so that rate is the headline here and everything else is context for it.
//
// HOW A REPORTED OBLIGATION IS JOINED TO THE ANSWER KEY. Not by matching statement
// text: extraction is non-deterministic, obligation ids are positional, and a
// lexical threshold tuned against stored runs would be an instrument tuned to the
// engine it grades. The join is the CITATION spec 23 already requires every
// obligation to carry — "an obligation the reviewer inferred rather than read is
// not an obligation" — resolved back to the source document through the line map
// hydration wrote. An expectation and an obligation are the same obligation when
// they point at the same clause of the stated intent.
//
// WHAT THAT COSTS, STATED RATHER THAN BURIED. An obligation no expectation anchors
// is UNSCORED, not correct: the answer key enumerates what a human found
// outstanding, never every clause of the excerpt. The unanchored count is reported
// beside every rate, because a run whose obligations mostly land outside the key is
// a run whose figures cover little of what it said.

/**
 * Whether a reported verdict leaves the obligation on the list a human reads.
 *
 * THIS TABLE ANSWERS ONE QUESTION and not "is this good news?". Spec 23's headline
 * `notEvidencedCount` counts `not-evidenced` plus `undetermined`; an `evidenced`
 * and a `not-contradicted` obligation are off it. A scorer that put a row back on a
 * list the engine took it off would be grading a report nobody receives.
 *
 * `not-contradicted` is OFF THE LIST BY DECISION, and the decision has a price
 * which is charged rather than excused. The verdict says a search over the changed
 * lines came back empty, never that the obligation holds at head — so an obligation
 * this corpus calls outstanding that comes back `not-contradicted` is counted twice
 * over: it is missing from outstanding recall AND it lands in the false-satisfied
 * numerator, on the same footing as a wrong `evidenced`. Spec 23's pre-registration
 * demands exactly that ("a wrong `not-contradicted` counts as a false-satisfied
 * claim").
 */
export const OUTSTANDING_LIST_PLACEMENT: Readonly<
  Record<ObligationStatus, 'on-list' | 'off-list'>
> = {
  'not-evidenced': 'on-list',
  undetermined: 'on-list',
  evidenced: 'off-list',
  'not-contradicted': 'off-list'
}

/**
 * Places one reported obligation on or off the outstanding list, and THROWS on a
 * status this scorer has never been told about.
 *
 * Throwing is the point. Before 2026-08-06 the harness scorers ended their status
 * chain with no final branch, so an unknown verdict fell through to "not on the
 * list" and was scored as satisfied — a published figure whose meaning nobody had
 * chosen. That is not hypothetical: `not-contradicted` shipped that day and was
 * absorbed exactly that way. A fifth verdict must be a loud failure here, not a
 * quiet improvement to the numbers.
 */
export const listPlacement = (input: {
  readonly caseId: string
  readonly obligation: Obligation
}): 'on-list' | 'off-list' => {
  const placement = OUTSTANDING_LIST_PLACEMENT[input.obligation.status] as
    | 'on-list'
    | 'off-list'
    | undefined

  if (placement === undefined) {
    throw new Error(
      `${input.caseId}/${input.obligation.id}: unrecognised reported status ${JSON.stringify(input.obligation.status)}. This scorer will not guess whether a verdict it has never seen belongs on the outstanding list. Add it to OUTSTANDING_LIST_PLACEMENT with the reason, and record the decision in specs/23-intent-fulfilment-review.md.`
    )
  }

  return placement
}

export const intentUnmeasuredReasons = [
  'not-hydrated',
  'stale-checkout',
  'engine-error',
  'capability-disabled',
  'provider-unavailable',
  'no-intent'
] as const

export type IntentUnmeasuredReason = (typeof intentUnmeasuredReasons)[number]

/**
 * What one case produced.
 *
 * `refused` is its own outcome and not a kind of failure. Spec 23's limits REFUSE
 * the run rather than truncate it, and exit 4 with a structured code is the engine
 * declining to answer — a different fact from the run breaking. Either way the case
 * is excluded from every rate with its id and reason printed, and never counted as
 * a case with zero obligations, which would drag every rate down while looking like
 * a result.
 */
export type IntentCaseOutcome =
  | {
      readonly status: 'scored'
      readonly report: IntentFulfilmentReport
      readonly lineMap: readonly IntentLineMapEntry[]
    }
  | {
      readonly status: 'refused'
      readonly code: string
      readonly detail: string
    }
  | {
      readonly status: 'unmeasured'
      readonly reason: IntentUnmeasuredReason
      readonly detail: string
    }

export type IntentCaseInput = {
  readonly corpusCase: IntentCorpusCase
  readonly outcome: IntentCaseOutcome
}

export type IntentRate =
  | {
      readonly status: 'measured'
      readonly matched: number
      readonly total: number
      readonly rate: number
    }
  | { readonly status: 'not-measured'; readonly reason: string }

const rate = (matched: number, total: number, reason: string): IntentRate =>
  total === 0
    ? { status: 'not-measured', reason }
    : { status: 'measured', matched, total, rate: matched / total }

/** How the run treated one enumerated outstanding obligation. */
export type ExpectationOutcome =
  // At least one obligation citing this clause stayed on the list a human reads.
  | 'reported-outstanding'
  // Obligations cited this clause and EVERY one of them was off the list. This is
  // the claim spec 23 calls the expensive error.
  | 'false-satisfied'
  // No obligation cited this clause at all. A recall miss, and deliberately NOT a
  // false-satisfied claim: the run asserted nothing about it, so nobody was
  // invited to stop looking.
  | 'not-reported'

export type ScoredIntentExpectation = {
  readonly caseId: string
  readonly arm: IntentArm
  readonly expectationId: string
  readonly statement: string
  readonly outcome: ExpectationOutcome
  readonly candidateObligationIds: readonly string[]
  // The off-list verdicts that cleared this obligation, in report order. Empty
  // unless `outcome` is `false-satisfied`; kept per status because spec 23 needs
  // a wrong `not-contradicted` to be visible as its own share of the numerator
  // rather than folded into one total.
  readonly clearedBy: readonly ObligationStatus[]
}

export type IntentArmMetrics = {
  readonly arm: IntentArm
  readonly scoredCaseCount: number
  readonly expectationCount: number
  // Of the enumerated outstanding obligations, how many the run left on the list.
  readonly outstandingRecall: IntentRate
  readonly falseSatisfied: IntentFalseSatisfiedMetrics
  readonly obligationCount: number
  readonly anchoredObligationCount: number
  // Obligations no expectation anchors. Unscored — see the header.
  readonly unanchoredObligationCount: number
  readonly notContradictedCount: number
  readonly notContradictedClearingOutstandingCount: number
  readonly humanObligationCount: number
}

export type IntentFalseSatisfiedMetrics = {
  // THE NUMERATOR SPEC 23 ASKS FOR, exactly: enumerated outstanding obligations
  // the run reported off the list a human reads.
  readonly claimCount: number
  readonly viaEvidenced: number
  readonly viaNotContradicted: number
  // Of the outstanding obligations the run REACHED at all, the share it cleared.
  // Named for its denominator because it is not spec 23's.
  readonly rateOverReached: IntentRate
  // Spec 23's own denominator is every obligation reported `evidenced` or
  // `not-contradicted`, and it is PERMANENTLY not measurable on this corpus.
  readonly rateOverAllSatisfiedClaims: IntentRate
}

export type IntentCaseScore =
  | {
      readonly caseId: string
      readonly arm: IntentArm
      readonly status: 'scored'
      readonly obligationCount: number
      readonly anchoredObligationCount: number
      readonly notContradictedCount: number
      readonly expectations: readonly ScoredIntentExpectation[]
    }
  | {
      readonly caseId: string
      readonly arm: IntentArm
      readonly status: 'refused'
      readonly code: string
      readonly detail: string
      readonly expectationCount: number
    }
  | {
      readonly caseId: string
      readonly arm: IntentArm
      readonly status: 'unmeasured'
      readonly reason: IntentUnmeasuredReason
      readonly detail: string
      readonly expectationCount: number
    }

export type IntentCoverage = {
  readonly totalCaseCount: number
  readonly scoredCaseCount: number
  readonly refusedCaseCount: number
  readonly unmeasuredCaseCount: number
  readonly totalExpectationCount: number
  readonly scoredExpectationCount: number
}

export type IntentScore = {
  readonly coverage: IntentCoverage
  readonly arms: Readonly<Record<IntentArm, IntentArmMetrics>>
  readonly caseScores: readonly IntentCaseScore[]
  // Facts about the run that make a rate above readable or unreadable. They are
  // produced by the scorer rather than by the command, because the conditions that
  // make a figure meaningless are properties of the scoring.
  readonly warnings: readonly string[]
}

// Spec 23's denominator, and why it can never be filled from this corpus. Written
// once, used wherever the rate is reported, so the two cannot drift.
export const SPEC_DENOMINATOR_NOT_MEASURABLE =
  "Spec 23's own denominator is every obligation reported `evidenced` or `not-contradicted`, and this corpus cannot supply it: the answer key enumerates the obligations a human found OUTSTANDING at head, not a truth for every clause an extraction might propose. Classifying the rest would take one hand judgement per reported obligation per run, against a non-deterministic obligation set. The numerator (`claimCount`) is exactly what spec 23 asks for; the denominator is not, and no figure here may be quoted as that rate."

const sourceLineOf = (input: {
  readonly bodyLine: number
  readonly lineMap: readonly IntentLineMapEntry[]
}): number | undefined =>
  input.lineMap.find((entry) => entry.bodyLine === input.bodyLine)?.sourceLine

const anchorsLine = (
  expectation: OutstandingExpectation,
  sourceLine: number
): boolean =>
  expectation.intentLineRanges.some(
    ([from, to]) => sourceLine >= from && sourceLine <= to
  )

const scoreCase = (input: IntentCaseInput): IntentCaseScore => {
  const { corpusCase, outcome } = input

  if (outcome.status !== 'scored') {
    return outcome.status === 'refused'
      ? {
          caseId: corpusCase.id,
          arm: corpusCase.arm,
          status: 'refused',
          code: outcome.code,
          detail: outcome.detail,
          expectationCount: corpusCase.outstandingExpectations.length
        }
      : {
          caseId: corpusCase.id,
          arm: corpusCase.arm,
          status: 'unmeasured',
          reason: outcome.reason,
          detail: outcome.detail,
          expectationCount: corpusCase.outstandingExpectations.length
        }
  }

  // EVERY reported status is placed before anything is scored, including the
  // obligations no expectation anchors. A verdict this scorer has never heard of
  // must be a loud failure wherever it appears; hiding in an unanchored row is
  // exactly how one would reach a published number unnoticed, because unanchored
  // rows are silently unscored by design.
  const placements = outcome.report.obligations.map((obligation) => ({
    obligation,
    placement: listPlacement({ caseId: corpusCase.id, obligation }),
    sourceLine: sourceLineOf({
      bodyLine: obligation.source.line,
      lineMap: outcome.lineMap
    })
  }))
  const anchoredObligationIds = new Set<string>()
  const expectations = corpusCase.outstandingExpectations.map(
    (expectation): ScoredIntentExpectation => {
      const candidates = placements.filter(
        (entry) =>
          entry.sourceLine !== undefined &&
          anchorsLine(expectation, entry.sourceLine)
      )

      for (const candidate of candidates) {
        anchoredObligationIds.add(candidate.obligation.id)
      }

      const onList = candidates.filter(
        (candidate) => candidate.placement === 'on-list'
      )

      return {
        caseId: corpusCase.id,
        arm: corpusCase.arm,
        expectationId: expectation.id,
        statement: expectation.statement,
        outcome:
          candidates.length === 0
            ? 'not-reported'
            : onList.length > 0
              ? 'reported-outstanding'
              : 'false-satisfied',
        candidateObligationIds: candidates.map(
          (candidate) => candidate.obligation.id
        ),
        clearedBy:
          onList.length > 0
            ? []
            : candidates.map((candidate) => candidate.obligation.status)
      }
    }
  )

  return {
    caseId: corpusCase.id,
    arm: corpusCase.arm,
    status: 'scored',
    obligationCount: outcome.report.obligations.length,
    anchoredObligationCount: anchoredObligationIds.size,
    notContradictedCount: placements.filter(
      (entry) => entry.obligation.status === 'not-contradicted'
    ).length,
    expectations
  }
}

const emptyArmMetrics = (arm: IntentArm): IntentArmMetrics => ({
  arm,
  scoredCaseCount: 0,
  expectationCount: 0,
  outstandingRecall: {
    status: 'not-measured',
    reason: 'No case in this arm was scored.'
  },
  falseSatisfied: {
    claimCount: 0,
    viaEvidenced: 0,
    viaNotContradicted: 0,
    rateOverReached: {
      status: 'not-measured',
      reason: 'No case in this arm was scored.'
    },
    rateOverAllSatisfiedClaims: {
      status: 'not-measured',
      reason: SPEC_DENOMINATOR_NOT_MEASURABLE
    }
  },
  obligationCount: 0,
  anchoredObligationCount: 0,
  unanchoredObligationCount: 0,
  notContradictedCount: 0,
  notContradictedClearingOutstandingCount: 0,
  humanObligationCount: 0
})

const scoreArm = (input: {
  readonly arm: IntentArm
  readonly cases: readonly IntentCaseInput[]
  readonly caseScores: readonly IntentCaseScore[]
}): IntentArmMetrics => {
  const armCaseScores = input.caseScores.filter(
    (caseScore) => caseScore.arm === input.arm
  )
  const scored = armCaseScores.filter(
    (caseScore) => caseScore.status === 'scored'
  )

  if (scored.length === 0) {
    return emptyArmMetrics(input.arm)
  }

  const expectations = scored.flatMap((caseScore) => caseScore.expectations)
  const reportedOutstanding = expectations.filter(
    (expectation) => expectation.outcome === 'reported-outstanding'
  ).length
  const falseSatisfiedRows = expectations.filter(
    (expectation) => expectation.outcome === 'false-satisfied'
  )
  const reached = reportedOutstanding + falseSatisfiedRows.length
  const obligationCount = scored.reduce(
    (total, caseScore) => total + caseScore.obligationCount,
    0
  )
  const anchoredObligationCount = scored.reduce(
    (total, caseScore) => total + caseScore.anchoredObligationCount,
    0
  )
  const scoredCaseIds = new Set(scored.map((caseScore) => caseScore.caseId))

  return {
    arm: input.arm,
    scoredCaseCount: scored.length,
    expectationCount: expectations.length,
    outstandingRecall: rate(
      reportedOutstanding,
      expectations.length,
      'No case in this arm enumerates an outstanding obligation.'
    ),
    falseSatisfied: {
      claimCount: falseSatisfiedRows.length,
      viaEvidenced: falseSatisfiedRows.filter((row) =>
        row.clearedBy.includes('evidenced')
      ).length,
      viaNotContradicted: falseSatisfiedRows.filter((row) =>
        row.clearedBy.includes('not-contradicted')
      ).length,
      rateOverReached: rate(
        falseSatisfiedRows.length,
        reached,
        'The run reported no obligation citing any enumerated outstanding clause, so there is nothing to take a share of.'
      ),
      rateOverAllSatisfiedClaims: {
        status: 'not-measured',
        reason: SPEC_DENOMINATOR_NOT_MEASURABLE
      }
    },
    obligationCount,
    anchoredObligationCount,
    unanchoredObligationCount: obligationCount - anchoredObligationCount,
    notContradictedCount: scored.reduce(
      (total, caseScore) => total + caseScore.notContradictedCount,
      0
    ),
    notContradictedClearingOutstandingCount: falseSatisfiedRows.filter((row) =>
      row.clearedBy.includes('not-contradicted')
    ).length,
    humanObligationCount: input.cases
      .filter(
        (caseInput) =>
          caseInput.corpusCase.arm === input.arm &&
          scoredCaseIds.has(caseInput.corpusCase.id)
      )
      .reduce(
        (total, caseInput) => total + caseInput.corpusCase.humanObligationCount,
        0
      )
  }
}

// The degenerate results worth calling out, in both directions, because each is the
// cheapest signal that a figure above should not be read at all.
const armWarnings = (metrics: IntentArmMetrics): readonly string[] => {
  if (metrics.scoredCaseCount === 0) {
    return []
  }

  const warnings: string[] = []

  if (metrics.obligationCount > 0 && metrics.anchoredObligationCount === 0) {
    warnings.push(
      `${metrics.arm}: not one of the ${metrics.obligationCount} reported obligation(s) cites a clause the answer key anchors, so every rate in this arm is over an empty join. Check the hydrated line map before reading anything.`
    )
  }

  if (metrics.notContradictedCount * 2 >= metrics.obligationCount && metrics.obligationCount > 0) {
    warnings.push(
      `${metrics.arm}: ${metrics.notContradictedCount} of ${metrics.obligationCount} obligation(s) came back not-contradicted. A verdict for obligations kept by changing nothing should not be the modal answer; check the judgement prompt's first boundary (work asked to be CARRIED OUT is never not-contradicted) before reading any rate.`
    )
  }

  if (metrics.notContradictedCount === 0 && metrics.obligationCount > 0) {
    warnings.push(
      `${metrics.arm}: no obligation came back not-contradicted. The verdict shipped 2026-08-06 and the corpus does contain prohibition-shaped clauses, so zero is a finding about the prompt rather than a clean result.`
    )
  }

  return warnings
}

/**
 * Scores every case of an intent-fulfilment eval run.
 *
 * Cases that refused or could not be measured are kept out of every numerator and
 * denominator and reported as coverage. Scoring one of them as zero recall would
 * publish a failure of the harness, or a correct refusal, as a failure of the
 * engine.
 */
export const scoreIntentCases = (
  cases: readonly IntentCaseInput[]
): IntentScore => {
  const caseScores = cases.map(scoreCase)
  const arms = Object.fromEntries(
    intentArms.map((arm) => [arm, scoreArm({ arm, cases, caseScores })])
  ) as Record<IntentArm, IntentArmMetrics>
  const scored = caseScores.filter((caseScore) => caseScore.status === 'scored')

  return {
    coverage: {
      totalCaseCount: cases.length,
      scoredCaseCount: scored.length,
      refusedCaseCount: caseScores.filter(
        (caseScore) => caseScore.status === 'refused'
      ).length,
      unmeasuredCaseCount: caseScores.filter(
        (caseScore) => caseScore.status === 'unmeasured'
      ).length,
      totalExpectationCount: cases.reduce(
        (total, caseInput) =>
          total + caseInput.corpusCase.outstandingExpectations.length,
        0
      ),
      scoredExpectationCount: scored.reduce(
        (total, caseScore) => total + caseScore.expectations.length,
        0
      )
    },
    arms,
    caseScores,
    warnings: intentArms.flatMap((arm) => armWarnings(arms[arm]))
  }
}
