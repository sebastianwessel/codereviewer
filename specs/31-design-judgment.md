# Spec 31 — Design Judgment

Status: **GATE RUN, GATE FAILED — the lane is not built.** Measured 2026-08-08; see
`reports/2026-08-08-design-judgment-gate-result.md`.

| measure | result | band |
| --- | --- | --- |
| curator vs curator (strict) | 54.2% (13/24) | 50–70% |
| each curator vs maintainer | **41.7%** (10/24, both) | **< 50%** |

The binding threshold is the maintainer comparison and it fails the floor, so the
rule below applies in its strongest form: **not built, now or later, without new
evidence.** Not advisory-only, not behind a flag.

The population was not the problem: **0 of 24** cases were `not-a-design-objection`
— every maintainer comment was a genuine design objection. Two blind curators
recovered the maintainer's actual objection two times in five, and failed
*differently* (one found a different flaw in the same diff, the other a different
framing of the same flaw). A design objection is one of several defensible readings
of a diff; the maintainer's is authoritative only because they are the maintainer.

The rest of this spec is preserved as written, because what it refused in advance is
what makes the result trustworthy.

### What The Number Measured, Stated Precisely (2026-08-14)

The gate asked *"can two curators independently agree on what the right design was?"*
as a proxy for *"can ground truth be constructed at all?"* (below, *Why This Spec Is
A Gate*). The outcome is stated as **not built, now or later** — and that outcome
stands. What needs stating is what the 41.7% is a measurement **of**, because the
proxy and the thing it stood for came apart:

1. **The curators were model agents.** The ledger records Curator B reporting a
   contamination defect *"unprompted, as a threat to the study it was participating
   in"*. So 41.7% is the blind **recovery rate of the kind of system this lane would
   be** — a capability measurement — not a statement about whether ground truth
   exists.
2. **Ground truth WAS constructed, and this spec's own data says so.** 30 candidates
   harvested under a screened population, with the key judge marking **0 of 24**
   `not-a-design-objection`: every case carried a recorded, verbatim, authoritative
   objection. That is a corpus. What failed was **recovery against it**.
3. **The dominant failure mode is this project's ordinary condition elsewhere.**
   "Curator found a different real problem in the same diff" is the *unlisted-real*
   phenomenon, measured at ~52% real and worth ~10.3pp of recall on the security
   corpus — where it has never been read as evidence that security ground truth is
   unconstructible.
4. **"Indistinguishable from chance" is not the right description.** Chance on
   free-text objection recovery is near 0%, not 50%. The 50% floor is a defensible
   product preference about how often an advisory lane may be wrong; it is not a
   statistical baseline, and calling it one lends the threshold an authority it does
   not have.
5. **n was 24, not the pre-registered 30**, and 10/24 carries an exact 95% interval
   of roughly **[22%, 63%]** — which spans the entire 50–70% *"record and stop"* band.
   The **strongest** form of the rule rests on a point estimate that cannot exclude
   the adjacent, materially weaker verdict.

**Restated finding.** *A competent blind reader recovers the maintainer's specific
objection about two times in five, so a design lane's recall ceiling is ~40% and its
precision is unfalsifiable against a single-authority key.* That supports the same
decision — do not ship a design lane; advisory output wrong at this rate trains
readers to ignore a surface it shares with findings that hold at ~96% — without
asserting the stronger claim that design ground truth cannot be constructed.

**"Without new evidence" is undefined, and the corpus is decaying under it.** The
same report records that design ground truth **decays**: 3 of 30 pre-review commits
were already garbage-collected, one going from fetchable to 404 within a single
session. So the prohibition has a clock on its own escape hatch. The follow-up the
evidence actually licenses is naming what would count — the obvious candidate being
**a design lane's recall scored against the maintainer key, exactly as the security
lane is scored against advisories**, which the restated finding above already gives a
ceiling for. That is a product-owner decision and is recorded here as open rather
than taken; what is not open is shipping a lane, which stays refused.

---

Original status: approved as a **gate**, not as a capability. Nothing here authorises
building a design-review lane. It authorises finding out whether one can be measured,
and records in advance what answer would stop the work.

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
