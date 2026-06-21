# 03: Generation Map

Status: Approved
Date: 2026-06-20

## Contract Source Strategy

R1 uses a contract-first clean implementation.

| Contract Surface | Planning Source | Implementation Source | Generated Output | Drift Check |
| --- | --- | --- | --- | --- |
| Config schema | `03-contracts/config.schema.json` | `src/shared/contracts/config/config.schema.ts` | `schema/codereviewer-config.schema.json`, `specs/03-contracts/config.schema.json` | `npm run generate:schemas` compares generated files with committed files. |
| Review report schema | `03-contracts/review-report.schema.json` | `src/shared/contracts/report/review-report.schema.ts` | `specs/03-contracts/review-report.schema.json` and TypeScript types inferred from Zod | `npm run generate:schemas` and contract fixture tests. |
| Finding/evidence contracts | `03-contracts/finding-evidence-report.md` and report schema definitions | `src/shared/contracts/findings/*.schema.ts` | TypeScript types inferred from Zod | contract fixture tests. |
| Review task and queue contracts | `05-review-workflow-and-runtime.md` review planning/runtime sections | `src/domains/review-planning/task-planner.ts` and `src/domains/review-planning/task-queue.ts` | TypeScript types inferred from Zod | task planner and queue tests. |
| Shared context snapshot | `05-review-workflow-and-runtime.md` shared context section | `src/domains/shared-context/shared-context.ts` | `shared-context.json` run artifact | CLI artifact and shared-context tests. |
| Error taxonomy | `05-review-workflow-and-runtime.md` | `src/shared/errors/*.ts` | TypeScript discriminated union | error mapping tests. |
| SARIF export | `03-contracts/finding-evidence-report.md` SARIF section | `src/domains/reporting/sarif/*` | `report.sarif` | SARIF schema validation and target subset tests. |

## Ownership

- `shared/contracts` owns source Zod schemas and inferred types.
- `configuration` owns config loading and normalized defaults.
- `reporting` owns artifact rendering from validated report objects.
- `evaluation` owns contract fixtures and regression datasets.

## Strong Boundary Type Policy

Closed contract boundaries reject weak types. `any` is forbidden. `unknown` is
allowed only before parser validation and must be narrowed by Zod before domain
logic receives a value. Open JSON leaves require an explicit schema field with
`additionalProperties` and a documented consumer.

## Compatibility

Before public release, contract changes require spec updates and regenerated
schemas. After public release, incompatible changes require schema version
increments, migration notes, and compatibility tests.
