# 02: Capability Inventory

Status: Approved
Date: 2026-07-22

Each capability is implementation-ready only when its linked spec sections
define contracts, errors, permissions, observability, acceptance, and tests.
R1 is intentionally LLM-centric: deterministic code provides safety, context,
and corroboration signals, while semantic issue discovery is owned by a holistic
whole-file review, a semantic finding merge, and a refutation pass batched per
task.

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
| CAP-AI-006 | Agentic cross-file discovery (mediated repo read/list/grep during discovery, on by default) | ACT-MODEL, ACT-REVIEWER | Yes | `16-agentic-cross-file-discovery.md`, `28-targeted-reads.md`, `04-configuration-and-providers.md` |
| CAP-AI-010 | Discovery partitioning (a task's changed files spread across several discovery calls, candidates unioned) | ACT-MODEL, ACT-REVIEWER | Yes | `27-discovery-partitioning.md`, `05-review-workflow-and-runtime.md` |
| CAP-AI-011 | Reactive task splitting (a task is halved only when the provider refuses the packet) | ACT-MODEL | Yes | `26-reactive-task-splitting.md`, `05-review-workflow-and-runtime.md` |
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
| CAP-IMPACT-001 | Change-impact review (`impact check`, deterministic reference traversal, off by default) | ACT-DEV, ACT-CI | Yes | `22-change-impact-review.md` |
| CAP-INTENT-001 | Intent-fulfilment review (`intent check`, obligation extraction and per-obligation judgement, advisory-only, off by default) | ACT-DEV, ACT-CI, ACT-MODEL | Yes | `23-intent-fulfilment-review.md` |
| CAP-CONF-001 | Invariant-conformance review (`conformance check`, peer-set divergence detection with optional model adjudication, off by default) | ACT-DEV, ACT-CI, ACT-MODEL | Yes | `24-invariant-conformance-review.md` |
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
- Contracts: a recall-first whole-file review per discovery partition reads the
  partition's unified-diff segments plus the full line-numbered changed files and
  emits `CandidateFinding[]` directly (capped per CALL), not findings. Each
  candidate names a concrete defect, its triggering path, and impact. A finding
  is dropped when its path is outside the paths its own call was shown.
- Side effects: provider calls only when model-backed review is configured; one
  general call per partition, plus one security call per partition when the
  dedicated security pass is enabled, plus any call a provider refusal split.
- Final state: every candidate is passed to the semantic merge and then to
  refutation; raw candidates do not become actionable on their own.
- Verification: hermetic provider fixture tests for candidate creation, schema
  invalid output, per-call candidate caps, and out-of-partition path rejection.

### CAP-AI-010 Discovery Partitioning

- Trigger: provider-backed discovery whenever a task carries more review targets
  than `aiReview.maxFilesPerDiscoveryCall` (default `2`).
- Contracts: `27-discovery-partitioning.md`. Partitioning is by file count, never
  by bytes. Each partition is a sub-task with its own synthetic task id and its
  own narrowed `paths`; every partition receives the shared context the undivided
  task would have had; candidates are unioned across partitions.
- Side effects: more discovery and refutation provider calls per task. The
  child-agent call budget scales with the partition count, since under-reserving
  makes the workflow refuse a call mid-run.
- Final state: a task within the limit produces exactly one partition and the run
  is unchanged. Above it, the same code is reviewed across more calls, and a
  finding stays restricted to the files its own call read.
- Verification: partition unit tests for the inert case, path narrowing, context
  routing (including referenced definitions, which are not parent review
  targets), and the scaled call budget.

### CAP-AI-011 Reactive Task Splitting

- Trigger: a discovery call failing with the harness's normalised
  `context_length_exceeded` reason.
- Contracts: `26-reactive-task-splitting.md`. Assembly never splits on a byte
  budget. Detection is the normalised reason only — never provider message text,
  status codes, or any provider-specific shape. The task is halved and each half
  retried from its own rebuilt context, bounded by recursion depth 6.
- Side effects: additional sequential provider calls; a reported split count kept
  distinguishable from transient retry.
- Final state: halves keep their absolute line origins so a finding reports the
  file's real line. A unit that cannot be halved and is still refused fails with
  `review_task_indivisible` rather than being truncated or dropped.
- Verification: split, depth-bound, line-origin, and indivisible-failure unit
  tests.

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
  admission. Candidates are grouped by the task that raised them and adjudicated
  one batch per task, so a partitioned task produces one batch per partition.
  Support-signal and out-of-scope candidates are decided by deterministic rules
  and never cost a call.
- Contracts: model-assisted or hermetic-test refutation uses only the provided
  candidates, reviewed diff ranges, evidence, review context (excluding the
  change-intent brief), support-signal candidates, instructions, skills metadata,
  shared digest, and provenance to prove or disprove each candidate
  (reachability, guards, framework semantics, declared contracts, outside-scope
  status, evidence sufficiency). Each candidate receives its own verdict, and
  sharing a call must not make one candidate's verdict depend on another's.
- Side effects: provider calls and mediated repository reads only when
  configured; no publication or write authority.
- Final state: `proved`, `refuted`, `needs-more-evidence`, or `provider-error`
  result. Only `proved` may continue to actionable admission; `refuted` is
  rejected; `needs-more-evidence` is dispositioned by `promotionPolicy`.
- Verification: tests with intentionally false candidates, guard-protected code,
  out-of-scope references, and provider failures.

### CAP-AI-006 Agentic Cross-File Discovery

- Trigger: `review.crossFileRetrieval.enabled`. On by default since 2026-08-01.
- Contracts: `16-agentic-cross-file-discovery.md` and `28-targeted-reads.md`.
  Discovery may call the mediated `repo_read`/`repo_list`/`repo_grep` tools,
  bounded by a per-task tool-call cap enforced in code (default `100`, a runaway
  guard rather than a ration). `repo_read` accepts an optional `startLine`/
  `endLine` range so the reviewer narrows a large file itself.
  `maxBytesPerRead` is UNSET by default: a read is not proactively cut, and when
  an operator sets it, or a runaway guard binds, the cut is DISCLOSED in the tool
  output rather than applied silently. A silently truncated read was the
  mechanism behind three measurements that recorded this capability as harmful.
- Side effects: additional bounded provider steps and mediated repository reads;
  no shell, network, or write authority. Tool calls are agent steps, so they cost
  no child-agent call budget.
- Final state: disabled, discovery is single-shot with no tools and the run is
  unchanged. Enabled, retrieved content is untrusted and its findings pass the
  same refutation and admission as any other candidate.
- Verification: cross-file tool, per-task scoping, truncation-disclosure, and
  discovery wiring tests.

### CAP-AI-007 Context Scout — withdrawn

Removed on 2026-07-27, together with `specs/18-context-scout.md` and the
`review.contextScout` configuration block. The identifier is retired and not
reused. The scout was a separate pre-review call that chose extra symbols to
include in the discovery packet; it is removed on mechanism, not on a failed
result, because its only measurement is void. The reasoning is recorded under
*Withdrawal Of The Context Scout* in `05-review-workflow-and-runtime.md`.

### CAP-AI-008 Discovery Posture — withdrawn

Removed on 2026-07-27, together with `specs/20-discovery-posture.md` and the
`review.discoveryPosture` configuration key. The identifier is retired and not
reused. The posture was an instruction segment that lowered the evidentiary bar
the discovery reviewer applied to itself; its A/B failed the decision rule fixed
in advance, and the intervention moved candidate count in the wrong direction. The
measurement, and the reason it is not a verdict on the idea it came from, are
recorded under *Measured Outcome Of The Withdrawn Discovery Posture* in
`05-review-workflow-and-runtime.md`.

### CAP-AI-009 Independent Discovery Sampling — withdrawn

Removed on 2026-07-27, together with `specs/21-independent-sampling.md` and the
`review.discoverySampleCount` configuration key. The identifier is retired and not
reused. Discovery drew `k` mutually blind samples over an identical packet and
unioned their candidates; at `k = 3` recall did not rise significantly while
adjusted precision fell 0.819 → 0.628 at +67% cost, and the measurement falsified
the spec's own premise — the harvestable union ceiling is ~4pp, not the assumed
~20pp. The measurement, the fact that it bounds identical-input resampling only,
and what survives the removal are recorded under *Measured Outcome Of The Withdrawn
Independent Sampling* in `05-review-workflow-and-runtime.md`. The harness-wide
suppression of conversation history arrived under this capability but is
independent of it and is rehomed under *Harness Runtime → Conversation History* in
the same spec.

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

### CAP-IMPACT-001 Change-Impact Review

- Trigger: `codereviewer impact check` CLI command. Never reached by `review`.
- Contracts: `22-change-impact-review.md`. Deterministic reference traversal only;
  no provider call. Bounded by `changeImpact.maxChangedSymbols`,
  `maxReferencesPerSymbol`, and `maxSearchDepth`.
- Preconditions: `changeImpact.enabled`, off by default. When disabled the
  command still exits `0` and reports itself disabled rather than erroring.
- Side effects: repository reads only, all through the mediated retriever so
  path containment, the eligibility gate, and redaction apply. No artifact is
  written; output is stdout.
- Final state: exit `0` with the impact summary, or a structured error.
- Verification: change-impact traversal and CLI tests.

### CAP-INTENT-001 Intent-Fulfilment Review

- Trigger: `codereviewer intent check` CLI command. Never reached by `review`.
- Contracts: `23-intent-fulfilment-review.md`. One extraction call, one judgement
  call per obligation, one explanation call per run. `maxObligations` is the
  primary spend bound and refuses rather than truncating when it binds.
- Preconditions: `intentFulfilment.enabled`, off by default. When disabled, or
  enabled with no provider configured, the lane reports that rather than failing:
  nothing in it can fail the run.
- Side effects: provider calls only. No artifact is written; output is stdout.
- Final state: advisory only. The command MUST NOT be able to fail a pipeline on
  fulfilment grounds, and that is a requirement rather than a default: there is
  deliberately no `blocking` configuration key, because the measured spurious-
  rejection rate of model requirement-conformance judgement is not accurate
  enough to gate on.
- Verification: extraction, judgement, and CLI tests.

### CAP-CONF-001 Invariant-Conformance Review

- Trigger: `codereviewer conformance check` CLI command. Never reached by
  `review`.
- Contracts: `24-invariant-conformance-review.md`. Deterministic peer-set
  divergence detection, with an optional model adjudication stage that is itself
  off by default. Bounded by `maxChangedDeclarations`, `maxPeersPerDeclaration`,
  `maxPeerFiles`, `maxDivergences`, and `maxPreExistingDivergences`.
- Preconditions: `invariantConformance.enabled`, off by default. When disabled
  the command still exits `0` and reports itself disabled rather than erroring.
  Adjudication enabled with no available adjudicator reports the deterministic
  divergences unjudged rather than failing.
- Side effects: repository reads, plus provider calls only when adjudication is
  enabled. No artifact is written; output is stdout.
- Final state: exit `0` with the divergence report, or a structured error.
- Verification: peer-derivation, divergence, and adjudication tests.

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
