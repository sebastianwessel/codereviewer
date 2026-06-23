# Quick Setup

Get CodeReviewer installed, configured, and verified in a single session.

---

## Prerequisites

| Requirement | Version / Notes |
| --- | --- |
| Node.js | `>=24.15.0` |
| npm | Bundled with Node |
| Git | Required for repository review flows |

---

## Setup flow

```mermaid
flowchart LR
  A["1. Install CLI"] --> B["2. Configure .env"]
  B --> C["3. Validate config"]
  C --> D["4. Run a review"]
```

---

## Step 1 — Install

Install the published CLI, then run a review:

```bash
# Global install
npm install -g @sebastianwessel/codereviewer
codereviewer review --base-ref origin/main --head-ref HEAD
# Or run without installing
npx @sebastianwessel/codereviewer review --base-ref origin/main --head-ref HEAD
```

---

## Step 2 — Configure environment

Create a local `.env` from the template:

```bash
cp .env.example .env
```

> **Note:** `.env` is gitignored. Keep provider credentials there or in your
> CI secret store — never commit them.

Edit `.env` and fill in at minimum your provider ID, model, and API key.
Example for OpenAI:

```text
CODEREVIEWER_PROVIDER_ID=openai
CODEREVIEWER_PROVIDER_MODEL=gpt-4o
OPENAI_API_KEY=sk-...
```

See [Secrets and Env](../security/secrets-and-env.md) for all credential
options and [Providers](../guides/providers.md) for provider-specific setup.

---

## Step 3 — Validate configuration

```bash
codereviewer config validate
```

A missing `.codereviewer/config.json` is valid — built-in defaults are applied
and environment overrides are merged on top. The command reports the effective
config (with secrets redacted).

---

## Step 4 — Run a review

### Review a specific file

```bash
codereviewer review --file src/app.ts
```

Artifacts are written under `.codereviewer/runs/`. See
[First Review](first-review.md) for what each artifact contains.

> **Note:** Evaluation and benchmarking run from a cloned repository, not the
> published CLI. See [Evaluation](../evaluation/README.md).

---

## Next steps

- [First Review](first-review.md) — understand the artifacts produced by a review run.
- [Configuration Guide](../guides/configuration.md) — tune mode, depth, and quality gates.
- [Providers](../guides/providers.md) — install and configure provider adapters.
