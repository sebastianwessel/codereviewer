# Environment Variables

Two distinct sets of variables exist:

1. **`CODEREVIEWER_*` config overrides** — a closed list mapped into the config
   object by the loader. Every other `CODEREVIEWER_*` name is ignored.
2. **Provider credentials** — read by provider adapters at resolution time and
   never copied into normalized config, logs, or artifacts.

Precedence: config file < process environment < `.env` < CLI flags. See
[configuration/README.md](./configuration/README.md#precedence).

## Config overrides

| Variable | Config path | Type / accepted values |
| --- | --- | --- |
| `CODEREVIEWER_CONFIG_PATH` | config file location | repository-relative path. Used only when `--config` is absent. A path set here that does not exist is a `config_error` (exit `2`), not a fallback to defaults. |
| `CODEREVIEWER_REVIEW_MODE` | `review.mode` | `local` \| `ci` \| `pr` \| `full` |
| `CODEREVIEWER_REVIEW_DEPTH` | `review.depth` | `fast` \| `balanced` \| `thorough` |
| `CODEREVIEWER_BASE_REF` | `review.baseRef` | string (must not start with `-`) |
| `CODEREVIEWER_HEAD_REF` | `review.headRef` | string (must not start with `-`) |
| `CODEREVIEWER_PROVIDER_ID` | `provider.id` | `openai` \| `openai-compatible` \| `bedrock` \| `azure` |
| `CODEREVIEWER_PROVIDER_MODEL` | `provider.model` | string |
| `CODEREVIEWER_PROVIDER_BASE_URL` | `provider.baseUrl` | URL |
| `CODEREVIEWER_PROVIDER_REASONING_EFFORT` | `provider.reasoningEffort` | `minimal` \| `low` \| `medium` \| `high` |
| `CODEREVIEWER_AI_DETERMINISTIC_SIGNAL_MODE` | `aiReview.deterministicSignalMode` | `support` \| `disabled` |
| `CODEREVIEWER_ARTIFACT_DIR` | `paths.artifactDir` | repository-relative path |
| `CODEREVIEWER_SKILLS_DIR` | `skills.directories` | repository-relative path. **Replaces the whole array** with this single entry. |
| `CODEREVIEWER_LOG_LEVEL` | `observability.logging.level` | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` \| `silent` |
| `CODEREVIEWER_OPENTELEMETRY_ENABLED` | `observability.openTelemetry.enabled` | exactly `true` or `false` (any other string is a config error) |
| `CODEREVIEWER_OPENTELEMETRY_ENDPOINT` | `observability.openTelemetry.endpoint` | URL |
| `CODEREVIEWER_OPENTELEMETRY_HEADERS` | `observability.openTelemetry.headers` | JSON object with string values, e.g. `{"x-api-key":"…"}` |
| `CODEREVIEWER_COST_INPUT_PER_MILLION` | `costs.inputPerMillion` | finite number |
| `CODEREVIEWER_COST_CACHED_INPUT_PER_MILLION` | `costs.cachedInputPerMillion` | finite number |
| `CODEREVIEWER_COST_OUTPUT_PER_MILLION` | `costs.outputPerMillion` | finite number |

Notes:

- an **empty-string** value is treated as unset;
- there is no environment variable for the quality gate, baseline, verification,
  fix, security, drift, reporting formats, or any `review.*` key beyond mode,
  depth, and the two refs — use the config file;
- a malformed value (bad boolean, non-finite number, non-object header JSON,
  value outside an enum) fails config loading with exit `2`.

## Provider credentials

Resolved by the adapter, checked before the first call, never normalized into
config and never printed.

| `provider.id` | Required | Notes |
| --- | --- | --- |
| `openai` | `OPENAI_API_KEY` | |
| `openai-compatible` | `OPENAI_API_KEY` | plus `provider.baseUrl` in config or `CODEREVIEWER_PROVIDER_BASE_URL` |
| `bedrock` | `AWS_REGION` | the AWS credential chain is resolved by the SDK and is not pre-checked |
| `azure` | `AZURE_AI_ENDPOINT`, `AZURE_AI_API_KEY` | |

A missing value fails fast with `provider_credentials_missing` (exit `2`),
naming the variable only.

## `.env` handling

The loader reads `.env` from the repository root, best-effort.

| Rule | Behavior |
| --- | --- |
| Missing file | Not an error (CI usually injects real environment variables). |
| Precedence | `.env` values **override** process environment values of the same name. |
| Blank lines, `#` comments | Skipped. |
| Line format | `KEY=VALUE`; the first `=` splits. A line with no `=`, or `=` at position 0, is an error. |
| Key format | Must match `^[A-Za-z_][A-Za-z0-9_]*$`. A `export FOO=bar` prefix is **not** supported and fails the line. |
| Quotes | One leading and one trailing `"` or `'` are stripped after trimming. |
| Invalid syntax | Config error, exit `2` — a broken local setup fails loudly instead of silently. |
| `eval run` | Does **not** read `.env` at all (`loadDotEnv: false`), so eval stays hermetic. Provider-backed eval scripts pass Node's `--env-file-if-exists=.env` instead. |

## Related

- [Configuration reference](./configuration/README.md)
- [`provider` configuration](./configuration/provider.md)
- [Exit codes and error codes](./exit-codes-and-error-codes.md)
