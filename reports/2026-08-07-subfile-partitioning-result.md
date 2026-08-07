# Result: sub-file partitioning is NOT PROMOTED, and its premise is falsified

Measured 2026-08-07 against `reports/2026-08-07-subfile-partitioning-prereg.md`,
committed before the runs.

**Verdict: not promoted. The predicted harm appeared, the predicted gain did not, and
the direction is negative.**

## Provenance

Control `359161b` vs treatment `45a75da`, **10 seeds per arm**, `ab-run.sh`
alternating order. Exactly **5/5 position balance in each arm**, `dirty=0` on all
twenty runs, one dependency digest and one dirty digest throughout. Corpus:
`security-advisory-2026`, 70 cases / 72 expectations. Model: `openai/gpt-5.3-codex`.

## The numbers

| | control | treatment | delta |
| --- | --- | --- | --- |
| recall | **64.0%** (sd 2.22pp) | **61.1%** (sd 4.68pp) | **−2.9pp** |
| adjusted precision | 95.0% | 96.9% | +1.9pp |
| raw precision | 72.9% | 58.4% | −14.5pp |
| genuine false positives | 25 | 14 | −11 |
| discovery calls | 710 | 1260 | **1.77x** |
| raw findings | 886 | 1494 | +69% |
| spend | $18.42 | $23.99 | **1.30x** |

Paired over all 72 expectations, ten seeds each: **11 gained, 23 lost, 38 unchanged,
two-sided exact sign test p = 0.0576.**

Not significant at the pre-registered 0.05 bar — and pointing the wrong way.

## The per-depth breakdown, which is why it was pre-registered as mandatory

| context depth | n | gained | lost | control | treatment | delta |
| --- | --- | --- | --- | --- | --- | --- |
| callee | 8 | 3 | 2 | 62.5% | 68.8% | **+6.2pp** |
| cross-file | 15 | 4 | 5 | 49.3% | 50.7% | +1.3pp |
| implementation | 18 | 3 | 7 | 51.1% | 49.4% | −1.7pp |
| local | 9 | 0 | 2 | 86.7% | 83.3% | −3.3pp |
| caller | 3 | 0 | 1 | 90.0% | 80.0% | −10.0pp |
| **cross-function** | **17** | **1** | **6** | **82.4%** | **71.2%** | **−11.2pp** |

**The predicted harm is confirmed exactly.** `cross-function` was named in advance as
the channel that would suffer — 16 of 17 of its expectations sit in cases this knob
splits — and it fell 11.2 points on 1 gained against 6 lost. Splitting a file does
blind the reviewer to defects whose halves land in different groups.

**The predicted gain is absent, and that is the finding.** The pre-registration said
`local` and `implementation` would rise, because the defect sits inside one group and
that group is most of what the call sees. Both **fell** (−3.3pp, −1.7pp). The
mechanism's entire premise — that narrowing what a call is shown buys recall on
defects contained within the narrowed region — **does not hold**.

## What the precision figures actually say

Raw precision collapsed (−14.5pp) while adjusted precision **rose** (+1.9pp) and
genuine false positives nearly halved (25 → 14). Discovery returned **69% more raw
findings**.

So the extra looks are not producing noise. They are producing **more real defects
that the advisory's key does not name** — and simultaneously finding *the advisory's
own defect* less often. That is the sharpest evidence yet for the selection story:

> The reviewer is not short of things to say and not short of real defects to find.
> Narrowing its attention makes it report *more* real local issues and *fewer* of the
> headline defects. Attention is not a resource this system is starved of; it is a
> resource it allocates, and cutting the material up reallocates it the wrong way.

Variance also doubled (sd 2.22 → 4.68pp): the split makes runs less stable.

## Decision under the pre-registered rule

- **Promote?** Requires p < 0.05 in favour of the treatment. p = 0.0576 **against**
  it. No.
- **Keep as an off-by-default knob?** The rule allowed this only *"if the aggregate is
  null but the per-depth split shows the predicted trade cleanly"*. The trade did not
  appear: there is no depth where the predicted compensating gain materialised.
  `callee` +6.2pp is the one favourable cell, it was not predicted, it rests on 8
  expectations and 3 gained against 2 lost, and treating it as a finding would be
  exactly the post-hoc subgroup mining this project has spent the day refusing.
- **Remove.** The rule's stated reason applies in full: *a knob nobody should turn on
  is not worth its maintenance.* It loses recall, costs 77% more discovery calls, and
  its premise is falsified rather than merely unproven.

**The code is removed.** What is kept is this measurement and the spec section
recording it, so nobody proposes it again.

## What this closes

Spec 27 has called sub-file partitioning "the untested lever […] where the curve
points next" since 2026-08-01. It is now tested. Combined with the three levers
already closed, **every mechanism for buying the reviewer more or narrower attention
has now been measured**:

| mechanism | result |
| --- | --- |
| a second, differently-framed pass over the same context | +0.83pp, p = 0.82, removed |
| halving files per call so each file gets its own call | 46.5% → 46.5%, +36% cost |
| four prompt clauses instructing broader or better-targeted reporting | all null |
| **splitting the file itself, so each call is shown less** | **−2.9pp, 11/23, p = 0.058, removed** |

Attention is closed as a line of work. The remaining question — *why does the
reviewer, given the right file and 1.2 findings' worth of attention, pick a different
real defect than the advisory's?* — is a question about **ranking**, and nothing in
this table addresses it.

## Cost, published as required

**$42.41** measured, not estimated: control $18.42, treatment $23.99. The treatment's
1.77x call multiple became only a 1.30x spend multiple because its packets are
smaller — though it also caches worse (68.5% vs 80.2% warm), since three narrowed
packets share less prefix than one repeated whole-file packet.

An incidental measurement worth keeping: per call the treatment sent **36% less
input** (21.4k vs 33.4k tokens), yet **total** input still rose, because every
partition carries the full shared context. In any partitioned mode the token cost is
dominated by shared-context duplication, not by the reviewed file body.

## Committed and honoured

Ten seeds per arm, analysed once, no further seeds on this question. p = 0.0576 sits
close enough to the bar that running more seeds would be tempting; the
pre-registration forbade it in advance and that commitment is kept. Adding seeds now
would be optional stopping in the harmful direction, and today already produced one
demonstration of what that does.
