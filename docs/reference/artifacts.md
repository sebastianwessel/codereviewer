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
| `run-summary.json` | Run metadata. |
| `context-ledger.json` | Redacted ledger of context items considered and included source chunks. |
| `shared-context.json` | Run snapshot with compact shared entries, exact `taskEvents`, derived `currentTasks`, evidence, candidates, and admission decisions. |
| `observability.json` | No-content event trace with run steps and task events. |
| `error.json` | Redacted normalized error for partial failed runs. |

`context-ledger.json` is content-free. It records paths, hashes when content was
read, byte counts, decisions, reasons, and task IDs. Source entries with reason
`task-context-source-chunk` prove which task reviewed each source chunk. A
completed `report.json` includes a `coverage` object; successful completed
reviews require `coverage.status` to be `complete`.

`report.json` exists for completed review runs. Markdown and SARIF are written
when enabled in `reporting.formats`. The `artifacts` array inside `report.json`
lists the non-JSON report artifacts written for the run; it does not include a
hash of itself.

If a provider task fails after task execution starts, the CLI writes partial
artifacts instead of a report: `run-summary.json`, `context-ledger.json`,
`shared-context.json`, `observability.json`, and `error.json`. The shared
context contains completed and failed task events with sanitized messages.
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
| `eval-report.json` | Evaluation metrics and case results. |
| `eval-summary.md` | Human-readable evaluation summary for local review and run comparison. |
