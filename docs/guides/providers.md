# Providers

Provider configuration is intentionally separate from provider package
installation. Provider adapters are optional peer packages, so the base install
does not install provider SDKs. Install only the adapter needed by the
deployment.

## Supported Provider Families

| Provider ID | Use For | Notes |
| --- | --- | --- |
| `openai` | OpenAI API. | Uses standard OpenAI credentials. |
| `openai-compatible` | Compatible HTTP APIs. | Requires `baseUrl`. |
| `bedrock` | AWS Bedrock. | Uses AWS credential chain and region. |
| `azure` | Azure AI/OpenAI deployments. | Uses Azure endpoint and key/identity. |

## Optional Provider Packages

```bash
npm run provider:install:openai
npm run provider:install:bedrock
npm run provider:install:azure
```

## Config Example

```json
{
  "provider": {
    "id": "openai",
    "model": "gpt-5-mini",
    "temperature": 0,
    "timeoutMs": 120000,
    "maxRetries": 2
  }
}
```

For OpenAI-compatible providers:

```json
{
  "provider": {
    "id": "openai-compatible",
    "model": "provider-model-name",
    "baseUrl": "https://example.internal/v1"
  }
}
```

Provider secrets belong in `.env` or the CI secret store, not in config files.

## Reasoning Effort

For OpenAI reasoning models, add `reasoningEffort` under `provider`:

```json
{
  "provider": {
    "id": "openai",
    "model": "gpt-5-mini",
    "reasoningEffort": "medium"
  }
}
```

Allowed values: `minimal`, `low`, `medium`, `high`. Env: `CODEREVIEWER_PROVIDER_REASONING_EFFORT`.

The OpenAI adapter maps this to the Responses API `reasoning: { effort }` field. High effort is
not recommended — it increases cost and latency without improving product recall.
Unset uses the provider default.

`temperature` is omitted for all `gpt-5.x` models (including dotted versions such
as `gpt-5.4-mini`) because those models reject the parameter.

## Retry Behavior

Provider task calls are retried under a single classified policy. Transient
failures (network errors, HTTP 408/425/5xx) and rate limits (HTTP 429, honoring
`Retry-After`) are retried with bounded exponential backoff; oversized context,
authentication, payment/quota, and cancellation failures are not. Total attempts
are `maxRetries + 1`, each backoff is capped by `retryMaxDelayMs`, and a
rate-limit window longer than that cap fails the run instead of waiting.

`temperature` is supported by configuration, but the resolver omits it for
OpenAI `gpt-5*` models because those models reject the parameter. Compatible
providers keep the configured value because their model behavior is
provider-specific.

## Provider Error Codes

When a provider call fails, the structured error carries one of the following
codes in `stderr` and in partial run artifacts:

| Code | Meaning |
| --- | --- |
| `provider_rate_limited` | HTTP 429 or overloaded/rate-limit/too-many-requests message. |
| `provider_auth` | HTTP 401/403 or API-key/unauthorized/forbidden message. |
| `provider_context_length` | Context-length/context-window/too-many-tokens message. |
| `provider_server_error` | HTTP 5xx response. |
| `provider_error` | Any other provider-side failure not matched above. |
| `provider_timeout` | Request timed out. |
| `provider_cancelled` | Request was aborted or cancelled. |

See the Retry Behavior section above for which of these codes are retried.
