# 04: Configuration And Providers

Status: Approved
Date: 2026-06-19

## Configuration Files

Default repository root: current working directory at CLI entry unless an
explicit CLI root option is provided. Config files must not redefine repository
root in R1.

Default config path: `.review/config.json`, resolved under repository root.

User-owned configuration, reviewer instructions, and skills live under
`.review/`. Generated run artifacts live under `.review/runs/`.

Merge order, lowest to highest precedence:

1. built-in defaults;
2. config file;
3. process environment variables;
4. `.env` file in the repository root when present;
5. CLI flags.

`.env` loading is best-effort: missing `.env` is not an error because CI/CD
systems usually provide environment variables directly. Invalid `.env` syntax
is a config error because it can hide a broken local setup.

`codereviewer eval run` does not load the repository root `.env` file. Eval is
a regression and quality-gate command and must remain hermetic by default.
Provider-backed eval requires explicit process environment or config input, not
ambient local `.env` state.

The normalized config object must be emitted to the run summary as a hash and a
redacted summary. Raw config values that can contain secrets must not be logged.

## Environment Variables

R1 supports only these configuration environment variables:

| Environment Variable | Config Path | Type |
| --- | --- | --- |
| `CODEREVIEWER_REVIEW_MODE` | `review.mode` | Review mode enum |
| `CODEREVIEWER_REVIEW_DEPTH` | `review.depth` | Review depth enum |
| `CODEREVIEWER_BASE_REF` | `review.baseRef` | string |
| `CODEREVIEWER_HEAD_REF` | `review.headRef` | string |
| `CODEREVIEWER_PROVIDER_ID` | `provider.id` | provider ID enum |
| `CODEREVIEWER_PROVIDER_MODEL` | `provider.model` | string |
| `CODEREVIEWER_PROVIDER_BASE_URL` | `provider.baseUrl` | URL |
| `CODEREVIEWER_ARTIFACT_DIR` | `paths.artifactDir` | repository-relative path |
| `CODEREVIEWER_CONFIG_PATH` | CLI/config loader default path override | repository-relative path |
| `CODEREVIEWER_SKILLS_DIR` | `skills.directories[0]` | repository-relative path |
| `CODEREVIEWER_LOG_LEVEL` | `observability.logging.level` | log level enum |
| `CODEREVIEWER_OPENTELEMETRY_ENABLED` | `observability.openTelemetry.enabled` | boolean |
| `CODEREVIEWER_OPENTELEMETRY_ENDPOINT` | `observability.openTelemetry.endpoint` | URL |
| `CODEREVIEWER_OPENTELEMETRY_HEADERS` | `observability.openTelemetry.headers` | redacted string map |
| `CODEREVIEWER_COST_INPUT_PER_MILLION` | `costs.inputPerMillion` | number |
| `CODEREVIEWER_COST_OUTPUT_PER_MILLION` | `costs.outputPerMillion` | number |

All other environment variables are ignored by config loading. Credentials are
resolved by provider adapters, not copied into normalized config.
Provider credential variables from the effective environment must be passed to
provider resolution. This includes credential values loaded from root `.env`
for review commands.

## Config Schema

Implementation must define `CodeReviewerConfigSchema` in Zod and generate a JSON
Schema artifact with `npm run generate:schemas`. The generated config schema
path is `schema/codereviewer-config.schema.json` and must be committed because
it is a public configuration contract. Unknown top-level keys are errors.
Unknown nested keys are errors unless the schema explicitly marks a
provider-specific object as passthrough.

### Top-Level Shape

| Key | Required | Type | Default |
| --- | --- | --- | --- |
| `review` | no | object | built-in review defaults |
| `provider` | no | object | omitted; required only for model-backed review |
| `instructions` | no | object | no instructions |
| `skills` | no | object | no skills |
| `paths` | no | object | default includes/excludes |
| `security` | no | object | secure defaults |
| `reporting` | no | object | JSON, Markdown, and SARIF local reports |
| `evaluation` | no | object | eval disabled |
| `drift` | no | object | drift checks enabled as warnings |
| `observability` | no | object | OpenTelemetry disabled |
| `costs` | no | object | detailed token/cost tracking enabled with no prices |

## Review Config

| Key | Type | Default | Rule |
| --- | --- | --- | --- |
| `mode` | `"local" | "ci" | "pr" | "full"` | `"local"` | `pr` does not publish in R1. |
| `depth` | `"fast" | "balanced" | "thorough"` | `"balanced"` | Controls budgets only. |
| `baseRef` | string | `"main"` | Must not start with `-`. |
| `headRef` | string | `"HEAD"` | Must not start with `-`. |
| `maxConcurrentTasks` | integer 1..32 | `4` | Caps active review tasks and provider model calls. |
| `maxFiles` | integer 1..10000 | `500` | Intake hard cap. |
| `maxFileBytes` | integer 1..5000000 | `500000` | Files above cap are skipped. |
| `contextMaxFiles` | integer 1..2000 | preset-defined | Planning hint for bounded task packetization; must not cap review coverage. |
| `contextMaxBytes` | integer 10000..10000000 | preset-defined | Per-packet model-bound context budget; explicit values override provider safety defaults. Budget pressure creates more tasks, not skipped source. |
| `inlineSeverityThreshold` | severity | `"high"` | Only affects reporter eligibility. |
| `maxCostUsd` | number >= 0 | preset-defined | Hard stop only when token usage and configured/provider pricing are available; otherwise reported as unavailable. |
| `runTimeoutMs` | integer 10000..7200000 | unset | Optional whole-run timeout. When unset, no hidden Harness run timeout is applied; provider calls still use `provider.timeoutMs`. |

## Provider Config

Provider IDs:

| ID | Adapter Package | Required Env |
| --- | --- | --- |
| `openai` | `@purista/harness-openai` | `OPENAI_API_KEY` |
| `openai-compatible` | `@purista/harness-openai` | provider-specific; `baseUrl` required |
| `bedrock` | `@purista/harness-bedrock` | AWS credential chain and region |
| `azure` | `@purista/harness-azure-foundry` | Azure credential/env fields defined by adapter docs |

Provider schema:

| Key | Required | Type | Rule |
| --- | --- | --- | --- |
| `id` | yes | provider ID | Closed enum. |
| `model` | yes | string | Non-empty. |
| `baseUrl` | conditional | URL | Required for `openai-compatible`; optional otherwise. |
| `temperature` | no | number 0..2 | Default `0`. |
| `maxOutputTokens` | no | integer >= 1 | Default provider adapter setting. |
| `timeoutMs` | no | integer 1000..600000 | Default `120000`. |
| `maxRetries` | no | integer 0..5 | Default `2`. Classified retries of provider task calls; total attempts are `maxRetries + 1`. |
| `retryBackoffMs` | no | integer 0..60000 | Default `500`. Base delay for exponential backoff between retries. |
| `retryMaxDelayMs` | no | integer 0..600000 | Default `30000`. Maximum single backoff wait; a longer required wait (e.g. a long rate-limit `Retry-After`) fails the run. |

Retry classification: transient failures (network, HTTP 408/425/5xx) and rate
limits (HTTP 429, honoring `Retry-After` within `retryMaxDelayMs`) are retried;
oversized context, authentication, payment/quota, and cancellation are not.

Provider resolver rules:

- Unsupported provider parameters must be omitted before the adapter call rather
  than retried after a provider error.
- For OpenAI `gpt-5*` models, omit `temperature` even when the normalized config
  contains its default value.
- OpenAI-compatible providers keep the configured `temperature` because their
  model compatibility is provider-specific.

Local development tests use `openai-compatible` by default when provider-backed
tests are explicitly enabled. `provider.baseUrl` must be configurable by config
file and by `CODEREVIEWER_PROVIDER_BASE_URL`.

## Depth Budget Defaults

| Depth | `maxCostUsd` | `runTimeoutMs` | `maxConcurrentTasks` |
| --- | --- | --- | --- |
| `fast` | `1` | `300000` | `4` |
| `balanced` | `3` | `900000` | `4` |
| `thorough` | `10` | `3600000` | `2` |

R1 cost reporting is intentionally conservative. If provider usage metadata is
unavailable, cost enforcement can use configured `costs.inputPerMillion` and
`costs.outputPerMillion` values only when token counts are available. If token
counts or prices are unavailable, cost is omitted and `maxCostUsd` is not
enforceable; the run summary must include warning code `cost-unavailable`.

Provider-backed tasks should record detailed token/cost metadata when the
adapter exposes it:

| Field | Type | Rule |
| --- | --- | --- |
| `inputTokens` | integer >= 0 | Provider reported or tokenizer estimate. |
| `outputTokens` | integer >= 0 | Provider reported or tokenizer estimate. |
| `totalTokens` | integer >= 0 | Sum of input and output tokens. |
| `costUsd` | number or null | Calculated when prices are known. |
| `costSource` | enum | `provider | configured | unavailable`. |

Run summaries aggregate available token/cost metadata per provider, model, task,
and run. Full per-task cost enforcement remains a required follow-up when the
selected provider adapters expose reliable usage data at the task boundary.

## Context Budget Defaults

| Depth | `contextMaxFiles` | `contextMaxBytes` |
| --- | --- | --- |
| `fast` | `50` | `100000` |
| `balanced` | `200` | `200000` |
| `thorough` | `500` | `500000` |

When no explicit `review.contextMaxBytes` is configured and a provider is
enabled, each provider-backed task uses the lower of the depth default and
`60000` bytes. Local deterministic review keeps the depth default. This is a
conservative byte-level safety guard until tokenizer-aware packing is
implemented.

Provider-backed task input also has a final serialized packet guard. The guard
must fail before provider invocation when a packet exceeds budget. It must not
truncate source, instructions, skills, evidence, analyzer output, or metadata.
The recovery is deterministic task splitting, increasing configured budget, or
removing non-required scope before rerun.

Context caps are deterministic packetization controls and conservative
provider-safety defaults. They are not review-scope caps. Source inside the
declared reviewable universe must be assigned to exact included source chunks.
Completed reports require `coverage.status = complete`; incomplete coverage
fails closed with error code `coverage_incomplete`.

## Provider Resolution

Rules:

- Base package must not import provider adapter packages at module top level.
- Provider resolution dynamically imports only the selected adapter package.
- Missing selected package produces exit code `2` and message:
  `Provider adapter "<package>" is not installed. Install it with: npm install <package>`.
- Missing credentials produces exit code `2` and identifies the missing
  environment variable or credential source without printing secret values.
- Provider errors during review produce exit code `4` unless a fallback provider
  is explicitly configured in a future spec. No fallback exists in R1.

## Instructions

| Key | Type | Default |
| --- | --- | --- |
| `files` | string[] | `[]` |
| `inline` | string | `""` |
| `precedence` | fixed | CLI inline > config inline > files in listed order |

Instruction file paths must be repository-relative and must not traverse above
root. Run summaries record path and SHA-256 hash only.

## Skills

| Key | Type | Default |
| --- | --- | --- |
| `enabled` | boolean | `false` |
| `directories` | string[] | `[]` |
| `allowTools` | `read | list | grep`[] | `["read", "list", "grep"]` |

Default skills directory is `.review/skills` when it exists and
`skills.enabled` is true. Skill directories may contain nested skill folders;
each skill folder must contain a harness-compatible `SKILL.md` with `name` and
`description` frontmatter. The frontmatter `name` is the canonical mounted skill
ID and must be unique.

Skill directories must be explicitly listed or provided by
`CODEREVIEWER_SKILLS_DIR`. Provider-backed reviewer agents mount enabled skills
through the harness `.skills(...)` registry and receive only the harness skill
index by default. The model may read mounted skill files from
`/skills/<name>/SKILL.md` using configured read-only built-ins. R1 permits only
`read`, `list`, and `grep` for mounted skills. Skill bodies must not be inlined
into workflow input, reports, logs, traces, or shared-context artifacts. Skill
hashes and repository-relative paths are recorded for provenance.

## Paths

| Key | Type | Default |
| --- | --- | --- |
| `include` | glob[] | `["**/*"]` |
| `exclude` | glob[] | `[".git/**", "node_modules/**", "dist/**", "coverage/**", ".review/**"]` |
| `artifactDir` | repository-relative path | `.review/runs` |

All path config is validated through `path-service` and must support Linux and
Windows separators.

## Baseline

| Key | Type | Default |
| --- | --- | --- |
| `enabled` | boolean | `true` |
| `path` | repository-relative path | `.review/baseline.json` |
| `failOnNewOnly` | boolean | `true` |
| `includeResolvedInReport` | boolean | `true` |

Baseline matching uses admitted finding fingerprints, never titles alone.
Missing baseline files are treated as an empty baseline and emit warning code
`baseline-missing` only when the user explicitly configured a baseline path or
enabled flag. When a baseline is explicitly configured but its file is missing,
admitted findings are marked `unknown` and treated as new for `failOnNewOnly`.

## Quality Gate

The quality gate is defined in `06-evaluation-and-quality-gates.md`. Its
configuration block:

| Key | Type | Default |
| --- | --- | --- |
| `maxCritical` | integer >= 0 | `0` |
| `maxHigh` | integer >= 0 | `0` |
| `maxMedium` | integer >= 0 | unset (no fail) |
| `minEvidenceLevel` | `"non-model" | "model-ok"` | `"non-model"` |
| `failOnProviderError` | boolean | `true` |
| `failOnNewOnly` | boolean | value from `baseline.failOnNewOnly` |

## Reporting

| Key | Type | Default |
| --- | --- | --- |
| `formats` | `ReportFormat[]` | `["json", "markdown", "sarif"]` |
| `sarif.target` | `"generic" | "github"` | `"generic"` |
| `sarif.category` | string | `"codereviewer"` |
| `sarif.maxResults` | integer 1..25000 | `5000` |
| `sarif.includeSuppressed` | boolean | `false` |
| `sarif.redact` | boolean | `true` |

JSON is always generated even if omitted from `formats`, because it is the
canonical machine-readable artifact. Markdown, SARIF, and GitHub review-comment
artifact rendering can be disabled only when their format is absent from
`formats`. The `github-review-comments` format writes local PR review-comment
draft JSON only and performs no network publishing.

## Observability Config

OpenTelemetry support is optional and dependency-isolated like provider
adapters. The base package must not require OpenTelemetry exporter packages at
module top level.

| Key | Type | Default | Rule |
| --- | --- | --- | --- |
| `logging.level` | `"trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent"` | `"silent"` | Controls sanitized operational logs. |
| `openTelemetry.enabled` | boolean | `false` | Enables OT setup only when endpoint exists. |
| `openTelemetry.endpoint` | URL | omitted | Required when enabled. |
| `openTelemetry.headers` | object | `{}` | Redacted; may come from env. |
| `openTelemetry.serviceName` | string | `codereviewer` | No secrets. |

If enabled and optional OT dependencies are missing, setup returns a recoverable
config error with installation guidance. Traces must never include raw source,
prompt text, model raw output, env vars, or secrets.

CLI `review --debug` sets `logging.level` to `debug`. `review --log-level`
accepts any configured log level and has normal CLI precedence over env and
file config.

## Cost Config

| Key | Type | Default |
| --- | --- | --- |
| `inputPerMillion` | number >= 0 | omitted |
| `outputPerMillion` | number >= 0 | omitted |
| `currency` | `"USD"` | `"USD"` |

Costs are operational metadata and safe to report after redaction.

## Security Config

| Key | Type | Default |
| --- | --- | --- |
| `allowShell` | boolean | `false` |
| `allowNetwork` | boolean | `false` |
| `allowFilesystemWrite` | boolean | `false` |
| `captureContentTelemetry` | boolean | `false` |

`allowShell: true`, broad `allowNetwork: true`, broad
`allowFilesystemWrite: true`, and `captureContentTelemetry: true` are rejected
in R1. Provider network access is controlled only by explicit provider config;
artifact writes are controlled only by the artifact writer boundary. Enabling
broader permissions requires a future spec with privacy and security review.

## Drift Config

| Key | Type | Default |
| --- | --- | --- |
| `enabled` | boolean | `true` |
| `failOn` | drift category[] | `["generated-artifact-drift", "security-drift"]` |
| `warnOn` | drift category[] | all other categories |
| `includeDocs` | boolean | `true` |
| `includeSpecs` | boolean | `true` |
| `includeGenerated` | boolean | `true` |

Drift categories:

- `documentation-drift`
- `spec-drift`
- `implementation-drift`
- `generated-artifact-drift`
- `ambiguity`
- `security-drift`

Configured categories in `failOn` make `drift check`, review preflight, and CI
mode fail with exit code `1` when findings are present. Categories in `warnOn`
are reported but non-blocking. `ambiguity` is warning by default.

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Run completed and quality gate passed or no gate configured. |
| `1` | Run completed and quality gate failed. |
| `2` | Config, provider setup, credentials, path, or CLI usage error. |
| `3` | Repository intake or filesystem error. |
| `4` | Provider/model runtime error. |
| `5` | Internal invariant violation. |
