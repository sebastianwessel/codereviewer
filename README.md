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
- [How quality is measured](#how-quality-is-measured)
- [Measured results](#measured-results)
- [Documentation](#documentation)

---

## Features

| Feature | Description |
| --- | --- |
| **Holistic discovery + refutation** | A whole-file review enumerates candidate defects, then an independent refutation pass — batched per task, one verdict per candidate — verifies or discards each one before admission — recall first, precision enforced. |
| **Deterministic support signals** | Local AST-based anchors, symbol spans, import/test/config hints, and contradiction signals improve clustering and context and reject weak claims without a provider call. |
| **Change-intent context (opt-in)** | Optionally summarizes PR/ticket/changed-doc context into a bounded, redacted brief injected before review as untrusted, informational context — orientation, never authorization. Off by default. |
| **Verification flow (opt-in)** | A separate agentic flow that verifies specific claims — a review comment, an analyzer alert, or whether a new commit fixed a prior finding — using bounded, mediated read/list/grep tools. Off by default. |
| **Provider-optional** | Runs deterministic-only with no model provider configured; add a provider for full model-backed review. |
| **Modular providers** | OpenAI, OpenAI-compatible, AWS Bedrock, and Azure are optional peer packages — install only the one you use. |
| **Severity floor** | A configurable actionable-severity threshold keeps low-severity nits out of the actionable surface so the report stays low-noise. |
| **Quality gates** | Configurable severity thresholds, baseline suppression, drift gates, and provider-error policy with reproducible exit codes. |
| **Local artifacts** | JSON, Markdown, SARIF, and GitHub review-comment drafts written to `.codereviewer/runs/`; no external publishing. |
| **CI-ready** | Env-var config overrides, `.env` loading, SARIF upload support, and explicit exit codes for gate pass/fail/error. |

---

## Quick Start

> **Note:** Requires Node.js `>=24.15.0`.

> **Not published yet.** This package is private (`package.json` has
> `"private": true`), so there is no `npm install -g` or `npx` path. Run it from a
> checkout.

1. Clone and install, then run a review:

```bash
git clone <repository-url> && cd codereviewer && npm install
```

```bash
npm run cli -- review --base-ref origin/main --head-ref HEAD
```

2. Configure provider credentials in your environment or a local `.env`:

```bash
cp .env.example .env
```

See [Secrets and credentials](docs/07-security/secrets-and-credentials.md) for what to fill in.

3. Validate the config:

```bash
npm run cli -- config validate
```

4. Run a local review:

```bash
npm run cli -- review --file src/app.ts
```

```bash
npm run cli -- review --base-ref origin/main --head-ref HEAD
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
    "depth": "balanced"
  }
}
```

See the [configuration guide](docs/04-guides/configuration.md) and the
[configuration reference](docs/06-reference/configuration/README.md) for all
options. `review.depth` sets the context budget; `review.mode` is recorded in the
report but changes no behavior.

---

## Provider Setup

Provider adapters are optional peer packages. Install only the one you use:

```bash
npm run provider:install:openai    # OpenAI and OpenAI-compatible
npm run provider:install:bedrock   # AWS Bedrock
npm run provider:install:azure     # Azure AI Foundry
```

See [Providers](docs/04-guides/providers.md) for full setup instructions.

---

## How quality is measured

Every evaluation case is a real code change with a curated list of the defects it
contains. The engine reviews it blind and its findings are compared against that
list, by a **model judge** that is itself calibrated against human-labelled pairs —
because the same defect can be described two correct ways, and lexical matching
scores paraphrase as failure.

Two properties of these numbers matter more than any single figure:

- **Recall against an incomplete answer key understates quality.** A curated key
  lists the defects a curator found, not every defect present. A second
  *plausibility* judge rules on each finding the key did not list, and confirmed
  ones are reported as **unlisted-real** rather than counted as mistakes. On the
  59-case benchmark the engine reports roughly 2.8x more genuine defects than the
  key lists, so **adjusted precision** — not raw precision, and not that corpus's
  recall — is the number worth reading there.
- **Seed-to-seed variance is real and measured.** On the real-repository corpus the
  same configuration run repeatedly varies by about 5 percentage points of recall.
  A single run that beats another by a few points has not demonstrated anything.

See [How quality is measured](docs/05-quality/README.md) for the full method.

## Measured results

Measured on the real-repository corpus: 30 cases, 42 expected findings, 24 upstream
repositories, 13 languages, each checked out **in full** at the commit before the
upstream fix — so a defect whose evidence sits in an unchanged file is actually
reachable. Model `gpt-5.3-codex`, three seeds, 2026-07-26.

| Metric | Value |
| --- | ---: |
| Recall | **54.8%** mean (50.0–59.5, sd 4.8pp) |
| Adjusted precision | **95.8–100%** |
| Genuine false positives | 0–1 per run |
| Unlisted-real findings | 4–7 per run |
| Cost | ~$1.22 per 30-case run |

Recall by tier on the median run: runtime-critical 100%, logic 57.9%, security
50.0%. Severity accuracy is the weakest metric at roughly 43%.

The engine is precision-strong and recall-moderate: when it reports something, it is
almost always real; it does not find everything. The current known limit is that a
single discovery pass reports roughly **one defect per file** — on cases containing
two known defects it typically finds one. Two attempts to fix that by adding further
discovery passes were measured and **neither improved recall**, so both ship off by
default. See [Current results](docs/05-quality/current-results.md) for the full
record, including what was tried and rejected.

Run it yourself:

```bash
npm run eval:benchmark
```

Read `scoring.judgeTrustworthy` in the report first: a run whose judge falls below
the configured calibration agreement declares its own metrics untrustworthy. Note
that `eval run`'s regression gate is hard-coded to demand 100% recall and zero false
positives, so it exits non-zero on essentially any provider-backed run — the report,
not the exit code, is the output you want. See
[Running an evaluation](docs/05-quality/running-an-evaluation.md).

## Documentation

The documentation is ordered from high level to deep — each section assumes the ones
before it. Start at [docs/README.md](docs/README.md).

| Section | Read it for |
| --- | --- |
| **[01 Overview](docs/01-overview/)** | What this is, why precision-first, how it fits your pipeline, and an honest [status and limitations](docs/01-overview/status-and-limitations.md) page |
| **[02 Getting started](docs/02-getting-started/)** | [Install and run](docs/02-getting-started/install-and-run.md), [your first review](docs/02-getting-started/first-review.md), [reading a report](docs/02-getting-started/reading-a-report.md) |
| **[03 Concepts](docs/03-concepts/)** | The [review lifecycle](docs/03-concepts/review-lifecycle.md), one page per pipeline stage, the [two flows](docs/03-concepts/two-flows.md), the [trust model](docs/03-concepts/trust-model.md), and the [optional-capability decision table](docs/03-concepts/optional-capabilities/README.md) |
| **[04 Guides](docs/04-guides/)** | [Configuration](docs/04-guides/configuration.md) · [Providers](docs/04-guides/providers.md) · [Instructions and skills](docs/04-guides/instructions-and-skills.md) · [Tuning noise and recall](docs/04-guides/tuning-noise-and-recall.md) · [Controlling cost](docs/04-guides/controlling-cost.md) · [CI/CD](docs/04-guides/ci-cd.md) |
| **[05 Quality](docs/05-quality/)** | [How quality is measured](docs/05-quality/README.md) · [Metrics](docs/05-quality/metrics.md) · [Judges](docs/05-quality/judges-and-calibration.md) · [Datasets](docs/05-quality/datasets.md) · [Current results](docs/05-quality/current-results.md) |
| **[06 Reference](docs/06-reference/)** | [CLI](docs/06-reference/cli.md) · [Configuration](docs/06-reference/configuration/README.md) · [Environment](docs/06-reference/environment.md) · [Exit and error codes](docs/06-reference/exit-codes-and-error-codes.md) · [Artifacts](docs/06-reference/artifacts.md) |
| **[07 Security](docs/07-security/)** | [Threat model](docs/07-security/threat-model.md) · [Prompt injection](docs/07-security/prompt-injection-and-untrusted-input.md) · [Permissions](docs/07-security/permissions-and-path-containment.md) · [Data handling](docs/07-security/data-handling-and-redaction.md) · [Secrets](docs/07-security/secrets-and-credentials.md) |
| **[08 Operations](docs/08-operations/)** | [Troubleshooting](docs/08-operations/troubleshooting.md) · [Partial and failed runs](docs/08-operations/partial-and-failed-runs.md) |
| **[09 Contributing](docs/09-contributing/)** | [Repo map](docs/09-contributing/repo-map.md) · [Spec-driven workflow](docs/09-contributing/spec-driven-workflow.md) · [Tests and checks](docs/09-contributing/running-tests-and-checks.md) · [Adding evaluation cases](docs/09-contributing/adding-evaluation-cases.md) |
