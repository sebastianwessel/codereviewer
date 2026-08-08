# Spec 31 — Design Judgment

Status: approved as a **gate**, not as a capability. Nothing here authorises building
a design-review lane. It authorises finding out whether one can be measured, and
records in advance what answer would stop the work.

## Purpose

"Is this the right change?" is the half of review this engine does not attempt.
Correctness it does well (in-diff recall ~64–68% at ~96–98% adjusted precision);
consequences beyond the diff have their own lane; but *design* — the wrong
abstraction, the boundary in the wrong place, the special case that should have been
a parameter — is untouched.

It is also the half a strong human reviewer is most valued for, which is exactly why
it is the most dangerous thing to ship on impression.

## Why This Spec Is A Gate

Every capability this project has retired died the same way: it was built, then
measured, then removed. Convention conformance fired 14× its noise budget with **zero
true positives across ~300 hand-judged divergences**. The un-anchored discovery pass
returned +0.83pp for +136% cost. Sub-file partitioning cost recall outright.

Each of those consumed real effort before the measurement that killed them. In every
case the measurement was possible; the question was only whether anyone had run it.

**Design judgment is different, and worse: it is not obvious that ground truth can be
constructed at all.** "Was this the right abstraction?" has no upstream fix commit
that proves the answer, no advisory that confirms it, no test that fails. It is a
matter on which competent engineers disagree — and a capability whose ground truth is
a matter of taste cannot be measured, only asserted.

So the first deliverable is not a lane. It is an answer to: **can two curators
independently agree on what the right design was?**

## The Feasibility Gate

### Population

Maintainer reviews that **demanded a design change** — "changes requested" on the
approach, not on a defect and not on style. Harvested from permissively licensed
repositories with the machinery spec 17 and spec 22 already use.

A candidate qualifies only if the reviewer's own words identify a design objection —
the wrong place, the wrong shape, the wrong abstraction — and the author's subsequent
push changes the design accordingly. The reviewer is the ground truth; the push is
the proof the objection was accepted rather than argued away.

### The measurement that decides everything

**Two curators, working independently, on the same 30 candidates.** Each writes what
the design objection was, in their own words, without seeing the other's answer or the
maintainer's.

Then: **do the two curators agree with each other, and do they agree with the
maintainer?**

- **Agreement ≥ 70% on both** — ground truth is constructible. A corpus may be built,
  and only then may a lane be designed against it.
- **Agreement 50–70%** — record it and stop. The disagreement itself is the finding,
  and it is publishable: it says design review is less consensual than the industry
  assumes, which is worth knowing and is not a reason to ship a lane.
- **Agreement < 50%** — **the lane is not built, now or later, without new evidence.**
  Below that, a "design finding" is one plausible opinion among several, and shipping
  it means telling authors their design is wrong at a rate indistinguishable from
  chance.

### Committed in advance

- The threshold is not revised after seeing the number. If agreement lands at 68%, it
  missed.
- The curators are not shown the maintainer's review before writing their own answer.
  A curator who has read the answer is measuring their own reading comprehension.
- A null here is a **result, not a failure**. "This cannot be measured, and here is
  the evidence" is a stronger position than a lane nobody can defend.

## If The Gate Passes

Only then, and constrained by everything already measured:

1. **Advisory forever.** Like intent and impact, it cannot block. Spec 22's reasoning
   applies unchanged: a lane whose ground truth is contested has no business failing
   anyone's pipeline.
2. **Repeatability before precision.** Intent's 87% self-agreement ceiling caps every
   intent figure ever published. Design judgment's own ceiling must be measured
   *first*, because no precision claim can exceed it.
3. **A pre-registered noise budget**, set before the first firing rate is seen. This
   is the discipline that made conformance's death clean, and design judgment is the
   capability most likely to produce confident, plausible, unfalsifiable output.
4. **No prompt-family reruns.** Five pre-registered prompt clauses have been measured
   on the review lane, all null (splits 7/8, 7/8, 7/7, 12/12, 16/16). A design lane
   that turns out to need prompt tuning to work is a design lane that does not work.

## What This Spec Refuses

- **Shipping it advisory-only "because advisory output is harmless."** It is not.
  Advisory output that is wrong at 50% trains readers to ignore the surface it shares
  with findings that are right at 96%.
- **Measuring it against this engine's own output.** The banned pattern, recorded
  repeatedly in the ledger: an answer key derived from the thing under test measures
  agreement with itself.
- **Treating maintainer approval as evidence of good design.** Plenty of poor designs
  are approved. The population is reviews that demanded a change, because a demand is
  a recorded judgement; an approval is at best an absence of one.
