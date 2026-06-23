# Environment Reference

Reference for all environment variables recognized by CodeReviewer. Variables
set in a root `.env` file override exported process environment values for
review commands; CLI flags still win where a flag exists for the same setting.

> **Note:** Plain `npm run eval` does **not** load `.env`. Provider-backed eval
> helpers (`npm run eval:with-env`, `npm run eval:semantic`,
> `npm run cli -- …`) load `.env` via Node's native
> `--env-file-if-exists=.env` flag.

See [Configuration Reference](configuration.md) for the full description of
each setting and its allowed values.

---

## Config overrides

These variables correspond directly to keys in `.codereviewer/config.json`.
Where both exist, the env variable wins over the file but loses to a CLI flag.

| Variable | Example value | Config key |
| --- | --- | --- |
| `CODEREVIEWER_REVIEW_MODE` | `ci` | `review.mode` |
| `CODEREVIEWER_REVIEW_DEPTH` | `balanced` | `review.depth` |
| `CODEREVIEWER_BASE_REF` | `main` | `review.baseRef` |
| `CODEREVIEWER_HEAD_REF` | `HEAD` | `review.headRef` |
| `CODEREVIEWER_PROVIDER_ID` | `openai` | `provider.id` |
| `CODEREVIEWER_PROVIDER_MODEL` | `gpt-5-mini` | `provider.model` |
| `CODEREVIEWER_PROVIDER_BASE_URL` | `https://example.internal/v1` | `provider.baseUrl` |
| `CODEREVIEWER_PROVIDER_REASONING_EFFORT` | `medium` | `provider.reasoningEffort` |
| `CODEREVIEWER_CONFIG_PATH` | `.codereviewer/config.json` | config file location |
| `CODEREVIEWER_ARTIFACT_DIR` | `.codereviewer/runs` | `paths.artifactDir` |
| `CODEREVIEWER_SKILLS_DIR` | `.codereviewer/skills` | `skills.directories` |
| `CODEREVIEWER_AI_INTENT_PLANNING` | `auto` | `aiReview.intentPlanning` |
| `CODEREVIEWER_AI_DETERMINISTIC_SIGNAL_MODE` | `support` | `aiReview.deterministicSignalMode` |
| `CODEREVIEWER_AI_JUDGE_FINDINGS` | `false` | `aiReview.judgeFindings` |
| `CODEREVIEWER_LOG_LEVEL` | `info` | `observability.logging.level` |
| `CODEREVIEWER_OPENTELEMETRY_ENABLED` | `false` | `observability.openTelemetry.enabled` |
| `CODEREVIEWER_OPENTELEMETRY_ENDPOINT` | `http://localhost:4318/v1/traces` | OpenTelemetry trace endpoint |
| `CODEREVIEWER_OPENTELEMETRY_HEADERS` | `{"Authorization":"Bearer ..."}` | OpenTelemetry request headers (JSON object) |
| `CODEREVIEWER_COST_INPUT_PER_MILLION` | `0.25` | `costs.inputPerMillion` |
| `CODEREVIEWER_COST_OUTPUT_PER_MILLION` | `1.25` | `costs.outputPerMillion` |

---

## Provider credentials

Provider adapters resolve their own credentials from the process environment.
These variables are **never** copied into the normalized config or logs.

| Variable | Provider family |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI, compatible providers |
| `AWS_REGION` | Bedrock |
| `AWS_ACCESS_KEY_ID` | Bedrock |
| `AWS_SECRET_ACCESS_KEY` | Bedrock |
| `AZURE_AI_ENDPOINT` | Azure |
| `AZURE_AI_API_KEY` | Azure |

See [Providers guide](../guides/providers.md) and
[Secrets and env](../security/secrets-and-env.md) for setup details.
