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

Evaluation is a from-source dev/benchmark workflow with its own artifacts under
`.codereviewer/eval/`. See [Evaluation](../evaluation/README.md) for the full
artifact schema, aggregate metrics, regression gate, and comparison output.
