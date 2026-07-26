# Secrets and Credentials

The engine holds exactly one class of secret: the credential for the model
provider you configured. This page covers how it gets there, where it must not
go, and what happens if something leaks.

---

## The rule

**Credentials live in the environment. Never in `.codereviewer/config.json`.**

There is no config key for an API key, a token or a password. The provider
adapters read credentials directly from environment variables, and the config
schema has nowhere to put one.

---

## Which variables each provider needs

| `provider.id` | Required in the environment | Notes |
| --- | --- | --- |
| `openai` | `OPENAI_API_KEY` | Asserted before the first call. |
| `openai-compatible` | `OPENAI_API_KEY` | Plus `provider.baseUrl` in config (not a secret, but printed host-only). |
| `bedrock` | `AWS_REGION` | Only the region is asserted. Access keys, SSO profiles, instance roles and web identity come from the AWS credential chain inside the adapter. |
| `azure` | `AZURE_AI_ENDPOINT`, `AZURE_AI_API_KEY` | Both asserted. |

A missing or empty value fails fast, before any network call, with
`provider_credentials_missing` (exit code `2`) naming the variable.

Nothing else in the product reads a credential. The change-intent context
providers are filesystem-only: your pipeline performs any tracker or forge
fetch and owns those credentials, so no external credential enters the engine.

---

## Local development

Copy the template and fill in only what you need:

```bash
cp .env.example .env
```

`.env` is git-ignored. The config loader reads it **after** the process
environment, so a value in `.env` overrides the same variable exported in your
shell. That is convenient locally and a hazard in CI — see below.

Verify without making a provider call:

```bash
npm run cli -- config validate
```

The output is redacted: sensitive keys become `[REDACTED]` and endpoints are
reduced to `scheme://host`.

---

## CI

Set credentials as CI secrets in the real environment. Do **not** bake a `.env`
into an image or commit one: because `.env` wins over the process environment,
a stale file silently overrides your CI secret.

`eval run` deliberately does not read `.env` at all, so provider-backed
evaluation must get its credentials from the real process environment. The
repository's own npm scripts do that with Node's `--env-file-if-exists=.env`.

Additional CI rules:

- Never expose provider secrets to workflows triggered by untrusted fork pull
  requests.
- Give the job that runs the model read-only repository scope. Publish comments
  or SARIF from a separate job with its own scope.
- Prefer OpenID Connect over long-lived static cloud keys for the Bedrock
  provider when your platform supports it.
- Mask and protect the variables in the CI provider's own settings
  (GitLab masked/protected variables, GitHub repository or environment
  secrets, Bitbucket secured variables).

Full pipeline guidance: [ci-cd.md](../04-guides/ci-cd.md).

---

## Where credentials are guaranteed not to appear

| Surface | Guarantee |
| --- | --- |
| Prompts and model context | Environment values are never placed in prompt context. |
| Logs and traces | Environment values, provider headers, tokens and secrets are excluded; the observability recorder drops attribute keys matching secret-like names. |
| Errors | Every normalized error message and detail value passes through the redactor before it reaches stderr or an artifact. |
| Reports | Every string in `report.json` is redacted before serialization; SARIF carries no environment values, command lines or absolute paths. |
| Config summary | Sensitive keys become `[REDACTED]`; `baseUrl`/`endpoint` are printed as `scheme://host` so URL-embedded credentials are stripped. |
| Provider error messages | Redacted before they reach you — a provider that echoes a key back does not leak it into your logs. |

The redactor's built-in pattern set is listed in
[data-handling-and-redaction.md](data-handling-and-redaction.md).

---

## Secrets found *in* the repository

A credential committed to the repository is source content, not configuration.
It is redacted before it reaches model context, logs, errors or reports, if it
matches one of the built-in patterns.

Two limits worth stating plainly:

- **Pattern-based redaction is a floor.** A token shaped unlike any known
  format is not detected. The redactor can accept exact secret values
  programmatically, but no configuration key supplies that list today.
- **Redaction is not remediation.** Finding a live credential in your source is
  an incident. Rotate it.

Keeping secret-bearing files out of review entirely is a scope decision:

```json
{
  "paths": {
    "exclude": [
      ".git/**",
      "node_modules/**",
      "dist/**",
      "coverage/**",
      ".codereviewer/**",
      "secrets/**",
      "**/*.pem",
      "**/*.p12"
    ]
  }
}
```

Remember that setting `paths.exclude` replaces the built-in list, so restate
the defaults you still want.

Independently of configuration, the mediated read tools used by the
verification, fix and cross-file-discovery lanes can never open a dotfile or
hidden path — `.env`, `.env.local`, `.git` and `.codereviewer` are unreachable
by a hard floor no configuration can widen.

---

## Incident response

If a secret is found in a run artifact:

1. Treat the run artifacts as compromised.
2. Delete the local run artifact directory.
3. Rotate the affected credential outside this tool. The tool never attempts
   automatic revocation.
4. Add a regression fixture to the redaction tests covering that token shape.

If a secret is found in the repository source: rotate first, then remove it
from history with your organization's usual process, then add the path to
`paths.exclude` if the file legitimately holds encrypted material.
