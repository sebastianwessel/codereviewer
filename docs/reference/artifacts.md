# Artifact Reference

Reference for every file written by the CodeReviewer CLI. All paths are
relative to `paths.artifactDir` (default `.codereviewer/`) unless noted.
Review runs are stateless and one-shot: nothing is persisted beyond the
redacted run artifacts listed here.

See [Reports and Artifacts guide](../guides/reports-and-artifacts.md) for
how to read and use these files.

---

## Review artifacts

Written to:

```text
.codereviewer/runs/<run-id>/
```

### File listing

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

### `report.json`

`report.json` exists for completed review runs. The `artifacts` array inside
lists the non-JSON report artifacts written for the run; it does not include a
hash of itself.

A completed `report.json` includes a `coverage` object; successful completed
reviews require `coverage.status` to be `complete`.

**Provider-backed runs** include the full proof-loop state:

- Review intents with compact verification questions
- Model suspicions (including structured context requests when the finding agent
  needs bounded read/list/grep follow-up)
- Investigation traces — whether the suspicion became a proof, was refuted,
  needed more evidence, or hit a recovered provider issue; the trace budget
  shows rounds allowed and used; when mediated context retrieval is active it
  also shows the configured read/search limits and reads/searches consumed
- Proof packets
- Refutation results
- Optional aggregate results — batch critic decisions across related proved
  findings; evidence references are only the IDs explicitly cited by the batch
  critic; an evidence-less approval or rejection is recorded as
  `needs-more-evidence`
- Optional judge results — challenge questions, structured verification checks,
  structured context requests, and any bounded prose context the critic used
  before the final verdict; evidence references are only the IDs explicitly
  cited by the critic; an empty list means the critic did not cite decisive
  evidence; an evidence-less approval or rejection is recorded as
  `needs-more-evidence`
- Promotion decisions
- Provider issues

JSON remains the structured source of truth for full evidence arrays and
verification checks.

### `context-ledger.json`

Content-free. Records paths, hashes when content was read, byte counts,
decisions, reasons, and task IDs. Source entries with reason
`task-context-source-chunk` prove which task reviewed each source chunk.

Context ledger entries are collapsed by stable ledger ID before report output,
so reused context retrieval artifacts keep one ledger record with many
references instead of repeated rows. Investigation context reads are traced
through this file. Mediated read/list/grep entries use the `tool-result` ledger
kind.

### `observability.json`

No-content event trace. The `deterministic_signals` step includes safe
support-signal attributes such as structural engine name/version, signal count,
evidence count, supported extension count, and skipped unsupported path count.
These fields are counts and version metadata only.

### `report.md`

Markdown renders investigation trace budgets and tool-call summaries, proof
packet evidence and proof fields, refutation summaries, refutation evidence,
refutation check evidence, aggregate result evidence, aggregate decision
evidence, aggregate similar-issue check evidence, judge result evidence, and
judge verification-check evidence as cited IDs or `none cited`.

### `report.sarif`

SARIF renders provider issues in run-level properties instead of diagnostic
results, so code-scanning consumers can inspect provider degradation without
creating code alerts. SARIF also excludes artifact-only findings from
diagnostic results and rule definitions; use JSON or Markdown for those audit
diagnostics.

### `github-review-comments.json`

A local artifact only — it does not publish comments. Each entry contains:

- Repository-relative path
- New-side line anchor
- Redacted body
- Source finding ID
- Severity
- Category
- Optional GitHub suggestion block (when a single safe fix edit maps to the
  same line range)

Review-comment drafts are emitted only for findings whose new-side line range
was validated against reviewed source content during admission and, for
diff-backed runs, overlaps a changed new-side diff hunk.

### Partial-failure artifacts

If a provider task fails after task execution starts, the CLI writes these
partial artifacts instead of a full report:

```text
run-summary.json
context-ledger.json
shared-context.json
observability.json
error.json
```

The shared context contains completed and failed task events with sanitized
messages. `taskEvents` is append-only history; `currentTasks` contains the
latest state per task ID.

Provider-call retries are handled by the Harness model retry policy before the
workflow records a terminal task event. Rerun the `review` command to start
again from scratch.

---

### Cross-run notes

- Markdown, SARIF, and GitHub review-comment drafts are written only when
  enabled in `reporting.formats`.
- Weak, refuted, or provider-error model output is visible to humans but is not
  included in quality-gate counts or review-comment drafts unless promoted as
  actionable.
- Exact duplicate provider issue records are collapsed before report output;
  distinct provider stages, recovery states, or messages remain visible.
- When optional judging is enabled, sibling sweep suspicions may create
  additional model suspicions and proof packets for the same repeated pattern in
  other changed ranges; they are not a separate artifact type.
- The review runtime keeps all session and task state in memory and never
  creates persistent durable databases, session directories, or workspace
  directories.

---

## Evaluation artifacts

Written to:

```text
.codereviewer/eval/
```

### File listing

| File | Description |
| --- | --- |
| `eval-report.json` | Evaluation selection metadata, aggregate metrics, grouped metrics, case results, context ledger kind summaries, provider issues, and artifact-derived agentic stage coverage. |
| `eval-summary.md` | Human-readable evaluation selection, grouped metrics, case table, context ledger kind coverage, agentic stage coverage, and failure details. |
| `eval-recall-report.md` | Human-readable per-expected-finding recall report for the current run. |

### `eval-report.json`

Records:

- `selection.fixtureSource`
- `selection.sliceRoot` (when `--slice-root` was used)
- `selection.caseFilters`
- `selection.selectedCaseIds`
- `metricGroups` for source profile, language, and tag — grouped metrics use
  the same deterministic metric contract as top-level report metrics

Each case result contains sanitized `expectedFindings` metadata (expected
index, category, severity, optional path/line range, match mode, and semantic
summary — no source snippets) so saved reports can be analyzed later without
the original fixture files.

Case results also record `duplicateFindingIds`, sanitized duplicate summaries,
token totals, `costUsd`, and `costUnavailable`. Duplicate findings are
same-location repeats of matched expected findings; they are visible as review
noise but are not counted as false positives.

### Aggregate metrics

| Metric | Description |
| --- | --- |
| `recallByTier` | Recall per intent tier: `runtime-critical`, `security`, `logic`, `nit`. |
| `precisionByTier` | Precision mirrored per tier (same computation as `recallByTier`; admitted findings carry no expected-tier label so precise per-tier precision is not derivable). |
| `productRecall` | Headline recall over `runtime-critical`, `security`, and `logic` tiers, excluding `nit`. This is the primary accuracy target. |
| `nitRecall` | Recall over `nit`-tier findings. Reported for visibility but not gated. |
| `suspicionStageCoverage` | Fraction of non-provider-error cases that produced at least one model suspicion. |
| `judgeCoverage` | When `judgeFindings` is enabled, judged candidates divided by actionable-promoted proofs. |
| `duplicateFindingCount` | Total duplicate findings across all cases. |
| `inputTokens` | Aggregate input token total. |
| `outputTokens` | Aggregate output token total. |
| `costUnavailableCount` | Cases where cost could not be computed. |

### Eval regression gate

The optional threshold fields below are configured via CLI flags on
`eval run`. When unset, the corresponding gate check is skipped.

| Threshold field | Gate behavior |
| --- | --- |
| `minProductRecall` | Fails if `productRecall` is below the configured value. |
| `minSuspicionStageCoverage` | Fails if `suspicionStageCoverage` is below the configured value. |
| `minJudgeCoverage` | Fails if `judgeCoverage` is below the configured value (only enforced when `judgeFindings` is enabled). |

### `eval-summary.md`

Renders a `Recall by Tier` section showing per-tier recall alongside the
overall product recall headline.

- When eval runs with `--semantic-judge`, accepted judge-backed matches include
  a bounded `semanticReason` rationale and the Markdown renders those reasons
  in a `Semantic Judge Matches` table. Deterministic matches omit this field.
- When case results include context ledger entries, renders a
  `Context Ledger Kinds` table with per-case context kind counts plus
  considered and truncated counts.

### Eval comparison output

`eval compare` Markdown renders:

- `Context Ledger Kind Deltas` when either saved report includes context ledger
  entries — base/head/delta counts by context kind.
- `Agentic Stage Deltas` when either saved report includes agentic stage
  coverage — base/head/delta counts by stage; zero/zero skipped stages are
  omitted.
- Input-token and output-token deltas using aggregate saved report metrics.
- Known/unavailable cost wording; unavailable-cost case deltas so missing
  pricing metadata is not hidden as zero cost.
- Provider error and provider issue deltas from aggregate saved report metrics
  without exposing raw provider messages.
- Proof-loop quality metric deltas (suspicion, proof, promotion, refutation
  regressions).
- `Metric Group Deltas` for shared `sourceProfile` and `language` groups —
  fixture counts plus recall, precision, F1, and false-positive deltas.
- `Metric Group Proof-Loop Deltas` for the same groups — suspicion recall,
  proof recall, proof promotion precision, and refutation
  false-positive/false-negative deltas.
- `Metric Group Resource Deltas` for the same groups — input-token,
  output-token, known-cost, and unavailable-cost case deltas.
- `Metric Group Coverage Deltas` from the union of shared `sourceProfile` and
  `language` group names so new, removed, and fixture-count-changed segments
  are visible even when detailed group metrics are not same-segment comparable.
