# 21: Independent Sampling With Union Merge

Status: Approved
Date: 2026-07-27

## Purpose

Recover the recall that run-to-run variance currently throws away, and reduce the
variance itself, by running discovery independently more than once and taking the
union of what it finds.

## What Our Own Data Prices

Single-run recall on the real-repository corpus is ~46%. The **union across runs
reaches ~67%**. That ~20pp gap is not a capability limit — it is the same defect
being found in one run and missed in the next.

The same variance makes results wobble between 43.8% and 48.8% across identical
configurations. **This is the only proposed change that addresses recall and
stability together.**

Published support: self-aggregation over independent samples raised recall
**+118.8% at n=10**, with a plateau at **n=5** and precision essentially flat;
sampling a cheaper model k times beat one pass of an expensive model at lower
cost.

## Design

Discovery runs `k` times independently for a task. Candidates from all samples
are unioned, passed through the Semantic Finding Merge (spec 05), and then
through refutation and admission unchanged.

## Requirements

- Samples MUST be **independent**. A sample MUST NOT receive the findings,
  reasoning, or any output of another sample. Anchoring a reviewer on its own
  prior answer is what the withdrawn enumeration sweep did, and it is why that
  experiment failed.
- Candidates MUST be combined by **union**. Consensus, majority voting, and
  agreement thresholds are **forbidden**.
- Deduplication of the union is the responsibility of the Semantic Finding Merge.
  This spec MUST NOT introduce a second deduplication mechanism, and MUST NOT
  fall back to positional identity.
- `k` MUST be bounded by configuration, and the applied `k` MUST be recorded in
  the run.
- `k = 1` MUST be exactly equivalent to today's behaviour, including packet shape
  and field order, so the default path is unchanged and prompt-cache prefix
  stability does not regress.
- Failure of one sample MUST NOT fail the review. Remaining samples proceed and
  the reduced sample count is recorded.
- The default is `k = 1` until measurement selects otherwise.

## Consensus Is Forbidden, And Why

On a standard defect benchmark the **union** of several models solved 205
problems against 112 for the best single model, while **every consensus strategy
underperformed a naive baseline** — models converge on the same wrong answer, so
agreement signals shared error rather than truth.

A published production reviewer used majority voting across eight parallel passes
and **removed it** in a later rewrite.

Majority voting would discard exactly the rare, single-sample findings this
change exists to recover. It is not a tuning option.

## Why This Is Not The Withdrawn Enumeration Sweep

The sweep re-asked for more findings **within one conversation that carried the
prior findings**, which anchors the model on what it already said. Samples here
are mutually blind and are combined afterward, deterministically.

## Why This Was Not Possible Before

Union-merging independent samples without semantic deduplication produces
restatements of one defect several times over — the failure that made
`adjustedPrecision` meaningless before it was fixed on 2026-07-27.

The Semantic Finding Merge is the enabling piece. It was measured under exactly
this load — 19.3 collapses per run under a 56% candidate increase, with no
one-sided loss — before this spec was written.

## Honest Limits

- **Ceiling-approaching, not ceiling-breaking.** This cannot exceed the union
  ceiling and therefore cannot address the 4.7% later-in-file recall gap.
- **The ~67% union figure is not current.** It was measured on a different corpus
  and configuration and MUST be re-measured rather than quoted as the prize.
- **Cost rises 40–50% per additional sample.** The cache probe found caching
  unreachable for repeated identical requests, so the increase is close to linear
  in `k`.

## Measurement

Arms: `k = 1` against `k = 3`, three seeds each, real-repository corpus, paired
finding-level significance. Measured **on top of whichever discovery posture
(spec 20) is selected**, because independent samples drawn from a conservative
posture have less diversity to union and would understate the effect.

Decision rule, fixed before the run:

- **Adopt** only if recall rises with the paired test clearing significance,
  **and** `adjustedPrecision` and `genuineFalsePositiveCount` do not degrade,
  **and** the cost per additional matched expectation is defensible.
- **Retain as configuration** if recall rises without significance at n=3.
- **Remove** if recall does not rise.

Report the **variance across seeds** for both arms. Reduced spread is a claimed
benefit of this change and must be shown rather than assumed.

## Verification Matrix

| Requirement | Test |
| --- | --- |
| Default `k` is 1 and that path is unchanged | config schema and discovery tests |
| Samples receive no output of any other sample | discovery unit test |
| Candidates are combined by union, never by agreement | discovery unit test |
| No second deduplication mechanism exists | discovery unit test |
| One failed sample leaves a complete review | discovery unit test |
| Applied `k` and reduced sample counts are recorded | run artifact test |
