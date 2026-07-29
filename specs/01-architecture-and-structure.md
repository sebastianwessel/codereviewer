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
    review-planning/
    context-retrieval/
    context-ingestion/
    verification/
    change-impact/
    invariant-conformance/
    shared-context/
    review-workflow/
      harness/
      pipeline/
        discovery/
      run/
    admission/
    reporting/
    evaluation/
    costs/
    observability/
    drift/
  shared/
    contracts/
    errors/
    glob/
    hash/
    json/
    redaction/
    schema/
    testing/
    text/
```

`shared/testing/` holds assertions a spec requires more than one domain to
satisfy. It is compiled out of the published build (`tsconfig.build.json`
excludes it) because nothing at runtime may import it.

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
| `verification` | The agentic investigation flow: claim/verdict contracts, claim providers (claims-file, prior-findings, current-findings), the bounded `investigate_claim` agent using mediated read/list/grep, the deterministic fix apply-check and advisory `fixProposal` enrichment, and corroboration matching. | Shell, network, filesystem writes, publishing, gate authority, or changing the general review's discovery path. |
| `change-impact` | Change-impact review (spec 22): the changed-symbol seed derived from support-signal facts intersected with diff hunks, bounded dependent discovery over those symbols, and its own report contract, admission, and metrics. | Filesystem or git access of its own, the diff reviewer's admission gate, quality-gate authority, report rendering for the diff review, or provider package loading. |
| `invariant-conformance` | Invariant-conformance review (spec 24): deterministic derivation of a changed declaration's peer set from support-signal facts, majority-pattern extraction over those peers, conformance adjudication, and its own divergence report contract separating change-attributed from pre-existing divergences. | Filesystem or git access of its own, the diff reviewer's admission gate or report schema, severity, quality-gate authority, or provider package loading. |
| `shared-context` | Run-local admitted facts/findings/evidence references. | Filesystem scanning or provider calls. |
| `review-workflow` | The public harness facade and the review runner: run-start state, preflight, source and planning state, context assembly, provider execution and failure classification, admission and completion state, baseline loading, cost and warning finalization. Also the model-facing stages it drives — holistic discovery, semantic finding merge, refutation, candidate conversion — with their packet shaping, agent instructions, and IO contracts. | Low-level git parsing, path normalization, artifact rendering, deterministic path authority, publication, provider package loading, or report rendering. |
| `admission` | Refutation-result validation, deterministic safety checks, promotion policy, and admitted/rejected decisions. | Candidate generation or output formatting. |
| `reporting` | JSON/Markdown/SARIF artifacts, run summary rendering, and platform-neutral review-comment drafts with their platform detection and per-platform renderers. | Admission decisions, provider calls, or publishing. |
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
- `change-impact` must not import from `review-workflow`, and `review-workflow`
  must not import from it. It is reachable only from `src/cli/`.
- `invariant-conformance` must not import from `review-workflow`, and
  `review-workflow` must not import from it. It is reachable only from
  `src/cli/`.
- `review-workflow` must not perform shell, git, network, or write operations,
  and every repository path it reads must first be resolved inside the
  repository root. See *Known Divergence* below on where that content is read.
### Known Divergence: Where Repository Content Is Read

The rule above is deliberately narrower than its predecessor, which required
model-facing review to obtain repository context *only* through
`context-retrieval`. That is not what the code does: `review-workflow` reads
source directly through `node:fs/promises` in its context-assembly modules —
task context, static context, and referenced definitions.

The safety half of the original intent **is** met. Every one of those reads
resolves its path inside the repository root first, and anything resolving
outside is skipped, so no unvalidated path reaches the filesystem. What is not
met is the layering half: retrieval policy lives in more than one place, so a
future change to how repository content is selected or bounded has several sites
to touch rather than one.

This is recorded as an unmet architectural goal rather than written out of the
spec, because consolidating those reads behind `context-retrieval` is a real
improvement that nobody has done, and deleting the requirement would erase the
reason to do it. It is not a security defect and should not be described as one.

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
