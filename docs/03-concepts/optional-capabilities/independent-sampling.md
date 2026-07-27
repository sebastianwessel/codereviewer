# Independent Discovery Sampling (Removed)

Independent sampling ran the discovery call **`k` times per task, blind to each
other**, and kept the **union** of everything any sample found —
`review.discoverySampleCount`, default `1`, bounded at 5. There was no vote and no
agreement threshold, by design: samples agree on wrong answers too, and a vote
would delete exactly the rare finding that sampling existed to recover. The union
was collapsed only by the [semantic finding
merge](../pipeline/04-holistic-discovery.md). It was **removed** on 2026-07-27:
code, spec, and configuration key.

There is nothing to configure here. `review.discoverySampleCount` was deleted from
the configuration schema, which is strict: a config file that still sets it now
fails validation with exit code `2`. Remove the key.

## What was measured

36-case / 80-expectation real-repository corpus, **3 seeds per arm**, paired
finding-level test.

| | `k = 1` | `k = 3` |
| --- | ---: | ---: |
| Recall | 46.25% | **48.33%** |
| Adjusted precision | **0.819** | **0.628** |
| Genuine false positives / run | **8.3** | **23.3** |
| Candidates / run | 74.8 | 127.0 |
| Semantic merge collapses / run | ~1.7 | **78.0** |
| Cost / run | $1.43 | $2.38 (**+67%**) |

Recall delta **+2.08pp**, 95% CI **[−1.67, +6.25]**, 7 gained and 5 lost,
**p = 0.56**. Cost per additional matched expectation: **$0.57**.

Recall did not rise significantly, adjusted precision fell by 0.19, and genuine
false positives nearly tripled. The rule fixed before the run required significance
and intact precision to adopt.

## It falsified its own premise

The feature was built on a claim that single-run recall of ~46% sat against a
**union ceiling of ~67%** — roughly 20 percentage points of run-to-run variance
waiting to be harvested. That number came from a different corpus and
configuration. Measured on this one:

| | Recall |
| --- | ---: |
| Single run, mean of 3 | 46.3% |
| **Post-hoc union of the same 3 runs** | **50.0%** |
| `k = 3` sampling inside one run | 48.3% |

**The harvestable variance is about 4pp, not 20pp**, and `k = 3` already captured
most of it — 48.3% against a 50.0% ceiling. Sampling worked exactly as designed;
the prize was not there.

## Why precision collapsed

The semantic merge fired **78 times per run**, up from about 1.7, and adjusted
precision still fell hard. So the extra candidates from independent samples are
**not** mainly restatements of one defect — they are **distinct wrong findings**.
The samples disagree about what is wrong rather than agreeing about a defect one of
them happened to miss.

That is also the mechanism behind the small union ceiling: run-to-run variance in
this engine is mostly noise, not near-misses.

## What survives the removal

**The semantic finding merge stays.** This was the only load that has ever properly
tested it — 78 collapses per run — and it did its job with no one-sided loss.

**Discovery calls no longer carry prior conversation.** That change landed
alongside sampling but is independent of it: it stops every agent call from opening
with the output of every call that finished before it, and it cut cost by 26% with
no measurable accuracy movement. It remains a requirement, in
`specs/05-review-workflow-and-runtime.md` under *Harness Runtime → Conversation
History*.

## What this does not establish

**This was not a faithful test of the idea it came from.** The published sources
used **n = 10**, with a plateau at 5 and an aggregation call over the samples — and
one of them **randomised the diff order across parallel passes specifically to
force different reasoning paths**.

We used **`k` = 3 with byte-identical packets**. The only diversity available to a
sample was sampling randomness. **The ~4pp ceiling measured here therefore bounds
identical-input resampling only. Input-perturbed sampling has a higher potential
ceiling and is untested in this engine.**

The honest expectation — and this is stated **as a prediction, explicitly not as a
measurement** — is that input-perturbed sampling would still not pay: precision
collapsed hard at `k` = 3, the extra candidates were distinct wrong findings rather
than near-misses, and inducing more diversity should produce more of them. Nothing
measured here establishes that, and it must not be quoted as if it did.

## Related

- [What limits recall](../../05-quality/what-limits-recall.md) — every intervention
  measured against the enumeration gap
- [Holistic discovery](../pipeline/04-holistic-discovery.md) — what discovery does
  today, and the semantic merge that survived this
- [Extra discovery passes (removed)](extra-discovery-passes.md) — three earlier
  removals
- [Optional capabilities](README.md) — what actually ships as a switch
