# 00: Scope And Glossary

Status: Approved
Date: 2026-06-19

## Product Goal

Build an LLM-centric semantic code review engine that runs locally, in CI/CD, on
pull requests, and against full repositories. The engine must produce
high-signal, auditable findings from bounded investigation loops that gather
repository context, prove or refute suspicious behavior, and emit structured
proof packets. Deterministic logic exists to provide repository facts,
line-anchor validation, scope checks, de-duplication, safety policy, and
corroborating or contradicting signals. It is not the primary issue-discovery
surface in production, where CodeQL, linters, formatters, tests, and build
checks are assumed to run in adjacent pipelines.

## First Release Scope

`R1` is the first implementation release. It includes:

- local CLI review of a checked-out git repository;
- base/head diff intake and explicit file-list intake;
- lightweight deterministic signal extraction for changed files and referenced
  context, used as support evidence and gating input rather than as a parallel
  static-analysis product;
- language-neutral contracts for findings, evidence, reports, configuration,
  run summaries, and errors;
- provider resolution for OpenAI/OpenAI-compatible, AWS Bedrock, and Azure
  model adapters through optional packages;
- harness-based suspicion, investigation, proof, and refutation workflow with
  hermetic provider fixtures in tests;
- JSON and Markdown local reports;
- local GitHub PR review-comment artifact rendering for admitted inline
  findings;
- evaluation runner with golden fixtures and quality metrics;
- no network PR comment publishing, no automatic code modification, and no
  GitHub Action implementation in `R1`.

## Later Scope

The following capabilities are specified as future extension points and must not
be implemented in `R1` unless a later spec changes scope:

- network pull request comment publishing;
- CI-native check annotations;
- full-codebase trend dashboards;
- automatic fix application;
- product-owned replacements for external static analysis, formatting, build,
  or unit-test pipelines;
- remote service or hosted UI.

## Actors And Consumers

| ID | Actor/Consumer | Scope |
| --- | --- | --- |
| ACT-DEV | Developer | Runs local CLI, reads reports, tunes config. |
| ACT-CI | CI runner | Executes CLI non-interactively and stores artifacts. |
| ACT-REVIEWER | Human reviewer | Consumes admitted findings and evidence. |
| ACT-AGENT | Implementation agent | Implements specs without inventing behavior. |
| ACT-OPS | Maintainer | Reviews logs, failures, releases, dependency drift. |
| ACT-MODEL | Model provider adapter | Generates suspicions, investigates context, and writes proof/refutation output through harness. |

## Glossary

| Term | Definition |
| --- | --- |
| Admission gate | Deterministic policy that decides whether a proven candidate can become an admitted finding. Model-generated confidence scores are not part of the review artifact contract; a model-origin finding may admit only through a complete proof packet that passes refutation and deterministic safety checks. |
| Candidate finding | A potential user-visible issue assembled from a verified proof packet before admission. Candidate findings can be admitted, rejected, or marked `needs-more-evidence` only by the admission gate. |
| Deterministic signal | Repository fact, diff fact, symbol fact, diagnostic, line-anchor check, scope check, de-duplication key, or contradiction produced without model judgment. Signals are support evidence and gate input, not the main production detection strategy, and they cannot replace proof/refutation for model-origin findings. |
| Evidence record | Structured proof item referenced by a finding, such as diff location, AST fact, command summary, diagnostic, or model rationale. |
| Finding | User-visible issue after admission. Findings are language-neutral and reporter-neutral. |
| Investigation loop | Bounded model-driven review step that may request allowed read/list/grep context, follow references, inspect nearby tests/config/docs, and produce either a stronger proof packet or a refuted/weak suspicion. |
| Model suspicion | Non-actionable model hypothesis about a possible issue. A suspicion is not a finding and cannot be rendered as an actionable comment without investigation and refutation. |
| Model provider adapter | Optional package loaded at runtime to connect harness model aliases to a concrete provider. |
| Portable path | Forward-slash path used in reports, git paths, SARIF-like artifact locations, and JSON artifacts. |
| Proof packet | Structured evidence conclusion for one suspected issue. It must identify changed behavior, execution/data path, violated invariant or contract, user impact, why the reviewed change introduced or exposed the issue, evidence records, contradiction checks, and a concrete fix direction. |
| Refutation gate | Independent verification step that tries to disprove a proof packet using repository context, deterministic contradictions, reachability/guard checks, scope checks, and evidence sufficiency rules. |
| Repository path | Filesystem path resolved inside the reviewed repository root. |
| Review task | Unit of work generated by the planner, scoped to files, dependencies, evidence, and budget. |
| Run | One execution of the CLI against a repository and configuration. |
| Shared context | Run-local store of safe repository facts, suspicions, proof summaries, admitted findings, rejected internal candidates, provider issues, and evidence references. |

## Global Invariants

| ID | Requirement | Verification |
| --- | --- | --- |
| INV-ESM-001 | First-party source is ESM-only. No CommonJS files, `require`, `module.exports`, `__dirname`, or `__filename`. | Static grep and typecheck. |
| INV-OS-001 | Filesystem behavior supports Linux and Windows paths. | Unit tests with POSIX and Windows path fixtures. |
| INV-LANG-001 | Core contracts are language-neutral. Language-specific data remains inside deterministic signal extractors, repository context tools, or provider prompts and is normalized before reaching findings, reports, admission, or evaluation. | Contract tests and schema review. |
| INV-PROV-001 | Base install does not include provider SDKs except `@purista/harness`. | `package.json` and lockfile inspection. |
| INV-SEC-001 | Logs, traces, reports, and errors do not include prompt text, source snippets, tokens, secrets, or raw tool output by default. | Redaction tests and artifact snapshot tests. |
| INV-PUB-001 | No model-only merge approval, merge blocking, or publication decision. Model-origin proof may produce review findings, but merge and publishing authority remains deterministic and local-artifact only. | Admission and quality-gate tests. |
| INV-STRUCT-001 | Code is grouped by domain/topic with colocated tests and shared helpers for repeated behavior. | Structure lint/review checklist. |

## Explicit Non-Goals For R1

- No remote API server.
- No browser UI.
- No authentication system.
- No database.
- No long-lived daemon.
- No automatic code modification.
- No network PR comment publishing.
- No GitHub Action implementation.
- No model suspicion or model-generated confidence score published as
  actionable. Model-origin output requires proof, refutation, and admission.
- No provider SDKs in base dependencies.
- No public documentation for behavior that is not implemented.
- No replacement implementation for CodeQL, linters, formatters, unit tests, or
  build checks that production pipelines already run.
