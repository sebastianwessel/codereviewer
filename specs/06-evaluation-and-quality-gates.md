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

**The default selection proves nothing about recall, and must never be quoted as
if it did.** `eval/fixtures/slices/` does not exist in the repository — the
loader treats a missing slice root as an empty one and returns no cases from it —
so the default run is exactly the seven cases in `sample-eval-cases.json`, every
one of which declares `expectedFindings: []`. With no expectation anywhere in the
selection, recall has no denominator: the run can only demonstrate that a case with
no expected finding produces none. It is a false-positive and plumbing check, not a
quality measurement.

The positive slices live under `eval/fixtures/proof-quality-slices/` — 15 slices,
12 carrying expected findings (14 in total) and 3 deliberate controls with none —
and nothing loads them by default. They are reachable only through
`eval run --slice-root eval/fixtures/proof-quality-slices`, which replaces the
default selection rather than adding to it.

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
`review.maxConcurrentTasks` only for the eval invocation, without changing the
repository config. Benchmark npm scripts that use provider-backed semantic
judging pass `--max-concurrent-tasks 1` to reduce transient timeout noise from
parallel provider calls on large captured slices.

The scope of that flag must not be overstated: it bounds the tasks WITHIN one
case. Eval cases themselves execute concurrently and there is no run-level
concurrency cap, so `--max-concurrent-tasks 1` does not serialize a run. Judge
and plausibility-judge scoring inside a run is sequential by construction.

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
  agreement falls below the configured minimum reports itself as untrustworthy by
  setting `scoring.judgeTrustworthy = false`. The minimum is
  `evaluation.minJudgeAgreement`, default `0.9`, and the SAME key governs the
  plausibility judge's own calibration below — there is deliberately one
  reliability bar, not two.
- A run that scored no calibration pair at all reports `judgeTrustworthy = false`.
  Absence of a reliability measurement is not evidence of reliability.

### The Judge Must Be Pinnable Independently Of The Reviewer

Added 2026-08-08, from a defect rather than from principle.

Both judges were built from the SAME resolved model alias as the reviewer under
test, and there was no way to configure otherwise. Setting
`CODEREVIEWER_PROVIDER_MODEL` to compare two reviewer models therefore swapped the
SCORER along with the subject. A recall difference measured that way has two
indistinguishable explanations — a weaker reviewer, or a weaker judge crediting
fewer of the reviewer's correct findings as matches — and adjusted precision has
the same problem, because the plausibility judge moved too. **Every model
comparison run under that arrangement is uninterpretable**, not merely noisy: no
amount of seeds separates the two explanations, because both arms moved together
by construction.

`evaluation.judgeModel` (environment: `CODEREVIEWER_JUDGE_MODEL`) pins the model
the semantic-match judge and the plausibility judge run on, independently of
`provider.model`:

- **Unset is the historical behaviour, exactly.** The judges resolve from the
  reviewer's provider config unchanged — the same alias, the same single provider
  resolution, no extra call. An unpinned run must be indistinguishable from a run
  of the engine before this setting existed.
- **Set, it overrides the model only.** Provider id, credentials, base URL, retry
  and timeout stay the run's own. The setting names a model to score with, not a
  second provider account.
- **It moves the two eval judges and nothing else.** The review workflow — every
  discovery, refutation, fix and summarization call — keeps resolving its own
  model from `provider.model`. Scoring changes; what is being scored does not.
- Judge/plausibility spend (`scoringCostUsd`) is priced against the judge's model,
  since those are the tokens that were spent. Review cost is unaffected.

Two requirements follow, and the second is the load-bearing one:

- **A model comparison must hold the judge fixed.** Vary `provider.model` per arm
  and pin `evaluation.judgeModel` to one value across both arms. An arm pair whose
  judge model differs is not a reviewer comparison and its recall delta must not
  be published as one.
- **Any published model comparison MUST state the judge model it was scored
  with**, alongside the reviewer models it compares — the same discipline that
  requires a rate to name its provider and model. `provenance.judgeModelName`
  records it on every report so the claim is checkable after the fact rather than
  recalled.

This carries **no `metricsVersion` bump**, and the reason is the rule rather than
an exemption from it: a bump is owed when a change alters what a metric would
report for identical review output, and an unpinned run resolves the identical
judge alias it always did, so every metric is byte-identical. A run that DOES pin
a different judge model of course scores differently — but that is a
configuration difference, carried by `provenance.configHash` and now named
outright by `provenance.judgeModelName`, not a change in the scoring rules.
`provenance.judgeModelName` is itself provenance, not a metric, and its absence in
an older report reads as unknown rather than as a value.

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

### The Refusal, Not Just The Setting

Pinning the judge is necessary and not sufficient: nothing stops someone comparing two
reports that were scored by different judges. That is the same silent-invalid
comparison the setting exists to prevent, one level up, so it is refused rather than
documented.

- `eval compare` MUST refuse arms whose judge models differ, and name the judges it
  found. A difference between such arms is either a better reviewer or a more generous
  scorer, with nothing in the reports to separate them.
- A report written before the judge became pinnable records no `judgeModelName`, and on
  those runs the judge WAS the reviewer's model. `modelName` is therefore the correct
  fallback identity — not "unknown". That keeps two archived reports comparable with
  each other, and keeps an archived report comparable with a pinned one naming the same
  model, while still refusing a genuine mismatch.

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
  under-credits real findings by answering "cannot confirm". A file that fits the
  byte bound is therefore passed whole.
- When a file does not fit the bound, the content is a window centred on the
  finding's location line, never a prefix: the code that supports a finding is
  rarely at the top of a file. The content the judge reads always opens with an
  explicit completeness marker — either that the whole file is shown, or that it
  is partial, which line range is covered, and that absence of supporting code
  outside that range is not evidence the finding is wrong. A cut the judge is not
  told about produces a confident `plausible = false` on a real finding, and that
  verdict feeds `adjustedPrecision`, a published number.
- It returns a boolean `plausible` decision and a report-safe reason. No numeric
  confidence.
- `plausible = true` marks the finding a real-but-unlisted defect; `false` marks
  a genuine false positive.

The plausibility judge never promotes a finding into recall or changes what the
reviewer reported. It only reclassifies the reviewer's own unmatched output for
precision accounting.

Fail-closed: a plausibility judgment that cannot be completed (provider error
after retries, an unreadable source file, or a file so large that the bounded
window cannot contain the finding's own location line) leaves the finding counted
as a raw false positive and is surfaced as a warning. The engine never assumes an
unjudged finding is real — precision is only ever credited by an affirmative
`plausible` decision. The judge is not asked at all when the window could not
keep the cited line: a verdict reached without the cited code would be a guess,
and a guess must not be able to move `adjustedPrecision` in either direction.

Reliability mirrors the match judge: the plausibility judge is scored against a
committed calibration set of findings labeled genuine or spurious against sample
code, producing `plausibilityJudgeAgreement`; a run below
`evaluation.minJudgeAgreement`, or one that scored no calibration pair, sets
`scoring.adjustedPrecisionTrustworthy = false`.

Unlike the match judge, the plausibility judge is not required. When no
plausibility judge is available the stage is a no-op: no finding is reclassified,
`unlistedRealFindingCount` is `0`, and `adjustedPrecision` therefore equals raw
`precision`. That is the conservative direction — it can only understate
precision, never inflate it — but it means an adjusted-precision figure must not
be compared between a run that had a plausibility judge and one that did not.

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

A version is not a bare string. `eval-metrics-versions.ts` holds an ORDERED
history in which every entry declares its id, a note, and the metrics that entry
changed for identical review output. `EVAL_METRICS_VERSION` is derived as the
newest entry, so a bump cannot land as a string edit without recording its blast
radius. Comparability between any two versions is then derived: the affected set
is the union of the `affects` declarations of every entry strictly after the older
version up to and including the newer one.

**Comparability is per metric, not per report.** A delta measured across a scoring
change reports the change in the ruler rather than in the engine, and it is
indistinguishable from a real regression or win — but a bump almost never touches
every metric. The 2026-08-03 plausibility-window bump changes which unmatched
findings are credited unlisted-real, so it moves `adjustedPrecision`,
`unlistedRealFindingCount`, and `genuineFalsePositiveCount`, and it cannot move
`recall`, raw `precision`, `linePlacementRate`, or `severityAccuracy`, none of
which read a plausibility verdict. `eval compare` therefore refuses exactly the
affected metrics — their deltas render `not comparable`, with the reason stated
before any number — and compares the rest normally. Refusing all of them made the
honest partial comparison impossible, which in practice meant the comparison was
done by hand or not at all.

Two fallbacks keep the derivation safe, and both point the same way:

- an entry whose blast radius is not known declares `all`, and every metric is
  refused across it;
- a version id absent from the declared history (a future build read by an older
  engine, or the `pre-2026-07-26` sentinel that stands for the era before
  versioning) also refuses every metric, because nothing is known about what it
  changed.

The significance module is unchanged and still refuses OUTRIGHT across differing
versions, because it POOLS runs into one arm rather than comparing two. Pooling
runs scored by different rules computes a rate over a population that never
existed; comparing them, metric by metric, does not.

Failing loudly where the data does not support a number is the only safe
behaviour here: this project has already published a recall figure that was scored
against a stale answer key, and nothing in the artifact revealed it.

### Reading A Report The Current Contract Did Not Write

`EvalReportSchema` is the PRODUCER contract and stays strict: the report this
build writes must satisfy it exactly. It is the wrong contract for READING an
archived report. `eval compare` exists to compare runs across engine changes, and
an engine change is exactly what adds a field to the report — comparing the
2026-08-02 baseline against the 2026-08-05 re-baseline failed outright on
`caseResults[].discovery.totals.cappedByLimitCount`, a counter the older run
predates.

Comparison therefore reads through a separate, tolerant COMPARISON VIEW
(`eval-comparison-view.ts`) with three properties:

- every leaf is optional and carries no default, so an absent field survives
  parsing as absent;
- unknown keys are ignored, so a field a later build adds is not fatal;
- only what comparison renders is modelled. It is a read model, not a second copy
  of the report contract.

**Absence is unknown, never zero.** Loosening the producer contract to default a
missing counter to `0` would report "no discovery calls" where the truth is "not
recorded" — the recurring defect class this repository has already had to fix
seven times. Every value the view could not read renders `unknown (not recorded)`,
and every delta involving one renders the same. This applies beyond metrics: a
case whose report did not record the inputs its status derives from renders
`unknown`, never `PASS`.

Reading a value under a name the producer no longer writes is the OPPOSITE of
defaulting, and the view does it where a field was respelled rather than added.
The gate verdict is the one such field: reports archived before `regressionGate`
became three-valued recorded a boolean `passed`, and that boolean IS the verdict
those runs reached. The view models both `outcome` and `passed`, preferring
`outcome`, and falls back to `unknown (not recorded)` only when a report carries
neither. Dropping `passed` would render every report ever archived as unknown
while the data was sitting in the file. The PRODUCER contract carries `outcome`
alone.

## Provenance

`metricsVersion` proves the numbers in a report were computed under known rules.
It proves nothing about WHAT was scored or under WHAT configuration — and this
project has already published a recall figure (78.8%) that was silently scored
against an answer key that had since changed underneath it, with nothing in the
artifact revealing that. Every report also records `provenance`:

| Field | Type | Notes |
| --- | --- | --- |
| `provenance.answerKeyDigest` | sha256-family digest string | A stable digest over the expected-finding CONTENT (category, severity, path, effective match mode, declared `lineRange`, semantic summary) of every case in `selection.selectedCaseIds`. Deliberately scoped to expected-finding content only — it excludes `expectedNoFindingZones`, `changedFiles`, `tags`, and other case metadata, none of which change what recall or precision are scored against. Computed by the eval domain itself from the cases it actually scored; a caller cannot supply or override it. Cases are sorted by id before hashing (order-insensitive across cases, since selection order carries no meaning), but expected findings keep their original order WITHIN a case (order-sensitive, since `expectedIndex` is part of the matching contract). Reports saved before this field existed default to a fixed sentinel digest, mirroring how `metricsVersion` itself defaults for old reports. |
| `provenance.answerKeyDigestByCase` | map of case id to digest string | The same expected-finding content digest, computed per case rather than pooled, so a comparison can name exactly which shared cases moved underneath it. Computed by the eval domain from the cases it scored; a caller cannot supply or override it. Empty for reports saved before the field existed. |
| `provenance.configHash` | digest string | A digest over the effective (file + environment + CLI-override merged) configuration the run used, supplied by the CLI. Comparison does NOT refuse across a `configHash` mismatch: a maintainer legitimately compares two runs under different configurations to measure the effect of changing one. The hash exists so an archived run can be read back and its configuration identity checked, not to gate diffing. Defaults to `"unspecified"` when the caller does not supply one (e.g. a direct unit-test call to the eval runner). |
| `provenance.providerId` | string, omitted when no provider | The provider identity (`ProviderConfig.id`) the run resolved. One provider serves both the reviewer and the judges; only the MODEL is separately pinnable. Omitted for a fully offline run (no expected findings, no judge needed). |
| `provenance.modelName` | string, omitted when no provider | The REVIEWER's model name (`ProviderConfig.model`) — the subject of the measurement. Omitted under the same condition as `providerId`. |
| `provenance.judgeModelName` | string, omitted when no provider | The model the two judges actually scored with: `evaluation.judgeModel` when pinned, otherwise `provenance.modelName`. **Recorded either way, including when it equals the reviewer's model** — "same as the reviewer" is an answer, and a report that cannot name its own judge leaves every number in it ambiguous between a reviewer difference and a scorer difference (see "The Judge Must Be Pinnable Independently Of The Reviewer"). Empty for reports saved before the field existed, which is exactly the era whose model comparisons cannot be checked. |

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

### Arm Order In An A/B Is A Confound, And Must Be Balanced

Added 2026-08-07, from a measured artifact rather than from principle.

Two unrelated A/Bs were run on the same day, each as `for each seed: control, then
treatment` — so the treatment arm ran **second** every time. In both, raw precision
came out 5–6 percentage points higher in the treatment arm, with an
order-of-magnitude tighter standard deviation:

| A/B | arm | position | mean | sd |
| --- | --- | --- | --- | --- |
| authorization-scope | control | 1st | .6941 | .0238 |
| authorization-scope | treatment | 2nd | .7420 | .0034 |
| precision-boundary | control | 1st | .6608 | .0227 |
| precision-boundary | treatment | 2nd | .7232 | .0052 |

A treatment effect does not replicate across unrelated treatments. Position does.
**The cause is not established, and this rule does not assume one** — it removes the
confound by construction, because a confound whose mechanism is unknown is still a
confound.

Two requirements follow:

- **Arm order alternates across seeds.** Odd seeds run the control first, even seeds
  run the treatment first, so across three or more seeds neither arm is
  systematically second.
- **Arm label and 1-based position within the seed are recorded in the provenance
  sidecar** (`armLabel`, `armPosition`). Recording is the load-bearing half:
  the artifact was visible only because two A/Bs happened to run the same day, and a
  single A/B would have published it as an effect.

**Interleaving is not this rule and does not satisfy it.** Interleaving was adopted
so the second arm would not inherit a warm cost profile, and it does that. It leaves
position completely fixed. Two distinct confounds, one of which looked handled.

Until an A/B satisfies both requirements, it may report **recall** and mechanism
counts, and **must not report a precision delta between arms.** Both A/Bs above are
subject to that restriction retroactively.

## Metrics

### How A Metric May Be Read

Model-backed evaluation is non-deterministic, so a single run does not establish a
result. The run-to-run band must be measured before a change is judged against it.
On the real-repository corpus, four seeds of one identical configuration produced
recall 81.3%, 87.5%, 81.3%, and 75.0% — a mean of 81.3% with a standard deviation of
4.4 percentage points, matched findings ranging 12 to 14, adjusted precision ranging
92.3% to 100%, and zero to one genuine false positive. A change measured on a single
seed must therefore move recall by more than roughly twice that deviation before it
can be distinguished from noise, and a smaller claimed effect requires several seeds.
Later measurement on an expanded corpus found a comparable band of about 4.8 points.

Two consequences follow, and both are requirements rather than advice. A headline
figure is the MEAN across seeds, never the best observed run. And a quality claim
that rests on one seed must be reported with the band, because quoting the top of a
range as the result overstates the engine.

Those four seeds are cited here for the run-to-run **variance** they establish,
which is what this subsection is about. They are not a current recall figure and
must not be quoted as one, for two independent reasons recorded in
`reports/eval-results-ledger.md`: they predate the harness-wide suppression of
conversation history on 2026-07-27 (see *Conversation History* in
`05-review-workflow-and-runtime.md`), and like every run before 2026-08-01 they
were produced by an UNPINNED engine — the harness pinned the repository under
test but invoked the engine from the live working tree, and no scored artifact
from that period records which engine produced it.

**No scored artifact records engine identity today either, and no guard covers
it.** `EvalReportProvenance` carries `answerKeyDigest`, `answerKeyDigestByCase`,
`configHash`, and an optional `providerId`/`modelName` — nothing that identifies
the engine build that produced the review output. The two guards that do exist
are:

- `metricsVersion`, which the significance module refuses to cross outright and
  the comparison renderer refuses PER METRIC (see "Metrics Version"), because a
  metrics-version change alters what a metric reports for identical review
  output; and
- `answerKeyDigest`, which the comparison renderer refuses to cross per shared
  case and the significance module refuses to cross in aggregate, because
  pooling runs scored against different expectations computes a rate over a
  population that never existed.

Neither guard can detect a mixed-engine pool, and neither is a proxy for one: two
runs of different engine builds against the same answer key and the same metrics
version pool silently. Anyone pooling or comparing runs across an engine change
has to establish engine identity out of band.

The blended recall figure is not interpretable on its own on the real-repository
corpus, because a large share of its expectations lie in unchanged code and the
blended number then depends on that ratio rather than on reviewer quality. Read
the in-diff and out-of-diff figures alongside it. `eval compare` enforces this
for the decision rule it prints: the paired recall verdict is adjudicated per
diff-scope population and the blended figure is never its headline — see
"Adjudicated Per Diff-Scope Population, Never Blended".

### Precision Is A Bracket, Not A Point

Under an incomplete answer key precision is **not identifiable**. A reported
finding that matches nothing is either a false positive or a genuine defect the
fixture never listed, and the answer key alone cannot tell those apart. Raw
`precision` charges every unmatched finding as wrong and is therefore the LOWER
bound; `adjustedPrecision` credits the ones the plausibility judge deemed genuine
and is the UPPER bound. The literature on incomplete judgments (bpref/infAP, and
the finding that condensed-list metrics overestimate a new system more than
traditional metrics underestimate it) puts the less trustworthy end at the top.

**The pair is the reported result.** Every surface that publishes precision
publishes the bracket — the run summary headline, the summary metric table, the
metric-group tables, and every comparison table — and `adjustedPrecision` is never
presented alone as "the" precision. This is a reporting and contract requirement,
not a new measurement: both numbers already existed, and quoting whichever one
suited a claim is what made them misleading.

The upper bound is **not measured** rather than equal to the lower bound whenever
no plausibility judge ran. With no judge the stage is a no-op and the engine sets
`adjustedPrecision = precision`; republishing that as an upper bound would assert
that every unmatched finding was examined and found spurious when none was
examined at all. `scoring.plausibilityJudged` records which case a run was in, so
this distinction is a recorded fact rather than an inference. A report saved
before that field existed cannot answer the question and its upper bound renders
`unknown`.

A bound is also rendered as untrustworthy when the plausibility judge scored below
`evaluation.minJudgeAgreement` (`scoring.adjustedPrecisionTrustworthy = false`).

Rates computed over MATCHED findings — `severityAccuracy`, `lineAccuracy`, and the
severity-weighted scores — are not comparable between two runs whose recall differs.
Their denominator is the matched set, so a change that improves recall mechanically
moves them by adding previously-missed (typically harder) findings to that set. When
recall differs between the runs being compared, the severity or line comparison must
be made on the INTERSECTION of findings matched in both runs, and any headline
movement in these rates must be reported as composition rather than as a quality
change until that paired check is done.

Empty denominators do not share one convention, and the difference is deliberate.
Recall, precision, adjusted precision, the artifact-only rates, `recallByTier`, and
`productRecall` use an empty value of `1`. The security recall metrics and all four
fix-lane rates use `0`. `lineAccuracy`, `linePlacementRate`, and `severityAccuracy`
use `null`, because a rate over no checks is undefined rather than zero.

### Metric Definitions

| Metric | Definition |
| --- | --- |
| `parseValidity` | Fraction of outputs validating against schemas. |
| `recall` | Expected findings matched by actionable admitted findings divided by expected findings. Model-origin actionable findings require a `proved` refutation verdict; trusted deterministic-rule findings are refutation-exempt. Findings with `reporterEligibility = "artifact-only"` are excluded. |
| `precision` | Actionable admitted findings matched to expected findings divided by actionable admitted findings. Model-origin actionable findings require a `proved` refutation verdict; trusted deterministic-rule findings are refutation-exempt. Findings with `reporterEligibility = "artifact-only"` are excluded. **This is the LOWER bound of the precision bracket** and is never published without its upper bound — see "Precision Is A Bracket, Not A Point". |
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
| `lineCheckCount` | Denominator of `lineAccuracy`. |
| `severityCheckCount` | Denominator of `severityAccuracy`. |
| `falsePositiveCount` | Actionable admitted findings not matched to expected findings (raw; includes real-but-unlisted defects). |
| `noFindingZoneFalsePositiveCount` | Actionable admitted findings inside an `ExpectedNoFindingZone` that match no expected finding. |
| `duplicateFindingCount` | Admitted findings at the same path and overlapping line range as an already-matched finding. Review noise, not separate false positives. |
| `genuineFalsePositiveCount` | Unmatched admitted findings the plausibility judge deemed spurious, plus any whose plausibility judgment could not be completed (fail-closed). The trustworthy false-positive count. |
| `unlistedRealFindingCount` | Unmatched admitted findings the plausibility judge deemed genuine defects absent from the fixture's expected list. It REWARDS fragmentation — a reviewer that splits one defect across two findings scores two — so it must not be differenced across arms as if it were a defect count. |
| `adjustedPrecision` | Matched findings divided by matched plus `genuineFalsePositiveCount`. Precision that does not penalise real defects the fixture omitted. **This is the UPPER bound of the precision bracket**, never "the" precision, and it is the less trustworthy end of it. It is published only alongside raw `precision`, and only as a measured bound when `scoring.plausibilityJudged` is `true`. |
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
| `providerErrorRate` | Cases with an UNRECOVERED provider error divided by total cases. |
| `providerIssueRate` | Cases carrying any provider issue, recovered or not, divided by total cases. Reported separately from `providerErrorRate` so a recovered retry stays visible without being counted as a case error. |
| `providerIssueCount` | Total provider issues across cases. |
| `securityRecallByMechanism` | Recall per CWE-family security mechanism (`authorization`, `injection`, `ssrf`, `open-redirect`, `xss`, `deserialization`, `secret-flow`, `cryptography`, `path-traversal`, `unsafe-config`, `concurrency-resource`). Empty value `0`. `open-redirect` was ADDED on 2026-08-07 (metrics version `2026-08-07.open-redirect-mechanism`): CWE-601 is a standard class this vocabulary claims alignment with, it is neither SSRF (there the SERVER issues the request) nor injection (there untrusted input changes a parsed STRUCTURE), and its absence made two curators bucket the same advisory two different wrong ways. `prompt-injection` was REMOVED from this set on 2026-08-06 and MUST NOT be reintroduced here: every other value names a defect class the reviewer should report, whereas prompt-injection resistance is whether the reviewer REFUSES an instruction planted in repository content — which no expected finding can express. Carried in the enum it had no expectation anywhere, so every report published `prompt-injection: 0%` over an empty denominator, which reads as a measured failure rather than as an absent measurement. It is verified behaviourally instead; see `15-security-focused-review.md` under *Mechanisms*. |
| `securityMechanismCounts` | Expected-finding denominators behind `securityRecallByMechanism`. |
| `securityAdjustedPrecisionByMechanism` | Matched divided by matched plus genuine false positives, per mechanism. **Nullable, and published only when bounded.** It is `null` when the mechanism's denominator is empty, and `null` for EVERY mechanism when any genuine security false positive in the run is unattributed — one unattributed false positive could belong to any mechanism, so it bounds all of them. A vacuous `100%` is never published. |
| `securityFindingMechanismCounts` | `{matched, genuineFalsePositive}` per mechanism, plus an `unknown` bucket for findings no rule could attribute. The bucket is what makes an unbounded run visible rather than merely absent. |
| `securityMechanismAttributionCounts` | `{expectation, cwe, unknown}` — where each label came from. A label read off a matched expectation is stronger evidence than one inferred from a finding's CWE tags, and pooling them would hide which. Attribution rules are specified in `15-security-focused-review.md` under *Attributing An Admitted Finding To A Mechanism*. |
| `securityRecallByContextDepth` | Recall per declared context depth (`local`, `cross-function`, `callee`, `caller`, `implementation`, `cross-file`, `analyzer-path-dependent`), so a cross-file blind spot is readable separately from a local one. |
| `securityContextDepthCounts` | Expected-finding denominators behind `securityRecallByContextDepth`. |
| `securityObviousRecall` | Recall over security expectations whose context depth is `local` — the ones visible without leaving the changed file. |
| `securityHardRecall` | Recall over security expectations at every other context depth. |
| `securityObviousCount` | Denominator of `securityObviousRecall`. |
| `securityHardCount` | Denominator of `securityHardRecall`. |
| `costUnavailableCount` | Cases whose cost is unknown: cost/token metadata was incomplete, or the case errored before any usage was surfaced. `costUsd` sums only the cases whose cost IS known, so a non-zero count here is what marks that total as partial rather than exact. |
| `usageUnavailableCount` | Cases whose token usage is unknown: a provider-errored case (no report, so no usage record), or a provider run whose usage never arrived. `inputTokens`, `cachedInputTokens` and `outputTokens` sum only the cases whose usage IS known, and this count is what marks those totals as partial. There is deliberately **one** count for all three totals rather than three: they come from a single usage record and are surfaced together or not at all, so three counters would be three names for one fact and could disagree. This is **not** the same population as `costUnavailableCount` — a run that surfaced usage but had no price for its model has known tokens and an unknown cost, and collapsing the two would mark real measurements unknown. |
| `costUsd` | Provider-reported or estimated cost, summed across each case's REVIEW report only. Does not include judge or plausibility-judge provider spend — see `scoringCostUsd`. |
| `durationMs` | Summed per-case review duration, over the cases that reported one (each case's own `run.durationMs`, added together); see `durationUnavailableCount` for the cases that did not. This is **not** a wall-clock measurement: it excludes judge/plausibility-judge calls, calibration, orchestration, and any idle time between cases, so it cannot be compared to how long the run actually took. See `elapsedMs` for that. |
| `durationUnavailableCount` | Cases with no review duration at all (they errored before one was measured). Mirrors `costUnavailableCount` for the duration sum, so a partial total is never rendered as an exact one. |
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

`codereviewer eval compare --base <report.json> [--base ...] --head <report.json>
[--head ...]` compares two evaluation ARMS and prints the scoring-rule status, the paired recall
verdict, and — when each arm holds exactly one report — gate status, selection
status, metric deltas, and case transitions.

**Both flags are repeatable, and an arm is a SET of reports.** Several runs per
arm is the design this specification's own decision rule requires, and comparing
one report against one report discards most of the evidence that was paid for.
The two arms must hold the SAME number of reports; unequal arms are a usage
error, because per-expectation outcomes measured over different run counts are
not paired observations and a 2/3 against a 1/1 would read as movement that is an
artifact of the run counts.

Within one arm every report must carry the same `metricsVersion` and the same
`provenance.answerKeyDigest`, and every report must have scored the same
expectations; each is a refusal, for the reason pooling refuses in general — the
runs share a per-expectation denominator, so a heterogeneous arm computes a rate
over a population that never existed, and an expectation one run never scored is
not an expectation that run missed. ACROSS arms both a differing `metricsVersion`
and a differing selection remain legitimate and are handled as they always were.

The per-report sections — gate status, selection status, metric deltas, context
ledger and agentic stage counts, metric-group deltas, and case transitions — are
rendered only when each arm holds exactly one report. With several runs per arm
they are replaced by a `## Run-Level Context` section stating the run counts and
why they are omitted: averaging reports would publish numbers no run produced,
and reading one run per arm would present an arbitrary pick as a result. The
paired verdict needs neither, because it adjudicates per expectation across every
run.

Both reports are read through the tolerant COMPARISON VIEW, not the producer
contract — see "Reading A Report The Current Contract Did Not Write". A report
saved before a field existed compares successfully, and every value it lacks
renders `unknown (not recorded)` rather than a number.

The command refuses outright (throws rather than rendering) when a case BOTH arms
scored was scored against different expectations, named individually in the error
— see "Provenance" above. When the answer key moved underneath the comparison, no
metric on either side means what it says, so there is nothing honest left to
render. Every base report is checked against every head report, so a divergence
present in only one run of a multi-run arm is found rather than missed by
checking a single representative. The command also refuses the three
arm-homogeneity violations listed above, and the CLI rejects unequal arm sizes as
a usage error.

A `metricsVersion` difference is NOT such a case. The command renders a
`## Scoring Rules` section naming both versions before any number, warns which
metrics the change makes incomparable, and suppresses exactly those deltas as
`not comparable` while comparing the rest. See "Metrics Version".

The **primary verdict for a recall difference is the paired, finding-level test**,
rendered as `## Paired Recall Verdict (primary)` BEFORE every other number. Both
arms scored the same expectations, so the unit is one expectation
(`caseId#expectedIndex`). This replaces run-level mean ± standard deviation as
the decision rule: an sd estimated from three seeds is barely an estimate — the
two most recent figures on the primary corpus, 0.96pp and 2.89pp, carry 95%
intervals of roughly [0.50, 6.04] and [1.50, 18.17] that overlap almost entirely —
so deciding a few-point recall difference by it is deciding it with noise.
Pairing removes the between-run variance both arms share and costs no additional
provider spend, because the per-expectation outcome is already recorded in every
report. Run-level metric deltas remain in the report as CONTEXT, explicitly
labelled as such.

### One Observation Per Expectation Per Arm

An arm contributes exactly ONE observation per expectation, whatever its run
count: the fraction of the arm's runs that matched it. Pooling the per-pair
discordant counts of several run pairs is forbidden — it counts the same
expectation once per pair, which is not more evidence, only the same evidence
repeated, and it breaks the independence the test assumes. An expectation absent
from one run of an arm is refused, never read as a miss.

### Adjudicated Per Diff-Scope Population, Never Blended

The corpus holds populations with structurally different behaviour: **in-diff**
expectations, which move, and **out-of-diff** expectations, which are a measured
hard zero in every arm of every run because the reviewer is diff-scoped. The
out-of-diff expectations are ties in every pairing, so they contribute nothing to
the test — but blended they inflate the denominator, make the reported base and
head recall the blended figure this specification already says is not
interpretable on its own, and make the verdict's prose describe a population that
cannot move.

Measured: on the three matched run pairs of the 2026-08-02 (`6781a26`) and
2026-08-05 (`db78900`) sweeps the blended verdict reported "does NOT clear
p < 0.05" for all three (5 gained against 2 lost, 5 against 1, 9 against 3). The
same data, adjudicated on the in-diff population and pooled correctly across the
runs, is **12 gained, 3 lost, 45 unchanged, exact two-sided sign test
p = 0.0352**. The blended framing hid a real effect.

The verdict therefore renders a section per population, each with its own
discordant counts, its own test and its own interpretation:

- `in-diff` and `out-of-diff` are ALWAYS rendered, even when empty. Saying a
  population holds no expectation is information; omitting it lets a reader
  assume it was covered.
- `in-diff` carries the **headline**. It is the only population on this corpus
  that can move.
- expectations whose recorded diff scope is neither of those (including
  `undetermined`, and any label a later build introduces) form their own
  population, rendered when non-empty.
- expectations for which NO arm recorded a diff scope form a
  `scope-not-recorded` population, and expectations the two arms scoped
  DIFFERENTLY form a `scope-divergent` population. Neither is folded into a
  measured population: diff scope is a property of the expectation, and
  attributing an unplaceable expectation to in-diff or out-of-diff would move it
  into a population nobody measured it in.
- a blended figure over every population is still rendered, LAST, explicitly
  labelled as depending on the fixture set's population mix rather than on
  reviewer quality, and never as the verdict.

A population with no expectations, and a population with no discordant pair,
report that fact instead of a p-value over nothing. A population every run in
both arms missed reports the stronger statement — a hard zero on both sides —
rather than the weaker "nothing moved", because a tie between two working arms
and a population neither arm can reach are not the same result.

### The Test Is Named And Its Assumptions Are Stated

The statistic is the **exact two-sided sign test** (McNemar's exact test) over
the discordant expectations, reported with the seeded paired-bootstrap 95%
interval from `eval-significance.ts`. It is exact rather than a normal
approximation because the discordant counts this corpus produces are small enough
for the two to disagree across the decision threshold: on 12 gained against 3
lost the normal approximation reports p = 0.0201 where the exact test reports
p = 0.0352. A verdict that clears its own threshold only under an approximation
is a verdict about the approximation.

The rendered output must NAME the test and STATE its assumptions — the unit of
observation, the Binomial(n, 0.5) null over discordant pairs, the exclusion of
concordant pairs by construction, the per-population adjudication, and what the
bootstrap interval describes — so a reader can check the verdict rather than
trust it.

The paired verdict is withheld, with the reason stated, when recall is not
comparable under the scoring-rule history, when a report did not record its
per-expectation outcomes, or when the two arms share no expectation. It is
never approximated: an arm whose expectations were not recorded is not an arm that
matched nothing.

Selection status must
identify whether `selection.selectedCaseIds` are identical and whether fixture
source/slice root metadata match. When selected case sets differ, the comparison
must render a warning before metric deltas because aggregate numbers are not
same-dataset comparable. When either report did not record its selected case set,
the status is `unknown` and the comparison must warn separately: not knowing
whether two runs scored the same cases is not the same as knowing they did. When either report has `scoring.judgeTrustworthy = false`, or the two
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
group-level fixture counts plus recall, the precision BRACKET with its two bound
deltas, F1, and false-positive deltas so aggregate benchmark results cannot hide a
segment-specific regression. The
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
| `scoring.judgeTrustworthy` | boolean | `false` when `judgeAgreement` is below `evaluation.minJudgeAgreement` or no calibration pair was scored, marking the run's quality metrics untrustworthy. |
| `scoring.plausibilityJudgeAgreement` | number or omitted | Measured plausibility-judge agreement against its own calibration set. Omitted when no pair was judged. |
| `scoring.adjustedPrecisionTrustworthy` | boolean | `false` when `plausibilityJudgeAgreement` is below the same configured minimum or no plausibility-calibration pair was scored, marking `adjustedPrecision` untrustworthy. Defaults to `true` when no plausibility judge ran. |
| `scoring.plausibilityJudged` | boolean or omitted | Whether a plausibility judge ran at all. Required for the precision bracket to be honest: with no judge, `adjustedPrecision` equals raw `precision` and is not an upper bound at all. Omitted only in reports saved before the field existed, where the answer is genuinely unknown; it is deliberately not defaulted, because either default fabricates the answer. |

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
availability from the review report.

**One finding array, many ID lists.** A case records every produced finding once
in `producedFindings`, and each classification — matched, duplicate, false
positive, unlisted-real, artifact-only — as a list of IDs into it. Two properties
follow, and both are the reason for the shape:

- **A finding in two classifications has one set of attributes.** Every
  unlisted-real finding is by construction also a false positive, so
  per-classification copies stored the same severity, category, path and title
  twice and could disagree.
- **Matched and unmatched findings are comparable.** Storing attributes only on
  the classifications that "failed" left every matched finding attribute-less, so
  a saved report could not answer *what distinguishes the findings that matched
  from the ones that did not* — within the artifact-only population, that is the
  question of whether the unprovable candidates were real. Answering it must never
  require re-running a case; a scored run is expensive and non-deterministic, and
  re-running to recover a field is how a comparison silently becomes a comparison
  of two different runs.

| Field | Type | Notes |
| --- | --- | --- |
| `producedFindings` | object[] | **Every finding the review produced for the case** — actionable and artifact-only alike — as a sanitized summary with ID, severity, category, path, line, and title. Every classification below is a list of IDs into this array; resolve a finding's attributes from here whichever bucket it fell in. |
| `duplicateFindingIds` | string[] | Admitted findings at the same path and exact overlapping line range as a matched finding. These are review noise, but not separate false positives. |
| `falsePositiveFindingIds` | string[] | Admitted findings that neither match an expected finding nor duplicate a matched finding. |
| `unlistedRealFindingIds` | string[] | Unmatched findings the plausibility judge deemed genuine defects the fixture omitted. |
| `genuineFalsePositiveFindingIds` | string[] | Unmatched findings the plausibility judge deemed spurious, plus any whose judgment could not be completed. |
| `noFindingZoneFalsePositiveIds` | string[] | Findings inside an `ExpectedNoFindingZone` that match no expected finding. |
| `agenticStages` | object[] | One entry per optional agentic stage (`refutation`, `fix`, `provider-recovery`) with `status` (`active`, `skipped`, `recovered`, `error`) and a count, so "the stage was off" stays distinguishable from "the stage ran and found nothing". |
| `parseValid` | boolean | Whether the case's outputs validated against schema. |
| `providerErrored` | boolean | Whether the case ended with an unrecovered provider error. |
| `inlineFindingCount` | integer >= 0 | Admitted findings the case marked inline-eligible. |
| `warnings` | string[] | Case-level warnings, including `cost-unavailable`, `eval-inconclusive-match:<n>`, and `eval-plausibility-fail-closed:<n>`. |
| `durationMs` | integer >= 0, optional | The case's own review duration. **Absent when the case produced no review report at all** (a provider-errored case), because no duration was ever measured. Absence is never written as `0`. |
| `artifactOnlyFindingIds` | string[] | Admitted findings with `reporterEligibility = "artifact-only"`; these are diagnostic and excluded from main recall/precision gates. |
| `artifactOnlyMatchedFindings` | object[] | Match records for artifact-only findings that overlap expected findings. |
| `artifactOnlyFalsePositiveFindingIds` | string[] | Artifact-only findings that neither match an expected finding nor duplicate a matched artifact-only finding. |
| `matchedFindings[].semanticReason` | string | Concise report-safe rationale from the semantic judge that accepted the match. |
| `artifactOnlyMatchedFindings[].semanticReason` | string | Same rationale field for artifact-only semantic judge matches. Every match is a judge decision, so the reason is always present. |
| `inconclusiveExpectedIndexes` | integer[] | Expected findings whose verdict is unknown because a judge call failed. Excluded from the recall denominator and from `unmatchedExpectedIndexes`. |
| `inconclusiveFindingIds` | string[] | Admitted findings whose verdict is unknown because a judge call failed. Excluded from false positives and duplicates. |
| `inconclusiveMatches` | object[] | Undecided expected/finding pairs with `expectedIndex`, `findingId`, provider error `code`, and optional `message`. |
| `contextLedger` | object[] | Report-safe context ledger summaries for the case. Each entry includes `kind` (one of the eight context-ledger kinds), `consideredForModelContext`, and `truncated`. |
| `providerIssues` | object[] | Provider instability observed for the case, including unrecovered provider errors, recovered eval retries, refutation provider issues, and budget/timeouts. Each entry includes `code`, `stage`, and `recovered`. |
| `refutationResults` | object[] | Sanitized refutation summaries with ID, refuted candidate ID, verdict, and reason code. |
| `inputTokens` | integer >= 0, optional | Total input tokens surfaced by the review report for this case. **Absent when no usage record was surfaced**, never written as `0`. A deterministic run with no provider configured made no model call and records a real `0`. |
| `cachedInputTokens` | integer >= 0, optional | Cached (prompt-cache read) input tokens surfaced by the review report for this case (a subset of `inputTokens`). Present exactly when `inputTokens` is. |
| `outputTokens` | integer >= 0, optional | Total output tokens surfaced by the review report for this case. Present exactly when `inputTokens` is. |
| `usageUnavailable` | boolean | `true` exactly when the three token counts are absent — a provider-errored case with no report, or a provider run whose usage never arrived. One flag rather than three, because the three counts come from one usage record and are surfaced together or not at all. Derived from the same value that decides whether the counts are present, so the flag and the figures cannot disagree. |
| `costUsd` | number >= 0, optional | Known cost for this case. **Absent when the cost is unavailable**, which is either a report carrying the `cost-unavailable` warning or a provider-errored case that produced no report at all. Absence is never written as `0`: a case whose cost was never measured must not contribute a confident zero to the run total. |
| `costUnavailable` | boolean | `true` exactly when `costUsd` is absent — a report carrying the `cost-unavailable` warning, or a provider-errored case with no report. Derived from the same value that decides whether `costUsd` is present, so the flag and the figure cannot disagree. |

`costUnavailable` and `usageUnavailable` are separate questions and a case may
carry either without the other. A provider run that surfaced usage but had no
price for its model reports every token count and no cost; a provider-errored
case reports neither.

`metrics` and every `metricGroups[].metrics` entry must aggregate
`duplicateFindingCount`, artifact-only diagnostic metrics,
`trustedDeterministicFindingCount`, `inputTokens`, `cachedInputTokens`,
`outputTokens`, `usageUnavailableCount`, and `costUnavailableCount`. They must
also aggregate
`providerIssueCount` and `providerIssueRate` separately from
`providerErrorRate`, because recovered provider retries must remain visible
without being treated as unrecovered case errors. Markdown summaries must render
token totals and must not present missing cost as a free run. When any case has
unavailable cost, the cost row must show known cost plus the number of cases
with unavailable cost; the summed-duration row must do the same for cases with
no measured duration; and each token row must do the same for cases with no
measured usage. All three use the same `<known> known; unavailable for N case(s)`
wording, so a reader learns one convention for "this figure is a floor" rather
than three.

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
- A real-repository corpus manifest MUST declare `splitIntegrity`, and it is
  cross-checked against the cases rather than believed. A manifest declaring
  `chronological-split` while one split is empty is REJECTED: with nothing on one
  side there is nothing to compare, so the chronological check would pass without
  checking anything — an anti-contamination guard that cannot fail is worse than
  none, because it reports assurance it never established. The alternative
  declaration, `single-split`, requires a written `contaminationNote` long enough
  that the label alone is not a valid answer: it must state what a reader should
  conclude about any figure produced from that corpus.
- **Contamination is not only about training data.** A corpus whose cases all
  postdate the model's training cutoff can still be a dev set, because every
  baseline, A/B and prompt change decided on it has fitted the engine to it. Where
  that is true the manifest must say so, and figures from that corpus must be read
  as dev-set figures rather than as held-out evidence.

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

These are the only keys. In particular the review gate does not threshold on
`productRecall`: recall is measured against a corpus of expected findings, and a
review run has no such corpus — it reviews a change whose true defects are
exactly what it is trying to discover. `minProductRecall` is a threshold of the
**Eval Regression Gate** below, which does have expectations to measure against.

Gate result:

- deterministic;
- records threshold inputs;
- records admitted finding IDs that caused failure;
- never consumes model-generated confidence scores from review artifacts;
- treats model-origin findings as gate-relevant only when their
  `RefutationResult.verdict = "proved"` and they are admitted as actionable.
- records whether baseline filtering was applied.

## Eval Regression Gate

`codereviewer eval run`'s exit code is a SEPARATE gate from the
review command's Quality Gate above: it is computed from
`EvalRegressionThresholds` (`src/domains/evaluation/report/eval-report-contracts.ts`)
against the run's own `metrics`, and is recorded on the saved report as
`regressionGate`.

`EvalRegressionThresholds` fields, every one optional except
`failOnProviderError`, which defaults to `true`:

| Threshold | Metric it gates |
| --- | --- |
| `minParseValidity` | `parseValidity` |
| `minRecall` | `recall` |
| `minProductRecall` | `productRecall` |
| `minPrecision` | `precision` (raw, not adjusted) |
| `minSeverityWeightedF1` | `severityWeightedF1` |
| `maxFalsePositiveCount` | `falsePositiveCount` (raw, not `genuineFalsePositiveCount`) |
| `maxCommentsPerKloc` | `commentsPerKloc` |
| `maxCommentsPerDiffHunk` | `commentsPerDiffHunk` |
| `maxIncompleteCoverageRate` | `incompleteCoverageRate` |
| `maxContextMutationRate` | `contextMutationRate` |
| `maxCostUsd` | `costUsd` |
| `maxDurationMs` | `durationMs` |
| `failOnProviderError` | presence of an unrecovered provider error |

The gate reads RAW metrics only. `adjustedPrecision`,
`genuineFalsePositiveCount`, `judgeTrustworthy`, and
`adjustedPrecisionTrustworthy` never enter it, and the nullable metrics
(`lineAccuracy`, `linePlacementRate`, `severityAccuracy`) are structurally
excluded so an undefined rate can never fail a gate. This is deliberate: the
gate's inputs must be reproducible from the run itself, and every excluded value
depends on a second model judgement.

### The Gate Has Three Outcomes

`regressionGate.outcome` is `passed`, `failed`, or `not-evaluable`. There is no
boolean `passed` field: a three-valued verdict does not fit in one, and carrying
both would let the two disagree about the case that motivated the third value.

| Field | Meaning |
| --- | --- |
| `outcome` | `passed`, `failed`, or `not-evaluable`. |
| `reasons` | Thresholds the run BREACHED. Non-empty exactly when `outcome` is `failed`. |
| `notEvaluableReasons` | Thresholds the gate COULD NOT EVALUATE, each naming the metric, the known-only total, the threshold, and how many cases are unmeasured. Kept apart from `reasons` so "over budget" and "budget not evaluable" are distinguishable by a machine and not only by reading prose. |
| `failingCaseIds` | Cases that caused a FAILURE. A refusal names none, for the same reason `qualityGate.failOnProviderError` fails with an empty `failingFindingIds`: there is nothing to blame, the problem is that a measurement is missing. Which cases are unmeasured is already recorded per case as `costUnavailable` / `usageUnavailable` / an absent `durationMs`. |

**Why a third outcome rather than a failure.** `maxCostUsd` and `maxDurationMs`
are compared against `costUsd` and `durationMs`, which are explicitly
known-only totals — they sum the measured cases and count the rest. With any
unmeasured case that total is a FLOOR, and a floor at or below the threshold
does not establish that the run was under budget. Reporting that as `passed` is
this repository's recurring absence-is-a-plausible-default defect sitting inside
the one place meant to catch it. Reporting it as `failed` is also wrong: a case
is unmeasured because its provider call failed, and this project's standing rule
is that a provider outage must not read as a quality result. The honest answer is
neither, so the gate reports neither. The engine already refuses rather than
judging partially elsewhere — `intent check` exits `4` instead of judging part of
an input, and the change-impact scorer reports `not-measured` instead of a rate.

**A decided failure outranks a refusal.** Unknown spend can only ADD to a total,
so the comparison stays decisive in one direction: a floor ALREADY above the
threshold is a breach whatever the unknowns hold, and fails. Any other failing
threshold likewise reports the failure it is. `outcome` is `failed` whenever
`reasons` is non-empty, `not-evaluable` only when `reasons` is empty and
`notEvaluableReasons` is not, and `passed` only when both are empty. An
unevaluable threshold is still RECORDED alongside a failure — it is a fact about
the run — but it never softens the verdict.

Exit codes follow the outcome: `0` for `passed`, `1` for `failed`, `4` for
`not-evaluable`, matching the CLI's existing meaning for `4` as a refusal to
judge an input it could not see whole.

**Exactly which runs change behaviour.** A run changes only if it satisfies ALL
of these:

1. it sets `maxCostUsd` or `maxDurationMs` (neither is in the `stable` or
   `strict` profile, so this requires an explicit
   `evaluation.regressionGate.overrides` entry);
2. it has at least one case with an unmeasured cost (for `maxCostUsd`) or an
   unmeasured duration (for `maxDurationMs`);
3. the known-only total is at or below that threshold; and
4. no other threshold failed.

Such a run reported `passed` and exited `0` before, and now reports
`not-evaluable` and exits `4`. That is correct: its known-only total never
established that the budget held, and the previous `0` was an assertion the data
did not support. **No other run changes.** A run over budget on its floor still
fails; a run with no unmeasured case still passes or fails exactly as before; a
run that sets neither threshold cannot reach the new outcome at all — which is
every run under both built-in profiles.

The human summary renders `Gate: PASS`, `Gate: FAIL`, or `Gate: NOT EVALUABLE`,
and renders a `## Gate Thresholds Not Evaluable` section listing
`notEvaluableReasons`. That section is ABSENT rather than empty on a genuine
pass, so "under budget" and "budget not evaluable" cannot be confused by a reader
skimming the artifact.

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

`drift.failOn` is the only gate list. A category named in it gates as an error;
every category not named in it gates as a warning. There is no `drift.warnOn`
key, so "warning" below is the absence of an entry rather than a second list.

| Finding Category | Default | Gate Source |
| --- | --- | --- |
| Documentation drift | warning | not in `drift.failOn` |
| Spec drift | warning | not in `drift.failOn` |
| Implementation drift | warning | not in `drift.failOn` |
| Generated artifact drift | hard error | `drift.failOn` default |
| Ambiguity | warning | not in `drift.failOn` |
| Security drift | hard error | `drift.failOn` default |

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
Eval comparison paired-recall verdict rendering must live in a focused helper
module so the per-population verdicts, the stated test and its assumptions, the
unavailable reasons, and the detail tables have one tested owner separate from
the run-level delta renderers.
The paired statistic itself — arm pooling, the population restriction, and the
exact two-sided sign test — must live in `eval-significance.ts`, separate from
both the verdict adapter that partitions populations and the renderer that
prints them, so the statistic can be tested without a report and cannot be
restated differently by a surface.
The tolerant comparison read model, the scoring-rule history that per-metric
comparability derives from, the paired-verdict adapter, and the precision bracket
must each live in their own focused module (`eval-comparison-view.ts`,
`eval-metrics-versions.ts`, `eval-paired-recall-verdict.ts`,
`eval-precision-bracket.ts`), so none of them is owned by a renderer. The bracket
in particular must be a domain value with explicit `known`/`not-measured`/
`unknown` bounds rather than a formatting rule, so no surface can render one bound
without the other.

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
`maxRetries`, task packet budgets, and preset
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
