# Wave 2 is instrument-limited, on both halves, and the precheck was free

Written 2026-08-08. **No provider calls.** Arithmetic over figures already in the
ledger, run before designing either study — the measurability precheck that has
changed the design every time this project has used it.

## The conclusion

**Neither half of Wave 2 can be run informatively today.** Both are limited by corpus
size rather than by ideas, and in both cases the fix is the same as Wave 1.2's:
more cases, not a better intervention.

## 2.1 — impact adjudication re-measure

Spec 22's promote bar is precision ≥ 50% and recall ≥ 40% of what the reference list
contains. The corpus holds **11 proven dependents**.

At that size a single expectation moves a rate by roughly 20 points. The bar can
therefore be neither **reached nor failed**: a run would produce a number, and the
number would not decide anything. Gated on the harvest, not on the model.

## 2.2 — intent calibration to the 60% bar

The diagnosis is specific and already measured: `not-contradicted` fires on
**1.6–2.8%** of obligations against the **39.8%** population it was added for, and
LIST precision sits at **53.5% / 53.0%** against a pre-registered **60%** target.

The precheck splits this into two endpoints that behave completely differently:

| endpoint | change under test | N | sd | resolvable? |
| --- | --- | --- | --- | --- |
| `not-contradicted` firing rate | ~2% → up to ~40% (**38pp**) | 436 obligations | ≤ 2.34pp | **yes, easily** |
| LIST precision | 53.5% → 60% (**6.5pp**) | ~126 statements | 4.44pp | **no** — resolves ~9.0pp |

So a study can establish **whether the clause makes the verdict fire**, and cannot
establish **whether firing improves precision**, which is the thing the 60% bar is
about. Running it and reporting the firing rate as if it settled the bar would be
answering the easy question and quoting it against the hard one.

On top of that, intent's **87% self-agreement ceiling** means ~13% of verdicts differ
between two runs over the same input. Every intent figure sits under that ceiling,
and a 6.5pp target sits well inside it.

## What would make each runnable

- **2.1**: the harvest. Roughly 40 more proven dependents, which the rate arithmetic
  in `2026-08-08-impact-corpus-harvest.md` puts at ~5,400 more commit bodies.
- **2.2**: roughly **double** the intent corpus. Resolving 6.5pp needs sd ≈ 3.2pp,
  which is ~240 statements against today's ~126.

Neither is a research problem. Both are curation.

## Why this is written down instead of just done

The temptation was to run 2.2 anyway — it is a small study, the diagnosis is real,
and the firing-rate endpoint would have produced a satisfying number. That number
would have been quoted against a bar it cannot reach, which is precisely the error
this project corrected twice in the last two days: a figure measured on one
denominator and reported against another.

It also spends provider budget to learn something the arithmetic already says. The
precheck cost nothing and the study would not have been free.

**Recorded as: both Wave 2 items pre-registered as blocked on corpus size, with the
threshold each needs stated in advance so nobody re-derives this.**
