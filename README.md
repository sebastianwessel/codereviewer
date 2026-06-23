# CodeReviewer

An evidence-first code review engine with an agentic proof loop, language-neutral
deterministic support signals, provider-optional model integration, local
artifacts, and CI-friendly quality gates.

## Table Of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Provider Setup](#provider-setup)
- [Documentation](#documentation)

## Features

- **Evidence-first review** — model suspicions must be proved and survive
  bounded refutation before they become actionable findings.
- **Deterministic support signals** — local AST-based anchors, symbol spans,
  import/test/config hints, and contradiction signals improve investigation
  recall and reject weak claims without a provider call.
- **Provider-optional** — runs deterministic-only with no model provider
  configured; add a provider for full agentic investigation.
- **Modular providers** — OpenAI, OpenAI-compatible, AWS Bedrock, and Azure
  are optional peer packages; install only the one you use.
- **Agentic proof loop** — intent planning, bounded suspicion generation,
  mediated evidence retrieval, proof/refutation, optional critic judge, and
  aggregate review; all capped and auditable.
- **Quality gates** — configurable severity thresholds, baseline suppression,
  drift gates, and provider-error policy with reproducible exit codes.
- **Local artifacts** — JSON, Markdown, SARIF, and GitHub review-comment drafts
  written to `.codereviewer/runs/`; no external publishing in R1.
- **CI-ready** — env-var config overrides, `.env` loading, SARIF upload support,
  and explicit exit codes for gate pass/fail/error.

## Quick Start

Requires Node.js `>=24.15.0`.

```bash
nvm install && nvm use
npm install
cp .env.example .env
```

Add your provider credentials to `.env` (see
[Secrets And Env](docs/security/secrets-and-env.md)).

Validate the config and run tests:

```bash
npm run typecheck
npm test
npx tsx src/cli/main.ts config validate
```

Run a local review:

```bash
npx tsx src/cli/main.ts review
```

Or review specific files:

```bash
npx tsx src/cli/main.ts review --file src/app.ts
```

Create a minimal `.codereviewer/config.json` to configure the review (all keys
are optional — unknown keys are rejected):

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

See [Configuration](docs/guides/configuration.md) and the
[Configuration Reference](docs/reference/configuration.md) for all options.

## Provider Setup

Provider adapters are optional peer packages. Install only the one you use:

```bash
npm run provider:install:openai    # OpenAI and OpenAI-compatible
npm run provider:install:bedrock   # AWS Bedrock
npm run provider:install:azure     # Azure AI Foundry
```

See [Providers](docs/guides/providers.md) for setup instructions.

## Documentation

| Section | Pages |
| --- | --- |
| **Getting started** | [Quick Setup](docs/getting-started/quick-setup.md), [First Review](docs/getting-started/first-review.md) |
| **Concepts** | [Architecture](docs/concepts/architecture.md), [Review Modes And Flows](docs/concepts/review-modes-and-flows.md), [Deterministic Support Signals](docs/concepts/deterministic-support-signals.md) |
| **Guides** | [Configuration](docs/guides/configuration.md), [Providers](docs/guides/providers.md), [Instructions And Skills](docs/guides/instructions-and-skills.md), [Reports And Artifacts](docs/guides/reports-and-artifacts.md), [Evaluation](docs/guides/evaluation.md) |
| **Operations** | [CI/CD](docs/operations/ci-cd.md), [Troubleshooting](docs/operations/troubleshooting.md), [Secrets And Env](docs/security/secrets-and-env.md), [Data Handling](docs/security/data-handling.md) |
| **Reference** | [CLI](docs/reference/cli.md), [Configuration Reference](docs/reference/configuration.md), [Environment](docs/reference/environment.md), [Exit Codes](docs/reference/exit-codes.md), [Artifacts](docs/reference/artifacts.md) |
