# Current results

What the engine measures at today, on which corpus, with what caveats. Every number
here is dated and names the corpus it came from, because a recall figure without a
corpus is meaningless — the same engine scores 36% on one and 55% on another.

Read [Metrics](metrics.md) first if the terms are unfamiliar, and
[Datasets](datasets.md) for what each corpus can and cannot show.

## Headline

Measured **2026-07-26**, model `gpt-5.3-codex`, on the **real-repository corpus**:
30 cases, 42 expected findings, 24 upstream repositories, 13 languages, each checked
out in full at the commit before the upstream fix.

| Metric | Value | Notes |
| --- | ---: | --- |
| Recall | **54.8%** | mean of 3 seeds (50.0 / 54.8 / 59.5), sd 4.8pp |
| Matched findings | 23 of 42 | mean of 21 / 23 / 25 |
| Adjusted precision | **95.8–100%** | 100% in 2 of 3 seeds |
| Genuine false positives | **0–1** per run | out of ~28 findings reported |
| Unlisted-real findings | 4–7 per run | genuine defects the answer key never listed |
| Severity accuracy | ~43% | the weakest metric |
| Provider errors | 0% | |
| Cost | ~$1.22 | per 30-case run, ~4.5 minutes |

Recall by tier, median run: **runtime-critical 100%**, logic 57.9%, security 50.0%.

**How to read this.** The engine is precision-strong and recall-moderate. When it
reports something, it is almost always a real defect — across nine runs of this
corpus it produced a single genuine false positive in total. It does not find
everything: roughly two of every five known defects are missed.

## What limits recall today

**A single discovery pass reports about one defect per file.** This is measured, not
inferred. The corpus holds 19 single-expectation cases, 10 double and 1 triple.
Pooled over the three baseline seeds:

| Split | Recall |
| --- | ---: |
| single-expectation cases | 39 of 57 (68.4%) |
| multi-expectation cases | 30 of 69 (43.5%) |
| **first-listed expectation of a case** | **64 of 90 (71.1%)** |
| **every later expectation** | **5 of 36 (13.9%)** |

Both decompositions reconcile exactly to the 54.8% headline. The rank split is the
sharper one: the engine reliably finds a case's headline defect and almost never the
later one. **No later expectation in this corpus is high-severity** — all fourteen
highs are first-listed — and every one of the seven later `medium` expectations was
missed in all three seeds.

A further measurement caveat: the semantic matcher assigns findings to expectations
greedily in order, so with two expectations and two findings a loose accept for the
first can strand the second. Most cases emit only one finding, so the effect on these
numbers is probably small, but it confounds precisely the multi-defect measurement.

Instrumenting a live run confirmed the mechanism sits in generation, not in the
pipeline: every task logged one finding produced, one candidate kept, and zero
dropped. Refutation proved nearly every candidate it received. There was simply only
ever one.

## What was tried against it, and removed

Two structural fixes were built and measured, three seeds each. **Neither improved
recall**, so both were **removed** — code and configuration keys alike.

| Arm | Recall (3 seeds) | Mean | Cost |
| --- | --- | ---: | ---: |
| Baseline | 50.0 / 54.8 / 59.5 | **54.8%** | $1.22 |
| + enumeration sweep | 50.0 / 52.4 / 61.9 | **54.8%** | $1.71 (+40%) |
| + diverse-lens pass | 57.1 / 52.4 / 52.4 | **54.0%** | $1.78 (+47%) |

- The **enumeration sweep** re-asked the same question — "what did the last pass
  miss?" — until a round added nothing. Mean recall identical to baseline.
- The **diverse-lens pass** asked a *different* question, re-reading the change
  hunting concurrency, unawaited asynchrony, error paths, resource lifetime,
  contract violations, and edge cases. Mean recall within noise of baseline.

Two qualifications belong with that verdict:

- **Unproven, not disproven.** With 3 seeds and a baseline deviation of 4.8pp the
  resolution is roughly ±5.5pp. A small real effect would be invisible. Both were
  removed as unproven and expensive, not as demonstrated failures.
- **One signal ran the other way.** The lens pass surfaced more
  plausibility-confirmed defects the answer key never listed — 7.3 per run against
  5.3, at 100% adjusted precision. That is a real-world gain this corpus's recall
  metric cannot see, and it is also inside the noise band.

The honest reading: the missed second defect is not being withheld by a model that
would surface it if asked once more, or asked differently. Asking again mostly
reproduces the first answer. **The limitation remains open** — what would actually
move this number is not yet known.

Neither is configurable any more. The record of what they were and what the
measurement established is kept in
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

- **Line placement is unmeasured.** Every expectation in the real-repository corpus
  matches semantically and declares no line check the matcher can satisfy, so
  `lineAccuracy` reports `n/a (0 checked)`. It previously reported `0.0%` — a metric
  that structurally could not pass, displayed as one that failed.
- **Severity accuracy is a rate over matched findings**, so it is not comparable
  across runs whose recall differs; a recall gain mechanically depresses it by adding
  harder findings to the denominator. Compare on the intersection instead.
- **The corpus is small.** 42 findings across 30 cases resolves large effects only.
- **All cases are `held-out`** by the anti-contamination policy, but the upstream
  repositories are public and may appear in model training data. Temporal cutoff and
  answer-key exclusion mitigate this; they do not eliminate it.

## Reproducing

```bash
node --import tsx scripts/hydrate-real-repo-corpus.ts
```

```bash
npm run cli -- eval run --slice-root .codereviewer/eval/corpus-slices/real-repo-cross-file --review-mode pr --review-depth thorough --max-concurrent-tasks 1
```

The regression gate is hard-coded to demand 100% recall and zero false positives, so
this exits non-zero on any realistic run. The report, not the exit code, is the
output. See [Running an evaluation](running-an-evaluation.md).
