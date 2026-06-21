# 06: Evaluation And Quality Gates

Status: Approved
Date: 2026-06-19

## Evaluation Goal

Evaluation is a product capability, not only test infrastructure. It measures
review quality, regression risk, cost, and latency across deterministic golden
fixtures before review behavior changes are accepted.

`codereviewer eval run` must not load the repository root `.env` file by
default. This prevents local provider credentials or provider selection from
changing fixture results unexpectedly.

## Eval Dataset Contract

Development datasets live under root `eval/fixtures/` in R1. The shippable
source package keeps reusable evaluation schemas, matching, metrics, and runner
logic under `src/domains/evaluation/`.

`codereviewer eval run` loads both:

- declared cases from `eval/fixtures/sample-eval-cases.json`;
- self-contained slice cases from `eval/fixtures/slices/<case-id>/slice.json`
  with source files under `eval/fixtures/slices/<case-id>/repo/`.

`codereviewer eval run --slice-root <path>` loads only slice cases from the
repository-relative directory at `<path>`. The directory must contain
`<case-id>/slice.json` and `<case-id>/repo/` entries. This mode exists for
untracked local benchmark packs copied into the repository workspace, such as
`eval/benchmarks/<dataset>/`, without requiring those packs to be committed.

`codereviewer eval run --case <case-id>` filters the loaded eval cases by exact
case ID. The flag may be repeated. If no loaded case matches, the command exits
with usage error `2`.

R1 also supports benchmark-compatible self-contained slices that follow the
same `repo/` layout but use `expected[]` entries instead of
`expectedFindings[]`. These slices are used to compare review quality against
external benchmark datasets without requiring a hosted experiment tracker.

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
| `expectedFindings` | conditional | `ExpectedFinding[]` |
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
| `expected` | conditional | `BenchmarkExpectedFinding[]` |

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

`BenchmarkExpectedFinding` fields:

| Field | Required | Type |
| --- | --- | --- |
| `file` | no | repositoryRelativePath |
| `path` | no | repositoryRelativePath |
| `line` | no | integer >= 1 or null |
| `lineEnd` | no | integer >= 1 or null |
| `type` | no | string mapped to `FindingCategory` |
| `category` | no | FindingCategory |
| `severity` | yes | Severity |
| `description` | yes | string |

Normalization rules:

- `expectedFindings[]` is the canonical internal shape.
- `expected[]` is normalized at load time into `expectedFindings[]`.
- `file` and `path` are aliases; `path` wins when both are present.
- `line`/`lineEnd` become `lineRange` only when a path is present.
- category is `category` when valid, otherwise mapped from `type`, otherwise
  `bug`.
- entries with no path use `matchMode = "semantic-only"`.
- entries with path and line use `matchMode = "path-line"`.
- entries with path and no line use `matchMode = "path-semantic"`.

## Metrics

| Metric | Definition |
| --- | --- |
| `parseValidity` | Fraction of outputs validating against schemas. |
| `recall` | Expected findings matched by admitted findings divided by expected findings. |
| `precision` | Admitted findings matched to expected findings divided by admitted findings. |
| `f1` | Harmonic mean of precision and recall. |
| `severityWeightedPrecision` | Precision weighted by expected severity impact. |
| `severityWeightedRecall` | Recall weighted by expected severity impact. |
| `severityWeightedF1` | Harmonic mean of severity-weighted precision and recall. |
| `lineAccuracy` | Fraction of matched findings with overlapping line range when expected line exists. Semantic-only benchmark expectations are excluded from the denominator. |
| `severityAccuracy` | Fraction of matched findings with exact severity. |
| `falsePositiveCount` | Admitted findings not matched to expected findings. |
| `actionableRate` | Admitted findings with resolvable location, impact, evidence, and a concrete remediation direction divided by admitted findings. |
| `commentsPerKloc` | Admitted findings per thousand changed lines. |
| `commentsPerDiffHunk` | Admitted findings per changed diff hunk. |
| `incompleteCoverageRate` | Runs whose report coverage is incomplete divided by total runs. The release target is `0`. |
| `contextMutationRate` | Context ledger entries with budget-driven mutation divided by entries considered for model context. The release target is `0`. |
| `costUsd` | Provider-reported or estimated cost. |
| `durationMs` | Wall-clock run duration. |

## Human Output

`codereviewer eval run` must produce both machine-readable and
human-readable output:

| Artifact | Purpose |
| --- | --- |
| `.review/eval/eval-report.json` | Stable structured metrics and case results for CI and automation. |
| `.review/eval/eval-summary.md` | Human-readable gate status, comparison metrics, per-case status, missed expected findings, false positives, warnings, costs, duration, and artifact links. |
| `.review/eval/eval-recall-report.md` | Human-readable per-expected-finding recall report for the current run. |

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
scoring-mode differences.

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

`codereviewer eval recall-report --report <report.json>` reads one or more
saved eval reports and prints a Markdown per-expected-finding recall report.
The flag may be repeated. When omitted, the command reads
`.review/eval/eval-report.json`. The report must show whether selected case
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
  from CLI/config/process environment. `eval run` still must not auto-load the
  repository root `.env` file.
- The semantic judge request may include only the expected semantic summary and
  admitted finding title/description. It must not include source snippets,
  unified diff text, prompt instructions, secrets, raw tool output, or
  repository files.
- Judge results must parse as a strict object with `match` and `confidence`.
  Judge-backed matches use the reported confidence as `semanticScore`, and the
  eval report must set `scoring.semanticMatcher = "semantic-judge"`.
- Judge-backed matching is for benchmark parity analysis and explicit local
  quality experiments. It must not silently replace deterministic gates.
- One admitted finding can match at most one expected finding.
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
| `minEvidenceLevel` | `"non-model" | "model-ok"` | `"non-model"` |
| `failOnProviderError` | boolean | `true` |
| `failOnNewOnly` | boolean | value from baseline config |

Gate result:

- deterministic;
- records threshold inputs;
- records admitted finding IDs that caused failure;
- never uses model judgment alone.
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

The committed R1 fixture pack must include positive and negative coverage for
TypeScript, JavaScript, Python, Go, Rust, and Java. Positive cases target
deterministic analyzer diagnostics where available. Negative cases prove valid
files do not produce findings in no-finding zones.

Future benchmark-style datasets should use self-contained repository slices:
metadata and expected findings plus a minimal `repo/` tree that preserves the
paths and context needed to reproduce a real review decision. Slice cases should
support recall, precision/noise, line accuracy when line data exists, severity
accuracy, cost, latency, and run-to-run comparison across presets, models, and
provider configurations.

Benchmark-compatible CRB-style datasets are allowed in `eval/fixtures/slices/`
or an untracked local slice root copied into that layout and selected with
`--slice-root`. Public
benchmark results must be labeled as `benchmark-semantic` and must not be used
as sole release evidence because public golden comments can be contaminated and
often lack line metadata. Project-owned captured PR slices with file and line
data are required for line-number and GitHub-comment accuracy gates.

Line-number reliability evals must include at least one case where a provider or
scripted reviewer proposes a finding on a reviewed path but outside the
reviewed head-file line range. The expected result is a rejected candidate with
`location-invalid`, no inline finding, and no GitHub review-comment draft for
that candidate.

Diff-anchor reliability evals must include at least one explicit-file or slice
case where a deterministic analyzer finding on a changed source line becomes a
new-side inline-eligible finding only because the eval-supplied unified diff
contains the matching new-side hunk. The same class of finding must remain
summary-only when no effective diff map covers the line.

Evaluation summaries must show enough human-readable detail to understand a
regression without opening raw JSON:

- selection metadata including fixture source, slice root when present, case
  filters, and selected case IDs;
- grouped recall, precision, F1, line accuracy, and false-positive counts by
  source profile and language;
- per-case source profile, language, expected count, matched count, false
  positive count, and gate status;
- missed expected findings with index, severity, category, path/line when
  available, match mode, and semantic summary;
- false positive findings with finding ID, severity, category, path/line, and
  title;
- a clear note when a case is semantic-only and therefore cannot prove line
  accuracy.

## R1 Performance Budgets

These budgets apply to fixture and scripted-provider verification, not to
uncontrolled external provider latency:

| Scenario | Budget |
| --- | --- |
| Config validation for one config file | <= 500 ms |
| Repository intake for 500 changed paths with no file over cap | <= 5000 ms |
| Report rendering for 100 admitted findings | <= 2000 ms |
| Eval metric calculation for 100 findings and 100 expectations | <= 1000 ms |
| Scripted-provider balanced review of 25 changed files across first-class languages | <= 90000 ms |

External provider runs must enforce provider `timeoutMs`, provider
`maxRetries`, whole-run `runTimeoutMs`, task packet budgets, and preset
`maxCostUsd` when usage and pricing data are available. Strict per-task cost
stops remain release-blocking follow-up work before R1 is considered complete.

## Verification

- Eval schema unit tests.
- Metric calculator unit tests.
- Fixture runner integration test with scripted provider.
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
