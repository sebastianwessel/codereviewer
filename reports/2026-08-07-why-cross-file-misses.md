# Cross-file misses are not silence, and not a retrieval failure

Derived 2026-08-07 from the three security-baseline runs already on disk. No
provider calls, no cost. It corrects a conclusion I drew in
`2026-08-07-security-corpus-baseline.md` on the same data.

## The conclusion it corrects

That report says cross-file recall of 9/24 is "the largest measured deficit
that instrument noise does not explain" and calls it the thing to act on. The
first half stands. The implied lever — that the reviewer needs to reach further
into other files — does not.

## What the telemetry says

Averages over 75 case-runs (25 cases × 3 seeds), split by the expectation's
context depth:

| depth | recall | discovery calls | raw findings | candidates |
| --- | --- | --- | --- | --- |
| cross-function | 9/9 | 1.00 | 1.44 | 1.44 |
| local | 13/18 | 1.00 | 1.00 | 1.00 |
| implementation | 10/18 | 1.00 | 1.50 | 1.39 |
| callee | 4/9 | 1.00 | 0.89 | 0.89 |
| cross-file | 9/24 | 1.12 | 1.33 | 1.25 |

And cross-file expectations alone, split by outcome:

| | n | discovery calls | raw findings | candidates |
| --- | --- | --- | --- | --- |
| found | 9 | 1.00 | 1.11 | 1.11 |
| **missed** | 15 | **1.20** | **1.47** | **1.33** |

**On the cross-file expectations it missed, the reviewer made more calls and
produced more findings than on the ones it found.** It was not quiet, and it was
not short of attempts.

## Where the misses actually go

Of **33 missed expectation-observations** across all depths:

| | n | |
| --- | --- | --- |
| the reviewer reported a *different* defect the judge called real | 11 | 33% |
| the reviewer produced no candidate at all | **4** | 12% |
| everything else — a candidate that matched neither | 18 | 55% |

For **cross-file specifically: 15 misses, 0 of them silent.** The reviewer said
something about every single one.

## The binding constraint is one finding per case

| | |
| --- | --- |
| candidates per case-run | **1.17** |
| expected findings per case | **1.04** |
| case-runs producing exactly one candidate | 55 of 75 |
| case-runs producing zero | 4 of 75 |
| of all 88 candidates: matched an expectation | 45 (51.1%) |
| of all 88 candidates: judged a real defect the key does not list | 17 (19.3%) |

The engine emits approximately **one finding per case**, and the answer key names
approximately **one defect per case**. Recall on this corpus is therefore
substantially the question *did the single thing it reported happen to be the
single thing the advisory named* — and about a fifth of what it reports is a real
defect the advisory simply did not cover.

That is why cross-file loses. Not because the reviewer cannot see other files —
it has the mediated read/list/grep tools by default, it used them more on the
cases it missed, and it never fell silent. It loses a **selection contest** under a
one-finding budget, and it loses that contest more often when the defect's evidence
is spread across files than when it sits in the changed lines.

## Two levers this rules out, one it points at

- **More discovery calls: already contradicted here.** The missed cross-file
  expectations had *more* calls than the found ones (1.20 vs 1.00). This agrees with
  the project's own record — extra discovery passes were measured and rejected in
  July at +40–47% cost for no gain, and reactive splitting measured −8.5pp recall.
- **More retrieval: already enabled.** Cross-file retrieval has been on by default
  since 2026-08-01. The 38% is *with* it.
- **What is left: reporting more than one defect when more than one exists.** Not
  more calls, not more context — more *findings per call*. The engine's own
  one-candidate-per-file behaviour was diagnosed and worked on in July; this is the
  same constraint reappearing where a single-defect answer key makes it costly.

## The honesty consequence, which is the more important half

**Recall on this corpus is a joint measure of detection and of the answer key's
completeness, and the single-finding budget couples them tightly.** A case where the
engine finds a genuine defect the advisory did not name scores zero recall while
doing correct work. 19.3% of its output is exactly that.

This does *not* mean the recall figure is wrong or should be adjusted upward — an
advisory-named defect is the right target, and inventing a correction would be the
kind of fabrication this project forbids. It means the figure must be read with its
companion: **precision's upper bound is 97.6% because nearly everything unmatched is
real.** Quote the two together or neither.

It also sets a trap for the obvious next move. Raising findings-per-case would raise
recall on a single-defect key almost mechanically, and would look like an
improvement whether or not the engine got better at cross-file reasoning. Any
intervention on this lever has to be judged on **precision at the same time**, and
pre-registered that way before it is run.
