# CodeReviewer

A precision-first code review engine: a holistic whole-file review discovers
candidate defects, an independent refutation pass filters them, and only the
survivors are admitted as findings. Language-neutral deterministic support
signals, provider-optional model integration, local artifacts, and CI-friendly
quality gates round it out.

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Provider Setup](#provider-setup)
- [Benchmark results](#benchmark-results)
- [Documentation](#documentation)

---

## Features

| Feature | Description |
| --- | --- |
| **Holistic discovery + refutation** | A whole-file review enumerates candidate defects, then an independent per-candidate refutation pass verifies or discards each one before admission — recall first, precision enforced. |
| **Deterministic support signals** | Local AST-based anchors, symbol spans, import/test/config hints, and contradiction signals improve clustering and context and reject weak claims without a provider call. |
| **Change-intent context (opt-in)** | Optionally summarizes PR/ticket/changed-doc context into a bounded, redacted brief injected before review as untrusted, informational context — orientation, never authorization. Off by default. |
| **Provider-optional** | Runs deterministic-only with no model provider configured; add a provider for full model-backed review. |
| **Modular providers** | OpenAI, OpenAI-compatible, AWS Bedrock, and Azure are optional peer packages — install only the one you use. |
| **Severity floor** | A configurable actionable-severity threshold keeps low-severity nits out of the actionable surface so the report stays low-noise. |
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

## Benchmark results

These numbers come from a full [Code-Review-Bench](docs/evaluation/README.md)
run over 59 captured-PR cases on the holistic pipeline. It is a realistic
captured-PR benchmark — each case is a real pull request with its real changes —
rather than a synthetic suite. Precision is strong and the severity floor keeps
noise low; recall is the headline lever the engine is tuned to improve.

**Model and settings:** OpenAI `gpt-5.3-codex`, review mode `pr`, depth
`thorough`, one task at a time, with semantic-judge scoring, over the 59-case
`code-review-bench-style` pack (`npm run eval:benchmark`).

| Metric | Value |
| --- | --- |
| **productRecall** (runtime-critical + security + logic tiers — headline accuracy target) | **39.4%** |
| Overall recall | 33.1% |
| Precision | 53.0% |
| F1 | 40.7% |
| False positives | 39 |
| Provider errors | 0 |
| Cost | ~$11.9 |
| Duration | ~32 min |

Recall by tier: runtime-critical **36%**, security **50%**, logic **40%**.

Per-case LLM variance is roughly ±2–3 points on these aggregate metrics, so treat
small differences between runs as noise rather than signal.

### What these numbers mean (plain English)

Think of the tool as a reviewer that reads a code change and flags problems.

- **Product recall** — Of the problems that *actually matter* (real bugs:
  crashes, security holes, wrong logic — ignoring trivial style nits), how many
  did the tool catch? This is our **headline score**: higher = fewer important
  bugs slip through.
- **Recall** — The same idea, but counting *every* expected issue including minor
  ones. "Of all the problems that were there, how many did we find?"
- **Precision** — Of everything the tool flagged, how much was a *genuine*
  problem? Higher = less noise and fewer false alarms wasting a developer's time.
- **F1** — A single balanced score that combines recall and precision, so a tool
  can't look good by only chasing one (e.g. flagging everything to "catch them
  all" but burying you in noise). Higher is better overall.
- **False positives (FP)** — The raw count of things it flagged that turned out
  *not* to be real problems. Lower = quieter, more trustworthy reviews.

Recall and precision pull against each other: flag more and you catch more real
bugs (recall up) but also raise more false alarms (precision down). The engine is
deliberately **precision-first** — it would rather stay quiet than cry wolf — and
recall is the dial we keep working to raise without adding noise.

---

## Documentation

| Section | Pages |
| --- | --- |
| **Getting started** | [Quick Setup](docs/getting-started/quick-setup.md) · [First Review](docs/getting-started/first-review.md) |
| **Concepts** | [Architecture](docs/concepts/architecture.md) · [Review Modes and Flows](docs/concepts/review-modes-and-flows.md) · [Deterministic Support Signals](docs/concepts/deterministic-support-signals.md) · [Change-Intent Context](docs/concepts/change-intent-context.md) |
| **Guides** | [Configuration](docs/guides/configuration.md) · [Providers](docs/guides/providers.md) · [Instructions and Skills](docs/guides/instructions-and-skills.md) · [Reports and Artifacts](docs/guides/reports-and-artifacts.md) |
| **Evaluation** | [Evaluation & Benchmarking](docs/evaluation/README.md) |
| **Operations** | [CI/CD](docs/operations/ci-cd.md) · [Troubleshooting](docs/operations/troubleshooting.md) · [Secrets and Env](docs/security/secrets-and-env.md) · [Data Handling](docs/security/data-handling.md) |
| **Reference** | [CLI](docs/reference/cli.md) · [Configuration Reference](docs/reference/configuration.md) · [Environment](docs/reference/environment.md) · [Exit Codes](docs/reference/exit-codes.md) · [Artifacts](docs/reference/artifacts.md) |

Full documentation index: [docs/README.md](docs/README.md)
