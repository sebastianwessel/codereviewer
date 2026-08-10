# `reporting`, `observability`, `costs`

Output formats, logs and traces, and the prices used to compute run cost.

## `reporting`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `reporting.formats` | array of `"json"` \| `"markdown"` \| `"sarif"` | `["json", "markdown", "sarif"]` | Which report renderers run. **`report.json` is always written** even if `"json"` is absent — it is the canonical machine-readable artifact. Only Markdown and SARIF can actually be switched off. |
| `reporting.sarif.target` | `"generic"` \| `"github"` | `"generic"` | SARIF dialect. `github` shapes the output for GitHub code scanning. |
| `reporting.sarif.category` | non-empty string | `"codereviewer"` | SARIF run category. |
| `reporting.sarif.maxResults` | integer 1–25000 | `5000` | Cap on SARIF results emitted. When it withholds findings, `report.sarif` says so in `runs[].invocations[].toolExecutionNotifications` — see below. |
| `reporting.reviewComments.enabled` | boolean | `false` | Writes platform-neutral inline review-comment drafts (including one-click fix suggestions) as **local artifacts only**. No network publishing happens, ever. |
| `reporting.reviewComments.platform` | `"github"` \| `"gitlab"` \| `"bitbucket"` \| `"generic"` \| `"auto"` | `"auto"` | Renderer selection. `auto` detects from CI environment, then the git `origin` remote host, then falls back to `generic`. An explicit value skips detection. |

There is no `reporting.sarif.redact` key. Every rendered report format redacts
secret-shaped text unconditionally, so a toggle for it would have had nothing to
switch.

When `reporting.sarif.maxResults` withholds findings, `report.sarif` carries a
`warning`-level entry in `runs[].invocations[].toolExecutionNotifications` naming
how many findings were withheld, the cap that withheld them, and where the full
set is. Read it, because code scanning treats a finding that is missing from a
run as **resolved**: without that entry, withheld findings would silently read as
fixed. `report.json` and `report.md` are never capped.

With `reviewComments.enabled`, two files are written per run:
`review-comments.json` (neutral, the source of truth) and
`review-comments.<platform>.json` (rendered). See
[artifacts.md](../artifacts.md).

## `observability`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `observability.logging.level` | `"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"` \| `"silent"` | **`"silent"`** | Level for sanitized operational logs. Overridden by `CODEREVIEWER_LOG_LEVEL`, then by `--log-level`, then by `--debug` (which forces `debug`). |
| `observability.openTelemetry.enabled` | boolean | `false` | Checks the OTLP packages are installed. **It does not export anything yet — see below.** |
| `observability.openTelemetry.endpoint` | URL | *unset* | OTLP endpoint. **Required when `enabled` is `true`** — otherwise validation fails with `endpoint is required when OpenTelemetry is enabled` (and, at setup, `opentelemetry_endpoint_missing`, exit `2`). |
| `observability.openTelemetry.headers` | record<string, string> | `{}` | Exporter headers. Always redacted in summaries and logs. |
| `observability.openTelemetry.serviceName` | non-empty string | `"codereviewer"` | `service.name` resource attribute. |

> **No spans are emitted yet.** Turning `openTelemetry.enabled` on verifies that
> `@opentelemetry/sdk-trace-node` and `@opentelemetry/exporter-trace-otlp-http`
> are installed and then stops. Nothing in this engine calls `getTracer` or
> `startSpan`, so **no trace ever reaches the configured endpoint**, and neither
> package is a dependency of this project — so with a default install, enabling
> this fails the run with `opentelemetry_dependency_missing` (exit `2`).
>
> Until 2026-08-11 the run logged "OpenTelemetry setup completed" here, which read
> as working telemetry. It now warns that nothing will arrive at the collector.
> The structured run data that DOES exist is `observability.json` in the run
> directory — see [artifacts.md](../artifacts.md).

OpenTelemetry exporter packages are optional and dependency-isolated. If
`enabled` is `true` and they are not installed, setup returns a recoverable
config error (`opentelemetry_dependency_missing`, exit `2`) with installation
guidance.

Traces and logs never contain raw source, prompt text, model raw output,
environment variables, or secrets.

## `costs`

Prices used to turn token counts into a USD figure. All three keys are unset by
default; the `costs` object itself defaults to `{}`.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `costs.inputPerMillion` | number ≥ 0 | *unset* | Price per million input tokens. |
| `costs.cachedInputPerMillion` | number ≥ 0 | *unset* | Price per million cached (prompt-cache read) input tokens. Cached tokens are a **subset** of input tokens, already counted in the input aggregate; this re-prices that subset. When unset, cached input falls back to the full input price — no discount is fabricated. |
| `costs.outputPerMillion` | number ≥ 0 | *unset* | Price per million output tokens. |

Resolution order for a price: explicit `costs` values, then the bundled model
pricing snapshot (used only for `provider.id = "openai"` models). If token
counts or prices are unavailable, cost is omitted from the run summary and the
warning `cost-unavailable` is recorded — and
[`review.maxCostUsd`](./review.md) cannot be enforced.

## Related

- [Artifacts](../artifacts.md) — what each format writes and where
- [Environment variables](../environment.md) — `CODEREVIEWER_COST_*`, `CODEREVIEWER_OPENTELEMETRY_*`
- [CLI reference](../cli.md) — `--log-level`, `--log-file`, `--debug`
