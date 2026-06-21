# Reports And Artifacts

Review runs write artifacts under the configured artifact directory.

Default:

```text
.review/runs/<run-id>/
```

## Files

| File | Format | Audience |
| --- | --- | --- |
| `report.json` | JSON | Automation, dashboards, regression checks. |
| `report.md` | Markdown | Humans reading local or CI artifacts. |
| `report.sarif` | SARIF | Code scanning integrations. |
| `run-summary.json` | JSON | Run metadata and status checks. |
| `context-ledger.json` | JSON | Redacted context coverage and inclusion audit. |
| `shared-context.json` | JSON | Compact shared entries, exact `taskEvents`, derived `currentTasks`, evidence references, candidates, and admission decisions. |
| `observability.json` | JSON | No-content run steps and task events. |
| `error.json` | JSON | Redacted error metadata for partial failed runs. |

`context-ledger.json` never stores source snippets or prompt text. Entries with
reason `task-context-source-chunk` show exact source chunks assigned to review
tasks. A completed `report.json` also includes a coverage certificate; if
required source cannot be fully assigned to review tasks, the run fails closed
instead of writing a successful report.

Provider task failures that happen after review context has been assembled still
write partial artifacts. In that case `report.json`, Markdown, and SARIF may be
absent, but `run-summary.json`, `context-ledger.json`, `shared-context.json`,
`observability.json`, and `error.json` are written and stderr includes
`artifactDir`.
In `shared-context.json`, `taskEvents` is append-only history and
`currentTasks` is the latest state per task ID.

Provider-backed review tasks do not create persistent durable databases,
session directories, or workspace directories. Session and runtime state stay in
memory; run state intended for users and automation is written to the JSON
artifacts above.

## Report Principles

| Principle | Behavior |
| --- | --- |
| Evidence-backed findings | Findings reference evidence IDs. |
| Redaction by default | Raw source snippets are not required in reports. |
| Stable exit behavior | Quality gates map to deterministic exit codes. |
| Machine-readable first | JSON and SARIF support automation. |
