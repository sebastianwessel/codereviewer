# Exit Codes and Error Codes

Canonical table for every process exit code and every structured error code.
This is the single place these are listed.

Errors are printed to **stderr** as one JSON object:

```json
{ "code": "provider_auth", "message": "…" }
```

`review` adds `"artifactDir"` when a partial run wrote artifacts before failing.
Messages are redacted; validation messages list `path: rule` pairs only and
never echo submitted values.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Run completed; quality gate passed or no gate configured. |
| `1` | Run completed; a gate failed (quality gate, drift gate, coverage, cost budget, or the eval regression gate). |
| `2` | Config, provider setup, credentials, path, or CLI usage error. |
| `3` | Repository intake or filesystem error. |
| `4` | Provider/model runtime error. |
| `5` | Internal invariant violation (admission, report rendering, unknown failure). |

Exit `1` is a **completion signal, not a crash**: artifacts are complete and the
report is valid.

## Category → exit code / recoverability

Every structured error carries a category, which fixes its exit code:

| Category | Exit code | Recoverable |
| --- | --- | --- |
| `config` | `2` | yes |
| `repository` | `3` | yes |
| `provider` | `4` | yes |
| `quality-gate` | `1` | yes |
| `admission` | `5` | no |
| `report` | `5` | no |
| `internal` | `5` | no |

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
| `invalid_git_ref` | `baseRef`/`headRef` is not a valid or safe git ref. |
| `instruction_read_denied` | An `instructions.files` entry could not be read within the allowed boundary. |
| `skill_read_denied` | A mounted skill file could not be read within the allowed boundary. |
| `opentelemetry_endpoint_missing` | `openTelemetry.enabled` is `true` with no `endpoint`. |
| `opentelemetry_dependency_missing` | OpenTelemetry enabled but the optional exporter packages are not installed. |
| `eval_semantic_judge_missing` | An eval case with expected findings was scored without the semantic judge (no provider). |
| `provider_*` setup codes | See the table above. |

### `repository` (exit 3)

| Code | When |
| --- | --- |
| `repository_error` | Generic filesystem/git failure. |
| `merge_base_unavailable` | No merge base exists between `baseRef` and `headRef`. |
| `baseline_source_unavailable` | `baseline write` found no completed report, or could not read the one given via `--report`. |

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
| `quality_gate_missing` | A completed run's report carried no quality gate result. Every completed run evaluates its gate, so this is an internal inconsistency; the run fails instead of being reported as passing. The run directory is written and is the evidence for the bug report. |
| `unknown_error` | Unclassified internal failure. |

## Non-fatal signals

These never set an exit code on their own; they appear in `run.warnings` in
`report.json` / `run-summary.json`, or in `providerIssues`.

| Signal | Meaning |
| --- | --- |
| `config-file-missing` | No config file found; defaults were used. |
| `baseline-missing` | A baseline was explicitly configured but the file is absent. Findings are marked `unknown` and treated as new. |
| `cost-unavailable` | Token counts or prices were unavailable, so cost was not computed and `review.maxCostUsd` could not be enforced. |
| Claim-provider warnings | A `verification` claim provider failed; the lane continues and reports an empty or partial result. |
| `plausibility_source_unavailable` | (eval) A finding's source file could not be read for plausibility judging; the judge fails closed for that finding. |

## Related

- [CLI reference](./cli.md) — per-command exit codes
- [configuration/quality-gate-and-baseline.md](./configuration/quality-gate-and-baseline.md)
- [Artifacts](./artifacts.md) — `error.json` for failed runs
