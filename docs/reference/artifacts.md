# Artifact Reference

## Review Artifacts

Default directory:

```text
.review/runs/<run-id>/
```

| File | Description |
| --- | --- |
| `report.json` | Full structured report. |
| `report.md` | Human-readable report. |
| `report.sarif` | SARIF report. |
| `github-review-comments.json` | Local GitHub PR review-comment draft array, when enabled. |
| `run-summary.json` | Run metadata. |
| `context-ledger.json` | Redacted ledger of context items considered and included source chunks. |
| `shared-context.json` | Run snapshot with compact shared entries, exact `taskEvents`, derived `currentTasks`, evidence, candidates, and admission decisions. |
| `observability.json` | No-content event trace with run steps and task events. |
| `error.json` | Redacted normalized error for partial failed runs. |

`observability.json` step events describe the implemented review pipeline. The
`language_analysis` step includes safe structural-analysis attributes:
`structuralEngine`, `astGrepVersion`, `factCount`, `evidenceCount`,
`languageCount`, and `testMappingCount`. These fields are counts and version
metadata only.

`context-ledger.json` is content-free. It records paths, hashes when content was
read, byte counts, decisions, reasons, and task IDs. Source entries with reason
`task-context-source-chunk` prove which task reviewed each source chunk. A
completed `report.json` includes a `coverage` object; successful completed
reviews require `coverage.status` to be `complete`.

`report.json` exists for completed review runs. Markdown, SARIF, and GitHub
review-comment drafts are written when enabled in `reporting.formats`. The
`artifacts` array inside `report.json` lists the non-JSON report artifacts
written for the run; it does not include a hash of itself.

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
Terminal task events may include `attempts` so CI can distinguish first-try
completion from retry exhaustion without reading provider output.
`taskEvents` is append-only history; `currentTasks` contains the latest state
per task ID. `tasks` is retained as a compatibility alias for append-only task
events.

Review runs are stateless and one-shot. A partial provider-backed failure writes
the run-summary, context-ledger, shared-context, observability, and `error.json`
artifacts for inspection; rerun the command to review again from scratch. The
review runtime keeps all session and task state in memory and never creates
persistent durable databases, session directories, or workspace directories.

## Evaluation Artifacts

Default directory:

```text
.review/eval/
```

| File | Description |
| --- | --- |
| `eval-report.json` | Evaluation selection metadata, aggregate metrics, grouped metrics, and case results. |
| `eval-summary.md` | Human-readable evaluation selection, grouped metrics, case table, and failure details. |
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
