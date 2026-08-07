# Three nulls, and the reason: the instrument is far noisier than reported

2026-08-07. Result of the third pre-registered intervention, and a correction to a
variance claim this project published earlier the same day.

## The third verdict

Intent-framing clause, control `f2a6ee8` vs treatment `9ac762e`, three seeds each,
51-case corpus. **First A/B under the alternating arm-order rule** — control ran
first twice, treatment first once, positions recorded in every sidecar.

| | control | treatment |
| --- | --- | --- |
| recall | 53.85 / 67.31 / 69.23% — mean **63.5%** | 65.38 / 55.77 / 59.62% — mean **60.3%** |
| empty returns | 15 | 12 |
| genuine false positives | 3 | 2 |
| adjusted precision | 97.0% | 98.2% |

**Rejected.** Recall fell. Paired per expectation: 7 gained, 7 lost, 38 unchanged,
exact sign test **p = 1.0000**.

No precision delta is cited, per the standing restriction.

## The correction

Look at the control arm: **53.85%, 67.31%, 69.23%.** A 15.4-point spread across three
runs of *identical* inputs. That is not a treatment effect; it is what this corpus
does at rest.

Four independent three-seed estimates of the same quantity — no-intervention recall —
now exist:

| arm | seeds | mean | sd |
| --- | --- | --- | --- |
| baseline (50 cases) | 60.78 / 56.86 / 64.71 | 60.8% | **3.92pp** |
| authorization control (50) | 54.90 / 66.67 / 56.86 | 59.5% | **6.30pp** |
| boundary control (51) | 59.62 / 59.62 / 63.46 | 60.9% | **2.22pp** |
| intent control (51) | 53.85 / 67.31 / 69.23 | 63.5% | **8.38pp** |

**The sd estimates span 2.22 to 8.38 — a 3.8× spread — for the same measurement.**
Pooled within-arm over 8 degrees of freedom the standard deviation is **5.71pp**, and
all twelve no-intervention runs span **53.85% to 69.23%**.

### What that invalidates

Earlier today this project published, and I described as the point of the whole
exercise, that **doubling the corpus halved the variance from 7.69pp to 3.92pp**.

That claim is not supported. Both figures are single three-seed estimates of a
quantity whose estimator, as the table above demonstrates, varies by 3.8× between
samples. The 3.92pp was a low draw. The honest figure for the 50/51-case corpus is
the pooled **5.71pp**, and whether it is any better than the 25-case corpus's 7.69pp
cannot be established from one estimate on each.

Doubling the corpus was still the right thing to do — more cases genuinely reduce
sampling variance — but the *evidence* offered for it was a coin landing favourably,
and I presented it as a demonstration.

### What that means going forward

At a pooled sd of 5.71pp, three seeds per arm resolve a difference of roughly
**11 percentage points**, not the ~8 previously stated and not the ~16 stated before
that. Detecting a 5-point effect at this variance would need on the order of **twenty
seeds per arm**.

**No plausible prompt-level intervention is an 11-point effect.** That is the real
reason all three A/Bs read null, and it was true before any of them ran. The paired
sign test — which removes between-run variance and is the sharper instrument — also
returned p = 1.0000, 1.0000 and 1.0000, so the nulls are not merely an artifact of
comparing noisy means.

## What the three nulls do and do not establish

They establish that none of the three interventions produces an effect this setup can
see. They do **not** establish that the interventions do nothing; the study was
underpowered for anything smaller than about eleven points, which is nearly every
realistic change.

Reporting them as "rejected" is correct under their pre-registered rules, which is
why each was reverted. Reporting them as "these ideas do not work" would be wrong.

## The honest conclusion

**Running further prompt-level A/Bs on this corpus is not a productive use of
spend.** Three have now been run — one from a hypothesis about weakness classes, one
from a documented prompt contradiction, one from controlled external evidence with a
large published effect size — and the design cannot distinguish any of them from
zero.

What would change that, in order of expected value per unit of effort:

1. **More cases — but the pool is nearly exhausted, and this was overstated when
   first written.** Only **21** screened candidates remain unadjudicated, not the
   "60+" originally claimed here. At the observed ~45% keep rate they yield about
   **9 more cases**, taking the corpus to ~60 expectations and the binomial sd from
   6.8pp to 6.3pp — resolving ~12.5pp instead of ~13.7pp. Effectively nothing.
   Reaching an 8pp resolution needs **149 expectations**, and 6pp needs **264**;
   the whole post-cutoff advisory harvest yielded 132 structurally reviewable
   candidates, of which 111 are already adjudicated. **More cases is not available
   at the scale required.**
2. **More seeds, carried by the paired test — the only affordable route.** Extra
   seeds barely move the run-level mean's binomial noise, which is set by the
   number of expectations. What they do change is the reliability of each
   expectation's own outcome: at 3 seeds an expectation reads 0-3 and a 2-vs-1
   difference between arms is mostly seed noise, which is why ~15 of 51 pairs read
   discordant in every A/B. At 9 seeds it reads 0-9 and a real shift separates from
   noise. 9 seeds x 2 arms x 51 cases is roughly $22 at warm-cache prices.
3. **A lower-variance endpoint.** Per-expectation paired outcomes already remove
   between-run variance and are what should carry any future claim; run-level recall
   means should not.

Until one of those is in place, the honest position is that this project can measure
its *level* of security recall — about **61%**, pooled over twelve runs — and cannot
currently measure an *improvement* to it.
