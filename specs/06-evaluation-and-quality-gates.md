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

`ExpectedFinding` fields:

| Field | Required | Type |
| --- | --- | --- |
| `category` | yes | FindingCategory |
| `severity` | yes | Severity |
| `path` | yes | repositoryRelativePath |
| `lineRange` | no | `[start, end]` |
| `semanticSummary` | yes | string |

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
| `lineAccuracy` | Fraction of matched findings with overlapping line range when expected line exists. |
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

The CLI stdout defaults to the same human-readable summary so a local run is
understandable without opening JSON. The JSON report remains the source of truth
for automation.

`codereviewer eval compare --base <report.json> --head <report.json>` compares
two eval reports and prints gate status, metric deltas, and case transitions.

## Matching Rules

- Exact path match is required.
- If expected line range exists, admitted finding location must overlap within
  three lines.
- R1 semantic matching is deterministic. Normalize `semanticSummary`,
  admitted title, and admitted description to lowercase word tokens; remove
  English stop words; match when Jaccard similarity is at least `0.35`.
- LLM judge matching is not part of R1.
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
