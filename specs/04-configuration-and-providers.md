# 04: Configuration And Providers

Status: Approved
Date: 2026-07-31
Amended: 2026-08-07 — `paths.include` scopes files; a directory is traversable
when an included file could live beneath it (see *Include Scopes Files, Not
Traversal*)

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
| `CODEREVIEWER_JUDGE_MODEL` | `evaluation.judgeModel` | string |
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
it is a public configuration contract; the same document is regenerated into
`specs/03-contracts/config.schema.json`, and `npm run generate:schemas:check`
fails when either copy drifts from the Zod source.

Every object in `CodeReviewerConfigSchema` is a Zod `strictObject`. Unknown
top-level keys are errors, unknown nested keys are errors, and no object is
passthrough.

`CodeReviewerConfigSchema.review` MUST use `.prefault({})` rather than a restated
default literal. Zod's `.default(value)` returns that value verbatim without
parsing it, so a restated literal becomes a second source of truth that silently
wins over the field defaults — a change to `crossFileRetrieval` on the field
itself had no effect at all until this was fixed. `.prefault({})` parses `{}`
through the schema, making each field's own default the single source of truth.
This is why the generated JSON Schema carries no `default` object on `review`.

### Top-Level Shape

| Key | Required | Type | Default |
| --- | --- | --- | --- |
| `review` | no | object | built-in review defaults |
| `provider` | no | object | omitted; required only for model-backed review |
| `instructions` | no | object | no instructions |
| `skills` | no | object | no skills |
| `paths` | no | object | default includes/excludes |
| `baseline` | no | object | baseline matching enabled at the default path |
| `qualityGate` | no | object | no critical or high admitted findings |
| `security` | no | object | secure defaults; dedicated security pass and analyzer-signal ingestion disabled |
| `reporting` | no | object | JSON, Markdown, and SARIF local reports |
| `evaluation` | no | object | `minJudgeAgreement` 0.9 and the `stable` regression-gate profile; case selection is driven by `eval run` CLI flags, not config |
| `drift` | no | object | drift checks enabled as warnings |
| `observability` | no | object | OpenTelemetry disabled |
| `costs` | no | object | detailed token/cost tracking enabled with no prices |
| `aiReview` | no | object | holistic discovery + refutation defaults |
| `promotionPolicy` | no | object | non-actionable model output disposition |
| `contextSources` | no | object | external change-intent context disabled |
| `verification` | no | object | agentic claim verification disabled |
| `changeImpact` | no | object | change-impact review disabled |
| `intentFulfilment` | no | object | intent-fulfilment review disabled |
| `fix` | no | object | agentic finding investigation and fix disabled |

## Review Config

| Key | Type | Default | Rule |
| --- | --- | --- | --- |
| `mode` | `"local" | "ci" | "pr" | "full"` | `"local"` | `pr` does not publish in R1. |
| `depth` | `"fast" | "balanced" | "thorough"` | `"balanced"` | Selects the task-planning shape and the context-retrieval caps, nothing else. `fast` plans one task per changed file; `balanced` and `thorough` plan dependency-cluster tasks. Depth does not set cost, timeout, or concurrency. |
| `baseRef` | string | `"main"` | Must not start with `-`. |
| `headRef` | string | `"HEAD"` | Must not start with `-`. |
| `maxConcurrentTasks` | integer 1..32 | `4` | Caps active review tasks and provider model calls. |
| `maxFiles` | integer 1..10000 | `500` | Intake hard cap. |
| `maxFileBytes` | integer 1..5000000 | `500000` | Files above cap are skipped. |
| `contextMaxBytes` | integer 10000..10000000 | *unset* | Lowers the 8,000,000-byte packet ceiling and the depth-derived cross-file per-read cap. Unset means nothing bounds the packet in advance and the provider decides (spec 26). Never skips or truncates source. |
| `inlineSeverityThreshold` | severity | `"high"` | Only affects reporter eligibility. |
| `maxCostUsd` | number >= 0 | *unset* | Checked once, after the run's work completes and before the success result is built: the run fails when the computed run cost exceeds it. It is not a mid-run stop, and it is skipped entirely when cost is unavailable. |

`review.crossFileRetrieval`, `review.signalFacts` and `review.citations` are nested
review blocks and are inventoried in their own sections below.

### `review.signalFacts`

| Key | Type | Default | Rule |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Show discovery the deterministic signal facts. |

The facts are extracted, byte-accounted and shipped to refutation on every run; the
discovery packet is one rendered document and nothing rendered them into it, so
until this key existed only the adjudicating stage saw them. Off by default because
enabling it adds a section to every discovery prompt, and the A/B measured it null
(spec 05 §Discovery Citations records the same promotion discipline). With the key
off, the packet is byte-for-byte what it was before the section existed.

### `review.citations`

| Key | Type | Default | Rule |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Ask discovery to quote the line that shows the defect, and verify it deterministically. ON since 2026-08-11 on readability, not quality: the A/B was null for recall and precision, and the change is that a finding shows the line it rests on. Costs +5.6% input tokens; `false` returns that to zero. |

Specified in full in spec 05 §Discovery Citations, including the MUST that an
absent, malformed or unverifiable citation leaves the candidate exactly as it would
have been — the lane cannot cost a finding, by construction.

## AI Review Config

The AI review block controls model-driven holistic discovery and refutation. It
does not enable shell, network beyond the selected provider, filesystem writes,
or publishing.

| Key | Type | Default | Rule |
| --- | --- | --- | --- |
| `enabled` | boolean | *unset* | A provider-backed review runs when `provider` is configured and this is not explicitly `false`. Set it to `false` to run the deterministic path with a provider still configured. |
| `requireRefutation` | boolean (always `true`) | `true` | Every model candidate must survive the refutation pass before admission. |
| `actionableSeverityThreshold` | severity | `medium` | Minimum severity for a MODEL-origin finding to be admitted as actionable. Below this it is rejected as `below-threshold` (still recorded as a rejected finding). Trusted deterministic-rule findings are exempt. Keeps the engine focused on impactful runtime/security defects over low-severity nits. |
| `deterministicSignalMode` | `"support" | "disabled"` | `"support"` | `support` injects deterministic facts as model context (materially improves recall). `disabled` keeps facts for free task clustering and admission contradiction checks but does NOT inject support-signal context into model packets — lower token cost, lower recall. Override with `CODEREVIEWER_AI_DETERMINISTIC_SIGNAL_MODE`. |
| `maxFilesPerDiscoveryCall` | integer >= 1 | `2` | How many changed files ONE discovery call may review (spec 27). A task covering more is partitioned across several calls whose candidates are unioned; every partition receives the same shared context the undivided task would have. Partitioning engages only above this many changed files, so a small change is unaffected. When the dedicated security pass is on, it is partitioned on the same terms. |

Holistic discovery and refutation packets reuse the provider task-input budget
instead of introducing stage-specific public settings. Each stage is measured
against what it sends: a discovery call sends `{taskId, paths, reviewText}`, and a
refutation call sends its whole batch input.

A discovery packet drops nothing — it is refused whole. It has nothing optional to
drop: everything a discovery call transmits is the rendered review document. A
refutation packet still drops the support signals, then the ambient review
context, each accompanied by a `budgetNotice` naming what was withheld, because
those fields really are in what it sends. The shared digest that both stages once
carried is gone entirely (spec 05, *The Shared Digest Was A Constant*): it was
always the same constant, so dropping it never removed a byte that mattered. Nothing else is dropped and nothing is ever
truncated — a packet still over budget fails with `task_packet_budget_exceeded`
(exit code `4`, recoverable). At the default 8,000,000-byte ceiling this path is
not reached by any realistic change.

When `contextMaxBytes` is not set explicitly, nothing bounds the review packet in
advance: the change is sent whole and split only if the provider refuses it
(spec 26). A serialized packet is still capped at 8,000,000 bytes as a runaway
guard, which refuses rather than truncates.

The depth-scaled values (`fast` 60,000, `balanced` 120,000, `thorough` 240,000
bytes) survive only as the cross-file retrieval per-read cap applied when
`crossFileRetrieval.maxBytesPerRead` is unset. An explicit `contextMaxBytes`
lowers both the packet ceiling and that per-read cap.

`maxFilesPerDiscoveryCall` is a partitioning rule, not a byte budget. It never
splits a packet by size, so it does not reintroduce the proactive byte splitting
spec 26 removed.

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

Provider-backed tests are opt-in and excluded from `npm test`. They live in
`*.live.test.ts`, run only through `npm run test:live`, and each skips itself
unless both `CODEREVIEWER_PROVIDER_ID` and `CODEREVIEWER_PROVIDER_MODEL` are
present in the environment; no provider is assumed as a default.
`provider.baseUrl` must be configurable by config file and by
`CODEREVIEWER_PROVIDER_BASE_URL`.

## Depth Budget Defaults

`review.depth` does not set cost, timeout, or concurrency. `maxCostUsd` and
`maxCostUsd` is unset unless configured, and `maxConcurrentTasks` defaults to
`4` at every depth. The only per-depth defaults are the context-retrieval caps:

| Depth | `maxReads` | `maxSearches` | `maxMatches` | `maxDepth` |
| --- | --- | --- | --- | --- |
| `fast` | `200` | `100` | `50` | `4` |
| `balanced` | `1200` | `600` | `150` | `8` |
| `thorough` | `4800` | `2400` | `320` | `12` |

Depth does NOT derive a cross-file `maxBytesPerRead`. This table previously
carried a per-depth column of `60000`/`120000`/`240000`; **spec 28 (Approved,
2026-07-31) supersedes it** and forbids sizing a per-read limit against a context
window at all. What binds a read now is the runaway guard on the retrieval budget
(`4000000` bytes, sized against memory rather than context), unless an operator
explicitly configures `crossFileRetrieval.maxBytesPerRead`, which still binds and
still discloses when it does.

R1 cost reporting is intentionally conservative. Cost is computed only from token
counts: prices come from configured `costs.*` values, or, for
`provider.id = "openai"`, from the bundled model pricing snapshot. Explicit
`costs` values override bundled pricing. When token counts or prices are
unavailable, cost is omitted, `maxCostUsd` is not enforced, and the run summary
must include warning code `cost-unavailable`.

When a provider surfaces prompt-cache usage, the cached input tokens (a subset
of the input tokens, already counted in the input aggregate) are re-priced at
`costs.cachedInputPerMillion` (or the bundled snapshot cached rate) when one is
known; otherwise they fall back to the full input price (no fabricated
discount). The cached input token count is surfaced in the run summary as
`cachedInputTokens`.

Provider-backed tasks record detailed token/cost metadata whenever the adapter
exposes it:

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

`review.contextMaxBytes` is unset by default and MUST stay unset unless an
operator deliberately wants a local ceiling: the provider decides whether a packet
is too large (spec 26). When set it lowers the 8,000,000-byte packet ceiling, and
it MUST refuse rather than truncate when it binds.

`review.contextMaxBytes` does NOT lower the cross-file `maxBytesPerRead`. That
coupling, and the depth-derived per-read values it scaled, were both removed by
**spec 28 (Approved, 2026-07-31)**, which supersedes the earlier text here: a
per-read limit MUST NOT be sized against a context window. When
`crossFileRetrieval.maxBytesPerRead` is unset, the retrieval budget's own runaway
guard applies instead, and the only thing that shrinks it is an actual provider
`context_length_exceeded` (bounded halving with a loud failure at the floor, per
spec 28).

A byte-level packet budget was previously derived from depth. It was removed
because bytes are a poor proxy for tokens and the values fired on 37% of this
repository's last 60 commits, substituting several partial reviews for the
whole-file review measured as better.

Provider-backed task input has a final serialized packet guard fixed at
8,000,000 bytes, lowered only by an explicit `review.contextMaxBytes`. The guard
must fail before provider invocation when a packet exceeds it. It must not
truncate source, instructions, skills, evidence, deterministic signal output, or
metadata. The guard is a runaway guard against serializing a pathological packet,
not a context ration: it is deliberately sized far beyond any model context so it
cannot refuse before the provider has been asked.

The recovery is reactive splitting (spec 26): an oversized-context failure
reported by the provider halves the task and retries each half, bounded on
recursion depth. A unit that cannot be split further and is still refused fails
loudly and is never truncated.

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
| `files` | `{ path: string; scope?: string[] }[]` | `[]` |
| `inline` | string | `""` |
| `precedence` | fixed | CLI inline > config inline > files in listed order |

Instruction file paths must be repository-relative and must not traverse above
root. A configured file that does not exist fails the run; it is never
silently skipped. Run summaries record path and SHA-256 hash only.

Each file entry MAY declare `scope`: one or more glob patterns, matched with
the same repository-relative glob matcher `paths.include`/`paths.exclude`
use (`*`, `**`, `?` — no second matcher implementation). `scope` is REJECTED
if present and empty; an operator who wants "everywhere" omits the key
entirely rather than supplying an empty list, so a scope that resolves to
nothing is always a deliberate, non-empty pattern set rather than an
ambiguous default.

A review task packet covers a cluster of one or more changed files. An
instruction whose `scope` is set MUST be included in a packet if, and only
if, at least one file in that packet's reviewed files matches at least one
pattern in `scope` (an ANY-file match, not an ALL-files match). This is the
fail-safe direction: guidance withheld from a packet is invisible to the
reviewer and unrecoverable, while guidance included for one extra unrelated
file in a mixed packet is merely additional, visible, discountable content.
An instruction with no `scope` MUST be included in every packet, identical to
behavior before scoping was introduced.

An included instruction MUST reach both model calls built from that packet: the
discovery call and the refutation call. Reaching only refutation is not partial
delivery of the feature but a different feature — guidance that can kill a
candidate after the fact and can never shape what discovery looks for. Discovery
here means every discovery call the packet produces, including the dedicated
security pass (`15-security-focused-review.md`); no pass is exempt, because an
operator instruction describes the repository rather than one reviewing lens, and
a pass whose candidates are adjudicated against an instruction must be shown it.

Instructions are OPERATOR CONFIGURATION and are presented to the model as a
higher trust class than repository content, pull-request or ticket text, or the
change-intent brief. That trust is over CONTENT only. Instructions MUST NOT be
able to expand the reviewer's authority: they cannot authorize publishing or any
other action, widen review beyond the reviewed paths, or alter admission,
severity thresholds, the quality gate, or baseline status. Those are deterministic
code paths that never read instruction text, so the limit holds by construction;
the prompt states it as well, so a document that claims otherwise is contradicted
where the model reads it. The rendering MUST also state that operator instructions
appear in exactly one place, so repository content that imitates the section
acquires none of its standing.

`inline` has no scope and is always included in every packet: it is a single
operator-typed string, not a list of documents, so there is no set of
per-entry scopes it could carry. Area-specific free text is expressed as a
scoped entry under `files` instead.

## Skills

| Key | Type | Default |
| --- | --- | --- |
| `enabled` | boolean | `false` |
| `directories` | string[] | `[".codereviewer/skills"]` |
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

### Include Scopes Files, Not Traversal

`paths.include` selects FILES. A DIRECTORY is eligible for traversal when an
included file could live beneath it — when some path under that directory
matches an `include` pattern — even though the directory itself matches no
pattern. Under `include: ["src/**/*"]` the repository root `.` and `src` are
therefore traversable; under `include: ["packages/*/src/**/*"]` so are
`packages` and `packages/a`, which means the ancestor test must handle a
wildcard anywhere in a pattern and cannot be a literal-prefix shortcut. A
directory beneath which no included file can exist (`docs`, under either
example) stays ineligible.

The rule binds wherever the include layer is applied to a path being TRAVERSED
rather than served: the mediated `list` and `grep` of the verification,
change-impact, intent-fulfilment, and cross-file discovery lanes. Without it an
include list naming a subtree matched no directory to start a traversal from, so
a repository-wide `grep` and a `list` of the configured subtree were both
refused while a `read` of a file inside that same subtree succeeded — the whole
grep-then-read loop, defeated by the configuration this project's own guides
recommend.

This WIDENS traversal and does NOT widen what is served. Every file a traversal
yields — every entry a `list` returns, every file a `grep` opens, every path a
`read` addresses — is still gated individually as a file against the unchanged
`include` rule, and the hard floor and `paths.exclude` are evaluated first and
prune a directory outright. The requirements that make that argument hold are in
*Mediated Read Eligibility* in `07-security-privacy-operations.md`.

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
(`11-external-context-ingestion.md`). **Enabled by default** since 2026-08-11,
with a provider set that yields nothing — silently, and without a failure — on a
repository that has neither an inbox directory nor changed markdown.

| Key | Type | Default |
| --- | --- | --- |
| `contextSources.enabled` | boolean | `true` |
| `contextSources.providers` | array of provider objects | `[{ "type": "inbox", "dir": ".codereviewer/context" }, { "type": "changed-files", "include": ["**/*.md"] }]`, each at the per-provider defaults below |
| `contextSources.summary.mode` | `"model" \| "digest"` | *unset*; resolved at runtime to `"model"` when a provider is configured, else `"digest"` |
| `contextSources.summary.maxBytes` | integer 256..20000 | `4000` |

Each provider object is discriminated by `type`. The initial phase accepts the
two no-network providers; the network providers (`platform`, `mcp`) are later
phases (`11-external-context-ingestion.md`) and are added to this list when their
implementations and the required security controls ship.

| `type` | Keys and defaults | Purpose |
| --- | --- | --- |
| `inbox` | `dir` (`.codereviewer/context`), `maxFiles` 1..200 (`20`), `maxFileBytes` 1..1000000 (`64000`) | Read frontmatter-markdown context files a pipeline wrote before the run. No network. |
| `changed-files` | `include` (non-empty glob array, `["**/*.md"]`), `maxFiles` 1..200 (`20`), `maxFileBytes` 1..1000000 (`64000`) | Surface PR-changed repository files matching globs as intent context. No network. |

Rules:

- setting `enabled` to `false` yields a review identical to one with no external
  context, byte for byte. The block defaults on, so this is now the opt-OUT;
- **replacing `providers` replaces the default pair outright** — an array is not
  merged into the default. A configuration naming only an `inbox` provider
  therefore turns the `changed-files` one off, which is the intended behaviour
  but is worth knowing before it surprises someone;
- `inbox.dir` resolves under the repository root (default `.codereviewer/context`)
  and is bounded by file-count and per-file byte caps;
- `changed-files.include` selects PR-changed files by glob (for example
  `specs/**`, `docs/**`, `**/*.md`), bounded by file-count and byte caps;
- `summary.mode` defaults to `model` when a **model provider** (`provider`) is
  configured and `digest` otherwise. It is decided by `provider`, never by
  `contextSources.providers` — which now always has entries, so the two readings
  are no longer interchangeable. `model` distills through a dedicated provider
  call and falls back to `digest` if that call fails;
- an unknown `type` or a missing required key fails `config validate` with exit
  code 2.

## Verification

Controls the agentic verification flow (`12-verification-flow.md`). Disabled by
default.

| Key | Type | Default |
| --- | --- | --- |
| `verification.enabled` | boolean | `false` |
| `verification.providers` | array of claim-provider objects | `[]` |
| `verification.maxToolCallsPerClaim` | integer 1..50 | `12` |
| `verification.maxBytesPerRead` | integer >= 1 | `20000` |
| `verification.maxMatches` | integer >= 1 | `20` |

Claim-provider objects are discriminated by `type`:

| `type` | Keys | Purpose |
| --- | --- | --- |
| `claims-file` | `path` | Read a neutral claims file a pipeline wrote before the run. No network. |
| `prior-findings` | `report` | Derive claims from a previous run report or the baseline. |

Rules:

- the block is off unless `enabled` is `true`; a disabled block yields no
  verification flow and an unchanged general review;
- claim inputs are untrusted and cannot change admission, severity, gates, or
  baseline;
- an unknown `type` or a missing required key fails config validation (exit 2);
- the later-phase `analyzer` (SARIF) and `comment` claim providers are added to
  this list when their adapters ship.

## Change Impact

Controls change-impact review (`22-change-impact-review.md`). **Enabled by
default** since 2026-08-11, and reached both by `codereviewer impact check` and
by the in-process advisory lane `review` runs (`src/cli/advisory-lanes.ts`).

| Key | Type | Default |
| --- | --- | --- |
| `changeImpact.enabled` | boolean | `true` |
| `changeImpact.maxChangedSymbols` | integer 1..500 | `50` |
| `changeImpact.maxReferencesPerSymbol` | integer 1..500 | `25` |
| `changeImpact.maxReferenceCandidatesPerSymbol` | integer 1..5000 | `500` |
| `changeImpact.maxSearchDepth` | integer 0..32 | `12` |

Rules:

- with it disabled, `impact check` still exits `0` and writes an empty report
  carrying the warning `Change-impact review is disabled. Set changeImpact.enabled
  to true to run it.`;
- the command makes no provider call, so these bounds are its whole cost model:
  they bound repository traversal only;
- the bounds are per-run and per-symbol rather than one global pool, so a change
  touching many symbols cannot let the first symbol consume the entire reference
  budget;
- `maxReferenceCandidatesPerSymbol` bounds what the SEARCH collects and
  `maxReferencesPerSymbol` bounds what the REPORT lists, selected from those
  candidates. They are separate keys because they bound different things, and
  they were one number until 2026-08-06 — which meant the reporting cap was spent
  in traversal order on matches that were discarded immediately afterwards;
- a symbol with more dependents than `maxReferencesPerSymbol` lists is reported
  truncated rather than dropped, and a search stopped by
  `maxReferenceCandidatesPerSymbol` is reported separately again, so the report
  never silently understates how widely a symbol is used and never presents an
  unfinished search as a shortened list;
- there is deliberately no `blocking` key. The command reports references, not
  findings, and always exits `0`; the key is added in the same change that admits
  the first impact finding.

## Intent Fulfilment

Controls intent-fulfilment review (`23-intent-fulfilment-review.md`). **Enabled by
default** since 2026-08-11, and reached both by `codereviewer intent check` and
by the in-process advisory lane `review` runs (`src/cli/advisory-lanes.ts`).

| Key | Type | Default |
| --- | --- | --- |
| `intentFulfilment.enabled` | boolean | `true` |
| `intentFulfilment.maxObligations` | integer 1..100 | `100` |
| `intentFulfilment.maxIntentBytes` | integer 256..200000 | `100000` |
| `intentFulfilment.maxChangeLines` | integer 1..5000 | `5000` |

Rules:

- with it disabled, `intent check` still exits `0` and writes an empty report
  carrying the warning `Intent-fulfilment review is disabled. Set
  intentFulfilment.enabled to true to run it.`;
- every limit here is a runaway guard, not a ration. All three degrade the answer
  silently when they bind, so a value set where real inputs reach it turns the
  command into one that reports "nothing left to do" because it could not see;
- `maxObligations` caps both reported obligations and judgement calls (one call
  per obligation) and is therefore the spend bound;
- `maxIntentBytes` caps the summed redacted change-intent text handed to the one
  extraction call per run; the ingestion providers already bound themselves per
  file, this bounds the sum across several of them;
- `maxChangeLines` caps the changed lines each judgement call may cite, and is the
  limit whose binding does the most damage;
- there is deliberately no `blocking` key, and none is added later. Spec 23 makes
  advisory-only a requirement, not a default, so a `blocking` key would be accepted
  and then silently ignored.

## Fix

Controls the agentic finding investigation-and-fix job (`12-verification-flow.md`).
Disabled by default. Reuses the same agent, tools, and bounds as `verification`.

| Key | Type | Default |
| --- | --- | --- |
| `fix.enabled` | boolean | `false` |
| `fix.minSeverity` | `Severity` | value of `aiReview.actionableSeverityThreshold` (default `medium`) |

Rules:

- `enabled` is the single switch for the whole single pass — judgment and fix
  together; a disabled block yields no investigation and an unchanged general
  review and gate;
- the lane runs only on admitted findings at or above `minSeverity`; the default
  tracks the pipeline's blocking severity so out of the box it runs on findings
  that can block, not on nits;
- outputs are advisory: a `false-positive` judgment or a fix never changes
  admission, severity, or the gate;
- per-claim bounds are shared with `verification`.

## Review Conversation Config

| Key | Type | Default | Rule |
| --- | --- | --- | --- |
| `reviewConversation.enabled` | boolean | `false` | Whether a reply on a review comment can nominate that finding for a second, independent look. |

**This is the whole block, and that is the design** (spec 30). There is
deliberately no prompt override, no threshold, and no `blocking` key: spec 30
requirement 2 forbids giving the re-run any knowledge that a human objected, and
requirement 6 forbids the lane blocking — so anything else to configure would be
the defect rather than a feature. The config object is strict, so setting a key
that is not `enabled` is a configuration error rather than a silent no-op.

It is a TOP-LEVEL key, not nested under `review`, because the lane is a property of
the platform integration rather than of the review itself.

## Cross-File Retrieval

Controls agentic cross-file discovery (`16-agentic-cross-file-discovery.md`).
Enabled by default.

| Key | Type | Default |
| --- | --- | --- |
| `review.crossFileRetrieval.enabled` | boolean | `true` |
| `review.crossFileRetrieval.maxToolCallsPerTask` | integer 1..500 | `100` |
| `review.crossFileRetrieval.maxBytesPerRead` | integer 1000..4000000 | *unset* |

Rules:

- with it disabled, holistic discovery issues no tool call and runs as a single-shot
  review with no tools;
- when enabled, discovery may call the mediated `repo_read`/`repo_list`/`repo_grep`
  tools; `maxToolCallsPerTask` is a runaway-loop guard enforced in code, not a
  context ration, and the context retriever's own eligibility, redaction, and
  byte/match caps still apply;
- `maxBytesPerRead` is unset by default (spec 28). Setting it is a deliberate
  operator choice and it then binds every cross-file read, with the cut disclosed
  in the read's own summary. Unset, the per-read cap is the depth-derived value in
  *Depth Budget Defaults*, and the reviewer narrows a read itself by passing an
  optional `startLine`/`endLine` line range to `repo_read` after locating what it
  needs with `repo_grep`;
- retrieved content is untrusted repository data: it cannot bypass scope, severity,
  baseline, admission, or the gate, and its findings pass the same refutation and
  admission as any other candidate.

`enabled` defaults to `true` even though the recall gain is **not** statistically
significant. Two independent runs put it ahead on every measured dimension —
recall +5.7pp then +2.3pp, adjusted precision 100% both times, cost down both
times, zero provider errors — but neither run reached significance, so no specific
recall improvement is claimed. The earlier net-negative verdict is refuted: it was
measuring reads silently truncated at the old 24,000-byte cap.

## Removed Configuration Blocks

These keys were removed with the capabilities they controlled and MUST NOT be
reintroduced as compatibility shims. Because every config object is strict, a
config that still sets one fails validation with exit code `2` and the user is told
to remove it, rather than running a review that silently differs from what the file
asks for.

| Removed key | Removed | Withdrawn capability |
| --- | --- | --- |
| `review.contextScout` | 2026-07-27 | Context scout (spec 18) |
| `review.discoveryPosture` | 2026-07-27 | Discovery posture (spec 20) |
| `review.discoverySampleCount` | 2026-07-27 | Independent sampling (spec 21) |
| `invariantConformance` | 2026-08-02 | Invariant-conformance review (spec 24) |
| `review.refutationRetrieval` | 2026-08-06 | Cross-file retrieval inside refutation (spec 05) |

A removed key is never reused for something else, so a reader who finds one in an
old configuration file can always identify the capability it belonged to.

The withdrawals are recorded in `_provenance.yaml`. The reasoning for the four
`review.*` keys is in `05-review-workflow-and-runtime.md`; the reasoning for
`invariantConformance` is in `24-invariant-conformance-review.md`, which is kept
as a withdrawn spec so the measurement that removed it stays on record.

## Security

`security.dedicatedPass` controls the dedicated additive security review pass
(`15-security-focused-review.md`, Mechanism 1). Disabled by default. Generic
OWASP/CWE-derived detection only; never tuned to eval findings.

| Key | Type | Default |
| --- | --- | --- |
| `security.dedicatedPass.enabled` | boolean | `false` |

Rules:

- with it disabled, no security pass runs and the general review is unchanged
  (the same single discovery call per task);
- the security pass's candidates pass the same untrusted refutation and admission as
  any other candidate and are additive (they never displace a general candidate);
  the pass never bypasses scope, severity, baseline, or the gate.

`security.signals` controls the deterministic security-signal evidence layer
(`15-security-focused-review.md`, Mechanism 2): ingestion of analyzer artifacts a
project's own pipeline already produced. Disabled by default and **unmeasured**.
This engine runs no analyzer and depends on no analyzer package.

| Key | Type | Default |
| --- | --- | --- |
| `security.signals.enabled` | boolean | `false` |
| `security.signals.artifacts` | array of `{ path, format: "sarif" }` | `[]` |
| `security.signals.maxArtifactBytes` | integer 1–50000000 | `4000000` |
| `security.signals.maxAlerts` | integer 1–500 | `40` |

Rules:

- with it disabled, no artifact is read and the review packet is byte-for-byte
  what it was before the layer existed;
- `enabled: true` with an empty `artifacts` list fails validation: a switch that is
  on and reads nothing would report no security signals and look like a clean scan;
- an artifact path is resolved through the repository path service; one outside the
  repository — including via a symlink — is rejected;
- an artifact that is missing, oversized, not JSON, or not SARIF 2.1.0 fails the run
  with exit `2`; every category of result held back is reported as a run warning;
- an ingested result is shown only with a changed-side cause (its own location, or a
  step of the path it traces, on a changed line); results without one are not
  reported;
- an ingested result is EVIDENCE: it seeds no candidate and is never admitted. Any
  finding derived from it passes the same discovery, refutation, scope, severity,
  baseline, and admission path as any other.

## Reporting

| Key | Type | Default |
| --- | --- | --- |
| `formats` | `ReportFormat[]` | `["json", "markdown", "sarif"]` |
| `sarif.target` | `"generic" | "github"` | `"generic"` |
| `sarif.category` | string | `"codereviewer"` |
| `sarif.maxResults` | integer 1..25000 | `5000` |
| `reviewComments.enabled` | boolean | `true` (since 2026-08-11) |
| `reviewComments.platform` | `"github" | "gitlab" | "bitbucket" | "generic" | "auto"` | `"auto"` |

JSON is always generated even if omitted from `formats`, because it is the
canonical machine-readable artifact. Markdown and SARIF rendering can be disabled
only when their format is absent from `formats`.

Every rendered report format redacts secret-shaped text unconditionally; there is
deliberately no `sarif.redact` key to turn that off, since a toggle a renderer
never reads would be a switch that lies about doing something.

`reviewComments` writes platform-neutral inline review-comment drafts, including
one-click fix suggestions, as local artifacts only — it performs no network
publishing (`13-review-comments-and-suggestions.md`). That "publishes nothing"
property is what makes defaulting it on safe; the flip carries no accuracy claim,
because the block is a renderer and not a lever. A suggestion is offered only
when its edits still apply to the file's current bytes. `platform` selects the
renderer; `auto` resolves it from CI environment, then the git remote host, then
`generic`. An explicit value overrides detection.

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

## Evaluation Config

| Key | Type | Default |
| --- | --- | --- |
| `minJudgeAgreement` | number 0..1 | `0.9` |
| `judgeModel` | string or unset | unset (the judges use `provider.model`) |
| `regressionGate.profile` | `"stable" \| "strict"` | `"stable"` |
| `regressionGate.overrides` | per-threshold override object | `{}` |

There is deliberately no `evaluation.enabled` key. Case selection is driven by
`eval run` CLI flags, so an `enabled` flag would be accepted by config validation
and then silently ignored. `regressionGate` is defined in
`06-evaluation-and-quality-gates.md`, section *Eval Regression Gate*.

`minJudgeAgreement` is the minimum semantic-judge agreement against the
committed calibration set described in `06-evaluation-and-quality-gates.md`. The
judge is the sole authority for every eval quality metric, so a run whose
measured agreement falls below this value reports
`scoring.judgeTrustworthy = false`. It marks the run's metrics as untrustworthy;
it does not by itself fail the regression gate.

`judgeModel` pins the model the eval's semantic-match judge and plausibility
judge run on, independently of `provider.model`, which the reviewer under test
keeps using. It overrides the model only — provider id, credentials, base URL,
retry and timeout stay the run's own — and it moves nothing in the review
workflow. Unset, the judges resolve from the reviewer's provider config
unchanged, which is the historical behaviour. A model comparison must set it to
one value across both arms; the rationale, and the requirement that a published
comparison state the judge it was scored with, are in
`06-evaluation-and-quality-gates.md`, section *The Judge Must Be Pinnable
Independently Of The Reviewer*.

## Security Config

| Key | Type | Default |
| --- | --- | --- |
| `allowShell` | boolean | `false` |
| `allowNetwork` | boolean | `false` |
| `allowFilesystemWrite` | boolean | `false` |
| `captureContentTelemetry` | boolean | `false` |
| `dedicatedPass.enabled` | boolean | `false` |

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
