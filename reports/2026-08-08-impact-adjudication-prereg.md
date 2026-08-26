# VOID — the premise of this pre-registration was falsified before the run

**Do not treat anything below as a live study.** It was written on the premise that
the corpus had grown to **19 cases / 25 proven dependents**. It had not: 7 of the 9
new cases failed the hydrator's contamination gate and were dropped, leaving
**12 cases / 13 dependents** — barely above the 11 at which I had called this study
blocked the first time.

At 13 dependents a true precision near 22.2% has a 95% interval reaching ~44.8%,
which is close enough to the 50% bar that a modestly higher observed value would
overlap it. The pre-registration's own clause applies: *report unresolved rather
than squeeze a verdict*. Rather than run a study that would almost certainly report
unresolved, it is voided.

**Wave 2.1 returns to blocked**, at essentially the size it was blocked at before.

**Root cause, and it is mine.** My curation brief specified the output shape and the
disclosure rule but never told the curator that `removedCommentDisclosureReview` is
MANDATORY — every case must record a judgement on each prose comment its reviewed
diff removes, or the hydrator refuses it. The 9 new cases are real and verified; they
are simply unfinished, and finishing them means a curator adjudicating each removed
comment. Same defect class as the id-slug leak earlier today: I specified the
artefact and assumed the process constraints would follow.

---

# Pre-registration: impact adjudication on the grown corpus

**Written before the run, and before the corpus was hydrated.** This supersedes the
"Wave 2.1 is blocked" finding earlier today, and says plainly why that finding changed.

## Why this is now runnable when it was not this morning

At **11 proven dependents** I recorded that spec 22's promote bar could be neither
reached nor failed, and gated the study on corpus growth. The corpus has since grown
to **19 cases / 25 proven dependents**, so the arithmetic was re-run rather than
inherited:

| | N | sd at the 50% bar | 95% CI half-width |
| --- | --- | --- | --- |
| this morning | 11 | 15.1pp | 29.5pp |
| now | 25 | 10.0pp | 19.6pp |

The decisive figure: if precision is really near the previously measured **22.2%
lower bound**, its 95% interval at this size tops out around **38.5%** — which
**excludes the 50% bar**. A run can now return a defensible *fail*. It could not
before.

**Stated honestly: the precision denominator is admitted findings, not proven
dependents.** The prior run admitted 9 findings from 10 cases; 19 cases should admit
roughly 17. At N≈17 the upper edge sits near 42%, still excluding the bar but with
less room. If the run admits far fewer findings than that, the result is **unresolved
and will be reported as unresolved**, not squeezed into a verdict.

## What is being measured

`eval impact` with adjudication enabled, over the 19-case corpus, scored against
spec 22's existing bar:

- **precision ≥ 50%** of admitted findings naming a proven dependent;
- **recall ≥ 40%** of the proven dependents the reference list itself contains;
- the deterministic tier must not already match it;
- no admitted finding may name a provably unaffected dependent.

## Decision rule, fixed now

- **Promote adjudication to enabled by default** only if all four hold.
- **Keep disabled and keep shipping it** if precision lands in the 25–50% band — the
  "real but noisy" range the published prior art occupies, and the prior run's result.
- **Remove the model tier** if precision falls below 25%, or if it fails to beat the
  deterministic-only arm, since its whole justification is beating that arm.
- **Report unresolved** if the admitted-finding count is too small for the interval to
  clear or exclude the bar. This is a real outcome and is not a licence to re-run
  until it resolves.

## Committed in advance

- **One run.** The corpus is not re-grown and the study not repeated to chase a
  different number.
- The cost is expected to be small — the prior run was **$0.08 for 61 model calls
  across 10 cases** — and will be reported as measured, not estimated.
- The 9 new cases were curated today by a process that did not see this bar and could
  not have been tuned to it: curation verified each dependent against the upstream fix
  commit, and rejected 5 of 14 candidates on grounds unrelated to any threshold here.
- **This is a measurement of a lane that ships disabled either way.** Spec 22 forbids
  the lane blocking anything, and a favourable result changes a default, not that.
