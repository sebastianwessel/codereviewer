# Data Handling

## Defaults

| Area | Default |
| --- | --- |
| Shell execution | disabled |
| Network access in review security config | disabled |
| Filesystem writes from review config | disabled |
| Content telemetry | disabled |
| Report redaction | enabled |

## Security Boundaries

| Boundary | Behavior |
| --- | --- |
| Repository root | Defaults to the current working directory for CLI runs. |
| Path access | Config, docs, specs, skills, instructions, eval fixtures, explicit files, and artifacts must resolve under the repository root. |
| Source writes | Review, eval, support signals, and drift checks do not modify source files. |
| Git | Only read-only `git diff` command shapes are allowed. Destructive git actions are not exposed. |
| Network | Disabled unless an explicit model provider is configured for a provider-backed review path. Local checks do not use network IO. |
| Telemetry | OpenTelemetry is disabled unless configured and never captures raw source, prompts, provider output, env vars, or secrets. |

## Source Handling

Deterministic support-signal extractors parse source files locally and produce facts, diagnostics,
and test mappings. They do not execute project code.

Reports are designed around evidence IDs, locations, hashes, and summaries. Raw
source snippets are not required for the default artifacts.

Partial provider-failure artifacts store normalized error metadata and sanitized
task messages. They must not include raw provider responses, tool output,
prompts, source snippets, environment values, or secrets.

## Filesystem Writes

Implemented CLI commands write only documented artifacts:

| Command | Output |
| --- | --- |
| `review` | `.codereviewer/runs/<run-id>/` |
| `eval run` | `.codereviewer/eval/eval-report.json` |
| `drift check` | stdout only |

## Drift And Ambiguity Checks

`drift check` runs locally and does not call a model provider.

| Category | Default Gate |
| --- | --- |
| Generated schema drift | hard error |
| Security-sensitive drift | hard error |
| Documentation drift | warning |
| Spec drift | warning |
| Implementation drift | warning |
| Ambiguity | warning |

Use this check before CI rollout and before changing public docs or specs.
