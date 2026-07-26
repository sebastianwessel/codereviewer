# Metrics

Every number in `eval-report.json` is produced by `calculateEvalMetrics` in
`src/domains/evaluation/metrics.ts`. This page gives the exact counter and
denominator for each one, and — more importantly — the three ways these numbers
are commonly misread.

All metrics are aggregated **across cases** (counts are summed, then the ratio is
taken), never averaged per case. Rates are rounded to 6 decimal places and
clamped to `[0, 1]`.

---

## Read this first: three traps

### 1. Raw precision understates quality; adjusted precision is the real number

A fixture's expected-finding list is a curated subset of the defects present in a
change. A precision-first reviewer routinely reports genuine defects the list
never mentioned. Raw `precision` counts every one of those as a false positive,
so it measures **fixture incompleteness**, not reviewer noise.

An independent plausibility judge reads the actual file and decides whether each
unmatched finding is a genuine defect. That splits the raw false positives:

```
falsePositiveCount = genuineFalsePositiveCount + unlistedRealFindingCount
```

- `precision` = `matched / (matched + falsePositiveCount)` — pessimistic.
- `adjustedPrecision` = `matched / (matched + genuineFalsePositiveCount)` —
  the trustworthy figure.

The gap is large and not a rounding effect. On the first judge-matched benchmark,
40 of 48 unmatched findings were judged genuine defects: raw precision 44%
understated an adjusted precision of roughly 83%.

`adjustedPrecision` is only as good as the judge that produced it. If
`scoring.adjustedPrecisionTrustworthy` is `false`, do not quote it.

### 2. Rates over MATCHED findings are not comparable across runs

`severityAccuracy`, `lineAccuracy` and the severity-weighted scores have the
**matched set** as their denominator. A change that improves recall mechanically
moves them, because it adds previously-missed (typically harder) findings to that
denominator. A drop in severity accuracy alongside a recall gain is usually
*composition*, not a quality regression.

When comparing two runs whose recall differs, compare these rates on the
**intersection** of findings matched in both runs.
→ [Comparing runs](comparing-runs.md#comparing-matched-set-rates-on-the-intersection)

### 3. Recall on an incomplete answer key understates badly

Recall's denominator is what the fixture *declares*, not what the change actually
contains. A corpus whose answer key lists 1 of the 4 real defects in a change
will report a plausible-looking recall that says nothing about the other three —
and a reviewer that finds a defect the key omits gets no recall credit for it at
all (it lands in `unlistedRealFindingCount` instead).

The corollary is a curation rule, not a caveat: **expected findings per case is
itself a measured property**. On the real-repository corpus, cases carrying one
expected finding scored 16/24 while cases carrying two scored 7/18 — and in seven
of those nine two-finding cases the review found exactly one of the two and never
both. That gap is a *stopping* behaviour, and a corpus of one-finding cases
cannot see it at all.

---

## Empty-denominator conventions

A ratio with a zero denominator is undefined. The code substitutes a fixed
"empty value", and the two families differ deliberately:

| Family | Empty value | Why |
| --- | --- | --- |
| `parseValidity`, `recall`, `recallByTier`, `productRecall`, `nitRecall`, `precision`, `adjustedPrecision`, severity-weighted rates, `lineAccuracy`, `severityAccuracy`, `artifactOnlyRecall`, `artifactOnlyPrecision` | `1` | "Nothing was expected, so nothing was missed." |
| `securityRecallByMechanism`, `securityRecallByContextDepth`, `securityObviousRecall`, `securityHardRecall`, all `fix*` rates | `0` | A mechanism with no expected findings has **no evidence** of recall; reporting 100% would be a misleading perfect. |
| `providerErrorRate`, `providerIssueRate`, `incompleteCoverageRate`, `contextMutationRate`, `commentsPerDiffHunk`, `commentsPerKloc` | `0` | Absence of a problem. |

Neither `1` nor `0` from an empty denominator is an achievement. Every rate that
can be empty ships with its denominator as a separate count field — read them
together, always.

---

## Recall

| Metric | What it counts | Denominator | How to read it |
| --- | --- | --- | --- |
| `recall` | Expected findings matched by an actionable admitted finding | Declared expected findings **minus** pairs the judge could not decide (`inconclusiveExpectedIndexes`) | The all-tiers figure. Dragged up or down by whatever proportion of the corpus is nits. |
| `productRecall` | Matched expected findings in tiers `runtime-critical` + `security` + `logic` | Expected findings in those three tiers | **The headline recall.** This is what the >80% target is measured against. |
| `nitRecall` | Matched `nit`-tier expected findings | `nit`-tier expected findings | Reported for visibility only. Not part of any target or gate. |
| `recallByTier` | Per-tier matched | Per-tier expected | Four rates: `runtime-critical`, `security`, `logic`, `nit`. |
| `severityWeightedRecall` | Sum of severity weights of matched expected findings | Sum of severity weights of scored expected findings | Weights: `critical` 5, `high` 4, `medium` 3, `low` 2, `info` 1. |
| `artifactOnlyRecall` | Expected findings matched by an **artifact-only** finding | Same denominator as `recall` | Diagnostic. Artifact-only findings are excluded from `recall`; this shows what they would have caught. |

**Tier assignment.** An expected finding may declare `tier` explicitly. Otherwise
it is derived: `security` → `security`; `bug` at `critical`/`high` →
`runtime-critical`, otherwise `logic`; `performance`/`compatibility` → `logic`;
`maintainability`/`test`/`policy` → `nit`.

**What counts as "an actionable admitted finding".** Findings with
`reporterEligibility = "artifact-only"` are excluded from the actionable set and
scored separately. Model-origin findings must additionally have survived
refutation and admission to be admitted at all.

---

## Precision and noise

| Metric | What it counts | Denominator | How to read it |
| --- | --- | --- | --- |
| `precision` | Matched findings | `matched + falsePositiveCount` | **Understated.** See trap 1. Useful only as a floor. |
| `adjustedPrecision` | Matched findings | `matched + genuineFalsePositiveCount` | **The trustworthy precision.** Valid only when `scoring.adjustedPrecisionTrustworthy` is `true`. |
| `falsePositiveCount` | Unmatched actionable findings that are not duplicates of a matched finding | — (a count) | *Raw* noise. Includes real-but-unlisted defects. |
| `genuineFalsePositiveCount` | `falsePositiveCount − unlistedRealFindingCount` | — | Unmatched findings the plausibility judge called spurious, **plus** every finding whose judgment could not be completed (fail-closed). The trustworthy noise count. |
| `unlistedRealFindingCount` | Unmatched findings the plausibility judge affirmatively called genuine defects | — | Real defects the fixture omitted. Never credited to recall. |
| `noFindingZoneFalsePositiveCount` | Unmatched, non-duplicate findings landing inside a declared `expectedNoFindingZone` | — | The sharpest noise signal: the fixture explicitly asserts there is nothing to report here. |
| `duplicateFindingCount` | Unmatched findings at the same path with a line range overlapping a matched finding (tolerance 0) | — | Review noise, **not** counted as false positives. |
| `severityWeightedPrecision` | Severity weight of matched expected findings | matched weight + false-positive weight | Uses raw false positives, so it inherits trap 1. |
| `f1` | Harmonic mean of `precision` and `recall` | — | Built on **raw** precision. Prefer reading recall and `adjustedPrecision` separately. |
| `severityWeightedF1` | Harmonic mean of the two severity-weighted rates | — | Same caveat. |
| `artifactOnlyFindingCount` | Admitted findings marked `reporterEligibility = "artifact-only"` | — | |
| `artifactOnlyMatchedFindingCount` / `artifactOnlyFalsePositiveCount` | Artifact-only findings that matched / did not | — | |
| `artifactOnlyPrecision` | Artifact-only matched | artifact-only matched + artifact-only false positives | Diagnostic only; does not satisfy any gate. |
| `trustedDeterministicFindingCount` | Actionable findings seeded by `deterministic-trusted-rule` rather than model review | — | These are refutation-exempt; a high count means part of the score is not model quality. |

---

## Location and priority accuracy

Both rates are computed over the **matched** set, so both carry trap 2. Both ship
with an explicit denominator count, and the renderer prints
`n/a (0 checked)` rather than `0.0%` when that denominator is empty.

| Metric | What it counts | Denominator | How to read it |
| --- | --- | --- | --- |
| `severityAccuracy` | Matches where the finding's severity equals the expected severity exactly | `severityCheckCount` = every matched finding | Exact equality — no partial credit for being one level off. |
| `severityCheckCount` | — | — | Denominator of the above. |
| `lineAccuracy` | Matches whose `lineOverlaps` flag is true | `lineCheckCount` | **See the note below.** |
| `lineCheckCount` | Matched findings whose expected finding is `path-line` **and** declares a `lineRange` | — | Denominator of the above. |

> ### `lineAccuracy` only measures `path-line` expectations
>
> Line overlap is scored for one match mode. Both sides of the ratio are gated
> on the same condition: the expectation's effective `matchMode` is `path-line`
> and it declares a `lineRange`.
>
> - `path-semantic` and `semantic-only` expectations are never scored for line
>   overlap, so they never enter the denominator — **even when they declare a
>   `lineRange`**. On `path-semantic` the range documents where the defect sits,
>   for a human reader and for the recall report's location labels; it is not a
>   line check.
> - An expectation that is explicitly `path-line` but declares no `lineRange` is
>   excluded too. It asserts no line, and the overlap rule would otherwise
>   credit it unconditionally.
>
> A corpus with no scored expectation reports `n/a (0 checked)`. That is the
> honest reading: the metric is undefined there, not failing.
>
> **The real-repository corpus is one of those corpora.** All 42 of its expected
> findings are `path-semantic`, so it reports `n/a (0 checked)` and line
> placement on real code is currently unmeasured. Do not read that as a result
> in either direction. `lineAccuracy` is only a measurement on corpora built
> from `path-line` expectations, such as the proof-quality slices.
>
> Before 2026-07-26 the denominator admitted any expectation carrying a
> `lineRange` regardless of match mode, while only `path-line` could be
> credited. A 30-case real-repository run reported `0.0% (23 checked)` — a
> number that read as total failure of line placement and carried no
> information. Discount that figure and any earlier one like it.

---

## Security dimension (spec 15)

Security expected findings may carry a `securityMechanism` and a `contextDepth`
label. These produce **recall only** — an admitted finding carries no mechanism
label, so per-mechanism precision is not derivable and is deliberately absent.
Every empty value here is `0`, not `1`.

| Metric | What it counts | Denominator |
| --- | --- | --- |
| `securityRecallByMechanism` | Matched security expected findings, per mechanism | Expected security findings carrying that mechanism |
| `securityMechanismCounts` | `{expected, matched}` per mechanism | — |
| `securityRecallByContextDepth` | Matched, per context depth | Expected, per context depth |
| `securityContextDepthCounts` | `{expected, matched}` per depth | — |
| `securityObviousRecall` / `securityObviousCount` | Matched / expected at depth `local` | The self-contained class |
| `securityHardRecall` / `securityHardCount` | Matched / expected at every other depth | Tracked separately so aced trivial sinks never mask the hard-class gap |

Mechanisms: `authorization`, `injection`, `ssrf`, `xss`, `deserialization`,
`secret-flow`, `cryptography`, `path-traversal`, `unsafe-config`,
`concurrency-resource`, `prompt-injection`.
Context depths: `local`, `cross-function`, `callee`, `caller`, `implementation`,
`cross-file`, `analyzer-path-dependent`.

Per-mechanism denominators are small. Always read the rate next to its count —
`0%` over an expected count of 1 is not a blind spot, and `100%` over 1 is not a
strength.

---

## Run health

These decide whether the quality numbers should be read at all.

| Metric | What it counts | Denominator | How to read it |
| --- | --- | --- | --- |
| `parseValidity` | Cases that produced a schema-valid review report | Total cases | Below `1` means some case produced nothing scoreable. |
| `providerErrorRate` | Cases whose review terminated in a provider error | Total cases | |
| `providerIssueRate` | Cases that are **provider-affected** — errored, carried a provider issue, or carried a `provider-error:` / `eval-provider-retry:` warning | Total cases | Recovered instability still shows here. |
| `providerIssueCount` | Same numerator as above — a count of **affected cases**, not of individual issues | — | The name is misleading; it is a case count. |
| `inconclusiveMatchCount` | Expected/finding pairs the judge could not decide | — | These leave **both** the recall and precision denominators. A large value means the run scored fewer pairs than the corpus declares. |
| `incompleteCoverageRate` | Cases whose report coverage is `incomplete` | Total cases | Release target `0`. |
| `contextMutationRate` | Context-ledger entries truncated by budget | Ledger entries considered for model context | Release target `0`. Above `0` means the model saw less than intended. |
| `costUnavailableCount` | Cases with no provider pricing data | — | Non-zero means `costUsd` is a partial total. |

Fail-closed events also surface as per-case warnings:
`eval-inconclusive-match:<n>` and `eval-plausibility-fail-closed:<n>`.

---

## Volume, cost, latency

| Metric | What it counts | Denominator |
| --- | --- | --- |
| `actionableRate` | Findings with resolvable location, impact, evidence and a concrete remediation direction | Actionable admitted findings |
| `commentsPerKloc` | Actionable admitted findings × 1000 | Changed lines (added new-side lines from the case diff) |
| `commentsPerDiffHunk` | Actionable admitted findings | Parsed diff hunks |
| `inputTokens` / `outputTokens` | Summed provider usage | — |
| `cachedInputTokens` | Cached input tokens — a **subset** of `inputTokens`, already counted there | — |
| `costUsd` | Provider-reported or estimated cost, summed | — |
| `durationMs` | Summed wall-clock case duration | — |

`commentsPerKloc` and `commentsPerDiffHunk` are the noise-volume metrics: a
change that raises them must justify the extra noise with recall, severity or
actionability gains.

---

## Refutation and fix-lane metrics

| Metric | What it counts | Denominator / note |
| --- | --- | --- |
| `refutationFalseNegativeCount` | Per case, `min(rejectedFindings, unmatchedExpected)` | Expectations that were plausibly demoted away. Bounded so a case that rejected many duplicates of an otherwise-matched expectation is not penalised. |
| `refutationFalsePositiveCount` | Per case, `max(0, provedRefutations − matched)` | `proved` verdicts whose finding never matched. |
| `fixJudgmentAccuracy` | Fix-lane judgments agreeing with ground truth | `fixJudgedFindingCount` |
| `fixFalsePositiveDetectionRate` | Genuine false positives the lane caught | `fixGroundTruthFalsePositiveCount` |
| `fixProduceRate` | Real findings that received an apply-checked fix | `fixRealFindingCount` |
| `fixApplyFailureRate` | Attempted fixes that failed the deterministic apply-check | `fixAttemptedCount` |

All fix-lane rates are scored only over findings the lane was **eligible** to act
on (at or above `fix.minSeverity`), and their ground truth is corrected by the
plausibility judge: a matched **or** unlisted-real finding is `real`; only a
genuine false positive is `false-positive`. Empty value `0` — a run that never
exercised the lane reports `0`, not a misleading perfect. The lane is off by
default.

---

## Judge reliability

| Metric | What it counts | Denominator |
| --- | --- | --- |
| `judgeAgreement` | Semantic-judge decisions matching the human label | `judgeAgreementPairCount` — calibration pairs actually scored (12 committed) |
| `plausibilityJudgeAgreement` | Plausibility-judge decisions matching the human label | `plausibilityJudgeAgreementPairCount` — pairs actually scored (11 committed) |

Both are omitted when nothing was scored (an offline run needs no judge). A pair
whose judge call failed **leaves the denominator** rather than counting as
disagreement, so a pair count below the committed total is itself a signal.
Details: [Judges and calibration](judges-and-calibration.md).

---

## Metric groups

Every metric above is also computed per segment and emitted in
`report.metricGroups`, grouped by `sourceProfile`, `language`, and `tag`. Use
these to check that an aggregate improvement is not hiding a segment-specific
regression.

---

## See also

- [Judges and calibration](judges-and-calibration.md) — how `matched` is decided.
- [Datasets](datasets.md) — which corpus can support which metric.
- [Comparing runs](comparing-runs.md) — when a delta is real.
- [Current results](current-results.md) — the measured values.
