# Result: adjudication is NOT promoted — and my pre-registration's premise was wrong

Ran 2026-08-09 against `reports/2026-08-09-impact-adjudication-prereg.md`. Engine
`8f54399`, clean tree, `openai/gpt-5.3-codex`, 16 cases / 17 proven dependents,
**118 model calls**. The session's only provider spend.

**Verdict: not promoted, stays disabled. The recall criterion fails decisively. The
precision criterion cannot be decided on this corpus — and I should have known that
before spending anything.**

## The numbers

| | deterministic arm | after adjudication |
| --- | --- | --- |
| destination files predicted | 154 | **15** |
| of those, proven dependents | 8 | **2** |
| precision | lower bound 5.2% | **lower bound 13.3%** |
| directly-reachable recall | **50.0%** (5/10) | **0.0%** (0/7) [+3 unmeasured] |
| whole-repo-search recall | 42.9% (3/7) | 50.0% (2/4) [+3 unmeasured] |

Against spec 22's bar:

- **precision ≥ 50%** — **undecidable.** 13.3% is a *lower bound*; the upper bound is
  not measurable on this corpus by construction.
- **recall ≥ 40% of directly reachable** — **fails at 0%** (0 of 7 scored).
- **must beat the deterministic arm** — it does on precision (5.2% → 13.3%) and
  collapses on recall (50% → 0%).

## The error in my own pre-registration

I wrote that the study had become runnable, with a table of confidence intervals:
*"at 17 dependents a true precision near 22.2% has a 95% interval topping out at 42%,
which excludes the 50% bar."*

**That arithmetic was meaningless.** It treats precision as a proportion with a known
denominator. It is not: the answer key lists the dependents upstream *repaired*, not
every file each change affected, so a predicted file missing from the key is not
thereby wrong. **Only a lower bound is computable.** No sample size fixes that,
because the limit is the key's construction, not its size.

The 2026-08-06 ledger entry says exactly this — *"only a lower bound of 22.2% exists.
The upper bound is unmeasurable on this corpus by construction, so ≥50% cannot be
established here at all — not now, and not by re-running"* — and I quoted that entry
earlier the same day before building a sample-size argument that contradicts it.

So I spent 118 model calls re-establishing a limit already in the ledger. The recall
result below is real and worth having, but it was not what I set out to measure.

## What the run does establish, and it is the useful part

**Adjudication removes almost everything, including the true positives.** It cut 154
predicted files to 15 — and the two survivors are both `whole-repo-search`, the
weakest reachability class. On the **directly-reachable population that spec 22's
promote bar is about, it scored 0 of 7.** The deterministic tier had found 5 of 10
there.

That is not "adjudication trades recall for precision", which spec 22 anticipates and
accepts. It is adjudication discarding the class of dependent the capability exists
to report, while keeping two it found by grep.

**Half the corpus never exercised the judge.** 8 of 16 cases spent zero model calls;
28 pairs were never adjudicated at all (75 `does-not-rely`, 15 `relies`, 28
`undetermined`). So this is a measurement of the *lane*, not cleanly of the model
tier — a distinction the report itself is careful to draw.

## Decision

**Adjudication remains disabled by default.** The pre-registered rule offers "keep
disabled, keep shipping" for precision in 25–50%; precision is not decidable here, so
the recall failure carries the decision on its own.

**The model tier is NOT removed.** Spec 22 removes it if it cannot beat the
deterministic arm, and on precision it does (5.2% → 13.3% lower bound). Removing it on
a 0% recall reading, from a corpus where half the cases never called the model, would
be over-reading a run whose own report says a single run decides nothing.

**No re-run.** The pre-registration committed to one run, and re-running cannot fix a
metric that is unbounded above by construction.

## What would actually decide this

Not more cases. A corpus whose answer key enumerates **every** affected file for a
change, rather than the ones an upstream fix happened to repair. That is a different
and much more expensive curation problem, and until it exists spec 22's precision bar
is unfalsifiable — which is worth stating plainly in the spec rather than leaving as a
bar people keep trying to clear.
