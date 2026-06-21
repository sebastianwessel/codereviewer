# CodeReviewer Documentation

Start with setup, then use the configuration, architecture, operations, and
reference material for the workflow you are running.

## Start Here

| Page | Use It For |
| --- | --- |
| [Quick Setup](getting-started/quick-setup.md) | Install, configure `.env`, and run the first checks. |
| [First Review](getting-started/first-review.md) | Run the implemented local review and inspect artifacts. |

## Concepts

| Page | Covers |
| --- | --- |
| [Architecture](concepts/architecture.md) | Main domains, data flow, and isolation boundaries. |
| [Review Modes And Flows](concepts/review-modes-and-flows.md) | Local, CI, PR, full review, gates, and execution steps. |
| [Language Analyzers](concepts/language-analyzers.md) | First-class languages, AST parsing, facts, and test mapping. |

## Guides

| Page | Covers |
| --- | --- |
| [Configuration](guides/configuration.md) | Config file shape, defaults, and precedence. |
| [Providers](guides/providers.md) | OpenAI, OpenAI-compatible, Bedrock, and Azure setup model. |
| [Instructions And Skills](guides/instructions-and-skills.md) | Reviewer instructions and skill directories. |
| [Reports And Artifacts](guides/reports-and-artifacts.md) | JSON, Markdown, SARIF, and run summaries. |
| [Evaluation](guides/evaluation.md) | Product review-runner evaluation and regression gates. |

## Operations And Security

| Page | Covers |
| --- | --- |
| [CI/CD](operations/ci-cd.md) | Pipeline shape and cache/security guidance. |
| [Troubleshooting](operations/troubleshooting.md) | Common errors and next actions. |
| [Secrets And Env](security/secrets-and-env.md) | `.env`, provider secrets, and redaction expectations. |
| [Data Handling](security/data-handling.md) | Source handling, telemetry defaults, path boundaries, and drift gates. |

## Reference

| Page | Covers |
| --- | --- |
| [CLI](reference/cli.md) | Commands, drift checks, and exit behavior. |
| [Configuration Reference](reference/configuration.md) | Supported config keys. |
| [Environment](reference/environment.md) | Supported environment variables. |
| [Exit Codes](reference/exit-codes.md) | Exit code contract. |
| [Artifacts](reference/artifacts.md) | Output files and directories. |
