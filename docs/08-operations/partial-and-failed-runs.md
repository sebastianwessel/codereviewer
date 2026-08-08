# Partial and Failed Runs

A run that dies partway through does not vanish. When the failure happens after
the run has produced state worth keeping, the engine writes a **partial
artifact set** and records the run as `failed` in the run index, so you can see
how far it got and why it stopped.

---

## Three different outcomes

| Outcome | Exit code | Artifacts |
| --- | --- | --- |
| Completed, gate passed | `0` | Full artifact set |
| Completed, gate failed | `1` | Full artifact set (`qualityGate.passed: false`) |
| Completed, gate result absent | `5` | Full artifact set, `quality_gate_missing` on stderr — see below |
| Failed | `1`–`5` depending on category | Partial set with `error.json`, **or** nothing at all — see below |

A gate failure is a **completed run**, not a failure. It produces the same
reports as a passing run.

`quality_gate_missing` is the third row's whole story: every completed run
evaluates its gate, so a completed report carrying none is an internal
inconsistency. The CLI used to summarize that absence as
`qualityGatePassed: true` at exit `0` — absence read as clearance, on the one
surface a pipeline branches on. It now fails at exit `5` **after** the artifacts
are written and the run is indexed as completed, so the run directory is the
evidence for the bug report.

---

## Degradation before failure

Several classes of trouble never fail the run at all. They are recorded in
`report.json` under `providerIssues`, so the degradation is visible rather than
silent.

**`recovered` means a retry succeeded, not "the run kept going".** A call that
failed and whose work was dropped records `recovered: false`, because something
the review was supposed to do did not happen. An issue with no `recovered` field
is read as unrecovered.

| Situation | `recovered` | Behavior |
| --- | --- | --- |
| A refutation call fails (packet or provider error) | `false` | Every candidate of that task is recorded as `needs-more-evidence` with reason `provider-error` — rejected unadjudicated. The run continues. |
| A refutation batch exceeds the provider input budget | no issue recorded | The batch splits in half and each half retries; a retry that succeeds is not a degradation. Only a single candidate that still does not fit becomes a packet failure. |
| A discovery call hits the agent-loop budget, returns malformed structured JSON, or fails output validation | `false` | That call contributes no findings. The run continues. |
| A semantic merge call fails | `false` | Its file is left ungrouped; every candidate survives. The run continues. |
| A change-intent provider fails, or produces nothing | — (a run warning, not a provider issue) | The review proceeds without the brief. |
| The model summarizer fails | — | The stage falls back to the deterministic digest summary. |
| A verification claim runs out of tool-call budget | — | The claim ends with an `uncertain` verdict. |
| A file is larger than `review.maxFileBytes` | — | It is skipped and listed in `skippedFiles`. |

**An unrecovered provider issue fails the quality gate on its own**, under the
default `qualityGate.failOnProviderError: true`. That is exit `1` with an
**empty** `failingFindingIds`: there is no finding to name, because the failure
is that findings are missing. Before this was enforced, an outage shrank the set
the gate measured — so a change was *more* likely to clear the gate during a
provider failure than on a healthy run. Set `failOnProviderError: false` to turn
the check off; it changes nothing else.

Always read `providerIssues` and `run.warnings` before concluding a clean run
was a thorough one.

---

## What produces a partial artifact set

A partial set is written when the failure carries run state — that is, once
task execution has begun or admission has completed:

| Failure | Code | Exit |
| --- | --- | --- |
| A review task threw an unrecoverable error | The normalized provider code (`provider_auth`, `provider_context_length`, `provider_error`, …) | `4` |
| Coverage was incomplete after admission | `coverage_incomplete` | `1` |
| The cost budget was exceeded | `cost_budget_exceeded` | `1` |

The first task failure stops the queue: in-flight tasks finish, no new task is
claimed, and the results collected so far are preserved in the partial state.

`run.warnings` on a partial run includes `partial-run`.

### What a partial set contains

```
<artifactDir>/<runId>/run-summary.json
<artifactDir>/<runId>/context-ledger.json
<artifactDir>/<runId>/shared-context.json
<artifactDir>/<runId>/observability.json
<artifactDir>/<runId>/error.json
```

There is deliberately **no** `report.json`, `report.md` or `report.sarif`. A
run that did not complete admission has no report to stand behind, and emitting
one would invite a pipeline to treat an aborted review as a clean bill of
health.

### `error.json`

```json
{
  "code": "provider_context_length",
  "message": "…",
  "category": "provider",
  "recoverable": true
}
```

Four fields only, all normalized and redacted. No stack trace, no raw provider
message, no source.

Stderr for the same run carries the code, the message and the `artifactDir`, so
a pipeline can locate the directory without parsing the filesystem.

---

## What produces no artifacts at all

Failures **before** the run has state produce a stderr error and nothing on
disk:

| Failure | Code | Exit |
| --- | --- | --- |
| Bad command or flag | `usage_error` | `2` |
| Invalid configuration | `config_error` | `2` |
| Provider setup problem | `provider_adapter_missing`, `provider_credentials_missing`, `provider_base_url_missing`, `provider_adapter_invalid` | `2` |
| Hard drift findings block the run | `drift_gate_failed` | `1` |
| Git or filesystem intake failure | `merge_base_unavailable`, `no_reviewable_change`, `repository_error`, `repository_timeout` | `3` |
| Instruction or skill path denied | `instruction_read_denied`, `skill_read_denied` | `2` |

The drift gate runs as the **first** preflight step, before intake, so a
blocked run has produced nothing to write.

---

## The run index

`<artifactDir>/index.json` is the only enumeration of runs. Run directories are
otherwise opaque.

```json
{
  "runs": [
    { "runId": "…", "startedAt": "…", "completedAt": "…", "status": "completed", "reportPath": ".codereviewer/runs/…/report.json" },
    { "runId": "…", "startedAt": "…", "status": "failed" }
  ]
}
```

- A completed run records `status: "completed"` and a `reportPath`.
- A partial run records `status: "failed"` and no `reportPath`.
- The index keeps at most 50 entries.
- Index maintenance is **best-effort bookkeeping**: a failure to update it never
  fails a review whose own artifacts are already durable. A missing or corrupt
  index therefore means "cannot enumerate", not "the run did not happen".

`baseline write` reads this index to find the newest run with a report, which
is why it cannot build a baseline from a partial run.

---

## Reading a partial run

Start with the error:

```bash
cat .codereviewer/runs/<runId>/error.json
```

See how far the run got — which tasks were planned, running, completed or
failed, and which candidates and verdicts existed at the time:

```bash
cat .codereviewer/runs/<runId>/shared-context.json
```

See what had been assembled for the provider, and what was skipped or
truncated:

```bash
cat .codereviewer/runs/<runId>/context-ledger.json
```

See timings, warnings and token/cost totals for the aborted run:

```bash
cat .codereviewer/runs/<runId>/run-summary.json
```

Failed-task messages in `shared-context.json` use stable sanitized strings.
They never carry raw provider messages or tool output.

---

## Recovering

| Cause | Action |
| --- | --- |
| `provider_rate_limited` | Re-run. Lower `review.maxConcurrentTasks`, or raise `provider.retryMaxDelayMs`. |
| `provider_context_length` | Narrow the scope (`paths.include`, `paths.exclude`, a smaller ref range), or set `review.contextMaxBytes`. **Not `review.depth`** — it does not bound the packet, only the mediated retrieval budget. |
| `provider_auth` | Fix the credential; not retried by design. |
| `coverage_incomplete` | Check `skippedFiles` and `paths.exclude`; something reviewable was not assigned to a task. |
| `cost_budget_exceeded` | Raise `review.maxCostUsd`, or reduce scope and optional passes. |

Re-running produces a **new run id and a new directory**. Nothing is
overwritten, so a partial run stays available as evidence.

---

## CI guidance

- Upload the whole `<artifactDir>` directory with an `always()`-style
  condition. Partial artifacts are the only record of what went wrong.
- Branch on the exit code, not on the presence of `report.json`. A partial run
  has no report by design.
- Treat exit `4` as retryable and exit `2` as fail-fast.
- Do not build or refresh a baseline from a failed run — `baseline write` will
  correctly refuse with `baseline_source_unavailable`.

More: [ci-cd.md](../04-guides/ci-cd.md),
[troubleshooting.md](troubleshooting.md),
[artifacts.md](../06-reference/artifacts.md).
