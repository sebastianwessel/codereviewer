# 27: Discovery Partitioning

Status: **Approved** (human, 2026-07-31)
Date: 2026-07-31

## Purpose

Make discovery yield scale with the **scope under review** instead of with an
accident of how many tasks assembly happened to produce.

## The Measured Problem

The spec 26 A/B (results ledger, 2026-08-01) isolated this by accident. Both arms
reviewed identical code with identical prompts; the provider refused **zero** packets,
so reactive splitting never engaged. The only difference between the arms was how
many discovery calls the same code was spread across:

| | proactive (more tasks) | reactive (one task) |
|---|---|---|
| candidates refuted | 106 | 75 |
| findings emitted | 113 | 84 |
| recall | 43.7% | 35.2% |

**Yield tracks the number of calls, not the number of defects present.** The per-task
candidate cap (`HOLISTIC_MAX_CANDIDATES`, 12) is **not** what binds — the
whole-change arm averaged 3.6 candidates per call against it — so raising the cap
changes nothing. What binds is attention inside a single call.

### Correction (2026-08-01): the mechanism is per FILE, not per call

This spec originally asserted that a call "returns roughly three to five candidates
whether it is shown one file or forty." **That is measured false.** A full analysis
of the five arms establishes a sharper and more useful law:

| files shown per call | candidates per call | share of files getting any finding | findings per file that gets any |
|---|---|---|---|
| 1 | 0.46 | 26.6% | **1.18** |
| 2 | 0.64 | 22.4% | **1.23** |
| 4 | 0.92 | 15.7% | **1.19** |
| 19 | 3.57 | 11.2% | **1.22** |

- **The ceiling is ~1.2 findings per FILE.** That figure is invariant across a 19x
  range of files-per-call and across two unrelated corpora — the hard limit in this
  system.
- **Per-call yield is sub-linear in scope**, not flat: roughly `0.46 · files^0.70`.
  The number of files a call attends to grows with what it is shown, but per-file
  attention decays as `shown^-0.30`.
- **Partitioning therefore works by moving files into more calls, and only that.** It
  does not raise per-file yield at all; it raises the share of files that get looked
  at, from 11% to 27%.

Two consequences follow, and both matter more than the original claim:

- **Recall saturates at 2 files per call.** Going to 1 keeps producing candidates
  (131 → 184) but they are additional *unlisted-real* defects and noise, not more of
  the listed ones. That is why 1 and 2 tie on recall, and it is the reason 2 is the
  default rather than an arbitrary midpoint.
- **The untested lever is sub-file partitioning.** Per-file yield is pinned at ~1.2
  while per-call yield still scales at exponent 0.70, so the interval between "one
  file per call" and "one function per call" is entirely unmeasured and is where the
  curve points next.

What the data could not settle is whether the ~1.2-per-file ceiling originates in
discovery or is partly imposed by refutation and admission. Deciding it required the
per-call `finding_count` the debug line already computed to reach the evaluation
report; nothing new had to be measured, only recorded.

**That recording now exists (2026-08-01).** Discovery telemetry is carried from the
discovery call up through the task result, the workflow output, and the review
report, into the per-case eval report — the same path `reviewedTasks` already took.
It records, per run and per task: discovery calls issued, **raw findings returned by
the model before the schema parse, the scope filter, the per-call cap and the merge**,
candidates after collection, findings dropped at parse or scope, findings suppressed
as duplicates by id and by location, overflow-driven splits, and the merge counters.
Raw findings are additionally kept **per call**, because the open question is the
SHAPE of the distribution — a hard ceiling near 1.2 per file and a spread with the
same mean imply different fixes, and a mean cannot separate them. The debug line is
unchanged and still emitted; the durable path runs alongside it. `EVAL_METRICS_VERSION`
is bumped, because a report saved earlier cannot recover the new figures: for such a
report the honest reading is "not recorded", never "no discovery calls".

The measurement itself is still outstanding. What has changed is that the next run —
including the prompt A/B this was needed for — answers it as a by-product, and a null
recall result can now be told apart from a discovery gain that later stages filtered
away.

The old byte budget was therefore doing two jobs while claiming one. It said it was
fitting packets into a context window (false — the provider accepts 1.2 MB without
complaint), and it was in fact partitioning the reviewer's attention (real, and worth
+8.5pp recall). Spec 26 correctly removed the false justification and, with it,
accidentally removed the real benefit.

## Design

Partition a task's **review targets** across several discovery calls, sized by scope.

1. A discovery call reviews at most `maxFilesPerDiscoveryCall` changed files.
2. A task whose targets exceed that is covered by several calls; their candidates are
   unioned, exactly as the general and security passes already union today.
3. Shared context (diff segments, referenced definitions, change intent, support
   signals) is attached to every call, so no call reviews with less context than the
   undivided task had.
4. Partitioning is by **file**, never by bytes. Files are the unit the reviewer
   reasons about and the unit findings are reported against, and a byte rule would
   reintroduce the content-dependent guess spec 26 removed.

This is deliberately **not** a second pass over the same context. Repeated passes
over identical context were measured and rejected (ledger, 2026-07-26: sweep and lens
both failed to beat baseline at +40–47% cost) because a second look at the same
material re-derives the same findings. Partitioned calls see *different* material,
which is why the spec 26 arms diverged.

## Why This Does Not Contradict Spec 26

Spec 26 removed splitting that was justified by a **context limit that does not
exist**. This adds splitting justified by an **attention limit that is measured**.
Different reason, different sizing rule, and the packet is still never split because
someone guessed a byte count. Spec 26's requirements all stand: assembly still does
not split on a byte budget, and the provider is still the only authority on packet
size.

## Requirements

- Discovery MUST partition a task's review targets when they exceed
  `maxFilesPerDiscoveryCall`, and MUST union the candidates.
- Partitioning MUST be by file count, never by bytes.
- Every partition MUST receive the same shared context the undivided task would have.
- A finding MUST remain restricted to the files its own call was shown, so admission
  cannot anchor a finding against content that call never read.
- The number of discovery calls issued MUST be reported, so a run's yield can be read
  against the number of looks that produced it.
- The raw findings a discovery call returned MUST be recorded on the review report,
  per call, BEFORE the schema parse, the scope filter, the per-call cap, and the
  merge. A debug log line does not satisfy this: debug logging was off for every paid
  run, so the figure existed and was discarded every time.
- The default MUST leave behaviour unchanged until the value is measured. Shipping a
  chosen-by-feel default is the failure this project has now corrected five times.

## Cost

Partitioning multiplies discovery calls, and each carries its own refutation. The
spec 26 arms bound the trade at the measured extreme: **+14% cost bought +8.5pp
recall** and cost 12.4pp of adjusted precision. Whether a middle setting is better on
all three is exactly what the measurement decides.

## Measurement Plan

On the same 21 affected crb cases, pinned engine, paired at expectation level,
against **arm 1 of the spec 26 A/B as the control** (recall 35.2%, adjusted precision
96.2%, $6.40 — an existing artefact, so the control costs nothing to re-run).

| arm | `maxFilesPerDiscoveryCall` |
|---|---|
| control | unlimited (current default) |
| **1** | 1 |

Pre-registered, before any run:

- Recall movement inside **±4.8pp** is not a result; the band is measured.
- Report **adjusted precision** and **cost** alongside recall. Spec 26 showed this
  change trades between all three, so a recall gain reported alone would be
  misleading.
- If recall rises but adjusted precision falls below the control's 96.2%, the trade
  MUST be argued explicitly, not assumed to be worth it.
- `maxFilesPerDiscoveryCall: 1` is the strongest partitioning available and therefore
  an upper bound on the effect, not a proposed default. A default MUST NOT be set
  from this run alone.

## Result (2026-08-01)

Ran as specified. Recall **35.2% → 46.5%** (+11.3pp, CI [0.0, 22.5], gained 13 lost
5, p = 0.059), adjusted precision **96.2% → 97.1%**, cost **+158%**.

The mechanism is confirmed: only the number of looks changed, and recall moved with
it. But `1` fails the cost gate — it lands recall indistinguishable from the OLD
proactive default (43.7%, p = 0.617) while costing 2.2x that default. Its real
advantage over the old default is adjusted precision, 83.8% → 97.1%.

### The sweep, and the shipped default

The useful region was then swept rather than interpolated:

| setting | recall | adj precision | cost |
|---|---|---|---|
| unlimited | 35.2% | 96.2% | $6.40 |
| 4 | 40.8% | 93.5% | $8.18 |
| **2** | **46.5%** | **97.1%** | **$12.09** |
| 1 | 46.5% | 97.1% | $16.51 |

**The default is 2.** It matches the strongest setting exactly on both recall and
adjusted precision at 27% less cost, and it is the only arm to reach conventional
significance (p = 0.033, CI excluding zero, 11 gained against 3 lost). Below 2 there
is nothing left to buy.

Partitioning engages only above two changed files, so small changes are unaffected;
the cost falls on large changes, which are the ones the unpartitioned reviewer served
worst.
