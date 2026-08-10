# Pre-registration: showing discovery the deterministic signal facts

**Written before the run.** Engine `a7fd733`, corpus `security-advisory-2026`
(72 cases), `openai/gpt-5.3-codex`, judge pinned to the same model as every prior
entry on this corpus.

## The mechanism, verified in code rather than assumed

Deterministic signal facts are extracted on every run, byte-accounted in the
context ledger, and shipped in each task's `reviewContext`. Refutation receives
them (the packet passes `reviewContext` through wholesale). Discovery does not:
`HolisticReviewInput` is `taskId`, `paths` and one rendered `reviewText`, and
`buildContextSections` had no branch for `support-signal-output`. So the facts
reached the stage that adjudicates a candidate and never the stage that produces
one.

`review.signalFacts.enabled` renders them into the discovery packet. Off by
default; with it off the packet is byte-identical to before the section existed.

## What makes this different from the closed families, and what does not

**Different:** every prior null on this stage moved WORDING. Five pre-registered
prompt clauses split 7/8, 7/8, 7/7, 12/12, 16/16, and four attention mechanisms
were flat or negative. This ships DATA the run already computed, through a
channel that has been structurally empty since inception, which no prior null
covers.

**Not different:** it is still a change to the discovery prompt, on a stage whose
last five interventions all landed nowhere. The prior here is unfavourable and
this pre-registration does not pretend otherwise.

## Decision rule

Two arms, `review.signalFacts.enabled` false and true, everything else identical.
Run through `ab-run.sh` so arm ORDER alternates — the arm-order artifact on this
harness is measured (raw precision +5–6pp to whichever arm runs second, replicated
across two unrelated interventions), and no precision delta may be cited from a
run that did not alternate.

- **Promote to enabled by default** only if in-diff recall improves by more than
  the run-to-run band AND adjusted precision does not fall AND the paired
  per-expectation sign test over the pooled in-diff population reaches p < 0.05.
- **Keep shipped, disabled** if recall moves favourably but the sign test does
  not clear p < 0.05. That is the honest home for an unproven capability, and it
  is where the dedicated security pass already lives.
- **Remove the key, the section and the flag** if adjusted precision falls, or if
  the packet-budget failures or provider errors rise above the control arm. A
  capability that costs prompt on every call and cannot show a gain does not get
  to stay on an underpowered null.

## Committed in advance

- **Three seeds per arm.** Three seeds resolve roughly 11pp on this corpus
  (pooled sd 5.71pp), which this pre-registration states plainly as the limit: a
  real effect smaller than that will read as null here, and that is a bound on
  what the run can conclude, not a licence to add seeds after seeing the number.
- **No optional stopping.** The 2026-08-08 confirmation study exists because an
  exploratory +5.13pp at 14/6 did not reproduce at ten seeds. Six more seeds are
  deliberately not budgeted.
- **Cost reported as measured**, both arms, alongside the $4.17 already spent this
  session on the artifact-only work.
- **A smoke first**, ~6 cases, to confirm the section renders into a real packet
  and that the budget guard sizes it — measurability before spend, which has
  changed the design of every study it has run on.
