# Current results

What the engine measures at today, on which corpus, with what caveats. Every number
here is dated and names the corpus it came from, because a recall figure without a
corpus is meaningless — the same engine scores 36% on one and 55% on another.

Every number here — recall, precision, cost, every table below — was measured on
`openai/gpt-5.3-codex`. The model is part of the measurement for the same reason
the corpus is: a rate is a property of the model that produced it, and none of
this is evidence about another provider or model.

Read [Metrics](metrics.md) first if the terms are unfamiliar, and
[Datasets](datasets.md) for what each corpus can and cannot show.

**The [current headline](#current-headline) immediately below is the figure to
quote for the review stage.** Everything under [Historical
record](#historical-record) further down predates it and is kept as a dated
record of how that figure was reached, not as an alternative to quote instead.

---

## Current headline

Measured **2026-08-05** on the **real-repository corpus** as it stands today: 37
cases, 87 expected findings, 27 upstream projects. Model `openai/gpt-5.3-codex`,
engine pinned `db78900`, dependency digest verified **identical to the
2026-08-02 baseline's digest** before running, so the engine build is the only
intended difference. Three runs, zero provider errors in any of them. This is
the current, quotable figure for the review stage — it supersedes the
2026-08-02 headline further down, which is kept as a dated record of how that
figure was reached, not as an alternative to quote instead.

| Metric | Value | Per run |
| --- | ---: | --- |
| Recall, in-diff | **68.3%** (sd 2.89pp) | 66.7 / 66.7 / 71.7 |
| Recall, blended | **47.1%** | 46.0 / 46.0 / 49.4 |
| Recall, out-of-diff | **0 of 27** — unchanged | 0 / 0 / 0 |
| Raw precision | **77.8%** | 78.4 / 76.9 / 78.2 |
| Adjusted precision | **96.2%** | 95.2 / 100 / 93.5 |
| Line placement | **94.3%** | 92.5 / 95.0 / 95.3 |
| Severity accuracy | **61.0%** | 60.0 / 65.0 / 58.1 |

Source: `reports/eval-results-ledger.md`, "2026-08-05 — stage 1 re-baselined
after the instruction and disclosure changes".

**In-diff recall — 68.3% — is the number to quote for "does review find defects
in the code it was asked to look at."** It was measured **higher** than the
2026-08-02 baseline's 61.1%: the three new runs (66.7–71.7%) do not overlap the
three old ones (60.0–61.7%) at all, and an exact permutation test over the 20
ways to split six runs into two arms of three puts one-sided **p = 0.050** —
the smallest p attainable at three runs per arm, so this is as strong as this
design can report and no stronger.

**Which change moved it is not established, and this document does not claim
one did.** The eval configures no reviewer instructions, so the 2026-08-05
instruction work — reviewer instructions reaching the discovery call, see
[Status and limitations](../01-overview/status-and-limitations.md) — is
**inert on this corpus**: an empty instruction set renders an empty section.
The delta belongs to the whole span between the two engine pins, which also
carries the prior session's disclosure work (grep/list truncation notices and
the refutation withholding notice reaching the model) and a refutation-context
fix for partitioned sub-tasks. Read this as "measured higher," never as
"improved by" any one change.

**Adjusted precision — 96.2% — is not comparable to the earlier 99.1%, and it
must not be read as a fall or a regression.** `EVAL_METRICS_VERSION` moved
from `2026-08-01.discovery-telemetry` to `2026-08-03.plausibility-source-window`
between the two measurements, and that bump's own note states it changes which
findings are credited unlisted-real — hence `adjustedPrecision`,
`unlistedRealFindingCount`, and `genuineFalsePositiveCount` — for **identical
review output** on any case with a file above the cap. The 99.1% → 96.2%
movement therefore mixes a scorer correction with whatever the engine did, and
this run cannot separate them. The scorer change does not affect raw
precision, and raw precision **rose**: 74.9% (2026-08-02) to 77.8% here.

**The variance band is now 2.89pp, not 0.96pp.** Two of the three new runs
landed on 66.7% and one on 71.7% — three times the spread of the 2026-08-02
runs, on the same corpus and the same run count. Until that is understood,
treat **2.89pp**, not 0.96pp, as the current band for judging a further change
against this baseline. See [Variance: why single runs prove
little](#variance-why-single-runs-prove-little) below.

**Out-of-diff recall stayed at a hard 0 of 27, in every run — unchanged from
the 2026-08-02 baseline.** Nothing in this span of changes targeted it, and
nothing moved it. The scope boundary documented in [Out-of-diff recall and
`impact check`](#out-of-diff-recall-and-impact-check-two-different-jobs-not-one-scorecard)
below stands exactly as written.

**Cost is two numbers, not one, and quoting either alone misrepresents the
other.** A cold-cache run costs **$1.97**; with a warm cache, **$0.82–0.83** —
more than 2x apart. Prompt caching is reachable at this engine pin, which
reverses an earlier probe that found it unavailable: the first of the three
runs cached 5% of its input, and the second and third cached 79% and 80%,
which is what cut cost from $1.97 to $0.83 and $0.82. That also means an A/B
run second on a shared cache inherits the first arm's warm cache — quote the
cold figure, or state which you're quoting. The three-run sweep cost **$3.62
review + $0.81 scoring = $4.44** for 3 × 37 cases.

## Out-of-diff recall and `impact check`: two different jobs, not one scorecard

`review` answers "does this change introduce a defect," and its attention is
scoped to the reviewed diff by design — a different job from a full repository
audit ("does this codebase contain a defect, changed or not"), which is not
built. The 2026-08-05 runs above measured **0 of 27** out-of-diff expectations
found, across all three runs — unchanged from the 2026-08-02 baseline: a
measured zero over a full denominator, not noise and not a defect in the
reviewer. Every one of those 27 misses sat in a file the reviewer had been
shown **in full** — the miss is diff-scoped attention holding exactly as
designed, not a context or retrieval gap. Full account: [What limits
recall](what-limits-recall.md).

`impact check` is a separate command built for exactly that population. Scored
against the same 27 out-of-diff expectations — the population it exists for — its
deterministic core localises **20 of 27 (74.1%)** inside a symbol it flagged as
changed (measured 2026-08-02, engine `6781a26`; this figure was not re-measured
at the 2026-08-05 pin — source: `reports/eval-results-ledger.md`, "2026-08-02 —
stage 1, three runs at one pinned engine").

That figure covers the deterministic core only. The command's **adjudication
layer** (`changeImpact.adjudication.enabled`, off by default) is **unmeasured**:
no figure for it exists, none may be quoted, and the 74.1% above must not be
read as covering it.

**That 74.1% is coverage, not detection, and it is not comparable to a recall
figure.** `impact check` reports risk and never claims a defect is present — it
answers "is this location worth a human look," not "is there a defect here."
Quoting a blended recall (which folds review's in-diff and out-of-diff
performance into one number) against `impact check`'s coverage, or treating the
two as substitutes, scores one stage against the other stage's job. Keep the
two figures — 68.3% in-diff recall for review, 74.1% out-of-diff coverage for
`impact check` — separate and separately labelled wherever either is quoted.

---

## Historical record

Everything below predates the [current headline](#current-headline) above. Read
the date on each section before quoting anything from it.

**The 2026-08-02 entry directly below carries the same engine-pinning and
dependency-digest guarantees as the current headline above it — it predates
only the current headline, nothing more.** Everything further below it also
predates 2026-08-01 engine pinning: before that date the harness pinned the
repository under test but invoked the *engine* from the live working tree, so
nothing in a scored artefact recorded which engine build produced it. None of
those older figures carries engine provenance and none can be pooled with
either pinned baseline above; treat small deltas among the historical figures
themselves as correspondingly weaker evidence too.

### 2026-08-02 — stage 1, three runs at one pinned engine

**Superseded by the [current headline](#current-headline) above.** Kept below
as a dated record of the measurement it replaced.

The figures the report renderer prints to users as of this writing. Recorded
here so the prose in `markdown-reporter.ts` and `summary-comment.ts` can be
traced back to the measurement it cites, even though that prose has not yet
been updated to the current headline above. Engine `6781a26`, same dependency
digest across all three runs.

| metric | value |
| --- | ---: |
| in-diff recall | 61.7 / 60.0 / 61.7 — mean 61.1%, **sd 0.96pp** |
| blended recall | 42.5 / 41.4 / 42.5 — mean 42.1%, **sd 0.66pp** |
| adjusted precision | 100 / 97.3 / 100 — mean 99.1% |
| out-of-diff recall | 0 / 0 / 0 — **0 of 27**, a measured zero over a full denominator |
| reported findings landing in-diff | 94.2% (49 of 52); the 3 strays were all judged real |

Two consequences worth keeping attached to these numbers.

The **sd was ~0.7pp, not the ±4.8pp** this project used for months. That older
band was estimated from too few samples and made every single-run comparison
unreadable in both directions; it produced at least three wrong calls in one
day, including two opposite readings of the same change. **This figure is
itself superseded** — the 2026-08-05 re-baseline above measured sd 2.89pp on
the same corpus and run count. Use 2.89pp, not 0.96pp or ~1pp, as the current
resolution.

The **out-of-diff zero is a scope boundary, not a defect**. `impact check` covers
that population at 20 of 27 (74.1%). Quoting a blended recall scores stage 1
against stage 3's job — the error spec 22 warns about by name.

### Headline

**Superseded by the [current headline](#current-headline) above.** Kept below as
a dated record of the measurement it replaced.

> #### Read this before quoting this section
>
> Until 2026-07-27 the review harness forwarded the accumulated session
> conversation into every agent call, so each stage opened holding the output of
> every call that had finished before it, attributed to the model itself.
> Refutation in particular began each call appearing to have already asserted the
> candidates it was about to adjudicate. That forwarding is now suppressed
> harness-wide.
>
> **Every number in this section was produced with history-carrying stages, and
> none of it is comparable to a current run.** The direction of the effect is
> **unknown**: the behaviour was removed because it contradicts what those stages
> are specified to do, not because it was shown to be harmful, and no measurement
> of either direction exists for this specific run. Do not describe the change as
> an improvement.
>
> Detail: [What limits recall](what-limits-recall.md#a-caveat-that-applies-to-every-number-here).

Measured **2026-07-26** on the **real-repository corpus** as it stood then: 36
cases, 80 expected findings, 29 upstream projects, 7 of them multi-file. Model
`gpt-5.3-codex`, three seeds, default configuration. That corpus has since lost
five cases removed for answer-key disclosure and gained six curated to make the
iterative review loop measurable, so it is now 37 cases and 87 findings and
**every number in this section was measured against an answer key that no
longer exists** — see [datasets](datasets.md#real-repository-cross-file-corpus).

| Metric | Value | Notes |
| --- | ---: | --- |
| Recall | **46.7%** | 46.3 / 45.0 / 48.8 |
| Adjusted precision | **97.3–100%** | |
| **False alarms on defect-free zones** | **0** | across every run, on ten curated zones |
| Severity accuracy | ~44% | ~49% when the actionable floor is lowered to `low` |
| Line placement (`linePlacementRate`) | ~97% | share of matched findings whose reported line falls inside the expected range |
| Cost | **~$1.6–1.9** | per 36-case run, with prompt caching working |

**This number is not comparable to the 53.2% published earlier the same day.** The
corpus changed underneath it: from 30 cases and 42 findings to 36 and 80, with
findings beyond the first added to 22 cases and one case carrying six. The
comparison tooling refuses to diff across that change rather than reporting a
misleading delta.

The drop is the corpus getting harder, and specifically it is the
one-defect-per-file behaviour becoming visible. A corpus of one-finding cases
cannot see that limitation at all; this one is built to.

**Precision and false alarms held under a substantially harder corpus**, which is
the more reassuring half of the result.

### The 2026-08-01 change, and why the 2026-07-26 headline understates the engine

Everything in the section above was measured before the largest quality change this
project has made. In short:

- The engine had been dividing changes into pieces to fit an assumed size limit.
  Testing showed **that limit does not exist** — the model accepted a change carrying
  over a megabyte of source without complaint.
- Removing the division, however, made recall *fall*, which revealed the real
  constraint: **the reviewer finds roughly one problem per call, regardless of how
  much it is shown.** Recall tracks the number of calls, not the amount of code.
- Dividing the change **deliberately** — two files per review call — then raised
  defects found by about a third relative to reviewing everything at once, with false
  alarms at their lowest measured level. That setting now ships as the default.

This is the change whose improvement is strong enough to be conventionally
significant rather than suggestive, and it is described in full in
[What limits recall](what-limits-recall.md#the-central-finding-in-two-parts).

Separately, the ability to consult *other* files in the repository — previously
recorded here as unhelpful — was re-tested and **the earlier verdict was wrong**. It
had been measuring a bug that cut files off mid-read without telling the reviewer.

It is now **on by default**. Two independent runs put it ahead on every dimension
measured: more defects found, fewer false alarms, slightly *lower* cost, no added
failures, and latency inside noise. The recall gain on its own is not statistically
significant, and no specific improvement is claimed for it — but significance is the
bar for claiming a benefit, not for allowing a change that is free and shows no harm.
If a regression ever appears, this is the first switch to turn back off.

**These changes are already reflected in both pinned headlines' shipped
defaults.** The 2026-08-02 and 2026-08-05 measurements both ran with
partitioning and cross-file retrieval on, at their shipped settings.

### What limits recall today

**A single discovery pass reports about one defect per file, and the reason is that
attention follows the diff.** Pooled over nine runs of the 36-case / 80-finding
corpus, the first expected finding in a file is matched 72.8% of the time and any
later one in the *same* file 4.7% of the time — while a later expectation in a
*different* file is matched 79.8% of the time, which is higher than a first one. A
controlled experiment then showed the reviewer answering the whole-file diff rather
than the code it was handed: only 21% of candidates from a diff-bearing arm pointed
inside the unit they were shown. This measurement predates the current 37-case /
87-finding corpus and the pinned baselines above; it is the diagnosis that
motivated the partitioning default described in the previous section, not a figure
to quote as the corpus's current shape.

Because that corpus's 80 expectations sit across 47 distinct (case, file) pairs, a
reviewer returning one finding per file per round **cannot exceed 58.8% in a single
pass** on it. The 46.7% figure in the 2026-07-26 headline above is roughly 80% of
that structural ceiling rather than 47% of a perfect score, which is a materially
different reading of the same number.

The full account — the experiment, the ceiling arithmetic, the six interventions
measured against it, and what has actually worked — is in
[What limits recall](what-limits-recall.md). It is the page to read before
proposing a fix.

A measurement caveat that belongs with these splits: the splits above were scored
by a matcher that assigned findings to expectations **greedily in order**, so with
two expectations and two findings a loose accept for the first could strand the
second — confounding precisely the multi-defect measurement they are about. Most
cases emit only one finding, so the effect on these numbers is probably small. The
matcher has since been replaced by maximum-cardinality bipartite matching
(`eval-matcher.ts`): no expectation is stranded when some assignment could have
matched it, and the pairing is identical wherever the greedy one was already
optimal.

### What was tried against it, and removed

Three additional discovery passes were built, measured, and **removed** — code and
configuration keys alike. On the 30-case / 42-finding corpus, three seeds each:

| Arm | Recall (3 seeds) | Mean | Cost |
| --- | --- | ---: | ---: |
| Baseline | 50.0 / 54.8 / 59.5 | **54.8%** | $1.22 |
| + enumeration sweep | 50.0 / 52.4 / 61.9 | **54.8%** | $1.71 (+40%) |
| + diverse-lens pass | 57.1 / 52.4 / 52.4 | **54.0%** | $1.78 (+47%) |

The third, an un-anchored pass that reviewed bounded units with the diff withheld,
was measured later on the current 36-case corpus: **+0.83pp for +136% cost, 10
expectations gained and 9 lost, p = 0.82**.

Two qualifications belong with the first two verdicts:

- **Unproven, not disproven.** With 3 seeds and a baseline deviation of 4.8pp on
  this corpus the resolution is roughly ±5.5pp. A small real effect would be
  invisible. Both were removed as unproven and expensive, not as demonstrated
  failures. (The pinned-engine measurements above put the same kind of comparison,
  on the current corpus, at a much tighter resolution — see
  [Variance](#variance-why-single-runs-prove-little) below.)
- **One signal ran the other way.** The lens pass surfaced more
  plausibility-confirmed defects the answer key never listed — 7.3 per run against
  5.3, at 100% adjusted precision. That is a real-world gain this corpus's recall
  metric cannot see, and it is also inside the noise band.

None of the three is configurable any more. The record of what they were and what
the measurement established is kept in
[extra discovery passes (removed)](../03-concepts/optional-capabilities/extra-discovery-passes.md).

### Variance: why single runs prove little

The same configuration, run repeatedly with nothing changed, varies by about **5
percentage points of recall** (sd 4.8pp over 3 seeds, 42 findings, the 30-case
corpus). A change on that corpus had to move recall by roughly **10 points** before
a single run could distinguish it from noise, or be run across several seeds.

This has already invalidated conclusions here. An earlier prompt change was reported
as worth +18.8pp on a 16-finding corpus; measured on 133 findings it is worth about
+3.8pp. The first figure was largely that small corpus's own noise.

**This ±4.8pp / ±5.5pp band was first superseded by a tighter one, which has itself
since been revised upward.** The 2026-08-02 measurement — three runs at one pinned
engine, one verified dependency digest, the current 37-case / 87-finding corpus —
put the standard deviation at 0.96pp (in-diff) and 0.66pp (blended), and was quoted
for a time as ~1pp resolution. The 2026-08-05 re-baseline, same corpus and run
count, measured **sd 2.89pp** on in-diff recall instead — three times wider, cause
not yet understood. **Use 2.89pp, not 0.96pp and not ±4.8pp, as the current
operating figure.** See the [current headline](#current-headline) above. The
entries in this section remain correct as descriptions of what they measured, on
the corpus and engine state of the time; none of them is a substitute for the
current figure.

### Other corpora

**The 59-case benchmark** (`code-review-bench-style`, 133 expected findings) reports
36.1% recall and 92.3% adjusted precision. Its recall number should not be compared
with the real-repository figures above: its answer key is badly incomplete. The
plausibility judge confirmed 86 unlisted-real findings against 48 matched, so the
engine finds roughly **2.8× more genuine defects than the key lists**, and its
recall understates by about that factor. Adjusted precision is the figure worth
reading there. Note also that 10 of its 59 cases are hand-built negatives rather
than real pull requests. This corpus was not part of either pinned-engine
measurement above and has no comparably recent figure recorded.

---

## Known measurement limits

Stated plainly, because each of these was a wrong number at some point:

- **`lineAccuracy` is unmeasured, which is not the same as line placement being
  unmeasured.** The two are separate metrics and the similar names have misled
  readers of this page. `linePlacementRate` is a diagnostic over every matched
  finding regardless of match mode. `lineAccuracy` counts only expectations whose
  match mode is `path-line`, and the real-repository corpus contains none, so it
  reports `n/a (0 checked)`. It previously reported `0.0%` — a metric that
  structurally could not pass, displayed as one that had failed.
- **Severity accuracy is a rate over matched findings**, so it is not comparable
  across runs whose recall differs; a recall gain mechanically depresses it by adding
  harder findings to the denominator. Compare on the intersection instead.
- **The corpus is modest.** 87 findings across 37 cases resolves large effects
  reliably — the current pinned baseline's own seed-to-seed spread is 2.89pp — but a
  real effect much smaller than that still needs several runs at one pinned engine
  to separate from noise.
- **All cases are `held-out`** by the anti-contamination policy, but the upstream
  repositories are public and may appear in model training data. Temporal cutoff and
  answer-key exclusion mitigate this; they do not eliminate it.

## Reproducing

```bash
npm run eval:corpus
```

Hydration alone, which costs no provider spend:

```bash
npm run eval:corpus:hydrate
```

The default `stable` gate profile thresholds only parse validity and provider
errors, so a clean run of this corpus exits `0` while saying nothing about recall.
Passing `--gate-profile strict` restores the old bar — 100% recall, zero raw false
positives — which exits non-zero on any realistic run. Either way the report, not
the exit code, is the output. See
[Running an evaluation](running-an-evaluation.md#the-regression-gate).
