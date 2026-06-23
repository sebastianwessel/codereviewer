# CodeReviewer

An evidence-first code review engine with an agentic proof loop, language-neutral
deterministic support signals, provider-optional model integration, local
artifacts, and CI-friendly quality gates.

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Provider Setup](#provider-setup)
- [Documentation](#documentation)

---

## Features

| Feature | Description |
| --- | --- |
| **Evidence-first review** | Model suspicions must be proved and survive bounded refutation before they become actionable findings. |
| **Deterministic support signals** | Local AST-based anchors, symbol spans, import/test/config hints, and contradiction signals improve investigation recall and reject weak claims without a provider call. |
| **Provider-optional** | Runs deterministic-only with no model provider configured; add a provider for full agentic investigation. |
| **Modular providers** | OpenAI, OpenAI-compatible, AWS Bedrock, and Azure are optional peer packages — install only the one you use. |
| **Agentic proof loop** | Intent planning, bounded suspicion generation, mediated evidence retrieval, proof/refutation, optional critic judge, and aggregate review; all capped and auditable. |
| **Quality gates** | Configurable severity thresholds, baseline suppression, drift gates, and provider-error policy with reproducible exit codes. |
| **Local artifacts** | JSON, Markdown, SARIF, and GitHub review-comment drafts written to `.codereviewer/runs/`; no external publishing. |
| **CI-ready** | Env-var config overrides, `.env` loading, SARIF upload support, and explicit exit codes for gate pass/fail/error. |

---

## Quick Start

> **Note:** Requires Node.js `>=24.15.0`.

1. Install the CLI, then run a review:

```bash
# Global install
npm install -g @sebastianwessel/codereviewer
codereviewer review --base-ref origin/main --head-ref HEAD
# Or run without installing
npx @sebastianwessel/codereviewer review --base-ref origin/main --head-ref HEAD
```

2. Configure provider credentials in your environment or a local `.env`:

```bash
cp .env.example .env
```

See [Secrets and Env](docs/security/secrets-and-env.md) for what to fill in.

3. Validate the config:

```bash
codereviewer config validate
```

4. Run a local review:

```bash
# Review a specific file
codereviewer review --file src/app.ts

# Review changes relative to a base branch
codereviewer review --base-ref origin/main --head-ref HEAD
```

### Minimal configuration

Create `.codereviewer/config.json` to tune the review (all keys are optional —
unknown keys are rejected):

```json
{
  "provider": {
    "id": "openai",
    "model": "gpt-4o"
  },
  "review": {
    "mode": "ci",
    "depth": "balanced"
  }
}
```

See [Configuration Guide](docs/guides/configuration.md) and the
[Configuration Reference](docs/reference/configuration.md) for all options.

---

## Provider Setup

Provider adapters are optional peer packages. Install only the one you use:

```bash
npm run provider:install:openai    # OpenAI and OpenAI-compatible
npm run provider:install:bedrock   # AWS Bedrock
npm run provider:install:azure     # Azure AI Foundry
```

See [Providers](docs/guides/providers.md) for full setup instructions.

---

## Documentation

| Section | Pages |
| --- | --- |
| **Getting started** | [Quick Setup](docs/getting-started/quick-setup.md) · [First Review](docs/getting-started/first-review.md) |
| **Concepts** | [Architecture](docs/concepts/architecture.md) · [Review Modes and Flows](docs/concepts/review-modes-and-flows.md) · [Deterministic Support Signals](docs/concepts/deterministic-support-signals.md) |
| **Guides** | [Configuration](docs/guides/configuration.md) · [Providers](docs/guides/providers.md) · [Instructions and Skills](docs/guides/instructions-and-skills.md) · [Reports and Artifacts](docs/guides/reports-and-artifacts.md) |
| **Evaluation** | [Evaluation & Benchmarking](docs/evaluation/README.md) |
| **Operations** | [CI/CD](docs/operations/ci-cd.md) · [Troubleshooting](docs/operations/troubleshooting.md) · [Secrets and Env](docs/security/secrets-and-env.md) · [Data Handling](docs/security/data-handling.md) |
| **Reference** | [CLI](docs/reference/cli.md) · [Configuration Reference](docs/reference/configuration.md) · [Environment](docs/reference/environment.md) · [Exit Codes](docs/reference/exit-codes.md) · [Artifacts](docs/reference/artifacts.md) |

Full documentation index: [docs/README.md](docs/README.md)
