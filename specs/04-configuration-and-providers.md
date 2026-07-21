# 04: Configuration And Providers

Status: Approved
Date: 2026-07-21

## Configuration Files

Default repository root: current working directory at CLI entry unless an
explicit CLI root option is provided. Config files must not redefine repository
root in R1.

Default config path: `.codereviewer/config.json`, resolved under repository root.

User-owned configuration, reviewer instructions, and skills live under
`.codereviewer/`. Generated run artifacts live under `.codereviewer/runs/`.

Merge order, lowest to highest precedence:

1. built-in defaults;
2. config file;
3. process environment variables;
4. `.env` file in the repository root when present;
5. CLI flags.

`.env` loading is best-effort: missing `.env` is not an error because CI/CD
systems usually provide environment variables directly. Invalid `.env` syntax
is a config error because it can hide a broken local setup.

`codereviewer eval run` does not load the repository root `.env` file inside
the CLI implementation. Eval programmatic calls remain hermetic by default.
Repository npm scripts for provider-backed eval may use Node's native
`--env-file-if-exists=.env` flag so local provider-backed eval can use
project-local secrets without manual shell exports. The plain deterministic
eval script must not load `.env`.

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
| `CODEREVIEWER_PROVIDER_REASONING_EFFORT` | `provider.reasoningEffort` | reasoning effort enum |
| `CODEREVIEWER_PROVIDER_BASE_URL` | `provider.baseUrl` | URL |
| `CODEREVIEWER_AI_DETERMINISTIC_SIGNAL_MODE` | `aiReview.deterministicSignalMode` | signal mode enum |
| `CODEREVIEWER_ARTIFACT_DIR` | `paths.artifactDir` | repository-relative path |
| `CODEREVIEWER_CONFIG_PATH` | CLI/config loader default path override | repository-relative path |
| `CODEREVIEWER_SKILLS_DIR` | `skills.directories[0]` | repository-relative path |
| `CODEREVIEWER_LOG_LEVEL` | `observability.logging.level` | log level enum |
| `CODEREVIEWER_OPENTELEMETRY_ENABLED` | `observability.openTelemetry.enabled` | boolean |
| `CODEREVIEWER_OPENTELEMETRY_ENDPOINT` | `observability.openTelemetry.endpoint` | URL |
| `CODEREVIEWER_OPENTELEMETRY_HEADERS` | `observability.openTelemetry.headers` | redacted string map |
| `CODEREVIEWER_COST_INPUT_PER_MILLION` | `costs.inputPerMillion` | number |
| `CODEREVIEWER_COST_CACHED_INPUT_PER_MILLION` | `costs.cachedInputPerMillion` | number |
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
| `aiReview` | no | object | holistic discovery + refutation defaults |
| `promotionPolicy` | no | object | non-actionable model output disposition |
| `contextSources` | no | object | external change-intent context disabled |

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
| `contextMaxBytes` | integer 10000..10000000 | preset-defined | Per-packet model-bound context budget; explicit values override provider safety defaults. Budget pressure creates more tasks, not skipped source. |
| `inlineSeverityThreshold` | severity | `"high"` | Only affects reporter eligibility. |
| `maxCostUsd` | number >= 0 | preset-defined | Hard stop only when token usage and configured/provider pricing are available; otherwise reported as unavailable. |
| `runTimeoutMs` | integer 10000..7200000 | unset | Optional whole-run timeout. When unset, no hidden Harness run timeout is applied; provider calls still use `provider.timeoutMs`. |

## AI Review Config

The AI review block controls model-driven holistic discovery and refutation. It
does not enable shell, network beyond the selected provider, filesystem writes,
or publishing.

| Key | Type | Default | Rule |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` when provider is configured | When false, no provider-backed review runs. |
| `requireRefutation` | boolean (always `true`) | `true` | Every model candidate must survive the refutation pass before admission. |
| `actionableSeverityThreshold` | severity | `medium` | Minimum severity for a MODEL-origin finding to be admitted as actionable. Below this it is rejected as `below-threshold` (still recorded as a rejected finding). Trusted deterministic-rule findings are exempt. Keeps the engine focused on impactful runtime/security defects over low-severity nits. |
| `deterministicSignalMode` | `"support" | "disabled"` | `"support"` | `support` injects deterministic facts as model context (materially improves recall). `disabled` keeps facts for free task clustering and admission contradiction checks but does NOT inject support-signal context into model packets — lower token cost, lower recall. Override with `CODEREVIEWER_AI_DETERMINISTIC_SIGNAL_MODE`. |

Holistic discovery and refutation packets reuse the provider task-input budget
instead of introducing stage-specific public settings. Under tight budgets the
workflow removes optional digest and ambient review context before recording a
recovered provider issue.

When a provider is configured and `contextMaxBytes` is not set explicitly, the
per-packet model-bound context budget scales with depth so deeper reviews see
more source per task: `fast` 60,000 bytes, `balanced` 120,000 bytes, `thorough`
240,000 bytes (the provider task-input packet cap is 360,000 bytes). An explicit
`contextMaxBytes` overrides these depth-scaled safety defaults.

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
| `reasoningEffort` | no | `"minimal" \| "low" \| "medium" \| "high"` | Unset uses the provider default. Maps to the OpenAI Responses API `reasoning.effort`; raises discovery/refutation quality on smaller reasoning models at higher token cost. |
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
- For OpenAI `gpt-5*` models (including dotted minor versions such as
  `gpt-5.4-mini`), omit `temperature` even when the normalized config contains
  its default value — these reasoning models reject `temperature` (HTTP 400).
- OpenAI-compatible providers keep the configured `temperature` because their
  model compatibility is provider-specific.
- The OpenAI/OpenAI-compatible adapter uses the Responses API (`api: 'responses'`),
  required for reasoning models with function tools. `provider.reasoningEffort`
  is forwarded as `reasoning.effort`; chat-completions would drop it.

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
`costs.outputPerMillion` values, or the bundled OpenAI model pricing snapshot,
only when token counts are available. Explicit `costs` values override bundled
pricing. If token counts or prices are unavailable, cost is omitted and
`maxCostUsd` is not enforceable; the run summary must include warning code
`cost-unavailable`.

When a provider surfaces prompt-cache usage, the cached input tokens (a subset
of the input tokens, already counted in the input aggregate) are re-priced at
`costs.cachedInputPerMillion` (or the bundled snapshot cached rate) when one is
known; otherwise they fall back to the full input price (no fabricated
discount). The cached input token count is surfaced in the run summary as
`cachedInputTokens`.

Provider-backed tasks should record detailed token/cost metadata when the
adapter exposes it:

| Field | Type | Rule |
| --- | --- | --- |
| `inputTokens` | integer >= 0 | Provider reported or tokenizer estimate. |
| `cachedInputTokens` | integer >= 0 | Cached (prompt-cache read) input tokens; a subset of `inputTokens`. |
| `outputTokens` | integer >= 0 | Provider reported or tokenizer estimate. |
| `totalTokens` | integer >= 0 | Sum of input and output tokens. |
| `costUsd` | number or null | Calculated when prices are known. |
| `costSource` | enum | `provider | configured | unavailable`. |

Run summaries aggregate available token/cost metadata per provider, model, task,
and run. Full per-task cost enforcement remains a required follow-up when the
selected provider adapters expose reliable usage data at the task boundary.

## Context Budget Defaults

| Depth | `contextMaxBytes` |
| --- | --- |
| `fast` | `100000` |
| `balanced` | `200000` |
| `thorough` | `500000` |

When no explicit `review.contextMaxBytes` is configured and a provider is
enabled, each provider-backed task uses the lower of the depth default and
`60000` bytes. Local deterministic review keeps the depth default. This is a
conservative byte-level safety guard until tokenizer-aware packing is
implemented.

Provider-backed task input also has a final serialized packet guard. The guard
must fail before provider invocation when a packet exceeds budget. It must not
truncate source, instructions, skills, evidence, deterministic signal output, or
metadata.
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

Default skills directory is `.codereviewer/skills` when it exists and
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
| `exclude` | glob[] | VCS/dependency/build/artifact dirs (`.git/**`, `node_modules/**`, `dist/**`, `coverage/**`, `.codereviewer/**`) plus generated/non-reviewable data files: dependency lock files (`**/package-lock.json`, `**/yarn.lock`, `**/pnpm-lock.yaml`, `**/npm-shrinkwrap.json`, `**/composer.lock`, `**/Gemfile.lock`, `**/poetry.lock`, `**/Cargo.lock`, `**/go.sum`), minified bundles (`**/*.min.js`, `**/*.min.css`), source maps (`**/*.map`), and snapshots (`**/*.snap`). |
| `artifactDir` | repository-relative path | `.codereviewer/runs` |

All path config is validated through `path-service` and must support Linux and
Windows separators.

## Baseline

| Key | Type | Default |
| --- | --- | --- |
| `enabled` | boolean | `true` |
| `path` | repository-relative path | `.codereviewer/baseline.json` |
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
| `failOnProviderError` | boolean | `true` |
| `failOnNewOnly` | boolean | value from `baseline.failOnNewOnly` |

Actionability is determined by `promotionPolicy`, refutation verdict, and the
severity floor.

## Promotion Policy

| Key | Type | Default |
| --- | --- | --- |
| `modelWeakOrRefuted` | `"artifact-only" | "rejected"` | `"artifact-only"` |

Rules:

- a model candidate becomes actionable only when its `RefutationResult.verdict =
  "proved"` and it meets the severity floor;
- a `refuted` candidate is rejected; a `needs-more-evidence` candidate is
  dispositioned by `modelWeakOrRefuted` (`artifact-only` keeps it auditable but
  out of the inline review; `rejected` drops it entirely);
- model candidates never become inline or quality-gate findings until they pass
  refutation;
- deterministic signal-only output is not actionable by default because
  production relies on adjacent CodeQL/linter/formatter/test/build pipelines.
  Trusted allowlisted deterministic rules are separate from generic signal-only
  output and may seed actionable evidence-backed candidates directly.

## Context Sources

Controls external change-intent context ingestion
(`11-external-context-ingestion.md`). Disabled by default.

| Key | Type | Default |
| --- | --- | --- |
| `contextSources.enabled` | boolean | `false` |
| `contextSources.providers` | array of provider objects | `[]` |
| `contextSources.summary.mode` | `"model" \| "digest"` | `"model"` when a provider is configured, else `"digest"` |
| `contextSources.summary.maxBytes` | integer | bounded change-intent-brief cap |

Each provider object is discriminated by `type`:

| `type` | Required keys | Purpose |
| --- | --- | --- |
| `platform` | `platform`, `transport`, `include` | Read PR/MR title, description, and comments through a `PlatformAdapter`. |
| `inbox` | `dir` | Read frontmatter-markdown context files a pipeline wrote before the run. No network. |
| `changed-files` | `include` | Surface PR-changed repository files matching globs as intent context. No network. |

Rules:

- the block is off unless `enabled` is `true`; a disabled block yields a review
  identical to one with no external context;
- `platform` is `github` in initial scope; `gitlab` and `bitbucket` are future
  implementations of the same adapter interface;
- `platform.transport` is `event` (read a CI payload file already on disk, no
  network) or `api` (read-only HTTP from an allowlisted `host`);
- `platform.include` selects among `title`, `description`, and `comments`;
- `inbox.dir` resolves under the repository root (default `.codereviewer/context`)
  and is bounded by file-count and per-file byte caps;
- `changed-files.include` selects PR-changed files by glob (for example
  `specs/**`, `docs/**`, `**/*.md`), bounded by file-count and byte caps;
- a network `host` is treated as an allowlist: only that host is contacted, and
  fetch targets are never derived from repository content or model output;
- credentials are referenced only by environment variable name (`tokenEnv`); a
  literal secret in configuration is rejected;
- an unknown `type`, a missing required key, or a non-allowlisted host fails
  `config validate` with `context_source_misconfigured` (exit code 2).

## Reporting

| Key | Type | Default |
| --- | --- | --- |
| `formats` | `ReportFormat[]` | `["json", "markdown", "sarif"]` |
| `sarif.target` | `"generic" | "github"` | `"generic"` |
| `sarif.category` | string | `"codereviewer"` |
| `sarif.maxResults` | integer 1..25000 | `5000` |
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
| `cachedInputPerMillion` | number >= 0 | omitted |
| `outputPerMillion` | number >= 0 | omitted |

Costs are operational metadata and safe to report after redaction. The bundled
pricing snapshot is generated from LiteLLM model pricing data and is used only
for configured `provider.id="openai"` models. When the snapshot exposes a cached
(prompt-cache read) input rate for a model it is captured as the per-model
cached rate; models without one stay conservative (cached input falls back to
the full input price). `cachedInputPerMillion` re-prices only the cached subset
of input tokens.

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
mode fail with exit code `1` when findings are present. Categories not in
`failOn` are implicitly treated as warnings: reported but non-blocking.
`ambiguity` is a warning by default.

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Run completed and quality gate passed or no gate configured. |
| `1` | Run completed and quality gate failed. |
| `2` | Config, provider setup, credentials, path, or CLI usage error. |
| `3` | Repository intake or filesystem error. |
| `4` | Provider/model runtime error. |
| `5` | Internal invariant violation. |
