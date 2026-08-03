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

> ### Read this before quoting any figure on this page
>
> Until 2026-07-27 the review harness forwarded the accumulated session
> conversation into every agent call, so each stage opened holding the output of
> every call that had finished before it, attributed to the model itself.
> Refutation in particular began each call appearing to have already asserted the
> candidates it was about to adjudicate. That forwarding is now suppressed
> harness-wide.
>
> **Every number on this page was produced with history-carrying stages, and none
> of it is comparable to a current run.** The direction of the effect is
> **unknown**: the behaviour was removed because it contradicts what those stages
> are specified to do, not because it was shown to be harmful, and no measurement
> of either direction exists. Do not describe the change as an improvement, and
> re-baseline before running the next A/B.
>
> Detail: [What limits recall](what-limits-recall.md#a-caveat-that-applies-to-every-number-here).

## Headline

Measured **2026-07-26** on the **real-repository corpus** as it stood then: 36
cases, 80 expected findings, 29 upstream projects, 7 of them multi-file. Model
`gpt-5.3-codex`, three seeds, default configuration. That corpus has since lost
five cases removed for answer-key disclosure and gained six curated to make the
iterative review loop measurable, so it is now 37 cases and 87 findings and
**every number on this page was measured against an answer key that no longer
exists** — see [datasets](datasets.md#real-repository-cross-file-corpus).

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

## The 2026-08-01 change, and why the headline above understates the engine

Everything above was measured before the largest quality change this project has
made. In short:

- The engine had been dividing changes into pieces to fit an assumed size limit.
  Testing showed **that limit does not exist** — the model accepted a change carrying
  over a megabyte of source without complaint.
- Removing the division, however, made recall *fall*, which revealed the real
  constraint: **the reviewer finds roughly one problem per call, regardless of how
  much it is shown.** Recall tracks the number of calls, not the amount of code.
- Dividing the change **deliberately** — two files per review call — then raised
  defects found by about a third relative to reviewing everything at once, with false
  alarms at their lowest measured level. That setting now ships as the default.

This is the first change here whose improvement is strong enough to be conventionally
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

## What limits recall today

**A single discovery pass reports about one defect per file, and the reason is that
attention follows the diff.** Pooled over nine runs of this corpus, the first
expected finding in a file is matched 72.8% of the time and any later one in the
*same* file 4.7% of the time — while a later expectation in a *different* file is
matched 79.8% of the time, which is higher than a first one. A controlled experiment
then showed the reviewer answering the whole-file diff rather than the code it was
handed: only 21% of candidates from a diff-bearing arm pointed inside the unit they
were shown.

Because the corpus's 80 expectations sit across 47 distinct (case, file) pairs, a
reviewer returning one finding per file per round **cannot exceed 58.8% in a single
pass**. The 46.7% above is roughly 80% of that structural ceiling rather than 47% of
a perfect score, which is a materially different reading of the same number.

The full account — the experiment, the ceiling arithmetic, the six interventions
measured against it, and what has actually worked — is in
[What limits recall](what-limits-recall.md). It is the page to read before
proposing a fix.

A measurement caveat that belongs with these splits: the semantic matcher assigns
findings to expectations greedily in order, so with two expectations and two findings
a loose accept for the first can strand the second. Most cases emit only one finding,
so the effect on these numbers is probably small, but it confounds precisely the
multi-defect measurement.

## What was tried against it, and removed

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

- **Unproven, not disproven.** With 3 seeds and a baseline deviation of 4.8pp the
  resolution is roughly ±5.5pp. A small real effect would be invisible. Both were
  removed as unproven and expensive, not as demonstrated failures.
- **One signal ran the other way.** The lens pass surfaced more
  plausibility-confirmed defects the answer key never listed — 7.3 per run against
  5.3, at 100% adjusted precision. That is a real-world gain this corpus's recall
  metric cannot see, and it is also inside the noise band.

None of the three is configurable any more. The record of what they were and what
the measurement established is kept in
[extra discovery passes (removed)](../03-concepts/optional-capabilities/extra-discovery-passes.md).

## Variance: why single runs prove little

The same configuration, run repeatedly with nothing changed, varies by about **5
percentage points of recall** (sd 4.8pp over 3 seeds, 42 findings). A change must
therefore move recall by roughly **10 points** before a single run can distinguish it
from noise, or be run across several seeds.

This has already invalidated conclusions here. An earlier prompt change was reported
as worth +18.8pp on a 16-finding corpus; measured on 133 findings it is worth about
+3.8pp. The first figure was largely that small corpus's own noise.

## Other corpora

**The 59-case benchmark** (`code-review-bench-style`, 133 expected findings) reports
36.1% recall and 92.3% adjusted precision. Its recall number should not be compared
with the one above: its answer key is badly incomplete. The plausibility judge
confirmed 86 unlisted-real findings against 48 matched, so the engine finds roughly
**2.8× more genuine defects than the key lists**, and its recall understates by about
that factor. Adjusted precision is the figure worth reading there. Note also that 10
of its 59 cases are hand-built negatives rather than real pull requests.

## Known measurement limits

Stated plainly, because each of these was a wrong number at some point:

- **`lineAccuracy` is unmeasured, which is not the same as line placement being
  unmeasured.** The two are separate metrics and the similar names have misled
  readers of this page. `linePlacementRate`, reported above at ~97%, is a
  diagnostic over every matched finding regardless of match mode. `lineAccuracy`
  counts only expectations whose match mode is `path-line`, and the
  real-repository corpus contains none, so it reports `n/a (0 checked)`. It
  previously reported `0.0%` — a metric that structurally could not pass,
  displayed as one that had failed.
- **Severity accuracy is a rate over matched findings**, so it is not comparable
  across runs whose recall differs; a recall gain mechanically depresses it by adding
  harder findings to the denominator. Compare on the intersection instead.
- **The corpus is small.** 42 findings across 30 cases resolves large effects only.
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

The regression gate is hard-coded to demand 100% recall and zero false positives, so
this exits non-zero on any realistic run. The report, not the exit code, is the
output. See [Running an evaluation](running-an-evaluation.md).
