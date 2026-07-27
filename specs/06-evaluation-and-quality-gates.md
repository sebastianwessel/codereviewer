# 06: Evaluation And Quality Gates

Status: Approved
Date: 2026-06-19

## Evaluation Goal

Evaluation is a product capability, not only test infrastructure. It measures
semantic review quality, refutation quality, regression risk, cost, and
latency across golden fixtures before review behavior changes are accepted.

`codereviewer eval run` must not load the repository root `.env` file inside
the CLI implementation by default. This keeps programmatic eval calls
reproducible. Repository npm scripts for provider-backed eval may use Node's
native `--env-file-if-exists=.env` flag to provide a simpler local UX. The
plain deterministic eval script must not load `.env`.

## Eval Dataset Contract

Development datasets live under root `eval/fixtures/` in R1. The shippable
source package keeps reusable evaluation schemas, matching, metrics, and runner
logic under `src/domains/evaluation/`.

Eval report schemas are a focused evaluation contract boundary. The contract
module owns report selection, scoring metadata, provider issue case details,
case result summaries, metric groups, and regression thresholds. Eval execution
and Markdown rendering must import that contract instead of redefining report
shape locally.

`codereviewer eval run` loads both:

- declared cases from `eval/fixtures/sample-eval-cases.json`;
- self-contained slice cases from `eval/fixtures/slices/<case-id>/slice.json`
  with source files under `eval/fixtures/slices/<case-id>/repo/`.

`codereviewer eval run --slice-root <path>` loads only slice cases from the
repository-relative directory at `<path>`. The directory must contain
`<case-id>/slice.json` and `<case-id>/repo/` entries. This mode exists for
untracked local benchmark packs copied into the repository workspace, such as
`eval/benchmarks/<dataset>/`, without requiring those packs to be committed.
Tracked benchmark-style packs may also live under `eval/benchmarks/` when they
are small, self-contained, and useful as a stable quality regression set.
Benchmark packs that intentionally commit metadata without executable source
must provide a preparation command that materializes a local slice root before
`eval run` is invoked. The Code Review Bench-style pack uses public PR/commit
unified diffs to hydrate full head-side files under
`.codereviewer/eval/benchmark-slices/code-review-bench-style/`; benchmark run
scripts must point `--slice-root` at that hydrated root, not at the
metadata-only source pack. The `eval:hydrate` script materializes that root.
The benchmark eval entrypoint must enforce hydration: before scoring, any
positive slice (non-empty `expectedFindings`) that still contains the
metadata-only placeholder marker must abort the run with a clear error telling
the user to hydrate first, rather than silently scoring it as zero recall.
Negative/noise slices with no expected findings may remain metadata-only.

`codereviewer eval run --case <case-id>` filters the loaded eval cases by exact
case ID. The flag may be repeated. If no loaded case matches, the command exits
with usage error `2`.

`codereviewer eval run --max-concurrent-tasks <1-32>` overrides
`review.maxConcurrentTasks` only for the eval invocation. The override exists so
provider-backed benchmark runs can be serialized without changing the
repository config. Benchmark npm scripts that use provider-backed semantic
judging should pass `--max-concurrent-tasks 1` to avoid transient timeout noise
from parallel provider calls on large captured slices.

R1 also supports benchmark-style self-contained slices that follow the same
`repo/` layout and use the canonical `expectedFindings[]` contract. These
slices are used to compare review quality against external benchmark datasets
without requiring a hosted experiment tracker.

`EvalCase` fields:

| Field | Required | Type |
| --- | --- | --- |
| `id` | yes | string |
| `language` | yes | string |
| `repositoryFixture` | yes | path |
| `baseRef` | no | string |
| `headRef` | no | string |
| `changedFiles` | yes | string[] |
| `expectedFindings` | yes | `ExpectedFinding[]` |
| `expectedNoFindingZones` | no | `ExpectedNoFindingZone[]` |
| `tags` | yes | string[] |
| `sourceProfile` | no | `"project" | "benchmark-semantic" | "captured-pr"` |

`ExpectedFinding` fields:

| Field | Required | Type |
| --- | --- | --- |
| `category` | yes | FindingCategory |
| `severity` | yes | Severity (assigned by the severity rubric in `05-review-workflow-and-runtime.md`) |
| `path` | conditional | repositoryRelativePath |
| `lineRange` | no | `[start, end]` |
| `semanticSummary` | yes | string |
| `matchMode` | no | `"path-line" | "path-semantic" | "semantic-only"` |

`path` is required for `path-line` and `path-semantic` expectations.
`semantic-only` expectations are allowed only for benchmark-compatible datasets
whose golden comments do not contain reliable file or line metadata. They
participate in recall, precision, severity, cost, and latency metrics, but they
do not prove line accuracy.

`ExpectedNoFindingZone` fields:

| Field | Required | Type |
| --- | --- | --- |
| `path` | yes | repositoryRelativePath |
| `lineRange` | no | `[start, end]` |
| `reason` | yes | string |

Slice metadata fields:

| Field | Required | Type |
| --- | --- | --- |
| `id` | yes | string |
| `title` | no | string |
| `description` | no | string |
| `source` | no | string |
| `sourceUrl` | no | URL |
| `capturedAt` | no | ISO date |
| `language` | yes | string |
| `baseRef` | no | string |
| `headRef` | no | string |
| `changedFiles` | yes | string[] |
| `expectedFindings` | yes | `ExpectedFinding[]` |
| `expectedNoFindingZones` | no | `ExpectedNoFindingZone[]` |
| `tags` | no | string[] |
| `sourceProfile` | no | `"project" | "benchmark-semantic" | "captured-pr"` |

Benchmark-compatible slice metadata may additionally contain:

| Field | Required | Type |
| --- | --- | --- |
| `prUrl` | no | URL |
| `prTitle` | no | string |
| `sourceRepo` | no | string |
| `baseSha` | no | string |
| `headSha` | no | string |
| `upstreamOwner` | no | string |
| `upstreamRepo` | no | string |
| `diff` | no | unified diff string |

When a slice contains `diff`, eval metric inputs must derive
`changedLineCount` and `diffHunkCount` from that unified diff rather than from
full file length or changed-file count. `changedLineCount` counts added
new-side lines excluding file headers; `diffHunkCount` counts parsed hunk
headers. Cases without `diff` may fall back to reviewed non-empty file line
count and changed-file count.

When a slice contains `diff`, eval review execution must parse that unified
diff into the same `DiffMap[]` shape used by repository intake and pass it to
the review runner as the effective diff map for admission and local PR
review-comment draft eligibility. This eval-supplied diff map must not change
the case's `changedFiles`, source fixture root, source reading, or coverage
accounting. Cases without `diff` must keep the normal repository-intake diff
behavior.

Normalization rules:

- `expectedFindings[]` is the canonical internal shape.
- removed alternate expected-finding shapes fail validation.
- `path` is the only repository path field; removed aliases fail validation.
- `lineRange` is the only line range field.
- `matchMode` defaults from `path` and `lineRange`.

## Expected-Finding Matching

Matching decides whether an admitted finding is the defect an expected finding
describes. It is the ground truth for every quality metric, including the fix-lane
metrics, so an unreliable matcher does not merely add noise — it inverts scores: a
correct finding scored as unmatched costs recall AND precision, and marks a correct
fix-lane judgment as wrong.

Matching has exactly two stages:

1. **Deterministic gates.** `matchMode` derives from `path` and `lineRange`. For
   `path-line` and `path-semantic` the finding path must equal the expected `path`;
   for `path-line` the line ranges must overlap within a tolerance of 3 lines.
   These checks are exact and reproducible, and are applied before any model call.
2. **Semantic identity.** Whether two natural-language defect descriptions denote
   the same defect is a judgment, and is decided only by the semantic judge. There
   is no lexical or token-similarity scoring. Vocabulary overlap measures shared
   topic, not identity of defect: two different defects in one function share most
   of their words, while one defect described twice may share almost none. Such a
   heuristic ranks true matches below false ones and is forbidden in the matcher.

A match carries a boolean decision and the judge's report-safe reason. There is no
numeric similarity score — an invented number is not evidence.

### Judge Reliability

The judge is the sole semantic authority, so its reliability is a requirement, not
an assumption:

- Judge calls use deterministic sampling where the provider supports it.
- Transient provider errors are retried under the configured provider retry policy.
- A judge call that cannot be completed yields `inconclusive` for that pair. An
  inconclusive pair is **excluded from the recall and precision denominators** and
  surfaced as a run warning and in the report. It must never be recorded as "no
  match": a provider failure would otherwise fabricate both a missed expected
  finding and a false positive.
- Judge agreement is measured against a committed calibration set of human-labeled
  pairs covering clear matches, clear non-matches, and near-misses. A run whose
  agreement falls below the configured minimum reports itself as untrustworthy.

### Provider Requirement

Semantic matching runs only for cases that declare expected findings. A case with
no expected findings needs no judge and scores offline. Scoring a case that has
expected findings without an available judge fails the run with a configuration
error; the engine never falls back to a heuristic.

### Baseline Discontinuity

Removing lexical scoring changes every quality metric. Eval reports produced
before this change are not comparable to reports produced after it, and any
recorded baseline from the lexical matcher is void. A new baseline must be
recorded deliberately after this change.

## Unmatched-Finding Plausibility

An admitted finding that matches no expected finding is not necessarily a false
positive: a fixture's expected-finding list is a curated subset of the real
defects in a change, so a precision-first reviewer routinely surfaces genuine
defects the list omits. Counting every unmatched finding as a false positive
measures fixture incompleteness, not reviewer precision. (Measured on the first
judge-matched benchmark: of 48 unmatched findings, an independent judge deemed 40
genuine defects — raw precision 44% understated adjusted precision at ~83%.)

A second, independent judge — separate from the semantic-match judge — resolves
this. For each admitted finding that matched no expected finding, the plausibility
judge decides whether the finding is a genuine defect in the actual code:

- It receives the finding (title, description, severity, category, location) and
  the finding's new-side file content, bounded and redacted. It must see the same
  file the reviewer saw, not a narrow window: a judge given too little context
  under-credits real findings by answering "cannot confirm".
- It returns a boolean `plausible` decision and a report-safe reason. No numeric
  confidence.
- `plausible = true` marks the finding a real-but-unlisted defect; `false` marks
  a genuine false positive.

The plausibility judge never promotes a finding into recall or changes what the
reviewer reported. It only reclassifies the reviewer's own unmatched output for
precision accounting.

Fail-closed: a plausibility judgment that cannot be completed (provider error
after retries) leaves the finding counted as a raw false positive and is surfaced
as a warning. The engine never assumes an unjudged finding is real — precision is
only ever credited by an affirmative `plausible` decision.

Reliability mirrors the match judge: the plausibility judge is scored against a
committed calibration set of findings labeled genuine or spurious against sample
code, producing a plausibility agreement metric; a run below the configured
minimum marks its adjusted precision untrustworthy.

### Restatement Collapsing

Judging every unmatched finding in total isolation has a second failure mode
beyond the fixture-incompleteness problem above: a reviewer that finds one real
defect and reports it again at a neighbouring line gets each restatement
individually confirmed, because a judge shown only the finding and the file has
no way to know the same defect was already counted. A precision audit found this
common enough to matter: a majority of one benchmark's "unlisted-real" evidence
was a single defect restated at adjacent lines, each restatement individually
true and therefore individually credited — turning one real defect into several
counted defects and pinning `adjustedPrecision` at or near 100% while raw
`precision` visibly collapsed from the same noise.

The plausibility judge is therefore also given every finding already credited as
a real defect in the SAME file — both findings matched to an expected finding and
findings this same run has already deemed unlisted-real — and asked an explicit
second question: does the finding under review describe the SAME underlying
defect as one of those, merely restated at a different location, rather than a
distinct defect of its own? A finding the judge answers yes to is **not** added to
`unlistedRealFindingCount`: crediting it there is exactly the mechanism that
inflated `adjustedPrecision`. It is not otherwise treated specially — it stays in
the case's raw false-positive count, and therefore in `genuineFalsePositiveCount`,
exactly as it would if the restatement question had never been asked, because it
is not a further, distinct real defect the fixture omitted.

This is a judge-side, semantic fix and deliberately not a matcher-side, line-based
one. The matcher's existing zero-tolerance duplicate check (same path, an
overlapping line range against an already-matched finding) stays at zero
tolerance: it has no view of what either finding actually says, so widening it to
catch a restatement at line 593 of a match at line 592 would just as readily
merge two genuinely distinct defects sitting a few lines apart, and would do so
silently. Whether two findings are the SAME defect is a semantic question, so it
is answered by a judge that reads both descriptions, not by a line-distance
threshold.

Restatement collapsing is scoring-side only: it changes how findings are
COUNTED, never what a review produces. The reviewer's own output, recall, and
every matched finding are unaffected.

## Metrics Version

Every report records a `metricsVersion` describing the rules its numbers were
computed under, distinct from `schemaVersion`, which describes the shape they are
written in. It is bumped whenever a change alters what a metric would report for
identical review output — expectation assignment and the model category taxonomy
have each done so.

Comparison and significance testing refuse to run across differing versions rather
than producing a delta. A delta measured across a scoring change reports the
change in the ruler, not in the engine, and it is indistinguishable from a real
regression or win. Failing loudly is the only safe behaviour here: this project has
already published a recall figure that was scored against a stale answer key, and
nothing in the artifact revealed it.

## Provenance

`metricsVersion` proves the numbers in a report were computed under known rules.
It proves nothing about WHAT was scored or under WHAT configuration — and this
project has already published a recall figure (78.8%) that was silently scored
against an answer key that had since changed underneath it, with nothing in the
artifact revealing that. Every report also records `provenance`:

| Field | Type | Notes |
| --- | --- | --- |
| `provenance.answerKeyDigest` | sha256-family digest string | A stable digest over the expected-finding CONTENT (category, severity, path, effective match mode, declared `lineRange`, semantic summary) of every case in `selection.selectedCaseIds`. Deliberately scoped to expected-finding content only — it excludes `expectedNoFindingZones`, `changedFiles`, `tags`, and other case metadata, none of which change what recall or precision are scored against. Computed by the eval domain itself from the cases it actually scored; a caller cannot supply or override it. Cases are sorted by id before hashing (order-insensitive across cases, since selection order carries no meaning), but expected findings keep their original order WITHIN a case (order-sensitive, since `expectedIndex` is part of the matching contract). Reports saved before this field existed default to a fixed sentinel digest, mirroring how `metricsVersion` itself defaults for old reports. |
| `provenance.configHash` | digest string | A digest over the effective (file + environment + CLI-override merged) configuration the run used, supplied by the CLI. Comparison does NOT refuse across a `configHash` mismatch: a maintainer legitimately compares two runs under different configurations to measure the effect of changing one. The hash exists so an archived run can be read back and its configuration identity checked, not to gate diffing. Defaults to `"unspecified"` when the caller does not supply one (e.g. a direct unit-test call to the eval runner). |
| `provenance.providerId` | string, omitted when no provider | The provider identity (`ProviderConfig.id`) the run's semantic judge was built from. Omitted for a fully offline run (no expected findings, no judge needed). |
| `provenance.modelName` | string, omitted when no provider | The model name (`ProviderConfig.model`) the run's semantic judge was built from. Omitted under the same condition as `providerId`. |

`eval compare` refuses to diff two reports when any case they BOTH scored was
scored against different expectations, named individually in the error. It uses
`provenance.answerKeyDigestByCase` for this rather than the aggregate digest,
because the two situations deserve opposite treatment. Comparing a filtered run
against a fuller one changes the aggregate digest and is ordinary work, already
covered by the differing-selection warning below; the shared cases having moved
underneath the comparison is the stale-answer-key incident, which looks exactly
like a real regression or win. A guard blunt enough to block the first would
reasonably be deleted, and would take the second with it.

The significance module is deliberately stricter and refuses on the aggregate
digest: its reports form one arm whose per-expectation hit rates share a
denominator, so pooling different selections computes a rate over a population
that never existed. Comparison tolerates a difference that pooling cannot.

## Metrics

| Metric | Definition |
| --- | --- |
| `parseValidity` | Fraction of outputs validating against schemas. |
Model-backed evaluation is non-deterministic, so a single run does not establish a
result. The run-to-run band must be measured before a change is judged against it.
On the real-repository corpus, four seeds of one identical configuration produced
recall 81.3%, 87.5%, 81.3%, and 75.0% — a mean of 81.3% with a standard deviation of
4.4 percentage points, matched findings ranging 12 to 14, adjusted precision ranging
92.3% to 100%, and zero to one genuine false positive. A change measured on a single
seed must therefore move recall by more than roughly twice that deviation before it
can be distinguished from noise, and a smaller claimed effect requires several seeds.

Two consequences follow, and both are requirements rather than advice. A headline
figure is the MEAN across seeds, never the best observed run. And a quality claim
that rests on one seed must be reported with the band, because quoting the top of a
range as the result overstates the engine.

Those four seeds, and every other accuracy figure recorded anywhere in this
repository, were measured before the harness-wide suppression of conversation
history on 2026-07-27 (see *Conversation History* in `05-review-workflow-and-runtime.md`).
They are cited here for the run-to-run **variance** they establish, which is what
this section is about; none of them is a current recall figure, and none may be
quoted as one until a post-change run re-establishes a baseline.

Rates computed over MATCHED findings — `severityAccuracy`, `lineAccuracy`, and the
severity-weighted scores — are not comparable between two runs whose recall differs.
Their denominator is the matched set, so a change that improves recall mechanically
moves them by adding previously-missed (typically harder) findings to that set. When
recall differs between the runs being compared, the severity or line comparison must
be made on the INTERSECTION of findings matched in both runs, and any headline
movement in these rates must be reported as composition rather than as a quality
change until that paired check is done.

| `recall` | Expected findings matched by actionable admitted findings divided by expected findings. Model-origin actionable findings require a `proved` refutation verdict; trusted deterministic-rule findings are refutation-exempt. Findings with `reporterEligibility = "artifact-only"` are excluded. |
| `precision` | Actionable admitted findings matched to expected findings divided by actionable admitted findings. Model-origin actionable findings require a `proved` refutation verdict; trusted deterministic-rule findings are refutation-exempt. Findings with `reporterEligibility = "artifact-only"` are excluded. |
| `f1` | Harmonic mean of precision and recall. |
| `severityWeightedPrecision` | Precision weighted by expected severity impact. |
| `severityWeightedRecall` | Recall weighted by expected severity impact. |
| `severityWeightedF1` | Harmonic mean of severity-weighted precision and recall. |
| `recallByTier` | Recall computed per intent tier (`runtime-critical`, `security`, `logic`, `nit`). Each expected finding carries an explicit `tier` or one derived from category/severity. Lets product-critical recall be read separately from nits. |
| `productRecall` | Headline recall over the product tiers (`runtime-critical` + `security` + `logic`), excluding `nit`. This is the number the >80% accuracy target is measured against, matching the low-noise product scope in `00-vision.md`. |
| `nitRecall` | Recall over `nit`-tier expected findings only. Reported for visibility; not part of the headline target or gates. |
| `lineAccuracy` | Fraction of matched findings whose location overlaps the expected line range. Only `path-line` expectations that declare a `lineRange` are scored for line overlap, so only they enter the denominator; `path-semantic` and `semantic-only` expectations are excluded even when they carry a `lineRange`. A corpus with no such expectation reports an empty `lineCheckCount` and the metric is undefined, not zero. |
| `linePlacementRate` | **Diagnostic only; never gates.** Fraction of MATCHED findings, across every match mode, whose produced location falls within the expected `lineRange` (same 3-line tolerance as `lineAccuracy`'s overlap rule). Unlike `lineAccuracy`, an expectation enters this denominator whenever it declares a `lineRange`, regardless of `matchMode` — chiefly `path-semantic`, which is the entire primary real-repository corpus and was therefore invisible to any line-quality measurement at all. This is a DIFFERENT measurement from `lineAccuracy`, not a broader version feeding the same number: it exists to answer a diagnostic question (are reported line numbers roughly right on real code) and must never be read into the regression gate or any pass/fail decision. `null` on an empty denominator, for the same reason as `lineAccuracy`. |
| `linePlacementCheckCount` | Denominator of `linePlacementRate`. |
| `severityAccuracy` | Fraction of matched findings with exact severity. Both sides of the comparison are governed by the severity rubric in `05-review-workflow-and-runtime.md`; read it with "Severity Measurement" below, which states why the bare rate cannot be read as a quality figure. |
| `falsePositiveCount` | Actionable admitted findings not matched to expected findings (raw; includes real-but-unlisted defects). |
| `genuineFalsePositiveCount` | Unmatched admitted findings the plausibility judge deemed spurious, plus any whose plausibility judgment could not be completed (fail-closed). The trustworthy false-positive count. |
| `unlistedRealFindingCount` | Unmatched admitted findings the plausibility judge deemed genuine defects absent from the fixture's expected list. |
| `adjustedPrecision` | Matched findings divided by matched plus `genuineFalsePositiveCount`. Precision that does not penalise real defects the fixture omitted. The trustworthy precision figure. |
| `plausibilityJudgeAgreement` | Fraction of plausibility-calibration findings whose judge decision matched the label. A run below the configured minimum marks `adjustedPrecision` untrustworthy. |
| `plausibilityJudgeAgreementPairCount` | Denominator of `plausibilityJudgeAgreement`. |
| `artifactOnlyRecall` | Expected findings matched by artifact-only findings divided by expected findings. This is diagnostic and does not satisfy the main recall gate. |
| `artifactOnlyPrecision` | Artifact-only findings matched to expected findings divided by artifact-only matched plus artifact-only false positives. |
| `artifactOnlyFindingCount` | Count of admitted findings marked `reporterEligibility = "artifact-only"`. |
| `artifactOnlyMatchedFindingCount` | Count of artifact-only findings matched to expected findings. |
| `artifactOnlyFalsePositiveCount` | Count of artifact-only findings that neither match expected findings nor duplicate matched artifact-only findings. |
| `trustedDeterministicFindingCount` | Count of actionable findings seeded by trusted deterministic-rule evidence rather than model review. |
| `rejectionReasonCounts` | Rejected/demoted candidates tallied by `RejectReason`, aggregated across cases. Shows what the admission gate discarded before anything downstream could see it. |
| `rejectionSeverityCounts` | The same rejected candidates tallied by the candidate's OWN severity instead of by reason. Without this, "is the model over-calling severity" is confounded by the admission floor deleting every model-origin `low` candidate before anyone downstream can observe it — the floor and the question it is suspected of confounding would otherwise share exactly one blind spot. A rejection whose candidate severity could not be recovered (currently: refutation-stage rejections, whose contract does not yet thread severity through) is bucketed under `unknown` rather than silently dropped, so these counts always sum to the case's rejected-candidate count. |
| `rejectionReasonBySeverityCounts` | `rejectionReasonCounts` cross-tabulated by severity: `{ [reason]: { [severity]: count } }`. Lets a spike in one rejection reason be attributed to a severity band instead of only read in aggregate. |
| `refutationFalseNegativeCount` | **Upper bound, not a measurement.** Expected findings left unmatched in a case that also rejected at least one candidate, bounded by the unmatched-expected count. Whether the rejected candidate was actually the missing expectation is not established, because doing so would mean judging every rejected candidate against every expectation and the evaluation does not spend those provider calls. Rendered with its upper-bound label so it is not read as a count of proven refuter mistakes. |
| `refutationFalsePositiveCount` | Candidates the refuter marked `proved` that were not real defects: unmatched findings the plausibility judge deemed spurious, bounded by the case's proved refutations so a refutation-exempt trusted deterministic finding is never charged to the refuter. Counting every unmatched proved finding instead — as this metric originally did — charges the refuter for the genuine defects the fixture never listed, which is exactly what the plausibility judge exists to exonerate, and made the metric numerically identical to `unlistedRealFindingCount` on a clean run. |
| `fixJudgmentAccuracy` | Fix lane (spec 12) accuracy over the findings it was **eligible** to act on (at or above `fix.minSeverity` — the only ones it judges) that carry a ground-truth label: the fraction whose judgment agrees with ground truth. Ground truth is corrected by the plausibility judge: a matched finding **or** an unmatched-but-plausible (unlisted-real) finding is `real`; a genuine false positive is `false-positive`. Empty value is `0`. Interpreted with `fixJudgedFindingCount`. |
| `fixFalsePositiveDetectionRate` | Of eligible genuine-false-positive findings, the fraction the fix lane judged `false-positive`. Recall on catching real noise. Empty value is `0`. Interpreted with `fixGroundTruthFalsePositiveCount`. |
| `fixProduceRate` | Of eligible real findings (matched or unlisted-real), the fraction that received an apply-checked fix (`applyCheck = "passed"`). Empty value is `0`. Interpreted with `fixRealFindingCount`. |
| `fixApplyFailureRate` | Of fixes the lane attempted (`applyCheck` `passed` or `failed`), the fraction that FAILED the deterministic apply-check — hallucinated or stale edits caught by code. Empty value is `0`. Interpreted with `fixAttemptedCount`. |
| `fixJudgedFindingCount` | Denominator of `fixJudgmentAccuracy`: judged findings that carry a ground-truth label. |
| `fixGroundTruthFalsePositiveCount` | Denominator of `fixFalsePositiveDetectionRate`: eligible genuine-false-positive findings. |
| `fixRealFindingCount` | Denominator of `fixProduceRate`: eligible real findings (matched or unlisted-real). |
| `fixAttemptedCount` | Denominator of `fixApplyFailureRate`: fixes the lane attempted. |
| `judgeAgreement` | Fraction of calibration pairs whose semantic-judge decision matched the human label. Reported whenever the calibration set is scored. A run below the configured minimum reports itself as untrustworthy. |
| `judgeAgreementPairCount` | Denominator of `judgeAgreement`: calibration pairs scored. |
| `inconclusiveMatchCount` | Expected/finding pairs the judge could not decide because the judge call failed. Excluded from the recall and precision denominators and surfaced as a run warning. |
| `actionableRate` | Actionable admitted findings with resolvable location, impact, evidence, and a concrete remediation direction divided by actionable admitted findings. |
| `commentsPerKloc` | Actionable admitted findings per thousand changed lines. |
| `commentsPerDiffHunk` | Actionable admitted findings per changed diff hunk. |
| `incompleteCoverageRate` | Runs whose report coverage is incomplete divided by total runs. The release target is `0`. |
| `contextMutationRate` | Context ledger entries with budget-driven mutation divided by entries considered for model context. The release target is `0`. |
| `costUsd` | Provider-reported or estimated cost, summed across each case's REVIEW report only. Does not include judge or plausibility-judge provider spend — see `scoringCostUsd`. |
| `durationMs` | Summed per-case review duration (each case's own `run.durationMs`, added together). This is **not** a wall-clock measurement: it excludes judge/plausibility-judge calls, calibration, orchestration, and any idle time between cases, so it cannot be compared to how long the run actually took. See `elapsedMs` for that. |
| `scoringInputTokens` | Input tokens the semantic-match judge and the plausibility judge consumed across the WHOLE run — both matching and their own calibration passes — captured by wrapping the judge model alias in the same usage-recorder mechanism the review path uses. `0` when no judge ran (an offline run). |
| `scoringCachedInputTokens` | Cached (prompt-cache read) subset of `scoringInputTokens`. |
| `scoringOutputTokens` | Output tokens the judge/plausibility judge produced across the whole run. |
| `scoringCostUsd` | Judge + plausibility-judge provider spend for the whole run, priced with the same cost helper (and the same configured/built-in prices) that produces `costUsd`. Deliberately its own field, never summed into `costUsd`: folding it in would silently inflate every historical cost figure's meaning instead of making the previously-invisible judge spend visible as what it is. Before this metric existed, judge/plausibility calls were real provider calls that nothing counted, so every published cost figure understated true spend by roughly this amount (10-30% depending on corpus, from this project's own measurement). |
| `scoringCostUnavailable` | `true` when a judge ran but its cost could not be priced (no provider cost and no configured/built-in prices) — mirrors `costUnavailableCount`, but as a single run-level flag rather than a per-case count, since one usage recorder covers the whole run rather than one case. |
| `elapsedMs` | Monotonic wall-clock elapsed time for the WHOLE evaluation run: per-case review execution plus judge/plausibility scoring. Unlike `durationMs`, this genuinely answers "how long did the run take" because it is a real elapsed-time measurement, not a sum of per-case self-reports. Measured with an injectable monotonic clock (mirroring the CLI's `now` seam used for `generatedAt`) so tests stay deterministic. |

### Severity Measurement

`expectedFindings[].severity` and the severity a run assigns are both governed by
the severity rubric in `05-review-workflow-and-runtime.md`. A curator labelling a
new expectation applies that rubric; a label that cannot be derived from it is a
fixture defect, not an engine defect, and `severityAccuracy` computed against such
a label measures label noise. This dependency is the whole reason the rubric is
normative: before it existed, `severityAccuracy` scored agreement with a
judgement no written standard justified, so neither a low score nor an improvement
in it could be attributed to the engine.

Three properties of this metric must be stated plainly, because each one makes a
naive reading wrong:

- **Exact equality on a five-level scale, with no partial credit.** A finding one
  band away scores identically to one three bands away. The metric therefore
  cannot distinguish a systematic one-band bias from random assignment, and a
  severity claim must be supported by the direction of the disagreements, not by
  the rate alone.
- **The denominator is the matched set.** Severity is scored only where recall
  already succeeded, so the metric's value is partly a function of which
  expectations were found — see the paired-comparison requirement above.
- **The metric is confounded with the answer key's own severity distribution.**
  Where an engine's assignments cluster in one band, `severityAccuracy`
  degenerates into the share of the matched set carrying that band, which is a
  property of the fixture rather than of the engine's judgement. A run whose
  disagreements are concentrated on one expected band must be reported that way,
  broken down by expected severity, and never as a single rate.

#### The Severity Floor Trap In A/B Measurement

The admission gate reads the **model's** severity, not the expectation's. An
expectation labelled below `aiReview.actionableSeverityThreshold` (default
`medium`) therefore cannot be matched at all unless the model over-rates it: a
correctly-rated `low` candidate is rejected as `below-threshold` before scoring
sees it, so recall on that expectation depends on the engine making exactly the
severity mistake this rubric forbids.

This is not hypothetical on the primary real-repository corpus. Six of its 42
expectations are labelled `low`. One of them was matched in every one of the
archived runs, and in none of those runs did the model agree with the `low` label
-- it matched only because it called the defect actionable.

The consequence is a requirement. **Calibrating severity downward correctly would
lose up to 6 of 42 expectations, 14.3 percentage points of recall, while making
the engine more accurate, and a naive reading would report that as a regression.**
Any experiment that changes how severity is assigned must therefore either lower
`aiReview.actionableSeverityThreshold` to `low` for the measurement runs, or tally
`below-threshold` rejections separately and read them alongside recall. A severity
A/B reported as a plain recall delta against the default floor is invalid, and the
recall figures from such a run must not be compared with figures produced under
the default floor.

### Fix Lane Measurement

When `fix.enabled` (spec 12), eval case execution runs the finding
investigation-and-fix lane on the review's admitted findings after the review
and before scoring, capturing each `FixOutcome` (`findingId`,
`findingJudgment`, `fixProduced`, `applyCheck`) into the case output. The lane
is off by default, so existing eval runs and their cost are unchanged; the lane
is exercised only when a caller enables `fix` and configures a provider. The
lane is advisory and non-fatal in eval: a lane failure is logged and the case is
scored without fix outcomes rather than failing the run. The failure is also
recorded as a `stage: 'fix'`, `recovered: false` entry in the case's
`providerIssues`, so it stays distinguishable in the report from the lane
being disabled or having no eligible finding — both of which also produce no
fix outcomes but are not failures and carry no such entry.

Each `FixOutcome` is joined to its finding by `findingId` and scored against the
match result as ground truth — a matched finding is a real defect, an unmatched
actionable admitted finding is a false positive — to compute
`fixJudgmentAccuracy`, `fixFalsePositiveDetectionRate`, `fixProduceRate`, and
`fixApplyFailureRate` (and their denominator counts). All four rates use an
empty value of `0`, unlike recall/precision. The lane never changes admission,
severity, or the quality gate; these metrics are advisory precision/fix-quality
signals only. The fix lane also appears as a `fix` entry in each case's
`agenticStages` (active with its outcome count, or skipped) alongside
`refutation` and `provider-recovery`, and each `caseResults[]` entry preserves
its `fixOutcomes[]` so saved reports are self-contained for fix-lane analysis.

## Human Output

`codereviewer eval run` must produce both machine-readable and
human-readable output:

| Artifact | Purpose |
| --- | --- |
| `.codereviewer/eval/eval-report.json` | Stable structured metrics and case results for CI and automation. |
| `.codereviewer/eval/eval-summary.md` | Human-readable gate status, comparison metrics, per-case status, missed expected findings, false positives, warnings, review cost/duration, judge/plausibility-judge scoring cost and elapsed wall-clock time (see `scoringCostUsd` and `elapsedMs` in Metrics), and artifact links. |
| `.codereviewer/eval/eval-recall-report.md` | Human-readable per-expected-finding recall report for the current run. |

The top-level artifacts are latest-run convenience copies. Every run must also
write the same artifacts under `.codereviewer/eval/runs/<run-id>/` so later
smoke runs do not overwrite the only copy of an expensive benchmark report.

The CLI stdout defaults to the same human-readable summary so a local run is
understandable without opening JSON. The JSON report remains the source of truth
for automation.

`codereviewer eval compare --base <report.json> --head <report.json>` compares
two eval reports and prints gate status, selection status, metric deltas, and
case transitions. Before any of that, the command refuses outright (throws
rather than rendering) when the two reports' `metricsVersion` differ, or when
their `provenance.answerKeyDigest` differ — see "Provenance" above. Both
refusals fire unconditionally; the answer-key refusal is not limited to cases
where `selection.selectedCaseIds` also differ, and in practice a differing case
selection almost always produces a differing digest too. Selection status must
identify whether `selection.selectedCaseIds` are identical and whether fixture
source/slice root metadata match. When selected case sets differ, the comparison
must render a warning before metric deltas because aggregate numbers are not
same-dataset comparable. When either report has `scoring.judgeTrustworthy = false`, or the two
reports' `scoring.judgeAgreement` values differ materially, the comparison must
render a warning before metric deltas because the deltas may reflect judge
variance rather than review quality. The command may still exit `0` after
rendering warnings so users can inspect partial overlap, new cases, removed
cases, and judge-reliability differences. When either compared report includes context ledger
entries, the comparison must render aggregate base/head/delta counts by context
ledger kind so benchmark readers can see context usage changes alongside metric
deltas. Metric deltas must include input-token and
output-token totals so token-use regressions are visible during benchmark
comparison. Cost deltas must use the same known/unavailable wording as eval
summaries and must include unavailable-cost case counts so missing pricing data
is not presented as free or cheaper.
Metric deltas must also include provider error rate, provider issue rate, and
provider issue case counts so provider instability is visible beside model
quality, token, cost, and duration changes. Metric deltas must include
refutation false negative count and refutation false positive count so
refutation quality regressions are visible during benchmark comparison. When
both reports include
matching `sourceProfile` or `language` metric groups, the comparison must render
group-level fixture counts plus recall, precision, F1, and false-positive deltas
so aggregate benchmark results cannot hide a segment-specific regression. The
same matching groups must also render refutation deltas for refutation false
negatives and false positives so refutation quality regressions are visible by
segment. They must also render resource deltas for input tokens, output tokens,
known cost, and unavailable-cost case counts using the same known/unavailable
cost wording as aggregate comparisons, so token or pricing regressions are
visible by segment. The comparison must separately render fixture-count
coverage deltas for the union of `sourceProfile` and `language` metric groups,
including groups present in only one report, and omit unchanged group counts.
Detailed quality, refutation, and resource group deltas remain limited to groups
present in both reports.

`codereviewer eval slice-manifest --slice-root <path>` prints a deterministic
JSON manifest for a repository-local slice pack. The manifest exists so humans,
agents, and CI logs can prove whether two local benchmark packs are the same
without committing the pack or uploading it to a hosted tracker. The command
must read only the selected slice root, validate the same slice metadata used by
`eval run --slice-root`, and expose hashes/counts only. It must not print source
text, prompts, provider payloads, secrets, or environment values.

Slice manifest fields:

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `"1.0"` | Manifest schema version. |
| `generatedAt` | ISO datetime | Creation timestamp; excluded from the manifest digest. |
| `sliceRoot` | path | Repository-relative slice root supplied by the caller. |
| `caseCount` | integer | Number of slice cases. |
| `caseIds` | string[] | Case IDs in deterministic directory order. |
| `digest` | sha256 hex | Stable digest over manifest identity fields and case summaries, excluding `generatedAt` and `digest`. |
| `cases[].id` | string | Slice case ID. |
| `cases[].language` | string | Slice language. |
| `cases[].sourceProfile` | string | Normalized source profile. |
| `cases[].tags` | string[] | Normalized tags. |
| `cases[].changedFileCount` | integer | Number of changed files declared by the slice. |
| `cases[].expectedFindingCount` | integer | Number of normalized expected findings. |
| `cases[].semanticOnlyExpectedCount` | integer | Expected findings that prove only semantic recall. |
| `cases[].lineBearingExpectedCount` | integer | Expected findings with path and line metadata. |
| `cases[].noFindingZoneCount` | integer | Expected no-finding zones. |
| `cases[].repositoryFileCount` | integer | Number of files under the slice repo directory. |
| `cases[].repositoryBytes` | integer | Total byte size of files under the slice repo directory. |
| `cases[].sliceJsonSha256` | sha256 hex | Digest of `slice.json`. |
| `cases[].repositoryTreeSha256` | sha256 hex | Digest over repository-relative file paths, byte sizes, and file digests. |

`eval-report.json` must include selection metadata proving which fixture source
and exact case set produced the run:

| Field | Type | Notes |
| --- | --- | --- |
| `selection.fixtureSource` | `"default" | "slice-root"` | `default` means committed fixture discovery; `slice-root` means the CLI was pointed at a repository-local slice pack. |
| `selection.sliceRoot` | path or omitted | Repository-relative path supplied by `--slice-root`; omitted for default discovery. |
| `selection.caseFilters` | string[] | Exact `--case` filters supplied by the caller, in CLI order. |
| `selection.selectedCaseIds` | string[] | Case IDs actually executed, in execution order. |

`eval-report.json` must include scoring metadata proving which semantic
matching strategy produced the run:

| Field | Type | Notes |
| --- | --- | --- |
| `scoring.judgeAgreement` | number or omitted | Measured semantic-judge agreement against the calibration set for this run. Omitted when no pair was judged. |
| `scoring.judgeTrustworthy` | boolean | `false` when `judgeAgreement` is below the configured minimum, marking the run's quality metrics untrustworthy. |

`eval-report.json` must also include a `provenance` object proving WHAT was
scored and under WHAT configuration, distinct from `scoring` above (which
proves which semantic judge scored it) and from `metricsVersion` (which proves
which rules scored it). See "Provenance" above for the full field table and the
comparison/significance refusal rules it drives.

`codereviewer eval run` may override review posture for one run without editing
repository config. Supported eval-only overrides are `--review-mode
<local|ci|pr|full>`, `--review-depth <fast|balanced|thorough>`, and
`--max-concurrent-tasks <1-32>`. These flags must merge above file and
environment config for the eval invocation only. They exist to make benchmark
quality comparisons reproducible, especially for the PR-review path
that should force PR mode, thorough depth, serial provider calls, and sanitized
debug logs. Semantic scoring is not a flag: the judge is constructed whenever a
provider is configured.

Every corpus a published number comes from must be runnable from a committed
script. A result produced by hand-typed flags is not reproducible by anyone else,
and the primary baseline was in exactly that state until `eval:corpus` was added.

- `eval:benchmark` hydrates the Code Review Bench-style pack and runs the
  PR-review posture — PR mode, thorough depth, serial provider calls — which is
  the default costly benchmark path. The configured provider supplies the
  semantic judge; scoring is not a flag.
- `eval:benchmark:debug` runs the same posture with sanitized no-content debug
  logs written to `.codereviewer/eval/log.log`.
- `eval:corpus` hydrates the real-repository corpus and runs the same posture
  against it. This is the corpus the headline recall baseline is measured on.
- `eval:corpus:hydrate` performs only the hydration, which costs no provider
  spend, so a corpus can be refreshed or repaired without running a review.

The `eval:cheap*`, `eval:benchmark:baseline`, `eval:semantic` and related scripts
this section once required were removed, and a committed test asserts they stay
removed. The requirement is recorded here as withdrawn rather than deleted,
because the spec previously mandated scripts whose absence was simultaneously
enforced by a test — a contradiction that survived because nothing checked the
two against each other.

`eval-report.json` must also include deterministic metric groups for human and
machine comparison:

| Field | Type | Notes |
| --- | --- | --- |
| `metricGroups[].groupBy` | `"sourceProfile" | "language" | "tag"` | Group dimension. |
| `metricGroups[].key` | string | Group value. |
| `metricGroups[].fixtureCount` | integer | Number of executed cases in the group. |
| `metricGroups[].caseIds` | string[] | Case IDs included in the group, sorted in execution order. |
| `metricGroups[].metrics` | EvalMetrics | Same metric contract as top-level metrics, calculated over only the group cases. |

The human summary must render grouped metrics for `sourceProfile` and
`language`. Tag groups remain available in JSON for automation and deeper local
analysis.

Each `caseResults[]` entry in `eval-report.json` must include sanitized
`expectedFindings[]` metadata so saved reports are self-contained for recall
analysis:

| Field | Type | Notes |
| --- | --- | --- |
| `expectedFindings[].expectedIndex` | integer | Index from the eval case. |
| `expectedFindings[].category` | FindingCategory | Expected category. |
| `expectedFindings[].severity` | Severity | Expected severity. |
| `expectedFindings[].path` | path or omitted | Repository-relative expected path when available. |
| `expectedFindings[].lineRange` | `[start, end]` or omitted | Expected new-side line range when available. |
| `expectedFindings[].matchMode` | `"path-line" | "path-semantic" | "semantic-only"` | Effective matching mode after defaults. |
| `expectedFindings[].semanticSummary` | string | Human-readable expected issue summary, without source snippets. |

Each `caseResults[]` entry must also preserve scoring diagnostics and usage
availability from the review report:

| Field | Type | Notes |
| --- | --- | --- |
| `duplicateFindingIds` | string[] | Admitted findings at the same path and exact overlapping line range as a matched finding. These are review noise, but not separate false positives. |
| `duplicateFindings` | object[] | Sanitized duplicate summaries with ID, severity, category, path, line, and title. |
| `falsePositiveFindingIds` | string[] | Admitted findings that neither match an expected finding nor duplicate a matched finding. |
| `falsePositiveFindings` | object[] | Sanitized false-positive summaries with ID, severity, category, path, line, and title. |
| `artifactOnlyFindingIds` | string[] | Admitted findings with `reporterEligibility = "artifact-only"`; these are diagnostic and excluded from main recall/precision gates. |
| `artifactOnlyMatchedFindings` | object[] | Match records for artifact-only findings that overlap expected findings. |
| `artifactOnlyFalsePositiveFindingIds` | string[] | Artifact-only findings that neither match an expected finding nor duplicate a matched artifact-only finding. |
| `artifactOnlyFalsePositiveFindings` | object[] | Sanitized artifact-only noise summaries with ID, severity, category, path, line, and title. |
| `matchedFindings[].semanticReason` | string | Concise report-safe rationale from the semantic judge that accepted the match. |
| `artifactOnlyMatchedFindings[].semanticReason` | string | Same rationale field for artifact-only semantic judge matches. Every match is a judge decision, so the reason is always present. |
| `inconclusiveExpectedIndexes` | integer[] | Expected findings whose verdict is unknown because a judge call failed. Excluded from the recall denominator and from `unmatchedExpectedIndexes`. |
| `inconclusiveFindingIds` | string[] | Admitted findings whose verdict is unknown because a judge call failed. Excluded from false positives and duplicates. |
| `inconclusiveMatches` | object[] | Undecided expected/finding pairs with `expectedIndex`, `findingId`, provider error `code`, and optional `message`. |
| `contextLedger` | object[] | Report-safe context ledger summaries for the case. Each entry includes `kind` (one of the eight context-ledger kinds), `consideredForModelContext`, and `truncated`. |
| `providerIssues` | object[] | Provider instability observed for the case, including unrecovered provider errors, recovered eval retries, refutation provider issues, and budget/timeouts. Each entry includes `code`, `stage`, and `recovered`. |
| `refutationResults` | object[] | Sanitized refutation summaries with ID, refuted candidate ID, verdict, and reason code. |
| `inputTokens` | integer >= 0 | Total input tokens surfaced by the review report for this case, or `0` when unavailable. |
| `cachedInputTokens` | integer >= 0 | Cached (prompt-cache read) input tokens surfaced by the review report for this case (a subset of `inputTokens`), or `0` when unavailable. |
| `outputTokens` | integer >= 0 | Total output tokens surfaced by the review report for this case, or `0` when unavailable. |
| `costUsd` | number >= 0 | Known cost for this case, or `0` when unavailable. |
| `costUnavailable` | boolean | `true` when cost/token metadata was incomplete and the case warnings include `cost-unavailable`. |

`metrics` and every `metricGroups[].metrics` entry must aggregate
`duplicateFindingCount`, artifact-only diagnostic metrics,
`trustedDeterministicFindingCount`, `inputTokens`, `cachedInputTokens`,
`outputTokens`, and `costUnavailableCount`. They must also aggregate
`providerIssueCount` and `providerIssueRate` separately from
`providerErrorRate`, because recovered provider retries must remain visible
without being treated as unrecovered case errors. Markdown summaries must render
token totals and must not present missing cost as a free run. When any case has
unavailable cost, the cost row must show known cost plus the number of cases
with unavailable cost.

`scoringInputTokens`, `scoringCachedInputTokens`, `scoringOutputTokens`,
`scoringCostUsd`, `scoringCostUnavailable`, and `elapsedMs` are **run-level
only** — they have no per-case field on `caseResults[]` entries and are not
summed from them, because a shared usage recorder and a single monotonic timer
each cover the whole run rather than one case. Every `metricGroups[].metrics`
entry repeats the same run-level values (exactly like `judgeAgreement`), since
one run produced every group's numbers.
Markdown summaries must also render context ledger kind coverage as a compact
case table when cases include context ledger entries. The table must show
per-kind counts plus the number of entries considered for model context and the
number truncated, so benchmark readers can audit context usage without opening
raw JSON.

Markdown summaries must also render artifact-only matched findings and
artifact-only false-positive/noise findings by finding ID, severity, category,
path, line, and title where available. Artifact-only findings remain excluded
from normal actionable precision/recall and gate failure counts, but they must
be visible to humans so weak, refuted, or artifact-only model output is not hidden
behind aggregate metrics.

`codereviewer eval recall-report --report <report.json>` reads one or more
saved eval reports and prints a Markdown per-expected-finding recall report.
The flag may be repeated. When omitted, the command reads
`.codereviewer/eval/eval-report.json`. The report must show whether selected case
sets are identical across reports, aggregate always-detected/never-detected/
flaky counts, and a per-expected table with case ID, expected index, severity,
location, match mode, summary, detection rate, and run marks.

## Matching Rules

- `path-line`: exact path match is required and admitted finding location must
  overlap the expected range within three lines.
- `path-semantic`: exact path match is required and line overlap is not scored.
  This holds even when the expectation declares a `lineRange`: the range
  documents where the defect sits for a human reader and for report location
  labels, and it neither gates the match nor enters the `lineAccuracy`
  denominator. Scoring line placement for these expectations is a deliberate
  future change, not an oversight — the real-repository corpus carries curated
  ranges for all of its expectations, so line placement on real code is
  currently unmeasured. Making that measurement requires deciding how to treat
  a finding that identifies the same defect from a different anchor (a caller
  rather than the definition), which the three-line tolerance would score as a
  miss, and it must be specified here before the matcher changes.
- `semantic-only`: path and line are not used for matching; the judge decision
  and one-to-one assignment determine recall/precision.
- Semantic identity is decided only by the semantic judge. There is no lexical,
  token, or similarity-score matcher, and no similarity threshold.
- The judge is constructed whenever a provider is configured; it is not a mode
  flag. Provider-backed npm scripts may load `.env` with Node's native env-file
  flag; the CLI implementation itself still must not auto-load the repository
  root `.env` file.
- The semantic judge request may include only the expected semantic summary and
  admitted finding title/description. It must not include source snippets,
  unified diff text, prompt instructions, secrets, raw tool output, repository
  files, paths, or line numbers.
- Judge results must parse as a strict object with `match` and `reason`.
  `reason` is a concise report-safe rationale for audit only. The judge returns a
  boolean decision and never a numeric confidence. Matches persist the bounded
  rationale as `semanticReason` and the Markdown summary renders a compact
  `Semantic Judge Matches` audit table.
- The judge decides semantic identity only. It never replaces the deterministic
  path and line gates, which are always applied first.
- One admitted finding can match at most one expected finding. Pair assignment
  maximises the number of matched expectations rather than taking the first
  acceptable pairing: assigning greedily lets a loose accept for an earlier
  expectation consume the only finding a later expectation could have matched,
  which scores that later expectation as a miss the reviewer did not commit.
  That bias runs in the same direction as the multi-defect behaviour the corpus
  exists to measure, so the matcher would have flattered its own diagnosis.
- Assignment is deterministic. Expectations are served in ascending order and each
  prefers the lowest available admitted finding index, including when it is
  displaced and re-seated, so identical inputs always yield identical pairs. Every
  pair is judged at most once: a pair the deterministic path and line gates reject
  is never sent to the judge, and a judged pair is cached, so maximising the
  matching costs no more judge calls than the first-acceptable rule did.
- An unmatched admitted finding at the same path and exact overlapping line
  range as an already matched finding is classified as a duplicate finding.
  Duplicate findings are tracked as review noise and must not be counted as
  false positives or no-finding-zone hits.
- A finding inside an `ExpectedNoFindingZone` counts as a false positive unless
  it matches a declared expected finding.
- Public benchmark fixtures are sanity checks only. Release gates must use a
  maintained private or project-owned fixture set to reduce benchmark
  contamination risk.

## Depth Profiles

R1 exposes `review.depth` as the public selector:

| Depth | Purpose |
| --- | --- |
| `fast` | Low cost smoke check. |
| `balanced` | Default local/CI review. |
| `thorough` | Maximum recall within budget. |

Depth-derived values must validate through the same config schema as user
config.

Budget defaults are defined in `04-configuration-and-providers.md` and are part
of the depth contract.

## Quality Gates

Quality gate config:

| Key | Type | Default |
| --- | --- | --- |
| `maxCritical` | integer >= 0 | `0` |
| `maxHigh` | integer >= 0 | `0` |
| `maxMedium` | integer >= 0 | no fail |
| `failOnProviderError` | boolean | `true` |
| `failOnNewOnly` | boolean | value from baseline config |
| `minProductRecall` | number 0..1 | unset (no fail) |

When set, `minProductRecall` fails the gate if `productRecall` falls below the
threshold.

Gate result:

- deterministic;
- records threshold inputs;
- records admitted finding IDs that caused failure;
- never consumes model-generated confidence scores from review artifacts;
- treats model-origin findings as gate-relevant only when their
  `RefutationResult.verdict = "proved"` and they are admitted as actionable.
- records whether baseline filtering was applied.

## Eval Regression Gate

`codereviewer eval run`'s pass/fail exit code is a SEPARATE gate from the
review command's Quality Gate above: it is computed from
`EvalRegressionThresholds` (`src/domains/evaluation/eval-report-contracts.ts`)
against the run's own `metrics`, and is recorded on the saved report as
`regressionGate`.

Threshold values are resolved from `evaluation.regressionGate` config in this
order, each layer overriding the previous field-by-field:

1. the selected profile's built-in thresholds (`stable` or `strict`, below);
2. `evaluation.regressionGate.overrides` from committed config;
3. `--gate-profile <stable|strict>` on the `eval run` command line, which
   overrides `evaluation.regressionGate.profile` for that invocation only.

| Profile | `minParseValidity` | `minRecall` | `maxFalsePositiveCount` | `failOnProviderError` |
| --- | --- | --- | --- | --- |
| `stable` (default) | `1` | unset (no fail) | unset (no fail) | `true` |
| `strict` | `1` | `1` | `0` | `true` |

`stable` is the default because `parseValidity` and provider-error presence
are the only two eval signals with zero run-to-run sampling variance: a given
run's output either validates against schema or it does not, and a provider
call either errored or it did not. Every other metric is a MEAN over a
model-backed, non-deterministic run. The "Metrics" section above records a
measured four-seed recall band (81.3%, 87.5%, 81.3%, 75.0%; mean 81.3%,
standard deviation 4.4 percentage points) on the primary corpus, and later
measurement on an expanded corpus found a comparable band (~4.8 points). A
default gate that thresholds on mean recall (or on the raw, fixture-
incompleteness-inflated `falsePositiveCount` — see its definition in
"Metrics") would fail unpredictably depending on which side of that band a
given run landed on, which is a worse default than always failing, because a
flaky gate trains reviewers to ignore it. `strict` restores an all-or-nothing
bar (perfect recall, zero tolerated false positives) as an explicit opt-in for
a maintainer preparing a release cut who has verified it holds for their own
fixture set, rather than as the default every CI run is measured against.

A project may tighten or loosen any individual threshold — including opting
into `minRecall`, `minProductRecall`, or `maxFalsePositiveCount` — via
`evaluation.regressionGate.overrides`, without changing the resolved profile's
other fields.

`eval run`'s `generatedAt` on the saved report reflects the real wall clock for
a production run. Test fixtures that need a byte-for-byte reproducible saved
report inject a fixed clock at the CLI boundary (`CliRunOptions.now`) rather
than the eval report contract carrying a special-cased "test mode".

## Drift And Ambiguity Gates

Drift checks produce deterministic findings that can participate in CI gates.

| Finding Category | Default | Gate Source |
| --- | --- | --- |
| Documentation drift | warning | `drift.warnOn` |
| Spec drift | warning | `drift.warnOn` |
| Implementation drift | warning | `drift.warnOn` |
| Generated artifact drift | hard error | `drift.failOn` |
| Ambiguity | warning | `drift.warnOn` |
| Security drift | hard error | `drift.failOn` |

Ambiguity examples include subjective requirements that request maximum
quality, security, speed, cleanliness, or robustness without a measurable,
testable acceptance rule. Ambiguity findings must identify the
unclear text and recommend a concrete owner/action. By default ambiguity does
not block PRs, but CI can configure it as a hard error.

Security drift blocks by default because mismatches in permissions, provider
network behavior, path containment, telemetry content capture, or secret
handling create audit risk.

## Regression Policy

Implementation changes to review logic must include:

- fixture update or new fixture when behavior intentionally changes;
- before/after eval report in PR or local review note;
- no reduction in `parseValidity`;
- no new unredacted content in eval artifacts;
- documented rationale for recall/precision tradeoffs.

Regression datasets must include negative/control cases where the expected
output is no finding. A review behavior change that increases comments per KLOC
or comments per diff hunk must document why the added noise is justified by
recall, severity, or actionability improvements.

The committed R1 fixture pack must emphasize semantic review cases that adjacent
CI/static-analysis pipelines normally miss: cross-file contract mismatches,
authorization/permission logic, data integrity, schema/data backfills, async
and control-flow defects, API compatibility, concurrency/race risks, missing
tests for changed behavior, and configuration-driven behavior. Fixtures may include
TypeScript, JavaScript, Python, Go, Rust, Java, Ruby, and mixed-language
examples, but language coverage is secondary to semantic issue coverage.

Benchmark-style datasets should use self-contained repository slices:
metadata and expected findings plus a minimal `repo/` tree that preserves the
paths and context needed to reproduce a real review decision. Slice cases should
support recall, precision/noise, line accuracy when line data exists, severity
accuracy, refutation correctness, cost, latency,
and run-to-run comparison across presets, models, and provider configurations.

Benchmark-compatible CRB-style datasets are allowed in `eval/fixtures/slices/`
or an untracked local slice root copied into that layout and selected with
`--slice-root`. Public
benchmark results must be labeled as `benchmark-semantic` and must not be used
as sole release evidence because public golden comments can be contaminated and
often lack line metadata. Project-owned captured PR slices with file and line
data are required for line-number and GitHub-comment accuracy gates.

Line-number reliability evals must include at least one case where a provider or
hermetic test provider proposes a finding on a reviewed path but outside the
reviewed head-file line range. The expected result is a rejected candidate with
`location-invalid`, no inline finding, and no GitHub review-comment draft for
that candidate.

Diff-anchor reliability evals must include at least one explicit-file or slice
case where a refutation-proved finding on a changed source line becomes a new-side
inline-eligible finding only because the eval-supplied unified diff contains the
matching new-side hunk. The same class of finding must remain summary-only when
no effective diff map covers the line.

Evaluation summaries must show enough human-readable detail to understand a
regression without opening raw JSON:

- selection metadata including fixture source, slice root when present, case
  filters, and selected case IDs;
- grouped recall, precision, F1, line accuracy, and false-positive counts by
  source profile and language;
- per-case source profile, language, expected count, matched count, false
  positive count, artifact-only finding count, and gate status;
- missed expected findings with index, severity, category, path/line when
  available, match mode, and semantic summary;
- false positive findings with finding ID, severity, category, path/line, and
  title;
- a clear note when a case is semantic-only and therefore cannot prove line
  accuracy.

Eval Markdown rendering is a focused evaluation boundary that imports the saved
eval report contract and owns summary, recall, and comparison formatting. Eval
execution owns case computation, matching, metrics, gates, and report assembly.
Summary section rendering must stay in focused renderer helpers when a table
has distinct row semantics, so selection, aggregate metrics, metric-group,
case, context-ledger kind, gate-reason,
provider-issue, semantic-judge match, attention-detail, and artifact-link
sections do not expand the runner or a single monolithic summary block.
Metric-group summary table rows must share a focused formatter that preserves
source-profile/language group output.
Case summary table rows must share a focused formatter that preserves
source-profile and expected-count fallback behavior.
Context-ledger kind table rows must share a focused formatter that preserves
kind, considered, and truncated count rendering.
Provider-issue and semantic-judge diagnostic table rows must share focused
formatters that preserve existing Markdown output.
Gate-reason and artifact-link bullet sections must share a focused helper that
preserves full Markdown section spacing.
Attention-detail rendering must share a non-empty bullet-section helper for
repeated finding and refutation subsections.
Finding-like attention bullets must share one formatter for finding ID,
severity, category, path/line, and title rows.
Matched-finding attention bullets must share one formatter for finding ID,
expected-finding label, and judge-reason rows. Inconclusive judge decisions must
render as their own attention subsection so an undecided pair is never read as a
missed expectation or a false positive.
Refutation attention bullets must share a focused formatter for refutation
result rows.
Missed-expected attention rows must share focused helpers that preserve stale
expected-index skipping while keeping row formatting local to the renderer.
Recall report section rendering must stay in focused renderer helpers, so run,
summary, and expected-finding tables do not expand the runner or a single
monolithic recall block.
Recall expected-finding table rows must share a focused formatter that preserves
location, recall-rate, and run-mark rendering.
Comparison section rendering must stay in focused renderer helpers when a table
has distinct row semantics, so aggregate metrics, context-ledger kind,
gate, selection, case-transition, grouped quality, resource,
refutation, and coverage sections do not expand the runner or a single
monolithic comparison block. Comparison helpers must share a local report-pair
input type instead of duplicating `{ base, head }` report shapes.
Comparison gate table rows must share a focused formatter that preserves the
report label, gate result, fixture count, and generated timestamp rendering.
Comparison selection table rows must share a focused formatter that preserves
field labels, status values, and list-value rendering.
Comparison metric-group coverage rows must share a focused formatter that
preserves group, key, base/head fixture counts, delta, and status rendering.
Comparison metric-group quality rows must share a focused formatter that
preserves recall, precision, F1, false-positive, and delta rendering.
Comparison metric-group resource rows must share a focused formatter that
preserves token, cost, unavailable-cost, and delta rendering.
Comparison metric-group refutation rows must share a focused formatter that
preserves refutation false negative, refutation false positive, and delta
rendering.
Comparison context-ledger kind rows must share a focused formatter that
preserves kind, base/head count, and delta rendering.
Comparison case-transition rows must share a focused formatter that preserves
case ID, missing-status fallback, and transition label rendering.
Comparison aggregate metric rows must share a focused formatter that preserves
metric labels, base/head values, and delta rendering.
Comparison count-delta rows for the context-ledger section
must use one escaped-label formatter that preserves base/head count and delta
rendering.
Comparison count-delta tables for the context-ledger
section must use one local appender that preserves section headings, headers,
zero-count filtering policy, escaped labels, and delta row rendering.
Comparison metric-group detail rows must share one escaped group/key and
base/head fixture prefix helper so quality, resource, and refutation rows keep
their common identity columns consistent.
Comparison metric-group percentage rows must share one percent/base-head-delta
cell helper so quality percentage metrics stay consistent.
Comparison metric-group count rows must share one raw-count/base-head-delta
cell helper so quality, resource, and refutation count metrics stay consistent.
Comparison metric-group integer rows must share one formatted-integer/base-head
delta cell helper so resource token metrics stay consistent.
Comparison metric-group identity cells must share one escaped group/key and
base/head fixture formatter across coverage, quality, resource, and refutation
rows.
Comparison cost metric rows must share one formatted-cost/base-head-delta cell
helper across aggregate and metric-group resource rows.
Comparison aggregate percentage metric rows must share one formatter that
preserves metric labels, formatted base/head percentages, and percentage-point
deltas.
Comparison aggregate count metric rows must share one formatter that preserves
metric labels, raw base/head counts, and numeric deltas.
Comparison aggregate integer metric rows must share one formatter that
preserves metric labels, formatted base/head integers, and numeric deltas.
Comparison aggregate duration metric rows must share one formatter that
preserves metric labels, formatted base/head durations, and millisecond deltas.
Comparison aggregate cost metric rows must share one formatter that preserves
metric labels, formatted base/head costs, and cost deltas.
Eval report Markdown rendering must keep shared scalar formatting, Markdown
cell escaping, cost formatting, and table appending in a focused helper module
so summary, recall, and comparison renderers do not duplicate presentation
primitives.
Eval report Markdown bullet sections must use the same focused helper module so
optional bullet-list rendering has one skip-empty policy across summary
attention and provider sections.
Eval report Markdown list-cell formatting must use the same focused helper
module so empty-list fallback and escaped comma joining are consistent across
summary and comparison selection sections.
Eval report expected-finding labels must live in a focused helper module so
summary attention and recall renderers share line-range, semantic-only, and
match-mode fallback rules.
Eval report case-result labels must live in a focused helper module so summary
case, provider issue, context ledger, and note rows share one
status and fallback policy.
Eval recall report rendering must live in a focused renderer module that the
evaluation package re-exports.
Eval summary report rendering must live in a focused renderer module that the
evaluation package re-exports.
Eval comparison report rendering must live in a focused renderer module that the
evaluation package re-exports.
Eval comparison gate and selection rendering must live in a focused helper
module so dataset-compatibility warnings and selection status rows are owned by
one tested component.
Eval comparison count-delta table rendering must live in a focused helper module
so the context-ledger delta section has one table policy.
Eval comparison case-transition rendering must live in a focused helper module
so pass/fail transition labels and escaped case rows have one tested owner.
Eval comparison metric-group rendering must live in a focused helper module so
coverage, quality, resource, and refutation group deltas share one owner.
Eval comparison aggregate metric-delta rendering must live in a focused helper
module so percent, count, duration, token, cost, provider, and refutation metric
rows share one owner.
Eval comparison context-ledger delta rendering must live in a
focused helper module so count collection, zero-row policy, and section headings
share one owner.

## R1 Performance Budgets

These budgets apply to fixture and hermetic-provider-fixture verification, not to
uncontrolled external provider latency:

| Scenario | Budget |
| --- | --- |
| Config validation for one config file | <= 500 ms |
| Repository intake for 500 changed paths with no file over cap | <= 5000 ms |
| Report rendering for 100 admitted findings | <= 2000 ms |
| Eval metric calculation for 100 findings and 100 expectations | <= 1000 ms |
| Hermetic provider fixture balanced review of 25 changed files with holistic discovery and refutation | <= 90000 ms |

External provider runs must enforce provider `timeoutMs`, provider
`maxRetries`, whole-run `runTimeoutMs`, task packet budgets, and preset
`maxCostUsd` when usage and pricing data are available. Strict per-task cost
stops remain release-blocking follow-up work before R1 is considered complete.

## Verification

- Eval schema unit tests.
- Metric calculator unit tests.
- Fixture runner integration test with hermetic provider fixture.
- Quality gate threshold matrix test.
- Code coverage gate: lines, branches, functions, and statements must each be
  at least `80%` for the package before the implementation goal can be marked
  complete. Coverage output must be generated by the test runner and checked in
  CI/local verification.
- Eval cases must execute the same review pipeline as product review. Hard-coded
  eval outputs are allowed only inside unit tests for metric math, not in the
  public `eval run` command.
- Drift checker unit and integration tests must cover stale docs links, stale
  specs path references, generated schema drift, security config drift, and
  ambiguity warning classification.
