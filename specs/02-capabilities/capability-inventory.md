# 02: Capability Inventory

Status: Approved
Date: 2026-07-22

Each capability is implementation-ready only when its linked spec sections
define contracts, errors, permissions, observability, acceptance, and tests.
R1 is intentionally LLM-centric: deterministic code provides safety, context,
and corroboration signals, while semantic issue discovery is owned by a holistic
whole-file review and a per-candidate refutation pass.

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
| CAP-AI-001 | Holistic discovery | ACT-MODEL, ACT-REVIEWER | Yes | `05-review-workflow-and-runtime.md`, `03-contracts/finding-evidence-report.md` |
| CAP-AI-004 | Refutation | ACT-MODEL, ACT-REVIEWER | Yes | `03-contracts/finding-evidence-report.md`, `05-review-workflow-and-runtime.md` |
| CAP-AI-005 | Semantic finding merge | ACT-MODEL, ACT-REVIEWER | Yes | `05-review-workflow-and-runtime.md`, `03-contracts/finding-evidence-report.md` |
| CAP-AI-006 | Agentic cross-file discovery (mediated repo read/list/grep during discovery, off by default) | ACT-MODEL, ACT-REVIEWER | Yes | `16-agentic-cross-file-discovery.md`, `04-configuration-and-providers.md` |
| CAP-AI-008 | Discovery posture (measured variant; default `precise`) | ACT-MODEL, ACT-REVIEWER | Yes | `20-discovery-posture.md`, `04-configuration-and-providers.md` |
| CAP-AI-009 | Independent discovery sampling with union merge (measured variant; default `k = 1`) | ACT-MODEL, ACT-REVIEWER | Yes | `21-independent-sampling.md`, `05-review-workflow-and-runtime.md`, `04-configuration-and-providers.md` |
| CAP-ADM-001 | Admission gate | ACT-REVIEWER | Yes | `03-contracts/finding-evidence-report.md`, `04-configuration-and-providers.md`, `05-review-workflow-and-runtime.md` |
| CAP-REP-001 | JSON report | ACT-DEV, ACT-CI | Yes | `03-contracts/finding-evidence-report.md` |
| CAP-REP-002 | Markdown report | ACT-DEV, ACT-REVIEWER | Yes | `03-contracts/finding-evidence-report.md` |
| CAP-REP-003 | SARIF report | ACT-DEV, ACT-CI | Yes | `03-contracts/finding-evidence-report.md`, `04-configuration-and-providers.md` |
| CAP-REP-004 | Platform-neutral review-comment artifacts (GitHub/GitLab/Bitbucket/generic renderers) | ACT-DEV, ACT-CI, ACT-REVIEWER | Yes | `13-review-comments-and-suggestions.md`, `03-contracts/finding-evidence-report.md` |
| CAP-BASE-001 | Baseline matching | ACT-CI | Yes | `03-contracts/finding-evidence-report.md`, `04-configuration-and-providers.md`, `05-review-workflow-and-runtime.md` |
| CAP-CTX-001 | Context ledger | ACT-OPS, ACT-DEV | Yes | `05-review-workflow-and-runtime.md`, `07-security-privacy-operations.md` |
| CAP-CTX-002 | External change-intent context ingestion (inbox + changed-files providers, digest/model summarizer, change-intent injection) | ACT-CI, ACT-DEV | Yes | `11-external-context-ingestion.md`, `07-security-privacy-operations.md`, `04-configuration-and-providers.md` |
| CAP-CTX-003 | Platform PR/MR context adapters (GitHub/GitLab/Bitbucket) | ACT-CI, ACT-DEV | No | Later phase — `11-external-context-ingestion.md` |
| CAP-CTX-005 | Read-only MCP context provider (e.g. JIRA) with tool-name allowlist | ACT-CI, ACT-DEV | No | Later phase — `11-external-context-ingestion.md`, `07-security-privacy-operations.md` |
| CAP-VERIFY-001 | Agentic verification flow (bounded read/list/grep agent, claim verdicts, corroboration) | ACT-CI, ACT-DEV, ACT-MODEL | Yes | `12-verification-flow.md`, `07-security-privacy-operations.md`, `04-configuration-and-providers.md` |
| CAP-VERIFY-002 | Claim providers (claims-file, prior-findings) | ACT-CI, ACT-DEV | Yes | `12-verification-flow.md` |
| CAP-VERIFY-003 | Analyzer (SARIF) and comment claim providers | ACT-CI, ACT-DEV | No | Later phase — `12-verification-flow.md` |
| CAP-VERIFY-004 | Finding investigation and fix lane (current-findings claims, boolean finding judgment, apply-checked fix enrichment) | ACT-CI, ACT-DEV, ACT-MODEL | Yes | `12-verification-flow.md`, `04-configuration-and-providers.md` |
| CAP-COV-001 | Review coverage certificate | ACT-DEV, ACT-CI, ACT-OPS | Yes | `05-review-workflow-and-runtime.md`, `03-contracts/finding-evidence-report.md` |
| CAP-EVAL-001 | Evaluation runner | ACT-OPS | Yes | `06-evaluation-and-quality-gates.md` |
| CAP-EVAL-002 | Evaluation analysis commands | ACT-OPS | Yes | `06-evaluation-and-quality-gates.md` |
| CAP-EVAL-003 | Semantic judge matching | ACT-OPS | Yes | `06-evaluation-and-quality-gates.md` |
| CAP-EVAL-005 | Real-repository evaluation corpus | ACT-OPS | Yes | `17-real-repository-eval-corpus.md`, `06-evaluation-and-quality-gates.md` |
| CAP-EVAL-004 | Per-mechanism security measurement (recall/precision by CWE mechanism + context-depth, held-out anti-contamination) | ACT-OPS | Yes | `06-evaluation-and-quality-gates.md`, `15-security-focused-review.md` |
| CAP-SEC-001 | Security review lens (generic OWASP/CWE checklist discovery, refutation-gated) | ACT-MODEL, ACT-REVIEWER | Yes | `15-security-focused-review.md`, `05-review-workflow-and-runtime.md` |
| CAP-SEC-002 | Deterministic security-signal evidence (source/sink, CWE/data-flow) | ACT-MODEL, ACT-DEV | Yes | `15-security-focused-review.md`, `03-contracts/finding-evidence-report.md` |
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

- Trigger: after repository intake and before holistic discovery.
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

### CAP-AI-001 Holistic Discovery

- Trigger: provider-backed review after deterministic support signals and task
  packets are assembled.
- Contracts: a single recall-first whole-file review per task reads the unified
  diff plus the full line-numbered changed files and emits `CandidateFinding[]`
  directly (capped per task), not findings. Each candidate names a concrete
  defect, its triggering path, and impact.
- Side effects: provider calls only when model-backed review is configured.
- Final state: every candidate is passed to refutation; raw candidates do not
  become actionable on their own.
- Verification: hermetic provider fixture tests for candidate creation, schema
  invalid output, and per-task candidate caps.

### CAP-AI-005 Semantic Finding Merge

- Trigger: after every discovery candidate for a task exists and before
  admission, for each file that carries two or more candidates. A file with
  fewer than two candidates issues no call.
- Contracts: a model call receives the candidates for one file together with
  that file and returns groups of candidates that describe the same underlying
  defect. It is never asked which candidate to discard, it treats proximity as
  no evidence, and it defaults to not grouping when uncertain. The
  representative of a group is selected deterministically in code by highest
  severity, then most specific location, then lowest candidate index.
- Side effects: one provider call per merging file; a separate call from
  refutation.
- Final state: each group yields exactly one candidate that continues to
  refutation and admission; non-representative members are recorded as
  `duplicate` rejected findings rather than dropped. A failed merge call is a
  recovered provider issue and leaves every candidate ungrouped.
- Verification: scripted-runner unit tests for grouping, for two distinct
  defects sharing a line, for the single-candidate no-call rule, and for
  degradation on call failure.

### CAP-AI-004 Refutation

- Trigger: every model-origin candidate finding within reviewed scope before
  admission.
- Contracts: model-assisted or hermetic-test refutation uses only the provided
  candidate, reviewed diff ranges, evidence, review context, support-signal
  candidates, instructions, skills metadata, shared digest, and provenance to
  prove or disprove the candidate (reachability, guards, framework semantics,
  declared contracts, outside-scope status, evidence sufficiency).
- Side effects: provider calls and mediated repository reads only when
  configured; no publication or write authority.
- Final state: `proved`, `refuted`, `needs-more-evidence`, or `provider-error`
  result. Only `proved` may continue to actionable admission; `refuted` is
  rejected; `needs-more-evidence` is dispositioned by `promotionPolicy`.
- Verification: tests with intentionally false candidates, guard-protected code,
  out-of-scope references, and provider failures.

### CAP-AI-006 Agentic Cross-File Discovery

- Trigger: `review.crossFileRetrieval.enabled`. Off by default.
- Contracts: `16-agentic-cross-file-discovery.md`. Discovery may call the mediated
  `repo_read`/`repo_list`/`repo_grep` tools, bounded by a per-task tool-call cap
  and a per-read byte cap enforced in code.
- Side effects: additional bounded provider steps and mediated repository reads;
  no shell, network, or write authority.
- Final state: disabled, discovery is single-shot with no tools and the run is
  unchanged. Enabled, retrieved content is untrusted and its findings pass the
  same refutation and admission as any other candidate.
- Verification: cross-file tool and discovery wiring tests.

### CAP-AI-007 Context Scout — withdrawn

Removed on 2026-07-27, together with `specs/18-context-scout.md` and the
`review.contextScout` configuration block. The identifier is retired and not
reused. The scout was a separate pre-review call that chose extra symbols to
include in the discovery packet; it is removed on mechanism, not on a failed
result, because its only measurement is void. The reasoning is recorded under
*Withdrawal Of The Context Scout* in `05-review-workflow-and-runtime.md`.

### CAP-AI-008 Discovery Posture

- Trigger: `review.discoveryPosture`. Default `precise`.
- Contracts: `20-discovery-posture.md`. The posture changes only how much
  self-evidence the reviewer demands before raising a candidate. It introduces no
  categories, checklists, or examples, and alters neither the call count nor the
  packet's field order.
- Side effects: none beyond a slightly longer instruction.
- Final state: refutation, the semantic finding merge, and admission are unchanged;
  the posture widens what reaches them and never what leaves them.
- Verification: config schema default test, prompt genericity guard, instruction
  unit test, and a discovery test asserting identical call count and packet field
  order across postures.

### CAP-AI-009 Independent Discovery Sampling

- Trigger: `review.discoverySampleCount`. Default `1`, bounded at `5`.
- Contracts: `21-independent-sampling.md`. Discovery runs `k` mutually blind
  samples over the identical packet and combines the candidates by union.
  Consensus, majority voting, and agreement thresholds are forbidden, and no
  second deduplication mechanism exists — the semantic finding merge (CAP-AI-005)
  is the only one.
- Side effects: `k` provider calls per task instead of one; cost rises close to
  linearly in `k`.
- Final state: `k = 1` is the single-call path. A failed sample costs that sample
  only; the reduced count is recorded in the run and surfaced as a run warning.
  No review agent call carries prior conversation.
- Verification: discovery sampling unit tests for blindness, union, no second
  dedup, and partial sample failure; handler tests for the reduced-count warning;
  harness config and provider-boundary tests for conversation suppression.

### CAP-ADM-001 Admission Gate

- Trigger: refutation result generated.
- Preconditions: candidate finding and refutation result conform to schema.
- Side effects: writes admitted, rejected, or artifact-only decision to shared
  context.
- Final state: every actionable admitted finding has location, evidence,
  severity, provenance, a `proved` refutation result, and reporter eligibility,
  and meets the severity floor. Refuted or needs-more-evidence model output
  remains visible only as configured artifact-only diagnostic output or rejected
  records.
- Verification: admission matrix tests.

### CAP-REP-001 JSON Report

- Trigger: run completion.
- Contract: `ReviewReport` JSON schema.
- Side effects: writes `report.json`.
- Final state: machine-readable artifact contains candidate findings, admitted
  findings, rejected findings, refutation results, provider issues, and redacted
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
  findings are not SARIF results unless a future spec defines suppressed
  diagnostics.
- Verification: SARIF schema validation, GitHub-target subset validation when
  configured, and redaction snapshot tests.

### CAP-REP-004 Platform-Neutral Review-Comment Artifacts

- Trigger: review completion when `reporting.reviewComments.enabled` is `true`
  (`13-review-comments-and-suggestions.md`).
- Contract: renders a deterministic neutral `review-comments.json` and a
  platform-rendered `review-comments.<platform>.json` from actionable admitted
  findings only. The platform is resolved from config, then CI environment, then
  the git remote host, then `generic`.
- Preconditions: admitted finding has `reporterEligibility = inline` (which
  admission grants only to a location that anchors to a changed new-side line —
  a `side = "new"` range overlapping a hunk, or a `side = "file"` line inside
  one), a `proved` refutation result, and severity at or above the configured
  inline threshold.
- Side effects: writes the artifacts in the run artifact directory only. It
  reads environment variables and the git remote for detection, performs no
  network IO, and does not publish comments.
- Final state: each neutral draft carries repository-relative path, new-side
  target range, redacted body, source finding ID, and a structured suggestion
  when a single safe fix edit maps to the range; renderers add per-platform
  syntax.
- Verification: renderer tests for actionable, artifact-only, refuted,
  ineligible, old-side, and unsafe multi-edit fix cases.

### CAP-BASE-001 Baseline Matching

- Trigger: after admission, before reporting and quality gates.
- Contracts: uses `FindingFingerprint` values and baseline config.
- Side effects: reads configured baseline path when present. Writing the baseline
  is a separate explicit operation, `codereviewer baseline write`, defined under
  *Baseline Generation* in `05-review-workflow-and-runtime.md`; the `review`
  command must never write it.
- Final state: admitted findings are marked new, existing, or unknown; resolved
  baseline entries are available in reports when configured.
- Verification: baseline fixture tests for new, existing, resolved, and missing
  baseline cases.

### CAP-CTX-001 Context Ledger

- Trigger: planning, model context assembly, and refutation tool mediation.
- Contracts: records every included source chunk, tool-mediated context read,
  search, and other considered context decisions without raw content.
- Side effects: writes redacted context ledger into run artifacts.
- Final state: source chunk and tool-read records can show what context informed
  each candidate and refutation.
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
- Final state: metrics include actionable recall/precision, product recall,
  recall by tier, F1, refutation false-positive/false-negative counts,
  artifact-only noise, provider issue rate, latency, token use, cost, and parse
  validity.
- Verification: eval runner integration test.

### CAP-EVAL-002 Evaluation Analysis Commands

- Trigger: eval compare, recall-report, and slice-manifest commands.
- Side effects: reads eval artifacts and writes local summaries only.
- Final state: humans can compare case selection, scoring mode, refutation
  quality, missed expectations, false positives, artifact-only findings, and
  provider issues.
- Verification: focused CLI tests.

### CAP-EVAL-003 Semantic Judge Matching

- Trigger: `codereviewer eval run` scoring a case that declares expected
  findings, with a configured provider.
- Side effects: provider calls for eval matching and judge calibration only.
- Final state: every expected-finding match carries a judge decision and reason,
  judge agreement and trustworthiness are recorded, undecided pairs are reported
  as inconclusive, and a case with expected findings and no judge fails with a
  config error. Matching metadata is recorded separately from production
  admission decisions.
- Verification: hermetic scripted-judge matcher, calibration, and CLI tests.

### CAP-EVAL-005 Real-Repository Evaluation Corpus

- Trigger: `codereviewer eval run` against the real-repository corpus under
  `eval/corpora/`.
- Contracts: `17-real-repository-eval-corpus.md`.
- Side effects: provider calls for review and judge scoring; local eval artifacts
  only.
- Final state: recall and precision are measured against cases derived from real
  repository history rather than hand-authored fixtures.
- Verification: corpus manifest and eval runner tests.

### CAP-EVAL-004 Benchmark Posture

- Trigger: `codereviewer eval run --review-mode pr --review-depth thorough`.
- Side effects: provider calls for review, plus semantic eval matching and judge
  calibration whenever a provider is configured.
- Final state: benchmark runs can force the intended PR-review path without
  changing repository config. The default costly benchmark script uses this
  posture.
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
  counts, costs, task timings, and redacted failure codes are visible to humans
  without exposing source or prompts.
- Verification: log/redaction snapshot tests.

### CAP-DRIFT-001 Drift, Gap, And Ambiguity Checks

- Trigger: review preflight or explicit drift command.
- Side effects: none unless report artifacts are written by the caller.
- Final state: deterministic drift findings identify stale docs/specs/schemas,
  security drift, ambiguity, and retired references.
- Verification: drift checker tests.
