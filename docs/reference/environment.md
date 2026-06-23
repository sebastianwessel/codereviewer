# Environment Reference

Root `.env` values override exported process environment values for review
commands. CLI flags still win where a command exposes a flag. Plain
`npm run eval` does not load `.env`. Provider-backed eval helpers such as
`npm run eval:with-env`, `npm run eval:semantic`, and `npm run cli -- ...` load
`.env` with Node's native `--env-file-if-exists=.env` flag.

## Config Overrides

| Variable | Example |
| --- | --- |
| `CODEREVIEWER_REVIEW_MODE` | `ci` |
| `CODEREVIEWER_REVIEW_DEPTH` | `balanced` |
| `CODEREVIEWER_BASE_REF` | `main` |
| `CODEREVIEWER_HEAD_REF` | `HEAD` |
| `CODEREVIEWER_PROVIDER_ID` | `openai` |
| `CODEREVIEWER_PROVIDER_MODEL` | `gpt-5-mini` |
| `CODEREVIEWER_PROVIDER_BASE_URL` | `https://example.internal/v1` |
| `CODEREVIEWER_PROVIDER_REASONING_EFFORT` | `medium` |
| `CODEREVIEWER_CONFIG_PATH` | `.codereviewer/config.json` |
| `CODEREVIEWER_ARTIFACT_DIR` | `.codereviewer/runs` |
| `CODEREVIEWER_SKILLS_DIR` | `.codereviewer/skills` |
| `CODEREVIEWER_AI_INTENT_PLANNING` | `auto` |
| `CODEREVIEWER_AI_DETERMINISTIC_SIGNAL_MODE` | `support` |
| `CODEREVIEWER_AI_JUDGE_FINDINGS` | `false` |
| `CODEREVIEWER_LOG_LEVEL` | `info` |
| `CODEREVIEWER_OPENTELEMETRY_ENABLED` | `false` |
| `CODEREVIEWER_OPENTELEMETRY_ENDPOINT` | `http://localhost:4318/v1/traces` |
| `CODEREVIEWER_OPENTELEMETRY_HEADERS` | `{"Authorization":"Bearer ..."}` |
| `CODEREVIEWER_COST_INPUT_PER_MILLION` | `0.25` |
| `CODEREVIEWER_COST_OUTPUT_PER_MILLION` | `1.25` |

## Provider Secret Variables

Provider adapters resolve their own credentials. Common variables are:

| Variable | Provider Family |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI, compatible providers |
| `AWS_REGION` | Bedrock |
| `AWS_ACCESS_KEY_ID` | Bedrock |
| `AWS_SECRET_ACCESS_KEY` | Bedrock |
| `AZURE_AI_ENDPOINT` | Azure |
| `AZURE_AI_API_KEY` | Azure |
