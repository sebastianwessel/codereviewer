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
  (The shipped `2` does not fully satisfy this: it was set from a single-seed sweep on
  an engine that violated the shared-context requirement above. See *The Sweep Ran On
  A Broken Engine* below.)

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

### The Sweep Ran On A Broken Engine: The Mechanism Survives, The Operating Point Does Not

**The shipped default of 2 is UNPROVEN, and the sentence "below 2 there is nothing
left to buy" is not supported by the run that produced it.** This is recorded rather
than acted on: changing a default is a measurement decision, and the measurement that
would settle it has not been run.

**Verified by `git`, not inferred.** The sweep arms ran at `4751277` (the spec 27
commit); the fix `4a4118d` — *"partitions were silently losing every referenced
definition"* — landed the next day, and
`git merge-base --is-ancestor 4751277 4a4118d` returns true. The sweep engine
strictly predates the fix. The defect: the partition context router matched context
documents against the partition's own file paths, while a referenced definition is by
construction an **unchanged** dependency file deliberately kept out of `task.paths`,
so that check never succeeded and **every referenced-definition digest was dropped
from every partitioned discovery call.** The control was spec 26's arm 1 at
`c11579c`, running unpartitioned, where `partitionTaskForDiscovery(task, undefined)`
returns the task unchanged and the router never ran. **So the control kept its
referenced definitions and every treatment arm lost them** — a direct violation of
this spec's own Requirement 3 (*"Every partition MUST receive the same shared context
the undivided task would have"*) by the very runs that set the default.

**The direction of the confound decides which conclusion survives, and they part
company:**

- **"Partitioning helps" SURVIVES.** Losing referenced definitions handicaps the
  treatment and never the control, so +11.3pp was measured *while carrying* the
  defect. A clean re-run can only improve it. No number is withdrawn.
- **The operating point does NOT survive.** The case for `2` over `1` — 27% cheaper
  at identical recall, and *"below 2 there is nothing left to buy"* — rests entirely
  on `1` and `2` returning **exactly** the same figures (46.5% / 97.1%) from
  independent single runs. But the defect fired whenever partitioning engaged, and
  the finer the setting the more tasks that was: at `1` every task with ≥2 changed
  files lost its digests, at `2` every task with ≥3, at `4` only those with ≥5. **The
  arm the argument needs to be no better was the arm penalised across the most
  tasks.** Remove the handicap and the knee may well sit below 2.

**Three compounding weaknesses in the same run, each independently checkable.** It is
**one seed per arm**, against a variance the ledger later pooled at sd 5.71pp with the
conclusion *"three seeds resolve ~11pp"* — and the claimed effect is +11.3pp.
`p = 0.033` is the **best of four** comparisons (≈0.13 with a Bonferroni correction).
And this spec's own Measurement Plan pre-registered two arms and stated *"A default
MUST NOT be set from this run alone"*, which is exactly what then happened. The
ledger's own remedy — *"Re-running the control on `4751277` (~$6.40) would remove the
caveat"* — was never acted on.

**What is riding on it.** `maxFilesPerDiscoveryCall: 2` is an always-on default
costing **+89%** on the corpus where it was measured ($6.40 → $12.09), and every cost
figure this project publishes carries that multiplier. `unlimited` has never been
measured since the fix, and the current 64.0% security baseline was itself measured
**at 2**, so no post-fix control exists to compare against anywhere in the record.

**What a post-fix control would have to show**, so the question is answerable rather
than merely open:

- Three arms — `unlimited`, `2`, `1` — on the **current** engine, one pin for all
  three, `dirty=0`, on `security-advisory-2026` (the corpus with the live baseline),
  with arm order alternated and the judge pinned.
- **At least the seed count the resolution band requires.** Three seeds resolve about
  11pp; the effect being defended is 11.3pp, so three seeds is the floor and not a
  comfortable one. Report the paired per-expectation test, not run-level means.
- **Keeping 2 requires two findings, not one**: that `2` beats `unlimited` by more
  than the band, *and* that `1` does not beat `2` by more than the band. The first
  re-establishes the mechanism; only the second establishes the knee, and only the
  second is what the default rests on.
- Record cost per arm. **The answer may be cheaper rather than dearer** — if the knee
  is at `1` the cost rises, but if the clean gap between `unlimited` and `2` is
  smaller than measured, the +89% buys less than the record claims. That is what
  makes this the cheapest open recall question rather than an expensive one.

Until that run exists, `2` stays as it is — a default set on a confounded sweep and
labelled as such, which is a better state than a default quietly presented as
measured.

## Sub-File Partitioning — MEASURED AND REJECTED (2026-08-07)

The section above called sub-file partitioning "the untested lever […] where the curve
points next". **It has now been tested, it does not work, and the code has been
removed.** This section exists so nobody proposes it again.

### What was built and measured

A file's body was cut at **declaration anchors from the AST** (never a byte count),
grouped into contiguous runs overlapping by one declaration, capped at a fixed number
of groups per file, with each group becoming its own discovery call carrying the full
shared context. Operating point chosen by a $0 precheck: 16 declarations per group,
3 groups per file — 35 of 70 corpus cases split, 1.77x discovery calls measured.

Control `359161b` vs treatment `45a75da`, **10 seeds per arm**, alternating order,
5/5 position balance, `dirty=0` throughout, 70-case security corpus,
`openai/gpt-5.3-codex`.

| | control | treatment |
|---|---|---|
| recall | **64.0%** (sd 2.22pp) | **61.1%** (sd 4.68pp) |
| adjusted precision | 95.0% | 96.9% |
| raw findings | 886 | 1494 |
| discovery calls | 710 | 1260 (1.77x) |
| spend | $18.42 | $23.99 (1.30x) |

Paired over 72 expectations: **11 gained, 23 lost, two-sided exact p = 0.0576**.

### Why it fails, and it is not the cost

| context depth | control | treatment | delta |
|---|---|---|---|
| cross-function | 82.4% | 71.2% | **−11.2pp** |
| caller | 90.0% | 80.0% | −10.0pp |
| local | 86.7% | 83.3% | −3.3pp |
| implementation | 51.1% | 49.4% | −1.7pp |
| cross-file | 49.3% | 50.7% | +1.3pp |
| callee | 62.5% | 68.8% | +6.2pp |

The predicted harm landed exactly where it was predicted: `cross-function` fell 11.2
points, because a defect whose halves land in different groups is invisible to every
call.

**The predicted gain never appeared.** `local` and `implementation` were named in
advance as the depths that would rise — the defect sits inside one group, and that
group is most of what the call sees. Both **fell**. So the premise of the whole
mechanism is falsified, not merely unproven: **narrowing what a call is shown does not
buy recall even on defects wholly contained in the narrowed region.**

Meanwhile raw findings rose **69%** and adjusted precision rose, while genuine false
positives nearly halved. The extra looks find *more real defects* and *fewer of the
advisory's*. That is a statement about ranking, not about attention.

### The requirement this replaces

The design requirements previously listed here are withdrawn with the code. What
stands is the finding:

- Discovery MUST NOT be partitioned below file granularity. Every sub-file split
  measured here traded a large cross-function loss for no compensating gain.
- Attention is now **closed** as a line of work. Four mechanically different ways of
  giving the reviewer more, or narrower, attention have been measured: a second
  differently-framed pass (+0.83pp, removed), one file per call (46.5% → 46.5%), four
  prompt clauses (all null), and this (−2.9pp, removed). Any future proposal in this
  family MUST first explain why it is not one of these four.
