# Reports And Artifacts

Review runs write artifacts under the configured artifact directory.

Default:

```text
.codereviewer/runs/<run-id>/
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
| `shared-context.json` | JSON | Compact shared entries, exact `taskEvents`, derived `currentTasks`, evidence references, internal candidates, and admission decisions. |
| `observability.json` | JSON | No-content run steps and task events. |
| `error.json` | JSON | Redacted error metadata for partial failed runs. |

`observability.json` includes the pipeline step order. The
`deterministic_signals` step records support-signal counts and structural engine
metadata when a parser is used. This is no-content metadata; it does not store
source snippets, prompt text, raw AST nodes, or provider responses.

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
Task events can include worker IDs and sanitized terminal messages.
Provider-call retries are owned by the Harness model retry policy on the model
alias; deterministic support-signal tasks use the same queue state model
without provider calls.

Provider-backed review tasks do not create persistent durable databases,
session directories, or workspace directories. Session and runtime state stay in
memory; run state intended for users and automation is written to the JSON
artifacts above.

Provider-backed `report.json` includes review intents with compact verification
questions, model suspicions,
investigation traces, proof packets, refutation results, optional judge
results, optional aggregate results, promotion decisions, and provider issues. Model suspicions and judge results can include structured
context requests that record the requested tool, path/query, and reason; legacy
prose requests remain human-readable audit text. Investigation traces record
bounded follow-up rounds when the investigator asks for more read/list/grep
context before proving or refuting a suspicion. Identical structured retrieval
requests in one pass are executed once before budget is spent, so reports may
show one ledgered evidence item for repeated equivalent model requests.
Investigation trace budgets show the configured read/search limits when
mediated retrieval is active and the trace-local reads/searches consumed. Judge
results also include the
critic verdict, challenge questions, structured verification checks, and
critic-cited evidence references from all bounded judge follow-up rounds.
Empty judge evidence means the critic did not cite decisive evidence rather than
that proof evidence was implicitly copied; an evidence-less critic approval or
rejection is recorded as `needs-more-evidence`. Aggregate results record batch
critic decisions for related proved findings when optional judging is enabled;
evidence-less aggregate result approvals and per-candidate approvals or
rejections are also recorded as `needs-more-evidence` instead of inheriting
proof evidence. Sibling sweep
findings are shown through the normal model suspicion, investigation trace,
proof packet, and aggregate sections. Markdown renders these sections so humans
can see planner, proof, critic, and provider-degradation state without reading
logs. Investigation, proof packet, refutation, aggregate, and judge Markdown
sections show trace budgets, tool-call summaries, cited evidence IDs, or
`none cited` for investigation, proof, and critic evidence fields, including
contradiction checks, refutation checks, similar-issue checks, and verification
checks. When the runtime retrieves follow-up context, the retrieved entries are recorded in
`context-ledger.json` and represented as evidence references rather than raw
source in reports. SARIF keeps actionable findings as results and writes
provider issues into run properties as redacted metadata, so provider
degradation is visible without creating code-scanning alerts. Artifact-only
findings remain in JSON and Markdown audit sections, but they are not rendered
as SARIF results or rules.

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

Evaluation runs write `.codereviewer/eval/eval-report.json` and
`.codereviewer/eval/eval-summary.md` plus `.codereviewer/eval/eval-recall-report.md`. The
JSON report records the fixture source, optional slice root, exact case
filters, selected case IDs, aggregate metrics, grouped metrics by source
profile/language/tag, and sanitized expected-finding metadata. The Markdown
summary renders the selection plus source-profile and language groups for quick
local comparison. The recall report lists each expected finding with detection
rate and run marks.
