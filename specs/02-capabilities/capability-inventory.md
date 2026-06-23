# 02: Capability Inventory

Status: Approved
Date: 2026-06-22

Each capability is implementation-ready only when its linked spec sections
define contracts, errors, permissions, observability, acceptance, and tests.
R1 is intentionally LLM-centric: deterministic code provides safety, context,
and corroboration signals, while semantic issue discovery is owned by bounded
model investigation and proof/refutation loops.

## Inventory

| ID | Capability | Actor/Consumer | R1 | Source Specs |
| --- | --- | --- | --- | --- |
| CAP-CLI-001 | Local review run | ACT-DEV, ACT-CI | Yes | `05-review-workflow-and-runtime.md` |
| CAP-CLI-002 | Config validation | ACT-DEV, ACT-CI | Yes | `04-configuration-and-providers.md` |
| CAP-REPO-001 | Repository intake | ACT-DEV, ACT-CI | Yes | `05-review-workflow-and-runtime.md` |
| CAP-SIGNAL-001 | Deterministic support signals | ACT-DEV, ACT-CI, ACT-MODEL | Yes | `05-review-workflow-and-runtime.md`, `03-contracts/finding-evidence-report.md` |
| CAP-PROV-001 | Provider resolution | ACT-DEV, ACT-CI | Yes | `04-configuration-and-providers.md` |
| CAP-INSTR-001 | Reviewer instructions | ACT-DEV | Yes | `04-configuration-and-providers.md` |
| CAP-SKILL-001 | Mounted reviewer skills | ACT-DEV | Yes | `04-configuration-and-providers.md`, `07-security-privacy-operations.md` |
| CAP-AI-001 | Suspicion generation | ACT-MODEL, ACT-REVIEWER | Yes | `05-review-workflow-and-runtime.md`, `03-contracts/finding-evidence-report.md` |
| CAP-AI-002 | Tool-mediated investigation loop | ACT-MODEL, ACT-REVIEWER | Yes | `05-review-workflow-and-runtime.md`, `07-security-privacy-operations.md` |
| CAP-AI-003 | Proof packet assembly | ACT-MODEL, ACT-REVIEWER | Yes | `03-contracts/finding-evidence-report.md`, `05-review-workflow-and-runtime.md` |
| CAP-AI-004 | Refutation gate | ACT-MODEL, ACT-REVIEWER | Yes | `03-contracts/finding-evidence-report.md`, `05-review-workflow-and-runtime.md` |
| CAP-ADM-001 | Promotion and admission gate | ACT-REVIEWER | Yes | `03-contracts/finding-evidence-report.md`, `04-configuration-and-providers.md`, `05-review-workflow-and-runtime.md` |
| CAP-REP-001 | JSON report | ACT-DEV, ACT-CI | Yes | `03-contracts/finding-evidence-report.md` |
| CAP-REP-002 | Markdown report | ACT-DEV, ACT-REVIEWER | Yes | `03-contracts/finding-evidence-report.md` |
| CAP-REP-003 | SARIF report | ACT-DEV, ACT-CI | Yes | `03-contracts/finding-evidence-report.md`, `04-configuration-and-providers.md` |
| CAP-REP-004 | GitHub PR review-comment artifact | ACT-DEV, ACT-CI, ACT-REVIEWER | Yes | `03-contracts/finding-evidence-report.md`, `06-evaluation-and-quality-gates.md` |
| CAP-BASE-001 | Baseline matching | ACT-CI | Yes | `03-contracts/finding-evidence-report.md`, `04-configuration-and-providers.md`, `05-review-workflow-and-runtime.md` |
| CAP-CTX-001 | Context ledger | ACT-OPS, ACT-DEV | Yes | `05-review-workflow-and-runtime.md`, `07-security-privacy-operations.md` |
| CAP-COV-001 | Review coverage certificate | ACT-DEV, ACT-CI, ACT-OPS | Yes | `05-review-workflow-and-runtime.md`, `03-contracts/finding-evidence-report.md` |
| CAP-EVAL-001 | Evaluation runner | ACT-OPS | Yes | `06-evaluation-and-quality-gates.md` |
| CAP-EVAL-002 | Evaluation analysis commands | ACT-OPS | Yes | `06-evaluation-and-quality-gates.md` |
| CAP-EVAL-003 | Semantic judge matching | ACT-OPS | Yes | `06-evaluation-and-quality-gates.md` |
| CAP-GATE-001 | Quality gate result | ACT-CI | Yes | `06-evaluation-and-quality-gates.md` |
| CAP-OPS-001 | Run observability | ACT-OPS | Yes | `07-security-privacy-operations.md` |
| CAP-DRIFT-001 | Drift, gap, and ambiguity checks | ACT-DEV, ACT-CI, ACT-OPS | Yes | `06-evaluation-and-quality-gates.md`, `07-security-privacy-operations.md` |
| CAP-PR-001 | Network PR comment publishing | ACT-REVIEWER | No | Future spec required |
| CAP-FIX-001 | Automatic fix application | ACT-DEV | No | Future spec required |
| CAP-UI-001 | Browser UI | ACT-DEV | No | Future spec required |

## Capability Details

### CAP-CLI-001 Local Review Run

- Trigger: `codereviewer review` CLI command.
- Preconditions: current working directory is inside a git repository unless
  `--files` provides explicit files; config is valid; selected provider is
  resolvable for LLM-backed review.
- Data touched: git metadata, selected files, config, reviewer instructions,
  mounted skill index, run artifact directory.
- Side effects: creates `.codereviewer/runs/<run-id>/` artifacts only.
- Permissions: read repository; no writes outside run artifact directory.
- Errors: invalid config, git failure, selected provider missing, path escapes
  repository, model failure, budget exceeded.
- Recovery: rerun after fixing error; `--run-id` reuse is forbidden in R1.
- Final state: JSON and Markdown reports exist, or a structured error exits
  with non-zero code.
- Verification: CLI integration test with fixture repo and hermetic provider fixture.

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

### CAP-SIGNAL-001 Deterministic Support Signals

- Trigger: after repository intake and before model investigation.
- Contracts: emits language-neutral `DeterministicSignal` and `EvidenceRecord`
  data for changed-line anchors, symbol spans, imports, test/config hints,
  scope validity, known contradiction checks, and duplicate keys.
- Runtime posture: signals are small, local, and bounded. They are not a
  product-owned replacement for CodeQL, linters, formatters, unit tests, or
  build checks in production.
- Side effects: none.
- Final state: model tasks and admission can use signals as context,
  corroboration, contradiction, anchoring, and report evidence.
- Verification: fixture tests proving valid anchors/corroboration and negative
  tests proving signals alone do not create issue findings unless explicitly
  classified as safety/gate errors.

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

### CAP-AI-001 Suspicion Generation

- Trigger: provider-backed review after deterministic support signals and task
  packets are assembled.
- Contracts: emits `ModelSuspicion[]`, not findings. A suspicion identifies a
  changed behavior, risk category, likely path/symbol, requested follow-up
  context, and initial evidence references.
- Side effects: provider calls only when model-backed review is configured.
- Final state: every suspicion is queued for investigation, rejected as weak, or
  retained as artifact-only diagnostic output.
- Verification: hermetic provider fixture tests for high-value suspicion creation,
  weak-suspicion rejection, schema invalid output, and budget limits.

### CAP-AI-002 Runtime-Mediated Investigation Loop

- Trigger: each non-rejected model suspicion.
- Contracts: suspicion output may include bounded `requestedContext` strings.
  Runtime-owned context retrieval maps only conservative read/list/grep-style
  requests into evidence records after containment, scope, budget, redaction,
  and ledger checks.
- Side effects: provider calls and repository reads/searches only. No shell,
  network, write, publish, provider-configuration, direct model repository
  tool, or git mutation capability is available to model output.
- Final state: mediated evidence supports a proof packet, a refuted suspicion,
  or `needs-more-evidence` artifact-only output.
- Verification: tests for requested-context mediation, per-suspicion
  read/search budgets, prompt-injection resistance, redacted traces, and
  context ledger entries.

### CAP-AI-003 Proof Packet Assembly

- Trigger: investigation concludes a suspicion is likely actionable.
- Contracts: proof packet must identify changed behavior, execution/data path,
  violated invariant or contract, concrete impact, why the reviewed change
  introduced or exposed the issue, exact evidence IDs, contradiction checks, and
  manual fix direction.
- Side effects: none beyond redacted artifacts and model calls already counted
  in the investigation.
- Final state: complete proof packets proceed to refutation; incomplete proof
  packets become artifact-only or rejected.
- Verification: schema tests, proof-completeness matrix tests, and eval cases
  for missing reachability, missing impact, and missing fix direction.

### CAP-AI-004 Refutation Gate

- Trigger: every complete proof packet before promotion/admission.
- Contracts: model-assisted or hermetic-test refutation must attempt to disprove the
  proof by checking reachability, guards, framework semantics, contradictory
  deterministic signals, outside-scope status, and evidence sufficiency.
- Side effects: provider calls and mediated repository reads only when
  configured; no publication or write authority.
- Final state: `proved`, `refuted`, `needs-more-evidence`, or
  `provider-error` result. Only `proved` may be promoted to actionable.
- Verification: tests with intentionally false suspicions, guard-protected code,
  out-of-scope references, provider failures, and deterministic contradictions.

### CAP-ADM-001 Promotion And Admission Gate

- Trigger: refutation result generated.
- Preconditions: proof packet and refutation result conform to schema.
- Side effects: writes admitted, rejected, or artifact-only decision to shared
  context.
- Final state: every actionable admitted finding has location, evidence,
  severity, provenance, proof packet, refutation result, and reporter
  eligibility. Weak or refuted model output remains visible only as configured
  artifact-only diagnostic output or rejected records.
- Verification: promotion policy and admission matrix tests.

### CAP-REP-001 JSON Report

- Trigger: run completion.
- Contract: `ReviewReport` JSON schema.
- Side effects: writes `report.json`.
- Final state: machine-readable artifact contains admitted findings, rejected
  findings, artifact-only suspicions/proofs, provider issues, and redacted
  evidence summaries.
- Verification: schema validation and snapshot tests.

### CAP-REP-002 Markdown Report

- Trigger: run completion.
- Contract: deterministic Markdown generated from `ReviewReport`.
- Side effects: writes `report.md`.
- Final state: human report contains summary, admitted findings, artifact-only
  unresolved output, provider issues, skipped files, run metadata, and setup
  warnings.
- Verification: snapshot tests.

### CAP-REP-003 SARIF Report

- Trigger: run completion when SARIF reporting is enabled.
- Contract: SARIF 2.1.0 generated from canonical `ReviewReport`.
- Side effects: writes `report.sarif` in the run artifact directory.
- Final state: machine-readable artifact contains redacted actionable results
  with stable fingerprints and repository-relative locations. Artifact-only
  suspicions are not SARIF results unless a future spec defines suppressed
  diagnostics.
- Verification: SARIF schema validation, GitHub-target subset validation when
  configured, and redaction snapshot tests.

### CAP-REP-004 GitHub PR Review-Comment Artifact

- Trigger: review completion when `reporting.formats` includes
  `github-review-comments`.
- Contract: renders a deterministic local JSON array of GitHub review-comment
  drafts from actionable admitted findings only.
- Preconditions: admitted finding has `reporterEligibility = inline`, a
  resolvable new-side diff location, a complete proof packet, a passed
  refutation result, and severity at or above the configured inline threshold.
- Side effects: writes `github-review-comments.json` in the run artifact
  directory only. It performs no network IO and does not publish comments.
- Final state: each comment draft carries repository-relative path, line or
  start-line range, side, redacted body, source finding ID, proof summary, and
  optional manual suggestion block when safe.
- Verification: renderer tests for actionable, artifact-only, refuted,
  ineligible, old-side, and unsafe multi-edit fix cases.

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

- Trigger: planning, model context assembly, and investigation tool mediation.
- Contracts: records every included source chunk, tool-mediated context read,
  search, and other considered context decisions without raw content.
- Side effects: writes redacted context ledger into run artifacts.
- Final state: source chunk and tool-read records can prove what context
  informed each suspicion/proof/refutation.
- Verification: ledger unit tests and snapshot tests proving no raw source is
  stored.

### CAP-COV-001 Review Coverage Certificate

- Trigger: report assembly after task execution and admission.
- Contracts: emits `ReviewReport.coverage` with per-file byte totals, covered
  byte totals, content hashes, task IDs, status, and incomplete reasons.
- Side effects: writes coverage data inside `report.json` and `report.md`.
- Final state: completed reports have `coverage.status = complete` for the
  declared source universe, or fail closed with `coverage_incomplete`.
- Verification: report schema tests, runner large-file tests,
  packet-overflow tests, and eval metric tests.

### CAP-EVAL-001 Evaluation Runner

- Trigger: `codereviewer eval run` CLI command.
- Side effects: writes eval report artifacts.
- Final state: metrics include actionable proof recall/precision, suspicion
  recall, proof promotion precision, artifact-only noise, provider issue rate,
  latency, token use, cost, and parse validity.
- Verification: eval runner integration test.

### CAP-EVAL-002 Evaluation Analysis Commands

- Trigger: eval compare, recall-report, and slice-manifest commands.
- Side effects: reads eval artifacts and writes local summaries only.
- Final state: humans can compare case selection, scoring mode, proof quality,
  missed expectations, false positives, artifact-only suspicions, and provider
  issues.
- Verification: focused CLI tests.

### CAP-EVAL-003 Semantic Judge Matching

- Trigger: `codereviewer eval run --semantic-judge`.
- Side effects: provider calls for eval matching only.
- Final state: benchmark-parity matching metadata is recorded separately from
  production admission decisions.
- Verification: hermetic provider fixture semantic-judge tests.

### CAP-EVAL-004 Agentic Benchmark Posture

- Trigger: `codereviewer eval run --review-mode pr --review-depth thorough
  --intent-planning model --judge-findings`.
- Side effects: provider calls for review, optional critic judging, and optional
  semantic eval matching when `--semantic-judge` is also supplied.
- Final state: benchmark runs can force the intended PR-review agentic path
  without changing repository config. The default costly benchmark script uses
  this posture; a separately named baseline script preserves current-config
  provider benchmark comparisons.
- Verification: focused eval CLI override tests and package-script tests.

### CAP-GATE-001 Quality Gate Result

- Trigger: review or eval completion.
- Side effects: process exit code only.
- Final state: deterministic pass/fail result based on actionable admitted
  findings, provider issue policy, coverage, and configured thresholds.
- Verification: quality-gate matrix tests.

### CAP-OPS-001 Run Observability

- Trigger: every command.
- Side effects: sanitized logs and run artifacts only.
- Final state: provider issues, retries, recovered/unrecovered status, token
  counts, costs, task timings, investigation budgets, and redacted failure
  codes are visible to humans without exposing source or prompts.
- Verification: log/redaction snapshot tests.

### CAP-DRIFT-001 Drift, Gap, And Ambiguity Checks

- Trigger: review preflight or explicit drift command.
- Side effects: none unless report artifacts are written by the caller.
- Final state: deterministic drift findings identify stale docs/specs/schemas,
  security drift, ambiguity, and retired references.
- Verification: drift checker tests.
