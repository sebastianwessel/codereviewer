# 02: Capability Inventory

Status: Approved
Date: 2026-06-19

Each capability is implementation-ready only when its linked spec sections
define contracts, errors, permissions, observability, acceptance, and tests.

## Inventory

| ID | Capability | Actor/Consumer | R1 | Source Specs |
| --- | --- | --- | --- | --- |
| CAP-CLI-001 | Local review run | ACT-DEV, ACT-CI | Yes | `05-review-workflow-and-runtime.md` |
| CAP-CLI-002 | Config validation | ACT-DEV, ACT-CI | Yes | `04-configuration-and-providers.md` |
| CAP-REPO-001 | Repository intake | ACT-DEV, ACT-CI | Yes | `05-review-workflow-and-runtime.md` |
| CAP-LANG-001 | First-class language analyzers | ACT-DEV, ACT-CI | Yes | `05-review-workflow-and-runtime.md` |
| CAP-PROV-001 | Provider resolution | ACT-DEV, ACT-CI | Yes | `04-configuration-and-providers.md` |
| CAP-INSTR-001 | Reviewer instructions | ACT-DEV | Yes | `04-configuration-and-providers.md` |
| CAP-SKILL-001 | Mounted reviewer skills | ACT-DEV | Yes | `04-configuration-and-providers.md`, `07-security-privacy-operations.md` |
| CAP-WF-001 | Harness review workflow | ACT-MODEL, ACT-CI | Yes | `05-review-workflow-and-runtime.md` |
| CAP-ADM-001 | Admission gate | ACT-REVIEWER | Yes | `03-contracts/finding-evidence-report.md`, `05-review-workflow-and-runtime.md` |
| CAP-REP-001 | JSON report | ACT-DEV, ACT-CI | Yes | `03-contracts/finding-evidence-report.md` |
| CAP-REP-002 | Markdown report | ACT-DEV, ACT-REVIEWER | Yes | `03-contracts/finding-evidence-report.md` |
| CAP-REP-003 | SARIF report | ACT-DEV, ACT-CI | Yes | `03-contracts/finding-evidence-report.md`, `04-configuration-and-providers.md` |
| CAP-BASE-001 | Baseline matching | ACT-CI | Yes | `03-contracts/finding-evidence-report.md`, `04-configuration-and-providers.md`, `05-review-workflow-and-runtime.md` |
| CAP-CTX-001 | Context ledger | ACT-OPS, ACT-DEV | Yes | `05-review-workflow-and-runtime.md`, `07-security-privacy-operations.md` |
| CAP-COV-001 | Review coverage certificate | ACT-DEV, ACT-CI, ACT-OPS | Yes | `05-review-workflow-and-runtime.md`, `03-contracts/finding-evidence-report.md` |
| CAP-EVAL-001 | Evaluation runner | ACT-OPS | Yes | `06-evaluation-and-quality-gates.md` |
| CAP-GATE-001 | Quality gate result | ACT-CI | Yes | `06-evaluation-and-quality-gates.md` |
| CAP-OPS-001 | Run observability | ACT-OPS | Yes | `07-security-privacy-operations.md` |
| CAP-DRIFT-001 | Drift, gap, and ambiguity checks | ACT-DEV, ACT-CI, ACT-OPS | Yes | `06-evaluation-and-quality-gates.md`, `07-security-privacy-operations.md` |
| CAP-PR-001 | PR comment publishing | ACT-REVIEWER | No | Future spec required |
| CAP-FIX-001 | Automatic fix application | ACT-DEV | No | Future spec required |
| CAP-UI-001 | Browser UI | ACT-DEV | No | Future spec required |

## Capability Details

### CAP-CLI-001 Local Review Run

- Trigger: `codereviewer review` CLI command.
- Preconditions: current working directory is inside a git repository unless
  `--files` provides explicit files; config is valid; selected provider is
  resolvable when model review is enabled.
- Data touched: git metadata, selected files, config, reviewer instructions,
  mounted skill index, run artifact directory.
- Side effects: creates `.review/runs/<run-id>/` artifacts only.
- Permissions: read repository; no writes outside run artifact directory.
- Errors: invalid config, git failure, selected provider missing, path escapes
  repository, model failure, budget exceeded.
- Recovery: rerun after fixing error; `--run-id` reuse is forbidden in R1.
- Final state: JSON and Markdown reports exist, or a structured error exits
  with non-zero code.
- Verification: CLI integration test with fixture repo and scripted provider.

### CAP-CLI-002 Config Validation

- Trigger: `codereviewer config validate --config <path>` CLI command.
- Preconditions: config file is optional. Missing file validates built-in
  defaults and emits warning code `config-file-missing`.
- Side effects: none.
- Final state: exit `0` with normalized config summary, or exit `2` with
  schema errors.
- Verification: config fixture tests for valid, missing optional, unknown key,
  invalid provider, unsafe path, and conflicting options.

### CAP-REPO-001 Repository Intake

- Trigger: local review run.
- Contracts: emits `RepositorySnapshot`, `ChangedFile`, `DiffMap`, and skipped
  file records defined in `03-contracts/finding-evidence-report.md`.
- Side effects: none.
- Final state: reviewed file paths are repository-relative portable paths
  and filesystem paths remain under repository root.
- Verification: POSIX and Windows path tests; git fixture tests.

### CAP-LANG-001 First-Class Language Analyzers

- Trigger: review planner assigns changed files for TypeScript, JavaScript,
  Python, Go, Rust, or Java.
- Contracts: emits language-neutral facts, diagnostics, test mappings, and
  evidence only.
- Side effects: none in R1.
- Final state: analyzer output can be consumed without language-specific fields
  in core finding, admission, report, or evaluation contracts.
- Verification: per-language fixture files, parser/AST tests, diagnostics
  tests where available, and schema tests.

### CAP-PROV-001 Provider Resolution

- Trigger: config references a provider for model-backed review.
- Contracts: provider IDs are `openai`, `openai-compatible`, `bedrock`,
  `azure`.
- Side effects: dynamically imports selected optional adapter only.
- Final state: harness model alias is registered or setup error names exact
  package to install.
- Verification: tests without provider packages installed.

### CAP-INSTR-001 Reviewer Instructions

- Trigger: config references instruction files or CLI passes one-off
  instruction text.
- Data touched: instruction files under repository root.
- Side effects: instruction content is passed to model context only for
  model-backed tasks and is not logged or traced by default.
- Final state: run summary records instruction source path and hash, not raw
  content.
- Verification: redaction snapshot tests.

### CAP-SKILL-001 Mounted Reviewer Skills

- Trigger: config allowlists skill directories.
- Preconditions: skill paths resolve under repository root or explicit absolute
  allowlist.
- Side effects: no skill file is read by default; agents receive skill index and
  controlled read access.
- Final state: run summary records skill names, paths, hashes, and tools
  allowed.
- Verification: traversal denial and allowlist tests.

### CAP-WF-001 Harness Review Workflow

- Trigger: local review run after intake and planning.
- Contracts: uses `defineHarness()`, declares models before agents before
  workflows, and uses Zod at boundaries.
- Side effects: provider calls if configured.
- Final state: candidate findings and evidence records are passed to admission.
- Verification: scripted provider workflow tests.

### CAP-ADM-001 Admission Gate

- Trigger: candidate finding generated.
- Preconditions: candidate conforms to schema.
- Side effects: writes admitted or rejected decision to shared context.
- Final state: every admitted finding has location, evidence, severity,
  provenance, and reporter eligibility.
- Verification: admission matrix tests.

### CAP-REP-001 JSON Report

- Trigger: run completion.
- Contract: `ReviewReport` JSON schema.
- Side effects: writes `report.json`.
- Final state: machine-readable artifact contains admitted and rejected
  candidates with redacted evidence summaries.
- Verification: schema validation and snapshot tests.

### CAP-REP-002 Markdown Report

- Trigger: run completion.
- Contract: deterministic Markdown generated from `ReviewReport`.
- Side effects: writes `report.md`.
- Final state: human report contains summary, admitted findings, skipped files,
  run metadata, and setup warnings.
- Verification: snapshot tests.

### CAP-REP-003 SARIF Report

- Trigger: run completion when SARIF reporting is enabled.
- Contract: SARIF 2.1.0 generated from canonical `ReviewReport`.
- Side effects: writes `report.sarif` in the run artifact directory.
- Final state: machine-readable artifact contains redacted results with stable
  fingerprints and repository-relative locations.
- Verification: SARIF schema validation, GitHub-target subset validation when
  configured, and redaction snapshot tests.

### CAP-BASE-001 Baseline Matching

- Trigger: after admission, before reporting and quality gates.
- Contracts: uses `FindingFingerprint` values and baseline config.
- Side effects: reads configured baseline path when present; future write/update
  command requires a separate spec.
- Final state: admitted findings are marked new, existing, or unknown; resolved
  baseline entries are available in reports when configured.
- Verification: baseline fixture tests for new, existing, resolved, and missing
  baseline cases.

### CAP-CTX-001 Context Ledger

- Trigger: review planning and model context assembly.
- Contracts: records every included source chunk and other considered context
  decisions without raw content.
- Side effects: writes redacted context ledger into run artifacts.
- Final state: source chunk records can prove which tasks covered each
  reviewable file.
- Verification: ledger unit tests and snapshot tests proving no raw source is
  stored.

### CAP-COV-001 Review Coverage Certificate

- Trigger: report assembly after task execution and admission.
- Contracts: emits `ReviewReport.coverage` with per-file byte totals, covered
  byte totals, content hashes, task IDs, status, and incomplete reasons.
- Side effects: writes coverage data inside `report.json` and `report.md`.
- Final state: successful completed reports have `coverage.status = complete`;
  incomplete source coverage exits with `coverage_incomplete` and partial
  artifacts instead of claiming success.
- Verification: report schema tests, runner large-file tests, packet-overflow
  tests, and eval metric tests.

### CAP-EVAL-001 Evaluation Runner

- Trigger: `codereviewer eval run` CLI command.
- Side effects: writes eval report artifacts.
- Final state: metrics include recall, precision, F1, line accuracy, severity
  accuracy, latency, cost, and parse validity.
- Verification: golden fixture tests.

### CAP-GATE-001 Quality Gate Result

- Trigger: review run or eval run with thresholds.
- Side effects: exit code is `1` when the configured quality gate fails.
- Final state: gate result records threshold inputs and deterministic reasons.
- Verification: threshold matrix tests.

### CAP-OPS-001 Run Observability

- Trigger: every run.
- Side effects: logs redacted events and optional no-content traces.
- Final state: run summary includes timings, model calls, token/cost estimates,
  skipped work, and error taxonomy.
- Verification: log redaction and summary tests.

### CAP-DRIFT-001 Drift, Gap, And Ambiguity Checks

- Trigger: review preflight, `codereviewer drift check`, CI quality gate, and
  release verification.
- Data touched: `specs/`, `docs/`, `README.md`, generated schemas, package
  scripts, CLI command inventory, and selected source contracts.
- Side effects: writes only report artifacts under configured artifact
  directory when invoked as part of a run.
- Final state: deterministic findings identify documentation drift, spec drift,
  implementation drift, generated artifact drift, ambiguity, and security
  drift. Findings are warnings or hard errors based on drift config.
- Security: no provider calls, no shell commands, no repository writes, and no
  network IO.
- Verification: drift checker tests for stale links, stale specs references,
  generated schema mismatch, security permission mismatch, and ambiguity
  classification.

## Explicit N/A Capabilities

| Category | R1 Status | Reason |
| --- | --- | --- |
| Admin/support UI | N/A | No remote service or user accounts in R1. |
| Payments/entitlements | N/A | No commercial flow in R1. |
| Notifications | N/A | No outbound notifications in R1. |
| Search index | N/A | Reports are local files; no query service in R1. |
| Import/export sync | N/A | R1 reads repositories and writes local artifacts only. |
| Files/media uploads | N/A | R1 does not accept user-uploaded files outside repository checkout. |
