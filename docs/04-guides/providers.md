# Choosing and Installing a Model Provider

The engine is provider-optional and provider-modular. No model SDK ships in the
base dependencies: each adapter is an optional peer package you install only if
you use it.

Full key/type/range tables live in the
[configuration reference](../06-reference/configuration/) and
[environment.md](../06-reference/environment.md).

---

## Do you need a provider at all?

| You want | Provider needed |
| --- | --- |
| Diff intake, deterministic support signals, drift check, artifacts, quality gate | No |
| Model-backed discovery and refutation (the actual review findings) | Yes |
| The optional change-intent summarizer in `model` mode | Yes |
| The verification and fix lanes | Yes |
| `eval run` scoring (the semantic judge and the plausibility judge) | Yes |

With `provider` omitted from the config, the run performs no network IO and
produces no model-origin findings.

---

## The four provider ids

| `provider.id` | Package to install | Credentials read from | Notes |
| --- | --- | --- | --- |
| `openai` | `@purista/harness-openai` | `OPENAI_API_KEY` | Uses the OpenAI Responses API. |
| `openai-compatible` | `@purista/harness-openai` | `OPENAI_API_KEY` | `provider.baseUrl` is **required**. The adapter still speaks the Responses API, so the endpoint must implement it. |
| `bedrock` | `@purista/harness-bedrock` | `AWS_REGION` plus the standard AWS credential chain | Only `AWS_REGION` is asserted before the call; the chain supplies the rest. |
| `azure` | `@purista/harness-azure-foundry` | `AZURE_AI_ENDPOINT`, `AZURE_AI_API_KEY` | Azure AI Foundry. |

The adapter package is imported lazily, at the moment the provider is resolved.
If it is not installed you get a setup error naming the exact package.

---

## Install the adapter you need

OpenAI and OpenAI-compatible endpoints:

```bash
npm run provider:install:openai
```

AWS Bedrock:

```bash
npm run provider:install:bedrock
```

Azure AI Foundry:

```bash
npm run provider:install:azure
```

Each script is a thin wrapper around `npm install <package>`.

---

## Configure and verify

### OpenAI

```json
{
  "provider": {
    "id": "openai",
    "model": "gpt-4o-mini"
  }
}
```

```bash
OPENAI_API_KEY=sk-... npm run cli -- config validate
```

### OpenAI-compatible endpoint

```json
{
  "provider": {
    "id": "openai-compatible",
    "model": "your-model-name",
    "baseUrl": "https://gateway.internal.example.com/v1"
  }
}
```

`baseUrl` must be a valid absolute URL. Omitting it fails validation with
`baseUrl is required for openai-compatible providers`. The printed config
summary reduces it to `scheme://host`, so credentials embedded in a URL never
reach stdout.

### AWS Bedrock

```json
{
  "provider": {
    "id": "bedrock",
    "model": "your-bedrock-model-id"
  }
}
```

```bash
AWS_REGION=eu-central-1 npm run cli -- config validate
```

Access keys, SSO profiles, instance roles and web-identity tokens are all
resolved by the AWS credential chain inside the adapter. The engine only
asserts that `AWS_REGION` is set.

### Azure AI Foundry

```json
{
  "provider": {
    "id": "azure",
    "model": "your-deployment-name"
  }
}
```

```bash
AZURE_AI_ENDPOINT=https://your-resource.services.ai.azure.com \
AZURE_AI_API_KEY=... \
npm run cli -- config validate
```

---

## Tuning the call

| Key | Default | What it does |
| --- | --- | --- |
| `provider.temperature` | `0` | Sent as a model default. **Not sent** for `openai` models whose name starts with `gpt-5` (dot or dash separator) — those reasoning models reject it with HTTP 400. |
| `provider.maxOutputTokens` | unset | Sent as `maxTokens` when set. |
| `provider.reasoningEffort` | unset | `minimal` / `low` / `medium` / `high`. Emitted as `providerOptions.reasoning_effort`, which the OpenAI Responses adapter maps to `reasoning: { effort }`. Unset uses the provider default. |
| `provider.timeoutMs` | `120000` | Per-call timeout handed to the adapter (1 000–600 000). |

`provider.model` is free text — the engine never validates a model name against
a catalogue. A wrong name surfaces as a provider error on the first call.

---

## Retry and error behavior

Retries are owned by the Harness model retry policy, configured from your
provider block:

| Key | Default | Range | Meaning |
| --- | --- | --- | --- |
| `provider.maxRetries` | `2` | 0–5 | Total attempts are `maxRetries + 1`. |
| `provider.retryBackoffMs` | `500` | 0–60 000 | Base delay for exponential backoff. |
| `provider.retryMaxDelayMs` | `30000` | 0–600 000 | Cap on a single wait. A required wait above the cap (for example a long `Retry-After`) fails instead of blocking. |

What is retried and what is not:

| Failure class | Retried |
| --- | --- |
| Network error, timeout, HTTP 5xx | Yes |
| Rate limit (`Retry-After` honored) | Yes, until the delay cap |
| Oversized context | No |
| Authentication / authorization | No |
| Payment / quota | No |

### Errors you will actually see

Setup errors surface before any call is made. All are `category: config`,
exit code `2`:

| Code | Cause | Fix |
| --- | --- | --- |
| `provider_adapter_missing` | The peer package is not installed. The message names the package. | Run the matching `provider:install:*` script. |
| `provider_credentials_missing` | A required credential variable is empty or absent. | Set the variable named in the message. |
| `provider_base_url_missing` | `openai-compatible` without `baseUrl`. | Add `provider.baseUrl`. |
| `provider_adapter_invalid` | The installed package does not export the expected factory. | Reinstall or align the adapter version with `@purista/harness`. |

Call-time failures are normalized, redacted, and exit `4` (`category:
provider`):

| Code | Recognized from |
| --- | --- |
| `provider_rate_limited` | HTTP 429, or `rate limit` / `overloaded` / `too many requests` in the message |
| `provider_auth` | HTTP 401/403, or `api key` / `unauthorized` / `forbidden` |
| `provider_context_length` | `context length` / `maximum context` / `too many tokens` / `context window` |
| `provider_server_error` | HTTP 5xx |
| `provider_timeout` | `timeout` / `timed out` / `ETIMEDOUT` |
| `provider_cancelled` | `abort` / `cancel` / `interrupt` |
| `provider_error` | Anything else from a provider call |

Raw provider messages are redacted before they reach stderr, logs or artifacts.

### A failed refutation does not lose the run

If the refutation call for a task fails, that task's candidates are recorded as
`needs-more-evidence` with reason `provider-error` and the run continues. The
failure is recorded as a recovered provider issue. A failure that aborts the
whole run still writes partial artifacts — see
[partial-and-failed-runs.md](../08-operations/partial-and-failed-runs.md).

---

## Cost visibility

The run summary reports token usage and, when a price is known, a cost. Prices
come from the provider response when it reports one; otherwise from
`costs.inputPerMillion`, `costs.cachedInputPerMillion` and
`costs.outputPerMillion` (or their `CODEREVIEWER_COST_*` environment
equivalents). With neither available, cost is reported as unavailable rather
than guessed. See [controlling-cost.md](controlling-cost.md).

---

## Where the provider sits in the trust model

The selected provider endpoint is the **only** network destination the product
ever contacts, and only when a provider is configured. What is sent is bounded,
redacted and recorded in the run's context ledger. See
[threat-model.md](../07-security/threat-model.md) and
[data-handling-and-redaction.md](../07-security/data-handling-and-redaction.md).
