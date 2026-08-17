# Exit Codes and Error Codes

Canonical table for every process exit code and every structured error code.
This is the single place these are listed.

Errors are printed to **stderr** as one JSON object:

```json cli-error
{ "code": "provider_auth", "message": "…" }
```

`review` adds `"artifactDir"` when a partial run wrote artifacts before failing.
Messages are redacted; validation messages list `path: rule` pairs only and
never echo submitted values.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Run completed; quality gate passed or no gate configured. |
| `1` | Run completed; a gate failed (quality gate, drift gate, coverage, cost budget, or the eval regression gate). The quality gate also fails on an unrecovered provider issue, with an empty `failingFindingIds`. |
| `2` | Config, provider setup, credentials, path, or CLI usage error. |
| `3` | Repository intake or filesystem error. |
| `4` | Provider/model runtime error, or an input the engine refused to process in part rather than whole. |
| `5` | Internal invariant violation (admission, report rendering, unknown failure). |

Exit `1` is a **completion signal, not a crash**: artifacts are complete and the
report is valid.

## Category → exit code / recoverability

Every structured error carries a category. The category supplies the **default**
exit code below, which is what the error normalizer assigns when it classifies a
raw thrown value:

| Category | Default exit code | Recoverable |
| --- | --- | --- |
| `config` | `2` | yes |
| `repository` | `3` | yes |
| `provider` | `4` | yes |
| `input-limit` | `4` | yes |
| `quality-gate` | `1` | yes |
| `admission` | `5` | no |
| `report` | `5` | no |
| `internal` | `5` | no |

**The category is what supplies the exit code.** Both columns are derived from
the category when the error is built, never passed in beside it, so a code and a
category cannot disagree — that derivation is why `input-limit` exists as its own
category rather than as `config` errors overriding the exit code by hand. A
structured error that reaches the normalizer keeps the `exitCode` it already
carries; nothing reclassifies it on the way out.

Read the `code`, not the category, when mapping to a CI action: the category tells
you how the run ended, the code tells you what to do about it.

## Generic codes

Produced by the error normalizer when nothing more specific applies. `<source>`
is one of `config`, `repository`, `provider`, `admission`, `report`.

| Code | When |
| --- | --- |
| `config_error` | Generic configuration failure, including all Zod validation failures and CLI argument `TypeError`s. |
| `repository_error` | Generic repository/filesystem failure. |
| `provider_error` | Provider failure with no recognizable sub-classification. |
| `admission_error`, `report_error` | Generic admission/reporting failure. |
| `unknown_error` | Unclassified internal failure (source `internal`). |
| `<source>_timeout` | The message matched `timeout` / `timed out` / `etimedout`. |
| `<source>_cancelled` | The message matched `abort` / `cancel` / `interrupt`. |
| `usage_error` | CLI usage failure (unknown command, missing required flag, empty case selection). Exit `2`. |

## Provider error codes

Derived from the HTTP status and message of the provider failure. This is the
authoritative table.

| Code | Trigger | Exit | Retried |
| --- | --- | --- | --- |
| `provider_rate_limited` | HTTP `429`, or message containing `rate limit`, `rate-limit`, `overloaded`, `too many requests` | `4` | yes, honoring `Retry-After` within `provider.retryMaxDelayMs` |
| `provider_auth` | HTTP `401`/`403`, or message containing `api key`, `api-key`, `unauthorized`, `forbidden` | `4` | no |
| `provider_context_length` | Message containing `context length`, `maximum context`, `too many tokens`, `context window` | `4` | no |
| `provider_server_error` | HTTP `500`–`599` | `4` | yes |
| `provider_error` | Any other provider failure | `4` | transient failures only |
| `provider_timeout` | Timeout-shaped message from the provider source | `4` | yes |
| `provider_cancelled` | Cancellation-shaped message from the provider source | `4` | no |

Classification is order-sensitive: rate-limit patterns are checked before auth,
auth before context length, and the `5xx` bucket last. A `429` with an
"unauthorized" message is therefore classified as `provider_rate_limited`.

One provider code is not derived from a failure at all:

| Code | Trigger | Exit | Retried |
| --- | --- | --- | --- |
| `provider_output_truncated` | A *successful* response whose finish reason is `length`, meaning generation stopped at the output-token ceiling | `4` | no |

It is raised from a response the provider considered fine: HTTP `200`, a body,
no error. Only the finish reason distinguishes it from a complete answer, so
without this check a review cut off mid-answer is indistinguishable from a
review that finished and found less. Retrying is pointless — an identical
request against an identical ceiling truncates identically — so the run fails
instead. Raise or unset `provider.maxOutputTokens`; when it is unset, the
message says so and the ceiling belongs to the model or adapter default.

Provider setup problems are **config** errors (exit `2`), not provider errors:

| Code | When | Exit |
| --- | --- | --- |
| `provider_adapter_missing` | The selected adapter package is not installed. Message includes the `npm install <package>` command. | `2` |
| `provider_adapter_invalid` | The adapter package does not export the expected factory. | `2` |
| `provider_credentials_missing` | A required credential environment variable is unset or blank. Names the variable, never the value. | `2` |
| `provider_base_url_missing` | `provider.id = "openai-compatible"` without `provider.baseUrl`. | `2` |
| `provider_capability_missing` | An eval judge needs a model capability the resolved provider does not offer. | `2` |

## Named codes by category

### `config` (exit 2)

| Code | When |
| --- | --- |
| `config_error` | Config file or CLI argument invalid; schema validation failed. |
| `model_review_provider_missing` | `aiReview.enabled` is `true` and no `provider` is configured, so the run was asked for a model review it has no model to perform. Refused in preflight, before any repository work — it is the default configuration, and it used to produce an empty review at exit `0`. Configure a provider, or set `aiReview.enabled: false` to run deterministic-only on purpose. |
| `invalid_git_ref` | `baseRef`/`headRef` is not a valid or safe git ref. |
| `instruction_read_denied` | An `instructions.files` entry could not be read within the allowed boundary. |
| `skill_read_denied` | A mounted skill file could not be read within the allowed boundary. |
| `analyzer_artifact_unreadable` | A `security.signals.artifacts` entry does not exist, is not a regular file, or does not resolve inside the repository. |
| `analyzer_artifact_too_large` | An analyzer artifact exceeds `security.signals.maxArtifactBytes`, or carries more results than the engine normalizes. It is never read partially. |
| `analyzer_artifact_invalid` | An analyzer artifact is not valid JSON, or is not a SARIF 2.1.0 document this engine reads. |
| `redaction_secret_env_unset` | A `security.redaction.secretEnvVars` entry names an environment variable that is unset or empty. The run stops rather than emit artifacts that look redacted and are not. Names the variable, never a value. |
| `redaction_secret_env_too_short` | A named variable holds fewer than 8 characters. Such a value would be replaced everywhere it occurs and corrupt the output instead of protecting it. Names the variable, never a value. |
| `opentelemetry_endpoint_missing` | `openTelemetry.enabled` is `true` with no `endpoint`. |
| `opentelemetry_dependency_missing` | OpenTelemetry enabled but the optional exporter packages are not installed. |
| `eval_semantic_judge_missing` | An eval case with expected findings was scored without the semantic judge (no provider). |
| `provider_*` setup codes | See the table above. |

### `input-limit` (exit 4)

`intent check`'s three input limits. They are **not** `config` errors: the input is
not a mistake to correct in configuration, it is more than the command will judge
in one pass, and refusing it beats judging part of it and reporting obligations as
not-evidenced whose evidence was never shown. Nothing is truncated in any of the
three, and the exit code is `4` because the category says so.

| Code | When |
| --- | --- |
| `intent_change_too_large` | The change has more citable lines than `intentFulfilment.maxChangeLines` allows. |
| `intent_text_too_large` | The stated intent is larger than `intentFulfilment.maxIntentBytes` allows. |
| `intent_too_many_obligations` | The stated intent yielded at least as many obligations as `intentFulfilment.maxObligations` allows. |

Each message names the offending size, the configured limit, and a recovery — and
where the limit is already at its schema maximum it says so instead of advising a
raise that cannot work.

### `repository` (exit 3)

| Code | When |
| --- | --- |
| `repository_error` | Generic filesystem/git failure. |
| `merge_base_unavailable` | No merge base exists between `baseRef` and `headRef`. |
| `baseline_source_unavailable` | `baseline write` found no completed report, or could not read the one given via `--report`. The message states WHICH of those happened — missing, permission denied, a directory, or a path refused for resolving outside the repository — and `details.cause` carries the normalized errno (`ENOENT`, `EACCES`, `EPERM`, `EISDIR`) or `path_outside_repository`. |
| `baseline_source_invalid` | `baseline write` read the source file, but it is not a review report (invalid JSON, or JSON that does not satisfy the report contract). |

### `provider` (exit 4)

| Code | When |
| --- | --- |
| `provider_*` runtime codes | See the table above. |
| `task_packet_budget_exceeded` | A serialized model-input packet exceeded the 8 MB runaway guard, or an explicitly configured `review.contextMaxBytes`. Fails *before* the call; source is never truncated. Fix by raising or unsetting `review.contextMaxBytes`, or reducing scope. |
| `review_task_indivisible` | The provider refused a review task as exceeding its context length and it cannot be split further. Nothing was truncated. Review a smaller change, or configure a model with a larger context window. |

### `quality-gate` (exit 1)

| Code | When |
| --- | --- |
| `coverage_incomplete` | The report's `coverage.status` is not `complete`. Completed reports must have full coverage; this fails closed. |
| `cost_budget_exceeded` | Run cost exceeded `review.maxCostUsd` (only enforceable when tokens and prices are both known). |
| `drift_gate_failed` | Drift findings exist in a category listed in `drift.failOn`. |

### `report` / `internal` (exit 5)

| Code | When |
| --- | --- |
| `sarif_invalid` | Rendered SARIF failed its own validation. |
| `report_error` | Writing a reporting artifact failed. |
| `cli_envelope_invalid` | The CLI built a stdout, stderr or `error.json` document that does not satisfy its own contract (`src/shared/contracts/cli/cli-output.schema.ts`). It names a defect in this engine, never in your input, and is the reason the envelopes are validated before they are printed rather than merely typed. |
| `quality_gate_missing` | A completed run's report carried no quality gate result. Every completed run evaluates its gate, so this is an internal inconsistency; the run fails instead of being reported as passing. The run directory is written and is the evidence for the bug report. |
| `unknown_error` | Unclassified internal failure. Also what the CLI's top-level guard reports for a failure that escaped a command's own error handling — for example a run that fails while its artifact directory is unwritable, where the partial-artifact write itself throws from inside the failure path. Such a failure prints this envelope at exit `5` rather than a raw stack trace at exit `1`. |

## Non-fatal signals

These never set an exit code on their own; they appear in `run.warnings` in
`report.json` / `run-summary.json`, or in `providerIssues`.

| Signal | Meaning |
| --- | --- |
| `config-file-missing` | No config file at the **default** path; defaults were used. A file named by `--config` or `CODEREVIEWER_CONFIG_PATH` that does not exist is a `config_error` at exit `2` instead — a named file that is missing is a mistake, not a fallback. |
| `baseline-missing` | A baseline was explicitly configured but the file is absent. Findings are marked `unknown` and treated as new. |
| `cost-unavailable` | Token counts or prices were unavailable, so cost was not computed and `review.maxCostUsd` could not be enforced. |
| `Referenced-definition context was capped: N imported dependency file(s) resolved but were not shown to the reviewer…` | The per-task dependency-digest caps (6 files, 12288 bytes total, 4096 bytes per file) kept resolvable imported dependencies out of the review context. The reviewer reasoned about calls into those files without their definitions; findings that hinge on such a callee's contract are less well evidenced than a run where nothing was dropped. |
| `Referenced-definition dependencies were unreadable: N imported dependency file(s) resolved and then could not be read…` | A dependency resolved to a real path and the read failed (it vanished between probe and read, permissions, an I/O error). Reported apart from the capped count because the caps are not what bound: check that those files exist and are readable. |
| `External change-intent provider "<id>" failed and was skipped.` | The provider errored. The review continues without its contribution. |
| `External change-intent provider "<id>" found no change-intent source, so the review ran without one. This is the ordinary result when a change has no written intent; if you expected content, check where the provider points.` | The provider ran and matched nothing — an empty inbox, a mistyped directory, no changed file matching its globs. With `contextSources` on by default, this is what an ordinary run sees; it is not read as a misconfiguration, though a mistyped path produces the same shape. |
| `External change-intent provider "<id>" matched N sources but none carried usable text, so the review ran without them. Check that those sources have a body below their frontmatter.` | The provider found sources and none of them yielded usable text — empty bodies, frontmatter only. Genuinely odd, since something did match. |
| `The <stage> stage produced no report because this run has no change set to compare: <reason>.` | The change-impact or intent-fulfilment lane found nothing to diff — no resolvable merge base (ordinary in a shallow clone), or refs that differ by no files. Both lanes run by default, so an ordinary run on such a checkout says this; it is worded as an absence rather than a failure, and the review itself is unaffected. |
| `The <stage> stage could not complete and produced no report for this run: <message>` | The change-impact or intent-fulfilment lane threw for any other reason — a timeout, an unknown ref, an unreadable file. An advisory stage can never fail the run, so the message is carried here instead of an exit code. |
| Claim-provider warnings | A `verification` claim provider failed; the lane continues and reports an empty or partial result. |
| `Verification claim provider "<id>" reached the per-provider cap of 200 claims; <n> further claim(s) were not investigated.` | The provider had more eligible claims than one run investigates. The claims that ran are complete; the withheld ones were never judged and never fixed. Narrow the source, or split the work across runs. |
| `Verification claim provider "<id>" skipped <n> entry(ies) that are not valid claims; they were not investigated.` | The provider read records it could not turn into claims — a claims file whose entries have the wrong shape. The claims that were read are sound; the skipped entries were never judged and never fixed. Fix the shape of the records the pipeline writes. |
| `plausibility_source_unavailable` | (eval) A finding's source file could not be read for plausibility judging; the judge fails closed for that finding. |
| `plausibility_source_line_omitted` | (eval) The file was larger than the judge's byte cap and the finding's own location line fell outside the window that fit, so the judge was not asked. The finding fails closed rather than being scored against code it was never shown. |

## Related

- [CLI reference](./cli.md) — per-command exit codes
- [configuration/quality-gate-and-baseline.md](./configuration/quality-gate-and-baseline.md)
- [Artifacts](./artifacts.md) — `error.json` for failed runs
