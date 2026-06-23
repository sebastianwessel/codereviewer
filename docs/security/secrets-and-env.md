# Secrets And Env

How CodeReviewer loads secrets and environment variables, and which variables map to which config fields.

This page covers the `.env` workflow, the config-override variables, and the provider secrets the engine reads.

---

## Local `.env` workflow

Use `.env.example` as the template and `.env` for local secrets:

```bash
cp .env.example .env
```

`.env` is ignored by git. CI should use native secret storage.

For review commands, root `.env` values override exported process environment
values. This lets a project-local `.env` define the intended local provider
without requiring shell exports.

> **Note:** Provider-backed CLI commands run through `npm run cli -- ...` (from a
> cloned repository) load `.env` with Node's native `--env-file-if-exists=.env`
> flag. See [Evaluation](../evaluation/README.md) for the from-source workflow.

---

## Config Overrides

Each variable maps to a single config field:

| Variable | Maps To |
| --- | --- |
| `CODEREVIEWER_REVIEW_MODE` | `review.mode` |
| `CODEREVIEWER_REVIEW_DEPTH` | `review.depth` |
| `CODEREVIEWER_BASE_REF` | `review.baseRef` |
| `CODEREVIEWER_HEAD_REF` | `review.headRef` |
| `CODEREVIEWER_PROVIDER_ID` | `provider.id` |
| `CODEREVIEWER_PROVIDER_MODEL` | `provider.model` |
| `CODEREVIEWER_PROVIDER_BASE_URL` | `provider.baseUrl` |
| `CODEREVIEWER_PROVIDER_REASONING_EFFORT` | `provider.reasoningEffort` |
| `CODEREVIEWER_ARTIFACT_DIR` | `paths.artifactDir` |
| `CODEREVIEWER_CONFIG_PATH` | config path override |
| `CODEREVIEWER_SKILLS_DIR` | first configured skills directory |
| `CODEREVIEWER_AI_INTENT_PLANNING` | `aiReview.intentPlanning` |
| `CODEREVIEWER_AI_DETERMINISTIC_SIGNAL_MODE` | `aiReview.deterministicSignalMode` |
| `CODEREVIEWER_AI_JUDGE_FINDINGS` | `aiReview.judgeFindings` |
| `CODEREVIEWER_LOG_LEVEL` | `observability.logging.level` |
| `CODEREVIEWER_OPENTELEMETRY_ENABLED` | `observability.openTelemetry.enabled` |
| `CODEREVIEWER_OPENTELEMETRY_ENDPOINT` | `observability.openTelemetry.endpoint` |
| `CODEREVIEWER_COST_INPUT_PER_MILLION` | `costs.inputPerMillion` |
| `CODEREVIEWER_COST_OUTPUT_PER_MILLION` | `costs.outputPerMillion` |

---

## Provider Secrets

| Variable | Use |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI and some compatible providers. |
| `AWS_REGION` | AWS Bedrock region. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS credentials when not using role-based auth. |
| `AZURE_AI_ENDPOINT` | Azure endpoint. |
| `AZURE_AI_API_KEY` | Azure API key when not using managed identity. |

> **Warning:** Do not store provider keys in `.codereviewer/config.json`.

---

## See also

- [Environment reference](../reference/environment.md)
- [Data handling](./data-handling.md)
- [Providers](../guides/providers.md)
