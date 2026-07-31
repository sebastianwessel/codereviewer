# `provider`

Selects the model backend. The whole `provider` object is **optional**: without
it the run is deterministic-only (no model calls). When present, `id` and
`model` are required.

Provider adapter packages are never imported at module top level — only the
selected adapter is dynamically imported at run time, and it must be installed.

## Keys

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `provider.id` | `"openai"` \| `"openai-compatible"` \| `"bedrock"` \| `"azure"` | *required* | Closed enum. Selects the adapter package. |
| `provider.model` | non-empty string | *required* | Model id passed to the adapter. |
| `provider.baseUrl` | URL | *unset* | Custom endpoint. **Required when `id` is `openai-compatible`** — omitting it fails validation with `baseUrl is required for openai-compatible providers` (and, at resolution time, `provider_base_url_missing`). |
| `provider.temperature` | number 0–2 | `0` | Sampling temperature. Omitted from the request for OpenAI `gpt-5*` models (dot or dash minor separator, e.g. `gpt-5-mini`, `gpt-5.4-mini`) because those reasoning models reject it with HTTP 400. `openai-compatible` keeps the configured value. |
| `provider.maxOutputTokens` | integer ≥ 1 | *unset* | Forwarded as the adapter's max output tokens. Unset uses the adapter default. |
| `provider.reasoningEffort` | `"minimal"` \| `"low"` \| `"medium"` \| `"high"` | *unset* | Forwarded as `reasoning.effort` on the OpenAI Responses API. Raises proof/investigation quality on smaller reasoning models at higher token cost. Emitted only when set. |
| `provider.timeoutMs` | integer 1000–600000 | `120000` | Per provider call timeout. This is the **only** time bound in the engine, and it exists so a single network call cannot hang forever. There is deliberately no whole-run deadline: that would be a self-imposed limit that destroys work already done. A call that fails transiently is retried under `maxRetries`; anything unrecoverable fails loudly. |
| `provider.maxRetries` | integer 0–5 | `2` | Classified retries of provider task calls. Total attempts = `maxRetries + 1`. |
| `provider.retryBackoffMs` | integer 0–60000 | `500` | Base delay for exponential backoff between retries. |
| `provider.retryMaxDelayMs` | integer 0–600000 | `30000` | Maximum single backoff wait. A required wait above this cap (e.g. a long rate-limit `Retry-After`) fails the run instead of blocking. |

## Adapters and credentials

| `id` | Adapter package | Credential sources checked before the call |
| --- | --- | --- |
| `openai` | `@purista/harness-openai` | `OPENAI_API_KEY` |
| `openai-compatible` | `@purista/harness-openai` | `OPENAI_API_KEY` (plus `baseUrl`) |
| `bedrock` | `@purista/harness-bedrock` | `AWS_REGION` (required); the AWS credential chain is resolved by the SDK and is not pre-checked |
| `azure` | `@purista/harness-azure-foundry` | `AZURE_AI_ENDPOINT`, `AZURE_AI_API_KEY` |

A missing required credential variable fails fast with
`provider_credentials_missing` (exit `2`), naming the variable but never
printing a value. A missing adapter package fails with
`provider_adapter_missing` (exit `2`) and an `npm install <package>` hint; an
adapter that does not export the expected factory fails with
`provider_adapter_invalid`.

Install adapters with the bundled scripts:

```
npm run provider:install:openai
npm run provider:install:bedrock
npm run provider:install:azure
```

## Retry classification

Retried: network failures, HTTP 408/425/5xx, and rate limits (HTTP 429, honoring
`Retry-After` within `retryMaxDelayMs`).

Not retried: oversized context, authentication, payment/quota, and cancellation.

## Related

- [Environment variables](../environment.md) — the `CODEREVIEWER_PROVIDER_*` overrides
- [reporting-and-observability.md](./reporting-and-observability.md#costs) — `costs` pricing used to compute spend
- [Exit codes and error codes](../exit-codes-and-error-codes.md) — the `provider_*` code table
