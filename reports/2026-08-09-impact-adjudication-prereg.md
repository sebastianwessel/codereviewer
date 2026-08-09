# Pre-registration: impact adjudication on the 16-case corpus

**Written before the run.** Replaces `2026-08-08-impact-adjudication-prereg.md`, which
was voided because it assumed a corpus size that never hydrated. This one is written
against the corpus that actually exists and hydrates: **16 cases / 17 proven
dependents**, all 16 checked out cleanly.

## Why this is runnable, stated with the number that decides it

| N | 95% interval around a true 22.2% | vs the 50% bar |
| --- | --- | --- |
| 11 (original) | up to 46.8% | excludes, barely |
| 13 (after blanket drops) | up to 44.8% | excludes |
| **17 (after adjudication)** | **up to 42.0%** | **excludes** |

If precision is near the previously measured 22.2% lower bound, this corpus can say so
against the bar. **The denominator that matters is admitted findings, not dependents**
— the prior run admitted 9 from 10 cases, so 16 cases should admit ~14, where the
interval still tops out near 44% and still excludes the bar.

**If observed precision comes back materially higher — say 40% — the interval will
overlap 50% and the result is UNRESOLVED.** That is a real outcome, it is not a
licence to re-run, and it will be reported as unresolved rather than argued either
way.

## What changed about the corpus, and why it is not tuning

The 6 cases added since the last measurement were harvested and curated by processes
that never saw this bar. Of 14 harvested candidates, 5 were rejected on grounds
unrelated to any threshold here (out-of-scope language, no honest
`compatibilityClass`, no admissible dependent), and 3 more were dropped at hydration
for removed-comment contamination.

Four cases had their removed comments **adjudicated and acknowledged** rather than
being dropped wholesale, each with a written rationale in the manifest. That
adjudication was done before this pre-registration and without reference to what it
would do to precision — the rationale in each case is about whether the comment names
the dependent or the failure, not about the case's effect on a rate.

## Decision rule

Spec 22's bar, unchanged: precision **≥ 50%** of admitted findings naming a proven
dependent; recall **≥ 40%** of the proven dependents the reference list contains; the
model tier must beat the deterministic-only arm; no admitted finding may name a
provably unaffected dependent.

- **Promote adjudication to enabled by default** only if all four hold.
- **Keep disabled, keep shipping** if precision lands in 25–50% — the "real but noisy"
  band the published prior art occupies and where the last run landed.
- **Remove the model tier** if precision is below 25%, or if it fails to beat the
  deterministic arm, since beating that arm is its entire justification.
- **Unresolved** if the admitted-finding count leaves the interval straddling the bar.

## Committed in advance

- **One run.** No re-growing the corpus and re-running to reach a different number.
- Cost reported as measured. The prior run was **$0.08 for 61 model calls over 10
  cases**; this should be comparable and is the first provider spend of this session.
- The lane ships **non-blocking either way** — spec 22 forbids it blocking, so a
  favourable result changes a default and nothing else.
