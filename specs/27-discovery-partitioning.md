# 27: Discovery Partitioning

Status: **Draft — awaiting human approval**
Date: 2026-08-01

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

**Yield tracks call count, not defect count.** A discovery call returns roughly three
to five candidates whether it is shown one file or forty. The per-task cap
(`HOLISTIC_MAX_CANDIDATES`, 12) is **not** what binds — arm 1 averaged 3.6 candidates
per case against it — so raising the cap changes nothing. What binds is attention
inside a single call.

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

**No default is set.** The useful region is 2 ≤ N < unlimited and is unmeasured; a
value MUST come from measuring it, not from interpolating between these two points.
