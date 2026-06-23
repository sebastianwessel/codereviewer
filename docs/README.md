# CodeReviewer Documentation

This index is the starting point for all CodeReviewer documentation. Start with
the getting-started pages, then move to concepts, guides, and reference material
for your specific workflow.

---

## Start Here

| Page | Use It For |
| --- | --- |
| [Quick Setup](getting-started/quick-setup.md) | Install, configure `.env`, and run the first checks. |
| [First Review](getting-started/first-review.md) | Run the local review command and inspect the artifacts it produces. |

---

## Concepts

| Page | Covers |
| --- | --- |
| [Architecture](concepts/architecture.md) | End-to-end pipeline — what each step does, why it exists, and how the steps interact. |
| [Review Modes and Flows](concepts/review-modes-and-flows.md) | Local, CI, PR, full review, gates, and execution steps. |
| [Deterministic Support Signals](concepts/deterministic-support-signals.md) | Local anchors, context hints, contradictions, and false-positive gates. |

---

## Guides

| Page | Covers |
| --- | --- |
| [Configuration](guides/configuration.md) | Config file shape, defaults, and precedence. |
| [Providers](guides/providers.md) | OpenAI, OpenAI-compatible, Bedrock, and Azure setup. |
| [Instructions and Skills](guides/instructions-and-skills.md) | Reviewer instructions and skill directories. |
| [Reports and Artifacts](guides/reports-and-artifacts.md) | JSON, Markdown, SARIF, and run summaries. |
| [Evaluation](guides/evaluation.md) | Product review-runner evaluation and regression gates. |

---

## Operations and Security

| Page | Covers |
| --- | --- |
| [CI/CD](operations/ci-cd.md) | Pipeline shape and cache/security guidance. |
| [Troubleshooting](operations/troubleshooting.md) | Common errors and next actions. |
| [Secrets and Env](security/secrets-and-env.md) | `.env`, provider secrets, and redaction expectations. |
| [Data Handling](security/data-handling.md) | Source handling, telemetry defaults, path boundaries, and drift gates. |

---

## Reference

| Page | Covers |
| --- | --- |
| [CLI](reference/cli.md) | Commands, drift checks, and exit behavior. |
| [Configuration Reference](reference/configuration.md) | Supported config keys. |
| [Environment](reference/environment.md) | Supported environment variables. |
| [Exit Codes](reference/exit-codes.md) | Exit code contract. |
| [Artifacts](reference/artifacts.md) | Output files and directories. |
