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
npm install @purista/harness-openai
npm install @purista/harness-bedrock
npm install @purista/harness-azure-foundry
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

`temperature` is supported by configuration, but the resolver omits it for
OpenAI `gpt-5*` models because those models reject the parameter. Compatible
providers keep the configured value because their model behavior is
provider-specific.
