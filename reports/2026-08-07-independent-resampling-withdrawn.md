# Independent resampling of the discovery call — WITHDRAWN BEFORE MEASUREMENT

**Status: withdrawn on prior evidence, before any run and before any code was
written.** No provider spend. This document keeps both the hypothesis and the reason
it was killed, because the reason is more useful than the hypothesis was.

## What was proposed

Four prompt-level interventions had read null, and the reviewer instructions already
say, verbatim, *"do not stop at the first defect you find […] There is no limit on how
many findings you may return"* — yet discovery returns **1.24 findings per case-run**
against a key naming **1.02**. Since yield is call-bound and the existing knob
(`maxFilesPerDiscoveryCall`) multiplies calls only by **partitioning files** — inert
on a corpus where **46 of 51 cases declare a single path** — the proposal was to issue
**k independent discovery calls over the same partition** and union them.

The pre-registered prediction was **+8pp or more**, on the reasoning that if selection
among several visible defects is noisy, more independent draws recover the advisory's
defect more often.

## Why it was withdrawn

Two measurements already paid for in this project bear on it directly. I wrote the
pre-registration before looking for them, which was the wrong order.

**1. A second pass over the same context was measured and removed.** The un-anchored
discovery pass A/B returned **+0.83pp recall, 10 gained / 9 lost, p = 0.82, for +136%
cost**, and was removed under its own pre-committed rule. It is the same shape as this
proposal — another look at the same material — and it moved nothing.

**2. The partition sweep already ran the closest available analogue, and it is flat.**

| `maxFilesPerDiscoveryCall` | recall | adjusted precision | cost |
| --- | --- | --- | --- |
| 2 (default) | 46.5% | 97.1% | $12.09 |
| 1 | **46.5%** | 97.1% | $16.51 |

Going from two files per call to one gives **every file its own dedicated call** —
per-file attention doubles. **Recall does not move at all**, for +36% cost. Spec 27
records the mechanism explicitly: below two files per call the extra calls keep
producing candidates (131 → 184), but they are **additional unlisted-real defects and
noise, not more of the listed ones**.

That is the exact failure mode this proposal would have reproduced. More looks produce
more real findings; they do not produce *the advisory's* finding.

## What this actually establishes, and it is worth more than the experiment

Three mechanically different ways of buying the reviewer more attention have now been
measured, and all three are flat on listed recall:

| mechanism | result |
| --- | --- |
| a second, differently-framed pass over the same context | +0.83pp, p = 0.82, removed |
| halving files per call so each file gets its own call | 46.5% → 46.5%, +36% cost |
| four prompt clauses instructing broader or better-targeted reporting | all null |

Set against the finding that the engine reads the right file in **67% of misses** and
emits **1.24 real findings** at **~98% adjusted precision**, the reading is now firm:

**The reviewer is not attention-starved and not volume-starved. It finds real defects
and reports them; the advisory's defect is simply not the one it ranks first, and
neither more looks nor more instructions change that ranking.**

"Selection within a file" was already the stated constraint. What is new is that the
obvious lever on selection — sample more and take the union — is closed by data rather
than by argument, and closed for **$0** rather than for the ~$25 the A/B would have
cost.

## The process failure, recorded

The pre-registration was written before I searched the ledger for prior art on its own
hypothesis. Pre-registration protects against reading the result you want out of data
you have already seen; it does nothing against proposing an experiment someone already
ran. **The order should be: search the ledger, then pre-register.** Had this gone the
other way, the run would have produced a well-documented, correctly-analysed, entirely
redundant null.

This is the fifth self-correction of the day and the only one that cost nothing to
make, because it happened before the spend rather than after the publication.

## What is NOT closed by this

- **Sub-file partitioning** — one *function* per call rather than one file — remains
  explicitly unmeasured in spec 27, and is not the same thing as resampling: it
  changes what each call is shown, rather than showing the same thing twice. It is the
  one attention lever the curve still points at.
- Whether the ~1.2-per-file ceiling is a property of the model or of this prompt is
  still unknown, and no measurement here distinguishes them.
