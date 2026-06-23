# Reports and Artifacts

Review runs write a structured set of artifacts under the configured artifact
directory so both humans and automation can consume results without relying on
stdout or logs.

Default artifact directory:

```text
.codereviewer/runs/<run-id>/
```

---

## Artifact files

| File | Format | Audience |
| --- | --- | --- |
| `report.json` | JSON | Automation, dashboards, regression checks. |
| `report.md` | Markdown | Humans reading local or CI artifacts. |
| `report.sarif` | SARIF | Code-scanning integrations. |
| `github-review-comments.json` | JSON | Local PR review-comment drafts (when enabled). |
| `run-summary.json` | JSON | Run metadata and status checks. |
| `context-ledger.json` | JSON | Redacted context coverage and inclusion audit. |
| `shared-context.json` | JSON | Compact shared entries, exact `taskEvents`, derived `currentTasks`, evidence references, internal candidates, and admission decisions. |
| `observability.json` | JSON | No-content run steps and task events. |
| `error.json` | JSON | Redacted error metadata for partial failed runs. |

---

## File details

### `observability.json`

Records pipeline step order. The `deterministic_signals` step records
support-signal counts and structural engine metadata when a parser is used. This
is no-content metadata — it does not store source snippets, prompt text, raw AST
nodes, or provider responses.

### `context-ledger.json`

Never stores source snippets or prompt text. Entries with reason
`task-context-source-chunk` show exact source chunks assigned to review tasks.

A completed `report.json` also includes a **coverage certificate**. If required
source cannot be fully assigned to review tasks, the run fails closed instead
of writing a successful report.

### `shared-context.json`

- `taskEvents` is an append-only history.
- `currentTasks` is the latest state per task ID.
- Task events can include worker IDs and sanitized terminal messages.

### `report.json` (provider-backed runs)

Includes review intents with compact verification questions, model suspicions,
investigation traces, proof packets, refutation results, optional judge results,
optional aggregate results, promotion decisions, and provider issues.

Key details:

- Model suspicions and judge results can include structured context requests
  recording the requested tool, path/query, and reason; legacy prose requests
  remain human-readable audit text.
- Investigation traces record bounded follow-up rounds when the investigator
  asks for more read/list/grep context before proving or refuting a suspicion.
- Identical structured retrieval requests in one pass are executed once before
  budget is spent, so reports may show one ledgered evidence item for repeated
  equivalent model requests.
- Investigation trace budgets show the configured read/search limits when
  mediated retrieval is active, and the trace-local reads/searches consumed.
- Judge results include the critic verdict, challenge questions, structured
  verification checks, and critic-cited evidence references from all bounded
  judge follow-up rounds.
- An evidence-less critic approval or rejection is recorded as
  `needs-more-evidence`. Empty judge evidence means the critic did not cite
  decisive evidence — proof evidence is not implicitly copied.
- Aggregate results record batch critic decisions for related proved findings
  when optional judging is enabled.
- Sibling sweep findings appear through the normal model suspicion,
  investigation trace, proof packet, and aggregate sections.

### `report.md`

Renders planner, proof, critic, and provider-degradation state so humans can
read the full evidence chain without opening raw JSON. Investigation, proof
packet, refutation, aggregate, and judge sections show trace budgets,
tool-call summaries, cited evidence IDs, or `none cited` for investigation,
proof, and critic evidence fields (including contradiction checks, refutation
checks, similar-issue checks, and verification checks).

### `report.sarif`

Keeps actionable findings as results and writes provider issues into run
properties as redacted metadata, so provider degradation is visible without
creating code-scanning alerts. Artifact-only findings remain in JSON and
Markdown audit sections but are not rendered as SARIF results or rules.

### `github-review-comments.json`

Rendered only when `reporting.formats` includes `"github-review-comments"`.
Contains local PR review-comment drafts for admitted inline findings on
new-side lines.

Eligibility rules:

- Severity must be at or above `review.inlineSeverityThreshold` (default `high`).
- Admission validates line ranges against reviewed source content before the
  renderer creates drafts.
- For diff-backed runs, the finding line must overlap a changed new-side diff
  hunk.

Each entry includes path, new-side line anchor, redacted body, finding ID,
severity, and category. A `suggestion` block is included when a single
structured fix edit maps exactly to the rendered comment range.

> **Note:** The CLI does not publish these comments or perform network requests.
> Your CI pipeline is responsible for posting them.

---

## Partial-failure artifacts

Provider task failures that happen after review context has been assembled still
write partial artifacts. In that case `report.json`, Markdown, and SARIF may be
absent, but the following are written and `stderr` includes `artifactDir`:

- `run-summary.json`
- `context-ledger.json`
- `shared-context.json`
- `observability.json`
- `error.json`

Provider-call retries are owned by the harness model retry policy on the model
alias. Deterministic support-signal tasks use the same queue state model without
provider calls.

> **Note:** Provider-backed review tasks do not create persistent durable
> databases, session directories, or workspace directories. Session and runtime
> state stay in memory; run state intended for users and automation is written to
> the JSON artifacts above.

---

## Report principles

| Principle | Behavior |
| --- | --- |
| Evidence-backed findings | Findings reference evidence IDs, not inline source snippets. |
| Redaction by default | Raw source snippets are not required in reports. |
| Stable exit behavior | Quality gates map to deterministic exit codes. |
| Machine-readable first | JSON and SARIF support automation without parsing human text. |

---

## Evaluation artifacts

Evaluation runs write a separate set of artifacts under `.codereviewer/eval/`.
See [Evaluation](../evaluation/README.md) for the full evaluation workflow and
artifact schema.

---

## Related docs

- [Evaluation](../evaluation/README.md) — evaluation artifacts and comparison
  commands.
- [Configuration guide](configuration.md) — `reporting.formats`,
  `paths.artifactDir`, and `review.inlineSeverityThreshold`.
- [Architecture](../concepts/architecture.md) — step 13 (Reporting) and the
  admission/quality-gate steps that determine what reaches a report.
- [Artifacts reference](../reference/artifacts.md) — full artifact schema
  reference.
