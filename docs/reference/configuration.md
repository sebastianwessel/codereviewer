# Configuration Reference

| Section | Key | Values |
| --- | --- | --- |
| `review` | `mode` | `local`, `ci`, `pr`, `full` |
| `review` | `depth` | `fast`, `balanced`, `thorough` |
| `review` | `baseRef`, `headRef` | git refs not starting with `-` |
| `review` | `maxConcurrentTasks` | `1` to `32` |
| `review` | `maxFiles` | `1` to `10000` |
| `review` | `maxFileBytes` | `1` to `5000000` |
| `review` | `contextMaxFiles` | `1` to `2000`; planning hint, never a coverage cap |
| `review` | `contextMaxBytes` | `10000` to `10000000`; per-packet budget, never a coverage cap |
| `review` | `runTimeoutMs` | optional whole-run timeout; unset disables the Harness run timeout |
| `provider` | `id` | `openai`, `openai-compatible`, `bedrock`, `azure` |
| `provider` | `model` | non-empty string |
| `provider` | `baseUrl` | URL, required for `openai-compatible` |
| `provider` | `reasoningEffort` | `minimal`, `low`, `medium`, `high` (OpenAI Responses `reasoning.effort`; env `CODEREVIEWER_PROVIDER_REASONING_EFFORT`) |
| `provider` | `maxRetries` | `0` to `5`; classified retries, total attempts = `maxRetries + 1` |
| `provider` | `retryBackoffMs` | `0` to `60000`; base exponential backoff delay |
| `provider` | `retryMaxDelayMs` | `0` to `600000`; max single wait; longer required waits fail |
| `instructions` | `files` | repository-relative paths |
| `instructions` | `inline` | string |
| `skills` | `enabled` | boolean |
| `skills` | `directories` | repository-relative paths |
| `skills` | `allowTools` | `read`, `list`, `grep` |
| `paths` | `include`, `exclude` | glob arrays |
| `paths` | `artifactDir` | repository-relative path |
| `baseline` | `enabled` | boolean |
| `baseline` | `path` | repository-relative path |
| `baseline` | `failOnNewOnly` | boolean |
| `baseline` | `includeResolvedInReport` | boolean |
| `qualityGate` | `maxCritical`, `maxHigh` | integer >= 0 (default `0`) |
| `qualityGate` | `maxMedium` | integer >= 0 (unset = no fail) |
| `qualityGate` | `failOnProviderError` | boolean |
| `qualityGate` | `failOnNewOnly` | boolean (defaults to `baseline.failOnNewOnly`) |
| `aiReview` | `enabled` | boolean, defaults to enabled when a provider is configured |
| `aiReview` | `maxSuspicionsPerTask` | `0` to `20` |
| `aiReview` | `maxInvestigationsPerRun` | `0` to `200` |
| `aiReview` | `maxToolReadsPerInvestigation` | `0` to `50` |
| `aiReview` | `maxToolSearchesPerInvestigation` | `0` to `25` |
| `aiReview` | `maxInvestigationRounds` | `1` to `5` |
| `aiReview` | `requireRefutation` | always `true` in R1 |
| `aiReview` | `intentPlanning` | `auto`, `deterministic`, `model` |
| `aiReview` | `judgeFindings` | boolean, default `false` |
| `aiReview` | `externalStaticAnalysisAssumed` | boolean |
| `aiReview` | `deterministicSignalMode` | `support` (inject facts as model context; better recall) or `disabled` (keep clustering, skip injection; lower cost/recall). Env: `CODEREVIEWER_AI_DETERMINISTIC_SIGNAL_MODE` |
| `aiReview` | `actionableSeverityThreshold` | severity, default `medium` (model findings below it are rejected as below-threshold; trusted deterministic rules exempt) |
| `promotionPolicy` | `modelProof` | `actionable`, `artifact-only` |
| `promotionPolicy` | `modelSuspicion` | `artifact-only`, `rejected` |
| `promotionPolicy` | `modelWeakOrRefuted` | `artifact-only`, `rejected` |
| `promotionPolicy` | `deterministicSignalOnly` | `artifact-only`, `rejected` |
| `promotionPolicy` | `staticAnalysisDuplicate` | `artifact-only`, `rejected` |
| `promotionPolicy` | `deterministicContradiction` | `artifact-only`, `rejected` |
| `costs` | `inputPerMillion`, `outputPerMillion` | number >= 0 |
| `observability` | `logging.level` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` |
| `observability` | `openTelemetry.enabled` | boolean |
| `security` | `allowShell` | always `false` |
| `security` | `allowNetwork` | always `false` in R1 |
| `security` | `allowFilesystemWrite` | always `false` in R1 |
| `security` | `captureContentTelemetry` | always `false` |

`promotionPolicy.deterministicSignalOnly` applies to generic support-signal
output. Trusted allowlisted deterministic rules can seed actionable candidates
directly when they have local evidence and a concrete fix direction.
| `drift` | `enabled` | boolean |
| `drift` | `failOn` | drift category array |
| `drift` | `warnOn` | drift category array |
| `drift` | `includeDocs`, `includeSpecs`, `includeGenerated` | boolean |
| `reporting` | `formats` | `json`, `markdown`, `sarif`, `github-review-comments` |
| `evaluation` | `enabled` | boolean |

Default `paths.exclude` is `[".git/**", "node_modules/**", "dist/**",
"coverage/**", ".codereviewer/**"]` plus generated/non-reviewable data files
(dependency lock files such as `**/package-lock.json`, `**/yarn.lock`,
`**/pnpm-lock.yaml`, `**/Cargo.lock`, `**/go.sum`; minified bundles `**/*.min.js`
and `**/*.min.css`; source maps `**/*.map`; and test snapshots `**/*.snap`).
These carry no semantic logic to review, so excluding them lowers token cost and
noise. Add app-specific data such as locale bundles via `paths.exclude` if
desired.

When provider token usage is available, explicit `costs` values override the
bundled OpenAI model pricing snapshot. Unknown model prices are reported with
`cost-unavailable`.

The generated JSON schema is available at:

```text
schema/codereviewer-config.schema.json
```

Default hard drift categories are `generated-artifact-drift` and
`security-drift`. Ambiguity is a warning unless moved to `drift.failOn`.

`observability.logging.level` defaults to `silent`. Override it with
`CODEREVIEWER_LOG_LEVEL`, `review --log-level <level>`, or `review --debug`.
Operational logs are newline-delimited JSON and are sanitized to exclude source
snippets, prompts, request/response bodies, provider headers, environment
values, tokens, and secrets.

`aiReview.intentPlanning` can be overridden with
`CODEREVIEWER_AI_INTENT_PLANNING`. `aiReview.judgeFindings` can be enabled with
`CODEREVIEWER_AI_JUDGE_FINDINGS=true`. `eval run` also accepts
`--review-mode`, `--review-depth`, `--intent-planning`, and `--judge-findings`
so benchmark runs can force an agentic review posture without changing the
repository config. The committed `eval:benchmark` helper uses that forced
agentic PR-review posture by default; `eval:benchmark:baseline` preserves the
older current-config benchmark posture for comparison.

`review.maxConcurrentTasks` caps both active review tasks and active provider
model calls. Provider calls also use `provider.timeoutMs`; whole-run timeout is
only applied when `review.runTimeoutMs` is configured. Provider-backed review
uses rolling workers, so a new task may start as soon as one active provider
call completes.

`aiReview.intentPlanning = "auto"` records deterministic intents for local or
single-task runs and uses a compact model planner for multi-task non-local
reviews. `model` forces that planner for multi-task runs; `deterministic`
records one intent per task without an extra model call.
`aiReview.judgeFindings = true` adds a stricter critic pass for proved
model-origin candidates before admission. When the judge requests more context,
the same `aiReview.maxInvestigationRounds` cap bounds its mediated follow-up
rounds. Investigation, optional aggregate, and judge packets also use the
existing provider task-input budget; under tight budgets the workflow drops
optional intent, trace, digest, and ambient context before recording a
recovered provider issue.

## Eval Regression Gate Thresholds

The saved `eval-report.json` records the thresholds used when the regression
gate was evaluated. The gate supports the following optional threshold fields;
each defaults to unset (no fail):

| Threshold | Description |
| --- | --- |
| `minParseValidity` | Minimum fraction of cases with a valid parse. |
| `minRecall` | Minimum overall recall. |
| `minPrecision` | Minimum overall precision. |
| `minSeverityWeightedF1` | Minimum severity-weighted F1. |
| `maxFalsePositiveCount` | Maximum total false positives. |
| `maxCommentsPerKloc` | Maximum comments per thousand changed lines. |
| `maxCommentsPerDiffHunk` | Maximum comments per diff hunk. |
| `maxIncompleteCoverageRate` | Maximum fraction of cases with incomplete coverage. |
| `maxContextMutationRate` | Maximum fraction of context entries that were mutated. |
| `maxCostUsd` | Maximum total cost in USD. |
| `maxDurationMs` | Maximum total duration in milliseconds. |
| `minProductRecall` | Minimum recall over `runtime-critical`, `security`, and `logic` tiers (excluding `nit`). This is the primary accuracy target gate. |
| `minSuspicionStageCoverage` | Minimum fraction of non-provider-error cases that produced at least one model suspicion. |
| `minJudgeCoverage` | Minimum judged candidates divided by actionable-promoted proofs. Only enforced when `judgeFindings` is enabled. |
| `failOnProviderError` | Whether any provider-errored case fails the gate. Default `true`. |
