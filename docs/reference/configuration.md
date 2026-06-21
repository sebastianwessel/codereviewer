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
| `qualityGate` | `minEvidenceLevel` | `non-model`, `model-ok` |
| `qualityGate` | `failOnProviderError` | boolean |
| `qualityGate` | `failOnNewOnly` | boolean (defaults to `baseline.failOnNewOnly`) |
| `costs` | `inputPerMillion`, `outputPerMillion` | number >= 0 |
| `observability` | `logging.level` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` |
| `observability` | `openTelemetry.enabled` | boolean |
| `security` | `allowShell` | always `false` |
| `security` | `allowNetwork` | always `false` in R1 |
| `security` | `allowFilesystemWrite` | always `false` in R1 |
| `security` | `captureContentTelemetry` | always `false` |
| `drift` | `enabled` | boolean |
| `drift` | `failOn` | drift category array |
| `drift` | `warnOn` | drift category array |
| `drift` | `includeDocs`, `includeSpecs`, `includeGenerated` | boolean |
| `reporting` | `formats` | `json`, `markdown`, `sarif` |
| `evaluation` | `enabled` | boolean |

Default `paths.exclude` is `[".git/**", "node_modules/**", "dist/**",
"coverage/**", ".review/**", ".codereviewer/**"]`.

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

`review.maxConcurrentTasks` caps both active review tasks and active provider
model calls. Provider calls also use `provider.timeoutMs`; whole-run timeout is
only applied when `review.runTimeoutMs` is configured. Provider-backed review
uses rolling workers, so a new task may start as soon as one active provider
call completes.
