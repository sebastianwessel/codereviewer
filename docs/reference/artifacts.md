# Artifact Reference

Reference for every file written by the CodeReviewer CLI. All paths are
relative to `paths.artifactDir` (default `.codereviewer/`) unless noted.
Each review run is self-contained: a run never reads another run's results.
The only cross-run state is the run index described below, which records where
each run wrote its artifacts, and the baseline file you generate explicitly
with `codereviewer baseline write`.

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
| `run-summary.json` | Run metadata, including `baseRef`, `headRef`, and the `mergeBaseRef` the diff was actually taken against. |
| `context-ledger.json` | Redacted ledger of context items considered and included source chunks. |
| `shared-context.json` | Run snapshot with compact shared entries, exact `taskEvents`, derived `currentTasks`, evidence, internal candidates, and admission decisions. |
| `observability.json` | No-content event trace with run steps and task events. |
| `verification-report.json` | Claim verdicts from the agentic verification flow, when `verification.enabled`. |
| `error.json` | Redacted normalized error for partial failed runs. |

---

## Run index

Written to:

```text
.codereviewer/runs/index.json
```

Records where each run wrote its artifacts, so tooling can find the newest
report without enumerating run directories. Newest entry first, capped at 50
entries; trimming the index never deletes a run directory.

| Field | Description |
| --- | --- |
| `runId` | Matches the run directory name. |
| `startedAt` | Run start timestamp. |
| `completedAt` | Present when the run finished. |
| `status` | `completed` or `failed`. |
| `reportPath` | Repository-relative path to `report.json`, when one was written. |

A corrupt or unreadable index is replaced on the next run. Failing to record a
run never fails a review that already produced its artifacts.

---

## Baseline file

Written to `baseline.path` (default `.codereviewer/baseline.json`) by
`codereviewer baseline write`. **The `review` command never writes it**, so a
review cannot suppress its own findings.

The file is an array of entries holding fingerprints only — no titles, paths,
severities, or timestamps — so it discloses no source content and is safe to
commit.

### `report.json`

`report.json` exists for completed review runs. The `artifacts` array inside
lists the non-JSON report artifacts written for the run; it does not include a
hash of itself.

A completed `report.json` includes a `coverage` object; successful completed
reviews require `coverage.status` to be `complete`.

**Provider-backed runs** include the full refutation + admission state:

- Refutation results — the `proved` / `refuted` / `needs-more-evidence` verdict
  for each candidate, with the deciding rationale summary and cited evidence IDs
- Admitted findings, rejected findings, and evidence records
- Provider issues

The candidate findings emitted by holistic discovery and the admission decisions
are recorded in `shared-context.json` (see below).

JSON remains the structured source of truth for full evidence arrays and
refutation results.

### `context-ledger.json`

Content-free. Records paths, hashes when content was read, byte counts,
decisions, reasons, and task IDs. Source entries with reason
`task-context-source-chunk` prove which task reviewed each source chunk.

Context ledger entries are collapsed by stable ledger ID before report output,
so reused context retrieval artifacts keep one ledger record with many
references instead of repeated rows. Mediated read/list/grep entries use the
`tool-result` ledger kind.

### `observability.json`

No-content event trace. The `deterministic_signals` step includes safe
support-signal attributes such as structural engine name/version, signal count,
evidence count, supported extension count, and skipped unsupported path count.
These fields are counts and version metadata only.

### `verification-report.json`

Written only when `verification.enabled`. Content-free beyond verdict data: an
array of claim verdicts (`confirmed` / `refuted` / `uncertain`, with a redacted
rationale and cited evidence IDs), per-claim no-content observations (claim kind,
source label, tool-call count, bytes read, verdict status, duration), any
non-fatal run warnings, the claim count, and `corroborations` — general-review
findings independently confirmed by a verdict (finding id, a `corroborated`
confidence signal, match kinds, and witnessing claim ids). Corroboration raises
confidence only; it never changes a finding's severity or the defect report.
Verdicts are a separate lane and never enter the quality gate. A failed claim
provider also surfaces as a run warning in `run-summary.json`. See
[Agentic Verification Flow](../concepts/verification-flow.md).

### `report.md`

Markdown renders candidate findings, refutation summaries, refutation evidence,
and refutation check evidence as cited IDs or `none cited`.

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
- Refuted, needs-more-evidence, or provider-error model output is visible to
  humans but is not included in quality-gate counts or review-comment drafts
  unless admitted as actionable.
- Exact duplicate provider issue records are collapsed before report output;
  distinct provider stages, recovery states, or messages remain visible.
- The review runtime keeps all session and task state in memory and never
  creates persistent durable databases, session directories, or workspace
  directories.

---

## Evaluation artifacts

Evaluation is a from-source dev/benchmark workflow with its own artifacts under
`.codereviewer/eval/`. See [Evaluation](../evaluation/README.md) for the full
artifact schema, aggregate metrics, regression gate, and comparison output.
