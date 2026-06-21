# 01: Architecture And Structure

Status: Approved
Date: 2026-06-19

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
    language-analyzers/
      typescript/
      javascript/
      python/
      go/
      rust/
      java/
      ast-grep/
    review-planning/
    shared-context/
    review-workflow/
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
| `provider-resolution` | Optional adapter package names, runtime loading, provider setup errors. | Model prompts, review policy, analyzer logic. |
| `language-analyzers` | Language facts, AST extraction, diagnostics, test discovery, framework discovery, and analyzer evidence for first-class language targets. | Core finding schema changes, admission decisions, provider calls, or report rendering. |
| `review-planning` | Review tasks, dependency-aware task grouping, budgets. | Model provider loading or publication. |
| `shared-context` | Run-local admitted facts/findings/evidence references. | Filesystem scanning or provider calls. |
| `review-workflow` | Harness runtime assembly and workflow orchestration. | Low-level git parsing, path normalization, artifact rendering. |
| `admission` | Candidate validation and admitted/rejected decisions. | Candidate generation or output formatting. |
| `reporting` | JSON/Markdown artifacts and run summary rendering. | Admission decisions or provider calls. |
| `evaluation` | Golden fixtures, metrics, benchmark runner, quality scoring. | Production admission logic. |
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
| Local run artifacts | `.review/runs/<run-id>/` | No |
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

## N/A Layers

| Layer | R1 Status | Evidence |
| --- | --- | --- |
| Frontend/browser UI | N/A | R1 has CLI and local artifacts only. |
| Database/migrations | N/A | R1 stores run artifacts on filesystem only. |
| Remote service topology | N/A | R1 has one local CLI process. |
| Authentication/session management | N/A | R1 uses local/CI credentials supplied by environment. |
