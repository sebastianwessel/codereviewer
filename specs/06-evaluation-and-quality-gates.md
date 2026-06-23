# 06: Evaluation And Quality Gates

Status: Approved
Date: 2026-06-19

## Evaluation Goal

Evaluation is a product capability, not only test infrastructure. It measures
semantic review quality, proof/refutation quality, regression risk, cost, and
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
| `severity` | yes | Severity |
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

## Metrics

| Metric | Definition |
| --- | --- |
| `parseValidity` | Fraction of outputs validating against schemas. |
| `recall` | Expected findings matched by actionable admitted findings divided by expected findings. Model-origin actionable findings require complete proof/refutation; trusted deterministic-rule findings are proof-exempt. Findings with `reporterEligibility = "artifact-only"` are excluded. |
| `precision` | Actionable admitted findings matched to expected findings divided by actionable admitted findings. Model-origin actionable findings require complete proof/refutation; trusted deterministic-rule findings are proof-exempt. Findings with `reporterEligibility = "artifact-only"` are excluded. |
| `f1` | Harmonic mean of precision and recall. |
| `severityWeightedPrecision` | Precision weighted by expected severity impact. |
| `severityWeightedRecall` | Recall weighted by expected severity impact. |
| `severityWeightedF1` | Harmonic mean of severity-weighted precision and recall. |
| `recallByTier` | Recall computed per intent tier (`runtime-critical`, `security`, `logic`, `nit`). Each expected finding carries an explicit `tier` or one derived from category/severity. Lets product-critical recall be read separately from nits. |
| `precisionByTier` | Per-tier precision. Admitted findings carry no expected-tier label, so this mirrors `recallByTier` as a best-effort signal (documented in code). |
| `productRecall` | Headline recall over the product tiers (`runtime-critical` + `security` + `logic`), excluding `nit`. This is the number the >80% accuracy target is measured against, matching the low-noise product scope in `00-vision.md`. |
| `nitRecall` | Recall over `nit`-tier expected findings only. Reported for visibility; not part of the headline target or gates. |
| `suspicionStageCoverage` | Fraction of non-provider-error cases that produced at least one model suspicion. A low value means discovery never ran for many cases. |
| `judgeCoverage` | When `judgeFindings` is enabled, judged candidates divided by actionable-promoted proofs. A low value means findings were admitted without the strict per-candidate judge actually reviewing them. |
| `lineAccuracy` | Fraction of matched findings with overlapping line range when expected line exists. Semantic-only benchmark expectations are excluded from the denominator. |
| `severityAccuracy` | Fraction of matched findings with exact severity. |
| `falsePositiveCount` | Actionable admitted findings not matched to expected findings. |
| `artifactOnlyRecall` | Expected findings matched by artifact-only findings divided by expected findings. This is diagnostic and does not satisfy the main recall gate. |
| `artifactOnlyPrecision` | Artifact-only findings matched to expected findings divided by artifact-only matched plus artifact-only false positives. |
| `artifactOnlyFindingCount` | Count of admitted findings marked `reporterEligibility = "artifact-only"`. |
| `artifactOnlyMatchedFindingCount` | Count of artifact-only findings matched to expected findings. |
| `artifactOnlyFalsePositiveCount` | Count of artifact-only findings that neither match expected findings nor duplicate matched artifact-only findings. |
| `trustedDeterministicFindingCount` | Count of actionable findings seeded by trusted deterministic-rule evidence rather than model proof. |
| `suspicionRecall` | Expected findings matched by any model suspicion, whether or not promoted, divided by expected findings. Diagnostic only. |
| `proofRecall` | Expected findings matched by any complete proof packet divided by expected findings. Diagnostic only. |
| `proofPromotionPrecision` | Promoted actionable proof packets matched to expected findings divided by promoted actionable proof packets. |
| `refutationFalseNegativeCount` | Expected findings with a matching proof packet that were refuted or demoted without deterministic contradiction. |
| `refutationFalsePositiveCount` | Refutation results marked `proved` whose promoted finding is unmatched. |
| `staticDuplicateDemotionCount` | Count of model outputs demoted as CodeQL/linter/formatter/test/build-equivalent duplicates. |
| `actionableRate` | Actionable admitted findings with resolvable location, impact, evidence, and a concrete remediation direction divided by actionable admitted findings. |
| `commentsPerKloc` | Actionable admitted findings per thousand changed lines. |
| `commentsPerDiffHunk` | Actionable admitted findings per changed diff hunk. |
| `incompleteCoverageRate` | Runs whose report coverage is incomplete divided by total runs. The release target is `0`. |
| `contextMutationRate` | Context ledger entries with budget-driven mutation divided by entries considered for model context. The release target is `0`. |
| `investigationToolReadCount` | Total mediated read/list/grep/symbol/test/config lookups used by investigations and refutations. |
| `costUsd` | Provider-reported or estimated cost. |
| `durationMs` | Wall-clock run duration. |

## Human Output

`codereviewer eval run` must produce both machine-readable and
human-readable output:

| Artifact | Purpose |
| --- | --- |
| `.codereviewer/eval/eval-report.json` | Stable structured metrics and case results for CI and automation. |
| `.codereviewer/eval/eval-summary.md` | Human-readable gate status, comparison metrics, per-case status, missed expected findings, false positives, warnings, costs, duration, and artifact links. |
| `.codereviewer/eval/eval-recall-report.md` | Human-readable per-expected-finding recall report for the current run. |

The top-level artifacts are latest-run convenience copies. Every run must also
write the same artifacts under `.codereviewer/eval/runs/<run-id>/` so later
smoke runs do not overwrite the only copy of an expensive benchmark report.

The CLI stdout defaults to the same human-readable summary so a local run is
understandable without opening JSON. The JSON report remains the source of truth
for automation.

`codereviewer eval compare --base <report.json> --head <report.json>` compares
two eval reports and prints gate status, selection status, metric deltas, and
case transitions. Selection status must identify whether
`selection.selectedCaseIds` are identical and whether fixture source/slice root
metadata match. It must also identify whether
`scoring.semanticMatcher` modes match. When selected case sets differ, the
comparison must render a warning before metric deltas because aggregate numbers
are not same-dataset comparable. When semantic matcher modes differ, the
comparison must render a warning before metric deltas because aggregate numbers
are not scoring-mode comparable. The command may still exit `0` after rendering
warnings so users can inspect partial overlap, new cases, removed cases, and
scoring-mode differences. When either compared report includes context ledger
entries, the comparison must render aggregate base/head/delta counts by context
ledger kind so benchmark readers can see context usage changes alongside metric
deltas. When either compared report includes agentic stage coverage, the
comparison must also render aggregate base/head/delta counts by agentic stage so
planning, proof, refutation, aggregate, and optional judge behavior changes are
visible beside quality metrics. Metric deltas must include input-token and
output-token totals so token-use regressions are visible during benchmark
comparison. Cost deltas must use the same known/unavailable wording as eval
summaries and must include unavailable-cost case counts so missing pricing data
is not presented as free or cheaper. Agentic stage delta rows must omit stages
whose aggregate base and head counts are both zero so skipped-stage noise does
not obscure meaningful planning, proof, refutation, aggregate, or judge changes.
Metric deltas must also include provider error rate, provider issue rate, and
provider issue case counts so provider instability is visible beside model
quality, token, cost, and duration changes. Metric deltas must include
suspicion recall, proof recall, proof promotion precision, refutation false
negative count, and refutation false positive count so proof-loop quality
regressions are visible during benchmark comparison. When both reports include
matching `sourceProfile` or `language` metric groups, the comparison must render
group-level fixture counts plus recall, precision, F1, and false-positive deltas
so aggregate benchmark results cannot hide a segment-specific regression. The
same matching groups must also render proof-loop deltas for suspicion recall,
proof recall, proof promotion precision, refutation false negatives, and
refutation false positives so agentic proof quality regressions are visible by
segment. They must also render resource deltas for input tokens, output tokens,
known cost, and unavailable-cost case counts using the same known/unavailable
cost wording as aggregate comparisons, so token or pricing regressions are
visible by segment. The comparison must separately render fixture-count
coverage deltas for the union of `sourceProfile` and `language` metric groups,
including groups present in only one report, and omit unchanged group counts.
Detailed quality, proof-loop, and resource group deltas remain limited to groups
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
| `scoring.semanticMatcher` | `"deterministic" | "semantic-judge"` | `deterministic` means offline token matching; `semantic-judge` means the caller explicitly enabled provider-backed semantic matching. |

`codereviewer eval run` may override review posture for one run without editing
repository config. Supported eval-only overrides are `--review-mode
<local|ci|pr|full>`, `--review-depth <fast|balanced|thorough>`,
`--intent-planning <auto|deterministic|model>`, `--judge-findings`, and
`--max-concurrent-tasks <1-32>`. These flags must merge above file and
environment config for the eval invocation only. They exist to make benchmark
quality comparisons reproducible, especially for the agentic PR-review path
that should force PR mode, thorough depth, model intent planning, optional
finding judging, semantic scoring, serial provider calls, and sanitized debug
logs.

The committed Code Review Bench-style package scripts must make the agentic
PR-review posture the default costly benchmark path. `eval:benchmark` hydrates
the benchmark pack and runs PR mode, thorough depth, model intent planning,
optional finding judging, semantic scoring, and serial provider calls.
`eval:cheap` must provide a low-cost provider-backed proof-quality smoke path
that first runs zero-token refutation gate regressions, then runs the
project-owned semantic authz positive/control slices plus small benchmark-derived
scheduling, cache-concurrency, and branch-asymmetric business-rule regression
slices with the same PR/thorough/model-intent/judge posture. The package scripts
must also expose `eval:cheap:refutation` for the zero-token precheck and
`eval:cheap:provider` for the artifact-producing provider-backed slice run.
`eval:benchmark:debug` runs the same posture with sanitized no-content debug
logs written to `.codereviewer/eval/log.log`. A separate
`eval:benchmark:baseline` script may preserve the older current-config provider
benchmark posture for before/after comparison, but it must be clearly named as
baseline so humans do not mistake it for the intended agentic quality run.

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
| `matchedFindings[].semanticReason` | string or omitted | Concise report-safe rationale from the optional semantic judge when that judge accepted the match. Omitted for deterministic matches. |
| `artifactOnlyMatchedFindings[].semanticReason` | string or omitted | Same rationale field for artifact-only semantic judge matches. |
| `contextLedger` | object[] | Report-safe context ledger summaries for the case. Each entry includes `kind`, `consideredForModelContext`, and `truncated`; legacy eval inputs without `kind` are reported as `unknown`. |
| `providerIssues` | object[] | Provider instability observed for the case, including unrecovered provider errors, recovered eval retries, investigation/refutation provider issues, and budget/timeouts. Each entry includes `code`, `stage`, and `recovered`. |
| `agenticStages` | object[] | Artifact-derived stage coverage for `intent-planning`, `suspicion-generation`, `suspicion-investigation`, `proof-packet`, `refutation`, `aggregate-critic`, `judge`, and `provider-recovery`. Each entry includes `status` and `count`; it is audit metadata only and must not imply hidden provider calls when the corresponding artifacts are absent. |
| `modelSuspicions` | object[] | Sanitized suspicion summaries with ID, category, severity hint, path/line when known, status, and title. |
| `proofPackets` | object[] | Sanitized proof summaries with ID, source suspicion ID, proof completeness status, matched expected index when any, and promotion decision. |
| `refutationResults` | object[] | Sanitized refutation summaries with ID, proof packet ID, verdict, and reason code. |
| `inputTokens` | integer >= 0 | Total input tokens surfaced by the review report for this case, or `0` when unavailable. |
| `outputTokens` | integer >= 0 | Total output tokens surfaced by the review report for this case, or `0` when unavailable. |
| `costUsd` | number >= 0 | Known cost for this case, or `0` when unavailable. |
| `costUnavailable` | boolean | `true` when cost/token metadata was incomplete and the case warnings include `cost-unavailable`. |

`metrics` and every `metricGroups[].metrics` entry must aggregate
`duplicateFindingCount`, artifact-only diagnostic metrics,
`trustedDeterministicFindingCount`, `inputTokens`, `outputTokens`, and
`costUnavailableCount`. They must also aggregate
`providerIssueCount` and `providerIssueRate` separately from
`providerErrorRate`, because recovered provider retries must remain visible
without being treated as unrecovered case errors. Markdown summaries must render
token totals and must not present missing cost as a free run. When any case has
unavailable cost, the cost row must show known cost plus the number of cases
with unavailable cost. Markdown summaries must also render agentic stage
coverage as a compact case table so benchmark readers can see whether planning,
suspicion, proof/refutation, aggregate critic, optional judge, or
provider-recovery artifacts were produced without opening debug logs.
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
- `semantic-only`: path and line are not used for matching; semantic similarity
  and one-to-one assignment determine recall/precision.
- R1 semantic matching is deterministic by default, and the deterministic
  matcher always runs first. Normalize `semanticSummary`, admitted title, and
  admitted description to lowercase word tokens; remove English stop words; match
  when Jaccard similarity is at least `0.35`. Provider-backed judging is an
  explicit opt-in described below and only supplements deterministic results.
- `codereviewer eval run --semantic-judge` enables provider-backed semantic
  matching for semantic-only and path-semantic expected findings that the
  deterministic matcher does not match. The default remains deterministic and
  offline.
- `--semantic-judge` requires explicit provider configuration and credentials
  from CLI/config/process environment. Provider-backed npm scripts may load
  `.env` with Node's native env-file flag; the CLI implementation itself still
  must not auto-load the repository root `.env` file.
- The semantic judge request may include only the expected semantic summary and
  admitted finding title/description. It must not include source snippets,
  unified diff text, prompt instructions, secrets, raw tool output, or
  repository files.
- Judge results must parse as a strict object with `match` and `reason`.
  `reason` is a concise report-safe rationale for audit only. Judge-backed
  matches use deterministic accepted-match scoring (`semanticScore = 1`) rather
  than provider-generated confidence, and the eval report must set
  `scoring.semanticMatcher = "semantic-judge"`. Accepted judge-backed matches
  persist the bounded rationale as `semanticReason` and the Markdown summary
  renders a compact `Semantic Judge Matches` audit table.
- Judge-backed matching is for benchmark parity analysis and explicit local
  quality experiments. It must not silently replace deterministic gates.
- One admitted finding can match at most one expected finding.
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
| `minSuspicionStageCoverage` | number 0..1 | unset (no fail) |
| `minJudgeCoverage` | number 0..1 | unset (no fail) |

When set, `minProductRecall`, `minSuspicionStageCoverage`, and `minJudgeCoverage`
fail the gate if the corresponding metric falls below the threshold.
`minJudgeCoverage` is only enforced when `aiReview.judgeFindings` is enabled, so
a run without optional judging is not penalised for zero judge coverage.

Gate result:

- deterministic;
- records threshold inputs;
- records admitted finding IDs that caused failure;
- never consumes model-generated confidence scores from review artifacts;
- treats model-origin findings as gate-relevant only when they have a complete
  proof packet, `RefutationResult.verdict = "proved"`, and actionable promotion.
- records whether baseline filtering was applied.

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
accuracy, suspicion recall, proof recall, refutation correctness, cost, latency,
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
case where a proof-backed finding on a changed source line becomes a new-side
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
case, agentic-stage coverage, context-ledger kind, gate-reason,
provider-issue, semantic-judge match, attention-detail, and artifact-link
sections do not expand the runner or a single monolithic summary block.
Metric-group summary table rows must share a focused formatter that preserves
source-profile/language group output.
Case summary table rows must share a focused formatter that preserves
source-profile and expected-count fallback behavior.
Agentic-stage coverage table rows must share a focused formatter that preserves
the fixed stage order.
Context-ledger kind table rows must share a focused formatter that preserves
kind, considered, and truncated count rendering.
Provider-issue and semantic-judge diagnostic table rows must share focused
formatters that preserve existing Markdown output.
Gate-reason and artifact-link bullet sections must share a focused helper that
preserves full Markdown section spacing.
Attention-detail rendering must share a non-empty bullet-section helper for
repeated finding, proof, refutation, and promotion subsections.
Finding-like attention bullets must share one formatter for finding ID,
severity, category, path/line, and title rows.
Matched-finding attention bullets must share one formatter for finding ID,
expected-finding label, and semantic score rows.
Proof-loop attention bullets must share focused formatters for proof packet,
refutation result, and promotion decision rows.
Missed-expected attention rows must share focused helpers that preserve stale
expected-index skipping while keeping row formatting local to the renderer.
Recall report section rendering must stay in focused renderer helpers, so run,
summary, and expected-finding tables do not expand the runner or a single
monolithic recall block.
Recall expected-finding table rows must share a focused formatter that preserves
location, recall-rate, and run-mark rendering.
Comparison section rendering must stay in focused renderer helpers when a table
has distinct row semantics, so aggregate metrics, context-ledger kind,
agentic-stage, gate, selection, case-transition, grouped quality, resource,
proof-loop, and coverage sections do not expand the runner or a single
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
Comparison metric-group proof-loop rows must share a focused formatter that
preserves suspicion, proof, promotion, refutation, and delta rendering.
Comparison context-ledger kind rows must share a focused formatter that
preserves kind, base/head count, and delta rendering.
Comparison agentic-stage rows must share a focused formatter that preserves
stage, base/head count, and delta rendering.
Comparison case-transition rows must share a focused formatter that preserves
case ID, missing-status fallback, and transition label rendering.
Comparison aggregate metric rows must share a focused formatter that preserves
metric labels, base/head values, and delta rendering.
Comparison count-delta rows shared by context-ledger and agentic-stage sections
must use one escaped-label formatter that preserves base/head count and delta
rendering.
Comparison count-delta tables shared by context-ledger and agentic-stage
sections must use one local appender that preserves section headings, headers,
zero-count filtering policy, escaped labels, and delta row rendering.
Comparison metric-group detail rows must share one escaped group/key and
base/head fixture prefix helper so quality, resource, and proof-loop rows keep
their common identity columns consistent.
Comparison metric-group percentage rows must share one percent/base-head-delta
cell helper so quality and proof-loop percentage metrics stay consistent.
Comparison metric-group count rows must share one raw-count/base-head-delta
cell helper so quality, resource, and proof-loop count metrics stay consistent.
Comparison metric-group integer rows must share one formatted-integer/base-head
delta cell helper so resource token metrics stay consistent.
Comparison metric-group identity cells must share one escaped group/key and
base/head fixture formatter across coverage, quality, resource, and proof-loop
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
case, provider issue, agentic stage, context ledger, and note rows share one
status and fallback policy.
Eval recall report rendering must live in a focused renderer module while the
public evaluation rendering entrypoint keeps exporting the recall renderer for
backward-compatible callers.
Eval summary report rendering must live in a focused renderer module while the
public evaluation rendering entrypoint keeps exporting the summary renderer for
backward-compatible callers.
Eval comparison report rendering must live in a focused renderer module while
the public evaluation rendering entrypoint keeps exporting the comparison
renderer for backward-compatible callers.
Eval comparison gate and selection rendering must live in a focused helper
module so dataset-compatibility warnings and selection status rows are owned by
one tested component.
Eval comparison count-delta table rendering must live in a focused helper module
so context-ledger and agentic-stage delta sections share one table policy.
Eval comparison case-transition rendering must live in a focused helper module
so pass/fail transition labels and escaped case rows have one tested owner.
Eval comparison metric-group rendering must live in a focused helper module so
coverage, quality, resource, and proof-loop group deltas share one owner.
Eval comparison aggregate metric-delta rendering must live in a focused helper
module so percent, count, duration, token, cost, provider, and proof-loop metric
rows share one owner.
Eval comparison context-ledger and agentic-stage delta rendering must live in a
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
| Hermetic provider fixture balanced review of 25 changed files with proof/refutation loops | <= 90000 ms |

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
