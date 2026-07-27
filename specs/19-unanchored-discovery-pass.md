# 19: Un-Anchored Discovery Pass

Status: Approved
Date: 2026-07-27

## Purpose

Recover defects the diff-anchored reviewer never looks for, without weakening the
behaviour that makes it precise.

## The Evidence This Rests On

The primary discovery call is anchored to the diff. That anchor is what makes it
precise, and it is also why it reports at most one defect per changed region.

A controlled experiment (2026-07-27, production model, prompt and temperature;
units derived mechanically from a file's line count alone, so no expected finding
could influence them) established the mechanism:

- **Only 16 of 76 candidates (21%)** from the diff-bearing arm pointed at a line
  inside the unit they were shown. One 1251-line file returned the same finding
  at line 820 from **all 31 units**, including the unit covering lines 1201–1251,
  where line 820 was not present in the packet at all.
- The un-anchored arm placed **50 of 50 candidates inside their own unit**.
- On a single 84-line file, same model and prompt: production found the first
  expectation 7 of 9 runs and the second 0 of 9; units **with** the diff, 2/2 and
  0/2; units **without** it, 0/2 and 2/2.

The engine answers the diff and does not read the rest of the file. Shrinking the
file section therefore changes nothing — the file section was never the binding
constraint. What must be removed is the anchor.

The same experiment showed the un-anchored arm **losing 6 of 7 controls**: with
no diff it has no reason to prioritise the changed line. It is a candidate
generator, not a reviewer, and it must feed the existing gate rather than replace
any part of it.

Corpus-level recall on later-in-file expectations is 4.7% against 72.8% for the
first expectation in a file. Closing that gap is worth roughly 28 recall points,
more than every measured capability gap combined.

## Design

An OPTIONAL additional pass reviews a file as bounded units **with the diff
withheld**, so the reviewer has no changed line to answer and must read what it
is given. Its candidates merge into the primary pass's candidates through the
Semantic Finding Merge (spec 05), and every candidate then passes through
refutation and admission unchanged.

## Requirements

- The pass is **additive**. It MUST NOT displace, reorder, or suppress a
  candidate produced by the diff-anchored pass.
- Units MUST be derived **mechanically from the file alone** — a rule expressible
  without reference to any expected finding, applied identically to every file in
  every language. Unit size and overlap are configuration, never per-language or
  per-defect-class tuning.
- The pass MUST use the same generic, language-neutral discovery instructions as
  the primary pass. It differs in **what it is shown**, never in what it is
  asked. The Non-Negotiable in spec 15 applies unchanged.
- The pass MUST be bounded: a maximum number of units per file and per run, taken
  from configuration, with the applied bound and any truncation recorded in the
  run. Silent truncation is forbidden — a bounded pass that reports nothing about
  its bound reads as full coverage.
- Failure of the pass is recoverable and non-fatal. A review without it is a
  complete review.
- The pass is **disabled by default** until a measurement on the real-repository
  corpus shows it earns its cost.

## Configuration

Mirrors `security.dedicatedPass`. Default unit size 60 lines, stride 40.

That size is **arbitrary and is recorded as such**: it is the only size that has
been measured, chosen originally on budget grounds. Published work reports that
the safe input size is defect-class dependent, which implies no single value is
optimal — but selecting per class would require knowing the class before looking,
which is not available. Treat the default as a starting point, not a finding.

## Rejected Alternatives

**Widening or shrinking the primary pass's file window.** Measured as the
diff-bearing arm above: it recovered almost nothing at N× the cost, because the
diff pulled every unit's answer back to the same line. The variable is the
anchor, not the unit size.

**Dropping the diff from the primary pass.** The un-anchored arm lost 6 of 7
controls. The diff anchor is what makes the primary pass reliably find the defect
the change introduced, which is the reviewer's principal job. Removing it would
trade the engine's strongest behaviour for a speculative one.

**Re-asking the primary pass for more findings.** Two such passes — an
enumeration sweep and a diverse-lens pass — were built, measured over three seeds
each, failed to beat baseline, and were removed. Both re-asked over the same
artifact. A positional bias cannot be argued away by asking again.

## Measurement

Arms: default config against the pass enabled, three seeds each, on the
real-repository corpus. Decision rule, fixed before the run:

- **Ship enabled** only if recall rises with the paired finding-level test
  clearing significance, `adjustedPrecision` and `genuineFalsePositiveCount` do
  not degrade, and cost per additional matched expectation is defensible.
- **Ship disabled but retained** if recall rises without significance at n=3.
- **Remove entirely** if recall does not rise.

Refutation's kill rate MUST also rise. It is 1.4% today. A pass that adds
speculative candidates without moving that number means the gate is not filtering
them, and precision will fall in place of recall rising.

## Reading The Result Honestly

The corpus has a median of 7 changed lines and 2 hunks per case, and 17 of its 36
cases are single-hunk, because it is built from upstream fix commits, which are
minimal by nature. Real pull requests are larger.

A small diff is where the anchor pulls hardest and therefore where this pass has
the most to add. **The corpus is close to the best case for this change.** It is
a sound screening instrument — a pass that does not help here will not help
anywhere — but a poor estimator of production gain, and the figure it produces
MUST NOT be reported as an expected real-world improvement.

## Verification Matrix

| Requirement | Test |
| --- | --- |
| Units derive from the file alone and are identical across languages | unit tests |
| Pass is additive and never removes a diff-anchored candidate | pipeline tests |
| Unit and run bounds are enforced and truncation is recorded | unit tests |
| Pass failure degrades to a complete review | unit tests |
| Pass is disabled by default | config schema test |
| Instructions match the primary pass and stay language-neutral | prompt genericity guard |
