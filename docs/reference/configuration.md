# Configuration Reference

Complete reference for every key in `.codereviewer/config.json`. Configuration
is merged lowest-to-highest precedence: built-in defaults → config file →
process env → `.env` → CLI flags. See [Environment Reference](environment.md)
for the corresponding environment variables.

The generated JSON schema is available at:

```text
schema/codereviewer-config.schema.json
```

---

## `review`

Controls the review scope, git refs, file budgets, and task concurrency.

| Key | Values / Type | Description |
| --- | --- | --- |
| `review.mode` | `local`, `ci`, `pr`, `full` | Review mode. |
| `review.depth` | `fast`, `balanced`, `thorough` | Review depth; scales the per-packet context budget. |
| `review.baseRef` | git ref (no leading `-`) | Base git ref for the diff. |
| `review.headRef` | git ref (no leading `-`) | Head git ref for the diff. |
| `review.maxConcurrentTasks` | `1`–`32` | Caps active review tasks **and** active provider calls. A new task may start as soon as one active provider call completes (rolling workers). |
| `review.maxFiles` | `1`–`10000` | Maximum number of files to include in a review. |
| `review.maxFileBytes` | `1`–`5000000` | Maximum size of an individual file in bytes; larger files are skipped. |
| `review.inlineSeverityThreshold` | severity string (default `high`) | Minimum severity for a finding to be eligible as an inline review comment. Lower-severity findings still appear in summary reports. |
| `review.contextMaxBytes` | `10000`–`10000000` | Per-packet context budget. This is never a coverage cap. |
| `review.runTimeoutMs` | optional integer | Whole-run timeout in milliseconds. Unset disables the Harness run timeout. Provider calls also respect `provider.timeoutMs`. |

---

## `provider`

Selects and configures the model provider. Provider adapters are optional;
leave this section unset to run in deterministic-only mode.

| Key | Values / Type | Description |
| --- | --- | --- |
| `provider.id` | `openai`, `openai-compatible`, `bedrock`, `azure` | Provider adapter to use. |
| `provider.model` | non-empty string | Model ID passed to the provider. |
| `provider.baseUrl` | URL | Required for `openai-compatible`; ignored otherwise. |
| `provider.reasoningEffort` | `minimal`, `low`, `medium`, `high` | OpenAI Responses `reasoning.effort` parameter. Env: `CODEREVIEWER_PROVIDER_REASONING_EFFORT`. |
| `provider.maxRetries` | `0`–`5` | Classified retries; total attempts = `maxRetries + 1`. |
| `provider.retryBackoffMs` | `0`–`60000` | Base exponential backoff delay in milliseconds. |
| `provider.retryMaxDelayMs` | `0`–`600000` | Maximum single wait in milliseconds; longer required waits fail immediately. |

When provider token usage is available, explicit `costs` values (see below)
override the bundled OpenAI model pricing snapshot. Unknown model prices are
reported as `cost-unavailable`.

---

## `instructions`

Injects reviewer guidance from files or inline strings into every model packet.

| Key | Values / Type | Description |
| --- | --- | --- |
| `instructions.files` | repository-relative path array | Paths to instruction files loaded at review time. |
| `instructions.inline` | string | Inline instruction text appended to every reviewer prompt. |

---

## `skills`

Controls optional reviewer tool skills (read / list / grep access during bounded
context retrieval).

| Key | Values / Type | Description |
| --- | --- | --- |
| `skills.enabled` | boolean | Enable or disable skills. |
| `skills.directories` | repository-relative path array | Directories scanned for skill definitions. |
| `skills.allowTools` | `read`, `list`, `grep` | Tool types the reviewer may call. |

---

## `paths`

Controls which files are reviewed and where artifacts are written.

| Key | Values / Type | Description |
| --- | --- | --- |
| `paths.include` | glob array | Glob patterns for files to include. |
| `paths.exclude` | glob array | Glob patterns for files to exclude. |
| `paths.artifactDir` | repository-relative path | Directory where run artifacts are written. |

**Default `paths.exclude`** is:

```text
.git/**
node_modules/**
dist/**
coverage/**
.codereviewer/**
```

Plus the following generated/non-reviewable data files (excluded because they
carry no semantic logic to review, lowering token cost and noise):

- Dependency lock files: `**/package-lock.json`, `**/yarn.lock`,
  `**/pnpm-lock.yaml`, `**/Cargo.lock`, `**/go.sum`
- Minified bundles: `**/*.min.js`, `**/*.min.css`
- Source maps: `**/*.map`
- Test snapshots: `**/*.snap`

Add app-specific data files (e.g. locale bundles) via `paths.exclude` as
needed.

---

## `baseline`

Tracks findings across runs to distinguish new issues from pre-existing ones.

| Key | Values / Type | Description |
| --- | --- | --- |
| `baseline.enabled` | boolean | Enable baseline tracking. |
| `baseline.path` | repository-relative path | Path to the saved baseline file. |
| `baseline.failOnNewOnly` | boolean | When `true`, the quality gate fails only on **new** findings (not pre-existing). |
| `baseline.includeResolvedInReport` | boolean | Include resolved (now-absent) baseline findings in the report. |

---

## `qualityGate`

Determines whether the `review` command exits with code `1` (gate failed).
Only refutation-passed, actionable model findings are gate-relevant.

| Key | Values / Type | Default | Description |
| --- | --- | --- | --- |
| `qualityGate.maxCritical` | integer ≥ 0 | `0` | Maximum allowed critical findings. |
| `qualityGate.maxHigh` | integer ≥ 0 | `0` | Maximum allowed high findings. |
| `qualityGate.maxMedium` | integer ≥ 0 | unset (no fail) | Maximum allowed medium findings. |
| `qualityGate.failOnProviderError` | boolean | — | Fail when a provider error occurs. |
| `qualityGate.failOnNewOnly` | boolean | defaults to `baseline.failOnNewOnly` | Fail only on new findings. |

---

## `aiReview`

Controls the LLM-backed holistic discovery + refutation pipeline. Requires a
configured `provider`.

| Key | Values / Type | Default | Description |
| --- | --- | --- | --- |
| `aiReview.enabled` | boolean | `true` when a provider is configured | Enable or disable AI review entirely. |
| `aiReview.requireRefutation` | always `true` | `true` | Refutation pass is always active; every model candidate must survive it before admission. |
| `aiReview.deterministicSignalMode` | `support`, `disabled` | `support` | `support`: inject parsed facts as model context (better recall). `disabled`: keep clustering and admission contradiction checks, skip injection (lower cost). Env: `CODEREVIEWER_AI_DETERMINISTIC_SIGNAL_MODE`. |
| `aiReview.actionableSeverityThreshold` | severity string | `medium` | Model findings below this severity are rejected as below-threshold (still recorded as rejected findings). Trusted deterministic-rule findings are exempt. |

---

## `promotionPolicy`

Controls how non-actionable model output is dispositioned in the report.

| Key | Allowed Values | Default | Description |
| --- | --- | --- | --- |
| `promotionPolicy.modelWeakOrRefuted` | `artifact-only`, `rejected` | `artifact-only` | Disposition for a candidate the refuter judged `needs-more-evidence`. `artifact-only` keeps it auditable but out of the inline review; `rejected` drops it entirely. |

---

## `costs`

Overrides the bundled pricing snapshot for cost estimation.

| Key | Values / Type | Description |
| --- | --- | --- |
| `costs.inputPerMillion` | number ≥ 0 | Cost per million input tokens in USD. |
| `costs.outputPerMillion` | number ≥ 0 | Cost per million output tokens in USD. |

---

## `observability`

Controls logging and OpenTelemetry tracing.

| Key | Values / Type | Default | Description |
| --- | --- | --- | --- |
| `observability.logging.level` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` | `silent` | Log verbosity. Override with env `CODEREVIEWER_LOG_LEVEL`, flag `--log-level <level>`, or `--debug`. |
| `observability.openTelemetry.enabled` | boolean | — | Enable OpenTelemetry span export. |

Operational logs are newline-delimited JSON and are sanitized to exclude source
snippets, prompts, request/response bodies, provider headers, environment
values, tokens, and secrets.

---

## `security`

Security bounds. All values are fixed and cannot be overridden.

| Key | Fixed value | Notes |
| --- | --- | --- |
| `security.allowShell` | always `false` | Shell execution is never permitted. |
| `security.allowNetwork` | always `false` in R1 | Network access is never permitted in R1. |
| `security.allowFilesystemWrite` | always `false` in R1 | Filesystem writes are never permitted in R1. |
| `security.captureContentTelemetry` | always `false` | Source content is never captured in telemetry. |

---

## `drift`

Controls the `drift check` command. See [CLI Reference — drift check](cli.md#drift-check).

| Key | Values / Type | Description |
| --- | --- | --- |
| `drift.enabled` | boolean | Enable drift checks. |
| `drift.failOn` | drift category array | Categories that cause a non-zero exit. Default hard categories are `generated-artifact-drift` and `security-drift`. |
| `drift.includeDocs` | boolean | Include documentation drift checks. |
| `drift.includeSpecs` | boolean | Include spec drift checks. |
| `drift.includeGenerated` | boolean | Include generated-artifact drift checks. |

Ambiguity is a warning by default; add it to `drift.failOn` to promote it to a
hard failure.

---

## `reporting`

Controls which report formats are written.

| Key | Values / Type | Description |
| --- | --- | --- |
| `reporting.formats` | `json`, `markdown`, `sarif`, `github-review-comments` | Report formats to emit. |

See [Artifacts Reference](artifacts.md) for a description of each output file.

---

## `evaluation`

| Key | Values / Type | Description |
| --- | --- | --- |
| `evaluation.enabled` | boolean | Enable the evaluation harness. |

> **Note:** Evaluation is a from-source dev/benchmark workflow. Regression gate
> thresholds are set via `eval run` CLI flags (not this config schema). See
> [Evaluation](../evaluation/README.md) for the thresholds and full workflow.
