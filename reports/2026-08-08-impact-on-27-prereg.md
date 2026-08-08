# Pre-registration: impact adjudication against the 27 out-of-diff expectations

**Written before any adjudicated run on this population exists.** The free
deterministic precheck is running as this is written; its result is a *ceiling*
measurement and is reported whatever it says, including if it kills the study.

## The question

`review` scores a measured **0 of 27** on out-of-diff expectations — defects in a
changed file that the diff does not touch. That zero is a scope boundary, not a
defect: diff-scoped attention holding exactly as designed.

`impact check` is the lane built for that population. Its deterministic core
**localises 20 of 27 (74.1%)** — the defect sits inside a symbol it flagged as
changed. **That figure is coverage, not detection**, and it has never been carried
through adjudication on this population. So the product question — *does this
project answer the consequence half of code review?* — is currently unanswered.

## What is already known, and why it constrains this

The only adjudicated measurement (2026-08-06, `change-impact-dependents`, 10 cases /
11 proven dependents, $0.08) returned **"ships disabled, not removed, not
promoted"**: precision lower bound 22.2% against a 50% promote bar, upper bound
unmeasurable on that corpus by construction, decision-denominator recall 50% (2/4).

It also relocated the binding constraint: **five of ten cases spent zero model calls
and three enumerated no reference files at all.** Seeding and contract-delta
detection limit this lane, not adjudication.

**That is why this study measures the ceiling first, for free.** If the reference
list does not contain the expectation's file, no amount of model work can find it,
and the honest next step is deterministic seeding work rather than a paid A/B.

## Primary endpoint

Against the **27 out-of-diff expectations** (20 cases, real-repo corpus):

- **Ceiling (free):** of 27, how many have their file in the deterministic reference
  list, split into `SEEDED+HIT`, `SEEDED+MISS` (reach problem) and `NO-SEED`
  (seeding problem).
- **Detection (paid):** of the `SEEDED+HIT` population, how many does adjudication
  admit as a consequence finding naming that file.
- **Noise:** admitted findings per case across all 37 corpus cases, not just the 20 —
  a lane that fires constantly on the other 17 is unusable regardless of recall.

## Decision rule, fixed now

Spec 22's promote bar governs and is not being restated more leniently:
precision **≥ 50%**, recall **≥ 40%** of what the reference list itself contains, the
deterministic tier must not already match it, and no admitted finding may name a
provably unaffected dependent.

Applied here:

- **Enable `changeImpact` + adjudication by default** only if all four hold AND the
  firing rate stays **≤ 1 admitted finding per case** across the full 37.
- **Ship enabled with adjudication OFF** if the deterministic reference list is
  useful on its own but adjudication misses the bar — the reference report is free
  and deterministic, so this is a real intermediate state, not a consolation.
- **Keep both off** if precision lands below 25%, the "training a reader to ignore
  it" floor.
- **Deterministic work instead of a paid study** if the ceiling shows the dominant
  failure is `NO-SEED` or `SEEDED+MISS`. In that case the model layer is not the
  constraint and paying to measure it would answer the wrong question.

## Stated in advance

- The 27 are **20 cases**, and several cases carry more than one expectation, so the
  effective independent sample is smaller than 27. A single case moves the rate by
  roughly 5–10 points. **No result here will be quoted as a precise rate.**
- This corpus is the one `review` was tuned against across many sessions. It is
  **not** held out for the impact lane in any strong sense, though the impact lane
  has never been tuned on it.
- Adjudication cost on the prior corpus was $0.08 for 10 cases. If cost here exceeds
  ~$5 the run stops and reports that, rather than being expanded.
- If the lane is promoted, `changeImpact.enabled` defaulting true must **not** also
  make it blocking — spec 22 forbids a blocking key and that is not revisited here.
