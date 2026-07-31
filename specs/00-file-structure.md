# 00: File Structure

Status: Approved
Date: 2026-07-31

## Implementation Structure

The canonical implementation structure is defined in
[01-architecture-and-structure.md](01-architecture-and-structure.md). This file
exists as the readiness gate anchor for folder ownership and generated outputs.

## Top-Level Directories

| Path | Owner | Rule |
| --- | --- | --- |
| `src/` | implementation | Domain/topic implementation and colocated tests. |
| `src/domains/` | implementation | Product domains only; new top-level domains require spec update. |
| `src/shared/` | implementation | Cross-domain contracts and helpers used by at least two domains. |
| `src/platform/` | implementation | OS/runtime helpers with no product policy. |
| `schema/` | contracts | Committed generated public JSON Schema artifacts. |
| `scripts/` | tooling | Schema generation, pricing refresh, and eval corpus hydration. No product behavior. |
| `eval/` | evaluation | Hand-authored golden fixtures, benchmark and corpus manifests. |
| `reports/` | evaluation | Measurement records, including the eval results ledger. Not implementation authority. |
| `specs/` | product architecture | Tracked implementation source of truth. |
| `docs/` | end-user docs | Implemented behavior only. |
| `concept/` | local research | Ignored by git and not implementation authority. |
| `plans/` | local planning | Ignored by git and not implementation authority. |
| `.agent/` | agent workflow | Implementation guidance and planning rules. |

## Generated Outputs

| Output | Location | Git |
| --- | --- | --- |
| ESM build | `dist/` | ignored |
| Coverage | `coverage/` | ignored |
| Run artifacts | `.codereviewer/runs/<run-id>/` | ignored |
| Eval artifacts and hydrated slices | `.codereviewer/eval/` | ignored |
| Config JSON Schema | `schema/codereviewer-config.schema.json` | committed |
| Spec copies of the generated contracts | `specs/03-contracts/config.schema.json`, `specs/03-contracts/review-report.schema.json` | committed |

## Placement Rules

- Domain-specific code stays in the owning domain.
- Reusable code moves to `src/shared/` only after reuse is real or specified.
- Tests stay near the implementation.
- Generated artifacts have fixed locations and are written only by
  `npm run generate:schemas`; hand-editing them is forbidden and
  `npm run generate:schemas:check` fails when they drift.
- No domain imports sibling internals; cross-domain access uses entrypoints.
