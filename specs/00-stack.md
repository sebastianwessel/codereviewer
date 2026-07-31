# 00: Stack

Status: Approved
Date: 2026-07-31

## Runtime Stack

| Layer | Decision | Evidence |
| --- | --- | --- |
| Runtime | Node.js `>=24.15.0` | `@purista/harness` engine metadata. |
| Module system | ESM only | `package.json` has `"type": "module"`; global invariant `INV-ESM-001`. |
| Language | TypeScript `NodeNext`, strict mode | `tsconfig.json`; architecture spec. |
| Package manager | npm with committed `package-lock.json` | dependency and release spec. |
| Orchestration | `@purista/harness` `^1.6.0` | `package.json` dependency range. |
| Validation | Zod `^4.4.3` | `package.json` dependency range. |
| Tests | Vitest `^4.1.9` | `package.json` dev dependency range. |
| Dev runner | tsx `^4.22.4` | `package.json` dev dependency range. |

Version evidence is the committed `package.json` range plus `package-lock.json`,
not a point-in-time registry lookup, so this table cannot drift from the installed
tree without the lockfile also changing.

## Public API Inventory

| Surface | Stability | Owner | Contract Source | R1 Execution |
| --- | --- | --- | --- | --- |
| CLI `codereviewer review` | Public R1 | `configuration`, `repository-intake`, `review-workflow` | Config and report contracts | Parses config, runs review, writes artifacts, exits with mapped code. |
| CLI `codereviewer config validate` | Public R1 | `configuration` | Config contract | Validates normalized config and exits without side effects. |
| CLI `codereviewer eval run` | Public R1 | `evaluation` | Eval contract | Runs fixture evaluations and writes eval report artifacts. |
| CLI `codereviewer eval compare` | Public R1 | `evaluation` | Eval contract | Compares two eval reports and writes a comparison artifact. |
| CLI `codereviewer eval recall-report` | Public R1 | `evaluation` | Eval contract | Renders a recall breakdown from eval report artifacts. |
| CLI `codereviewer eval slice-manifest` | Public R1 | `evaluation` | Eval contract | Emits a corpus slice manifest for a selected case set. |
| CLI `codereviewer baseline write` | Public R1 | `admission`, `reporting` | Baseline file contract | Writes the configured baseline from a completed report; never invoked by `review`. |
| CLI `codereviewer drift check` | Public R1 | `drift` | Drift categories | Runs the deterministic drift checks and exits by `drift.failOn`. |
| CLI `codereviewer impact check` | Public R1 | `change-impact` | Change-impact report contract | Reports dependents of changed symbols as JSON. Advisory: it exits `0` whatever it reports, and only setup/repository errors change the code. Never invoked by `review`. |
| CLI `codereviewer intent check` | Public R1 | `intent-fulfilment` | Intent-fulfilment report contract | Maps stated obligations to evidence in the change as JSON. Advisory: it exits `0` whatever it reports, and only setup/repository errors change the code. Never invoked by `review`. |
| CLI `codereviewer conformance check` | Public R1 | `invariant-conformance` | Divergence report contract | Reports peer-pattern divergences as JSON. Advisory: it exits `0` whatever it reports, and only setup/repository errors change the code. Never invoked by `review`. |
| Library `src/index.ts` | Public R1 | root package | exported TypeScript types | Re-exports stable types/helpers with no side effects. |
| Config file `.codereviewer/config.json` | Public R1 | `configuration` | `03-contracts/config.schema.json` | Strict JSON config, merged with env and CLI flags. |
| Report JSON `report.json` | Public R1 | `reporting` | `03-contracts/review-report.schema.json` | Canonical machine-readable run output. |
| Markdown `report.md` | Public R1 | `reporting` | report rendering spec | Human-readable deterministic artifact. |
| SARIF `report.sarif` | Public R1 | `reporting` | SARIF 2.1.0 export rules | Local SARIF export only; upload/publishing excluded. |

## Execution Semantics

```yaml
execution_semantics:
  process_model: single_cli_process
  module_system: esm_only
  async_scope: run_local_promises_cancelled_before_process_exit
  default_network: selected_provider_only
  default_shell: denied
  default_filesystem_write: run_artifact_directory_only
  other_filesystem_writes:
    baseline_write_command: baseline.path
    eval_run_command: eval_report_and_slice_artifacts
  source_writes: never
  external_provider_tests: opt_in_only
  default_tests: hermetic_provider_fixtures
  timeout_sources:
    provider_call: provider.timeoutMs
    run: review.runTimeoutMs
  cancellation:
    cli_interrupt: cancel_pending_tasks_and_write_partial_summary
  retries:
    provider: provider.maxRetries
    repository_intake: no_retry
    report_rendering: no_retry
  idempotency:
    run_id_reuse: forbidden_in_R1
    artifacts: written_under_new_run_directory
```

## Dependency Evidence

Current package metadata was checked with `npm view` on 2026-06-22. The
canonical dependency table is [08-dependencies-and-release.md](08-dependencies-and-release.md).
