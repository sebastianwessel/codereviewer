# 01: Architecture And Structure

Status: Approved
Date: 2026-07-22

## Topology

`R1` is a modular TypeScript CLI package. It has one process, no database, no
remote server, and no background daemon. Async work runs inside one CLI run and
terminates before process exit.

## Runtime Stack

| Layer | Contract |
| --- | --- |
| Runtime | Node.js `>=24.15.0`, ESM-only. |
| Package manager | npm with committed `package-lock.json`. |
| Language | TypeScript `NodeNext`, strict mode. |
| Orchestration | `@purista/harness` workflows and agents. |
| Validation | Zod schemas at external, workflow, agent, tool, and artifact boundaries. |
| Tests | Vitest with colocated `*.test.ts` files. |

## Domain Structure

Implementation must use nested domain folders under `src/`. Additional files
are allowed only inside the owning domain folder defined below. New top-level
domain folders require a spec update.

```text
src/
  index.ts
  platform/
    path-service.ts
  domains/
    repository-intake/
    configuration/
    provider-resolution/
    deterministic-signals/
      structural/
      diff/
      scope/
    review-planning/
    context-retrieval/
    context-ingestion/
    shared-context/
    review-workflow/
    agentic-review/
      discovery/
      refutation/
    admission/
    reporting/
    evaluation/
    security/
    drift/
  shared/
    contracts/
    errors/
    redaction/
    result/
    schema/
```

## Ownership Rules

| Domain | Owns | Must Not Own |
| --- | --- | --- |
| `platform` | OS/path/runtime helpers. | Product policy, model calls, report rendering. |
| `repository-intake` | Git refs, changed files, file snapshots, diff maps. | Provider resolution, admission, report formatting. |
| `configuration` | Config discovery, parsing, defaults, merge order, validation. | Provider SDK imports, workflow execution. |
| `provider-resolution` | Optional adapter package names, runtime loading, provider setup errors. | Model prompts, review policy, support-signal logic. |
| `deterministic-signals` | Cheap local facts used for changed-line anchoring, symbol spans, import/test hints, scope validation, de-duplication, known-noisy contradiction checks, and optional external-tool metadata summaries. | Primary issue discovery, replacement CodeQL/linter/build/test behavior, admission decisions, provider calls, or report rendering. |
| `review-planning` | Review tasks and dependency-aware task grouping (change-unit clustering). | Model provider loading or publication. |
| `context-retrieval` | Read/list/grep-style repository context tools exposed through bounded mediation to refutation and (when skills are enabled) holistic review. | Shell execution, filesystem writes, network access, provider loading, or admission. |
| `context-ingestion` | External change-intent context providers (inbox, changed-files), fragment redaction, and the digest/model summarizers producing one bounded change-intent brief. | Admission decisions, gate authority, network beyond the configured provider endpoint, or reading outside the repository root. |
| `shared-context` | Run-local admitted facts/findings/evidence references. | Filesystem scanning or provider calls. |
| `review-workflow` | Public harness facade, focused review-runner run-start state, focused review-runner run observability/start logging, focused review-runner preflight for drift and telemetry setup, focused review-runner source-state preparation for repository intake and source reads, focused review-runner planning-state preparation for deterministic signals and task planning, focused review-runner context-assembly step lifecycle, focused review-runner repository input preparation, focused review-runner deterministic signal preparation, focused review-runner task planning, focused review-runner static-context loading, focused review-runner context-state/provenance/metrics preparation, focused review-runner completion-state preparation, focused review-runner success-result/report-metrics/completion-log assembly, focused review-runner quality-gate partial failure assembly, focused review-runner provider-state execution/live task-event recovery, focused review-runner provider failure classification and partial recovery, focused review-runner admission-state preparation with deterministic fallback observability, focused review-runner provider workflow invocation/usage accounting/provider-step observability, focused deterministic runner admission/task-event conversion, focused provider workflow output admission mapping, focused review-runner error/timeout signal and terminal-error classification, focused review-runner partial failure-state assembly, focused review-runner finalization for cost/warnings/resolved baseline, focused review-runner provenance hash projection, focused review-runner baseline loading/configured-state/schema validation/baseline-load observability, focused review-runner drift warning and gate-error shaping, focused review-runner observability recording, focused provided-candidate harness construction, focused model-backed harness construction, focused ai-harness runtime config/delegation policy, focused workflow session invocation/error normalization, focused shared workflow handler orchestration, focused public workflow contracts, focused task planning, bounded workflow task queue execution, workflow completion/admission assembly, review-runner budget derivation, review-runner context assembly, review-runner workflow-input assembly, review-runner result assembly, holistic discovery and refutation packet shaping, refutation orchestration, candidate-finding conversion, provider-call logging/normalization adapters, report-safe provider issue normalization, shared model packet-budget errors, compact model shared-digest rendering, model-agent instruction and IO-contract modules, shared mediated context artifact shaping, and model-origin admission review. | Low-level git parsing, path normalization, artifact rendering. |
| `agentic-review` | Model-facing holistic candidate-finding generation and refutation output schemas. | Deterministic path authority, publication, provider package loading, or report rendering. |
| `admission` | Refutation-result validation, deterministic safety checks, promotion policy, and admitted/rejected decisions. | Candidate generation or output formatting. |
| `reporting` | JSON/Markdown artifacts and run summary rendering. | Admission decisions or provider calls. |
| `evaluation` | Focused eval report contracts, focused Markdown report rendering, golden fixtures, metrics, benchmark runner, quality scoring, semantic-judge scoring metadata, and provider issue visibility in eval artifacts. | Production admission logic. |
| `security` | Redaction, permission models, safe command policy. | Business-domain review rules. |
| `drift` | Deterministic checks for docs/specs/schema/security ambiguity and drift. | Provider calls, model judging, git mutations, or source writes. |
| `shared` | Reusable contracts/helpers used by 2+ domains. | Domain-specific orchestration. |

## Public Entrypoints

| Entrypoint | Path | Contract |
| --- | --- | --- |
| Library entry | `src/index.ts` | Re-export stable public types and runtime helpers. No side effects. |
| CLI entry | `src/cli/index.ts` | Parse args, call domain services, map errors to exit codes. |
| Specs | `specs/` | Source of truth until readiness approval and implementation. |
| User docs | `docs/` | Implemented behavior only. |

## Generated Outputs

| Output | Location | Committed |
| --- | --- | --- |
| Build output | `dist/` | No |
| Coverage | `coverage/` | No |
| Local run artifacts | `.codereviewer/runs/<run-id>/` | No |
| Generated config schema | `schema/codereviewer-config.schema.json` | Yes |
| Golden eval datasets | `eval/fixtures/` | Yes when hand-authored |

## Shared Helper Policy

A helper must move to `src/shared/` only when at least two domains use it or a
spec identifies it as a stable cross-domain contract. Otherwise keep it inside
the owning domain.

## Dependency Direction

- Domains are allowed to depend on `platform` and `shared`.
- Domains must not import from sibling domain internals.
- Cross-domain access must use exported domain entrypoints.
- `shared` must not import from `domains`.
- Optional provider packages must only be imported by `provider-resolution`.
- `agentic-review` may request repository context only through
  `context-retrieval`; it must not perform direct filesystem, shell, git,
  network, or write operations.
- Deterministic signal extractors must be removable without changing core
  finding/report schemas. They can improve evidence quality but cannot be a
  required product-specific static-analysis tool for external CI-equivalent checks.

## N/A Layers

| Layer | R1 Status | Evidence |
| --- | --- | --- |
| Frontend/browser UI | N/A | R1 has CLI and local artifacts only. |
| Database/schema changes | N/A | R1 stores run artifacts on filesystem only. |
| Remote service topology | N/A | R1 has one local CLI process. |
| Authentication/session management | N/A | R1 uses local/CI credentials supplied by environment. |
