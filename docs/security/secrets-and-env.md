# Secrets And Env

Use `.env.example` as the template and `.env` for local secrets:

```bash
cp .env.example .env
```

`.env` is ignored by git. CI should use native secret storage.

For review commands, root `.env` values override exported process environment
values. This lets a project-local `.env` define the intended local provider
without requiring shell exports. Evaluation runs do not load root `.env` by
default.

## Config Overrides

| Variable | Maps To |
| --- | --- |
| `CODEREVIEWER_REVIEW_MODE` | `review.mode` |
| `CODEREVIEWER_REVIEW_DEPTH` | `review.depth` |
| `CODEREVIEWER_BASE_REF` | `review.baseRef` |
| `CODEREVIEWER_HEAD_REF` | `review.headRef` |
| `CODEREVIEWER_PROVIDER_ID` | `provider.id` |
| `CODEREVIEWER_PROVIDER_MODEL` | `provider.model` |
| `CODEREVIEWER_PROVIDER_BASE_URL` | `provider.baseUrl` |
| `CODEREVIEWER_ARTIFACT_DIR` | `paths.artifactDir` |
| `CODEREVIEWER_CONFIG_PATH` | config path override |
| `CODEREVIEWER_SKILLS_DIR` | first configured skills directory |
| `CODEREVIEWER_LOG_LEVEL` | `observability.logging.level` |
| `CODEREVIEWER_OPENTELEMETRY_ENABLED` | `observability.openTelemetry.enabled` |
| `CODEREVIEWER_OPENTELEMETRY_ENDPOINT` | `observability.openTelemetry.endpoint` |
| `CODEREVIEWER_COST_INPUT_PER_MILLION` | `costs.inputPerMillion` |
| `CODEREVIEWER_COST_OUTPUT_PER_MILLION` | `costs.outputPerMillion` |

## Provider Secrets

| Variable | Use |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI and some compatible providers. |
| `AWS_REGION` | AWS Bedrock region. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS credentials when not using role-based auth. |
| `AZURE_AI_ENDPOINT` | Azure endpoint. |
| `AZURE_AI_API_KEY` | Azure API key when not using managed identity. |

Do not store provider keys in `.review/config.json`.
