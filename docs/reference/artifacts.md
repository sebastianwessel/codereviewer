# Artifact Reference

## Review Artifacts

Default directory:

```text
.codereviewer/runs/<run-id>/
```

| File | Description |
| --- | --- |
| `report.json` | Full structured report. |
| `report.md` | Human-readable report. |
| `report.sarif` | SARIF report. |
| `github-review-comments.json` | Local GitHub PR review-comment draft array, when enabled. |
| `run-summary.json` | Run metadata. |
| `context-ledger.json` | Redacted ledger of context items considered and included source chunks. |
| `shared-context.json` | Run snapshot with compact shared entries, exact `taskEvents`, derived `currentTasks`, evidence, internal candidates, and admission decisions. |
| `observability.json` | No-content event trace with run steps and task events. |
| `error.json` | Redacted normalized error for partial failed runs. |

`observability.json` step events describe the implemented review pipeline. The
`deterministic_signals` step includes safe support-signal attributes such as
structural engine name/version, signal count, evidence count, supported
extension count, and skipped unsupported path count. These fields are counts
and version metadata only.

`context-ledger.json` is content-free. It records paths, hashes when content was
read, byte counts, decisions, reasons, and task IDs. Source entries with reason
`task-context-source-chunk` prove which task reviewed each source chunk. A
completed `report.json` includes a `coverage` object; successful completed
reviews require `coverage.status` to be `complete`.

`report.json` exists for completed review runs. Markdown, SARIF, and GitHub
review-comment drafts are written when enabled in `reporting.formats`. The
`artifacts` array inside `report.json` lists the non-JSON report artifacts
written for the run; it does not include a hash of itself.

Provider-backed runs include proof-loop state in `report.json`: review intents
with compact verification questions,
model suspicions, investigation traces, proof packets, refutation results,
optional aggregate results, optional judge results, promotion decisions, and
provider issues.
Investigation context reads are traced through `context-ledger.json`.
Model suspicions include structured context requests when the finding agent
needs bounded read/list/grep follow-up before proof assembly.
Investigation traces show whether the suspicion became a proof, was refuted,
needed more evidence, or hit a recovered provider issue. The trace budget shows
how many investigation rounds were allowed and how many were used. When mediated
context retrieval is active, it also shows the configured read/search limits and
the reads/searches consumed by that trace; follow-up context requested by the
investigator is recorded through the same context ledger and evidence references
as initial suspicion context. Mediated read/list/grep entries use the
`tool-result` ledger kind.
Aggregate results show batch critic decisions across related proved findings
when optional judging is enabled for runs with multiple proof packets. Aggregate
result and decision evidence references are only the IDs explicitly cited by the
batch critic; an evidence-less aggregate approval or rejection is recorded as
`needs-more-evidence`.
When optional judging is enabled, sibling sweep suspicions may create additional
model suspicions and proof packets for the same repeated pattern in other
changed ranges; they are not a separate artifact type.
Optional judge results include report-safe challenge questions, structured
verification checks, structured context requests, and any bounded prose context
request strings the critic used before the final verdict. Follow-up context uses
the same trace path and remains bounded to redacted ledger entries and evidence
references in reports. Judge result evidence references are only the IDs
explicitly cited by the critic; an empty list means the critic did not cite
decisive evidence, and an evidence-less critic approval or rejection is recorded
as `needs-more-evidence`.
Weak, refuted, or provider-error model output is visible to humans but is not
included in quality-gate counts or review-comment drafts unless it is promoted
as actionable. SARIF renders provider issues in run-level properties instead of
diagnostic results, so code-scanning consumers can inspect provider degradation
without creating code alerts. SARIF also excludes artifact-only findings from
diagnostic results and rule definitions; use JSON or Markdown for those audit
diagnostics. Exact duplicate provider issue records are collapsed before report
output; distinct provider stages, recovery states, or messages remain visible.
Context ledger entries are collapsed by stable ledger ID before report output,
so reused context retrieval artifacts keep one ledger record with many
references instead of repeated ledger rows.
Markdown renders investigation trace budgets and tool-call summaries, proof
packet evidence and proof fields, refutation summaries, refutation evidence,
refutation check evidence, aggregate result evidence, aggregate decision
evidence, aggregate similar-issue check evidence, judge result evidence, and
judge verification-check evidence as cited IDs or `none cited`; JSON remains the
structured source of truth for full evidence arrays and verification checks.

`github-review-comments.json` is a local artifact only. It does not publish
comments. Each entry contains the repository-relative path, new-side line
anchor, redacted body, source finding ID, severity, category, and an optional
GitHub suggestion block when a single safe fix edit maps to the same line
range. Review-comment drafts are emitted only for findings whose new-side line
range was validated against reviewed source content during admission and, for
diff-backed runs, overlaps a changed new-side diff hunk.

If a provider task fails after task execution starts, the CLI writes partial
artifacts instead of a report: `run-summary.json`, `context-ledger.json`,
`shared-context.json`, `observability.json`, and `error.json`. The shared
context contains completed and failed task events with sanitized messages.
Provider-call retries are handled by the Harness model retry policy before the
workflow records a terminal task event.
`taskEvents` is append-only history; `currentTasks` contains the latest state
per task ID. There is no alternate name for the append-only history.

Review runs are stateless and one-shot. A partial provider-backed failure writes
the run-summary, context-ledger, shared-context, observability, and `error.json`
artifacts for inspection; rerun the command to review again from scratch. The
review runtime keeps all session and task state in memory and never creates
persistent durable databases, session directories, or workspace directories.

## Evaluation Artifacts

Default directory:

```text
.codereviewer/eval/
```

| File | Description |
| --- | --- |
| `eval-report.json` | Evaluation selection metadata, aggregate metrics, grouped metrics, case results, context ledger kind summaries, provider issues, and artifact-derived agentic stage coverage. |
| `eval-summary.md` | Human-readable evaluation selection, grouped metrics, case table, context ledger kind coverage, agentic stage coverage, and failure details. |
| `eval-recall-report.md` | Human-readable per-expected-finding recall report for the current run. |

`eval-report.json` records `selection.fixtureSource`,
`selection.sliceRoot` when `--slice-root` was used, `selection.caseFilters`,
and `selection.selectedCaseIds`. It also includes `metricGroups` for source
profile, language, and tag. Grouped metrics use the same deterministic metric
contract as the top-level report metrics.

Each case result also contains sanitized `expectedFindings` metadata so saved
reports can be analyzed later without the original fixture files. The metadata
contains expected index, category, severity, optional path/line range, match
mode, and semantic summary. It does not contain source snippets.

Case results also record `duplicateFindingIds`, sanitized duplicate summaries,
token totals, `costUsd`, and `costUnavailable`. Aggregate metrics include
`duplicateFindingCount`, `inputTokens`, `outputTokens`, and
`costUnavailableCount`. Duplicate findings are same-location repeats of matched
expected findings; they are visible as review noise but are not counted as false
positives.

Aggregate metrics also include the following tier-based and coverage metrics:

| Metric | Description |
| --- | --- |
| `recallByTier` | Recall per intent tier: `runtime-critical`, `security`, `logic`, `nit`. |
| `precisionByTier` | Precision mirrored per tier (same computation as `recallByTier`; admitted findings carry no expected-tier label so a precise per-tier precision is not derivable). |
| `productRecall` | Headline recall over the product tiers (`runtime-critical`, `security`, `logic`), excluding `nit`. This is the primary accuracy target. |
| `nitRecall` | Recall over `nit`-tier findings. Reported for visibility but not gated. |
| `suspicionStageCoverage` | Fraction of non-provider-error cases that produced at least one model suspicion. |
| `judgeCoverage` | When `judgeFindings` is enabled, judged candidates divided by actionable-promoted proofs. |

The `eval-summary.md` renders a `Recall by Tier` section showing per-tier recall
alongside the overall product recall headline.
When eval runs with `--semantic-judge`, accepted judge-backed matches include a
bounded `semanticReason` rationale and the Markdown summary renders those
reasons in a `Semantic Judge Matches` table. Deterministic matches omit this
field.
When case results include context ledger entries, the Markdown summary renders a
`Context Ledger Kinds` table with per-case context kind counts plus considered
and truncated counts.
Eval comparison Markdown renders `Context Ledger Kind Deltas` when either saved
report includes context ledger entries, showing base/head/delta counts by
context kind.
It also renders `Agentic Stage Deltas` when either saved report includes
agentic stage coverage, showing base/head/delta counts by stage.
The comparison metric table includes input-token and output-token deltas using
the aggregate saved report metrics.
It uses known/unavailable cost wording and renders unavailable-cost case deltas
so missing pricing metadata is not hidden as zero cost.
Agentic stage deltas omit zero/zero skipped stages and keep only stages with
activity in at least one compared report.
The comparison metric table also renders provider error and provider issue
deltas from aggregate saved report metrics without exposing raw provider
messages.
It includes proof-loop quality metric deltas from aggregate saved report metrics
so suspicion, proof, promotion, and refutation regressions remain visible.
It renders `Metric Group Deltas` for shared `sourceProfile` and `language`
groups, including fixture counts plus recall, precision, F1, and false-positive
deltas.
It also renders `Metric Group Proof-Loop Deltas` for the same groups, including
suspicion recall, proof recall, proof promotion precision, and refutation
false-positive/false-negative deltas.
It renders `Metric Group Resource Deltas` for the same groups, including
input-token, output-token, known-cost, and unavailable-cost case deltas.
It renders `Metric Group Coverage Deltas` from the union of shared
`sourceProfile` and `language` group names so new, removed, and fixture-count
changed segments are visible even when detailed group metrics are not
same-segment comparable.
