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
| `github-review-comments.json` | JSON | Local PR review-comment drafts when enabled. |
| `run-summary.json` | JSON | Run metadata and status checks. |
| `context-ledger.json` | JSON | Redacted context coverage and inclusion audit. |
| `shared-context.json` | JSON | Compact shared entries, exact `taskEvents`, derived `currentTasks`, evidence references, candidates, and admission decisions. |
| `observability.json` | JSON | No-content run steps and task events. |
| `error.json` | JSON | Redacted error metadata for partial failed runs. |

`observability.json` includes the pipeline step order. The `language_analysis`
step records structural engine metadata, ast-grep version, fact count, evidence
count, language count, and test-mapping count. This is no-content metadata; it
does not store source snippets, prompt text, raw AST nodes, or provider
responses.

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
Task events can include worker IDs and terminal attempt counts. Provider-backed
tasks use bounded queue-owned retries for transient failures; deterministic
analyzer tasks use the same queue state model without provider calls.

Provider-backed review tasks do not create persistent durable databases,
session directories, or workspace directories. Session and runtime state stay in
memory; run state intended for users and automation is written to the JSON
artifacts above.

`github-review-comments.json` is rendered only when
`reporting.formats` includes `github-review-comments`. It contains local
GitHub review-comment drafts for admitted inline findings on new-side lines.
Admission validates those line ranges against reviewed source content before
the renderer can create drafts. For diff-backed runs, inline eligibility also
requires the finding line to overlap a changed new-side diff hunk.
The artifact can include a GitHub suggestion block when a single structured fix
edit maps exactly to the rendered comment range. The CLI does not publish these
comments or perform network requests.

## Report Principles

| Principle | Behavior |
| --- | --- |
| Evidence-backed findings | Findings reference evidence IDs. |
| Redaction by default | Raw source snippets are not required in reports. |
| Stable exit behavior | Quality gates map to deterministic exit codes. |
| Machine-readable first | JSON and SARIF support automation. |

## Evaluation Artifacts

Evaluation runs write `.review/eval/eval-report.json` and
`.review/eval/eval-summary.md` plus `.review/eval/eval-recall-report.md`. The
JSON report records the fixture source, optional slice root, exact case
filters, selected case IDs, aggregate metrics, grouped metrics by source
profile/language/tag, and sanitized expected-finding metadata. The Markdown
summary renders the selection plus source-profile and language groups for quick
local comparison. The recall report lists each expected finding with detection
rate and run marks.
