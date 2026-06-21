# 05: Review Workflow And Runtime

Status: Approved
Date: 2026-06-19

## End-To-End Flow

1. Parse CLI args.
2. Load and validate config.
3. Load root `.env` when present and merge process env.
4. Resolve repository root from CLI or current working directory.
5. Create run directory.
6. Collect repository intake.
7. Load reviewer instruction metadata.
8. Load mounted skill index when enabled.
9. Run deterministic drift/security preflight checks.
10. Build language-neutral repository facts.
11. Plan review tasks.
12. Resolve provider when model-backed tasks exist.
13. Run harness workflow.
14. Admit or reject candidates.
15. Match admitted findings against baseline.
16. Render reports.
17. Evaluate optional quality gate.
18. Record available token/cost metadata and optional no-content telemetry
    configuration.
19. Exit with mapped code.

Runtime artifacts and logs must remain redacted. Source snippets, prompt text,
secrets, tokens, and raw provider payloads must not be logged by default.

## Repository Intake

Inputs:

- `baseRef`;
- `headRef`;
- explicit file list, optional;
- include/exclude patterns;
- repository root.

Output contracts:

- `RepositorySnapshot`;
- `ChangedFile[]`;
- `DiffMap[]`;
- `SkippedFile[]`.

Rules:

- Repository root defaults to CLI current working directory.
- Config, explicit files, include/exclude paths, instruction paths, skill paths,
  baseline path, eval fixtures, and artifact directory must resolve under the
  repository root before IO.
- Git refs must not start with `-`.
- Git command execution is read-only and allowlisted as defined by the security
  spec.
- Explicit files bypass git diff but still require repository-root containment.
- Deleted files are recorded as skipped with reason `deleted`.
- Binary files are skipped with reason `binary`.
- Oversized files are skipped with reason `too-large`.
- Generated/vendor files matched by excludes are skipped with reason `excluded`.
- All output paths are portable paths.

## Language Analyzer Contract

Each analyzer implements:

```text
detect(files) -> AdapterDetection
analyze(changedFiles, repositorySnapshot) -> LanguageFact[] + EvidenceRecord[]
discoverTests(changedFiles, repositorySnapshot) -> TestMapping[]
```

R1 first-class language targets:

- TypeScript: `.ts`, `.tsx`, `.mts`, `.cts`;
- JavaScript: `.js`, `.jsx`, `.mjs`, `.cjs`;
- Python: `.py`;
- Go: `.go`;
- Rust: `.rs`;
- Java: `.java`.

Generic analyzer requirements:

- use AST-backed parsing, not regex-only source scanning, for declarations,
  imports/includes, exports/public API, and symbol spans;
- expose one first-class adapter per language target. Shared parser helpers are
  allowed, but registry dispatch must call `detect`, `analyze`, and
  `discoverTests` only on the adapter that owns the routed file extension;
- enforce language ownership at registry, adapter, and parser boundaries. A
  parser must reject paths outside the selected language extension set before
  invoking the AST engine;
- validate both `LanguageFact.path` and `EvidenceRecord.location.path` against
  the producing analyzer language before adding analysis output to review tasks
  or shared context;
- use `@ast-grep/napi` as the preferred generic multi-language AST layer for
  syntax facts across first-class languages;
- keep ast-grep execution inside the deterministic analyzer stage. Normal
  review runs must not add ast-grep documentation, raw AST dumps, generated rule
  authoring traces, or MCP transcripts to provider prompts;
- allow language-native analyzers when they provide materially better evidence
  than the generic AST layer, for example TypeScript compiler diagnostics,
  `go test`/`go list` metadata, Rust crate metadata, or Java build metadata;
- emit language-neutral facts for declarations, imports/dependencies, exported
  or public API symbols, changed symbol spans, diagnostics, and related tests;
- emit test mappings using idiomatic conventions for each first-class language;
- never add language-specific fields to `CandidateFinding` or
  `AdmittedFinding`;
- never execute project code as part of default analyzer behavior.

Language-specific minimums:

| Language | Minimum Analyzer Evidence |
| --- | --- |
| TypeScript | AST facts, import/export facts, parse diagnostics, TypeScript test mapping. |
| JavaScript | AST facts, import/export/CommonJS facts, parse diagnostics where available, JS test mapping. |
| Python | AST facts, import facts, public symbol facts, `test_*.py` and `*_test.py` mapping. |
| Go | AST facts, import facts, exported symbol facts, `_test.go` mapping. |
| Rust | AST facts, `use`/`mod` facts, public item facts, unit/integration test mapping. |
| Java | AST facts, package/import facts, public class/member facts, JUnit-style test mapping. |

## Review Planning

Task grouping:

- one task per changed file for `fast`;
- bounded dependency-cluster tasks for `balanced`;
- dependency-cluster plus bounded policy-focused tasks for `thorough`.
  Policy tasks must reuse bounded path/evidence clusters and must not create a
  single all-changed-files sweep.

Task limits:

- hard cap `maxConcurrentTasks`;
- dependency clusters must be split into bounded task packets. Connected import
  components larger than the task path cap must be split deterministically
  rather than sent as one oversized worker packet;
- per-task source, analyzer, instruction, and metadata packet must fit the
  configured model-bound task input budget before a provider call starts;
- workflow context assembly must split source into exact included chunks when a
  file or dependency cluster cannot fit in one packet. Large files and large
  dependency clusters create more review tasks; they must not create skipped or
  truncated required source;
- workflow context assembly records every included source chunk in the context
  ledger with reason `task-context-source-chunk`, task ID, byte counts, and
  content hash. Budget pressure is not an evidence record unless another
  analyzer or reviewer produces evidence that references it;
- deterministic analyzer candidates remain eligible for admission even when a
  provider-backed model is configured; model output may add candidates but must
  not be the only path by which deterministic diagnostics are admitted.

`ReviewTask` fields:

| Field | Type |
| --- | --- |
| `id` | `task_<hash>` |
| `round` | integer >= 1 |
| `kind` | `file | dependency-cluster | policy` |
| `paths` | repository-relative path array |
| `factIds` | language fact IDs in scope |
| `evidenceIds` | evidence IDs in scope |
| `candidateIds` | deterministic candidate IDs in scope |
| `contextEntryIds` | ledger entry IDs included in task context |
| `priority` | deterministic integer |

Task queue rules:

- tasks are leased in deterministic `round`, `priority`, `id` order;
- later rounds must not be claimed while an earlier round still has planned or
  running tasks;
- no more than `maxConcurrentTasks` tasks may be running at one time;
- provider-backed task execution must use a rolling worker pool: as soon as one
  worker finishes a task, the next eligible task in the same round may start
  without waiting for slower sibling tasks;
- provider-backed workflows must enforce the same `maxConcurrentTasks` value at
  the task queue and Harness child-agent delegation boundary so active model
  calls cannot exceed the configured cap;
- task state transitions are append-only: `planned -> running -> completed`
  or `planned -> running -> failed`;
- worker inputs contain only task-scoped context, evidence, candidates,
  instructions, mounted skill references, and a compact shared digest from
  earlier admitted task output;
- live shared digests passed to later workers must not include raw model
  candidates, rejected candidates, or admission decisions before they pass a
  deterministic admission boundary. Raw candidates may remain in their owning
  task packet and final admission input, but only admitted findings and other
  explicitly safe shared entries are rendered into live worker digests;
- provider-backed review invokes worker agents per task, never with the entire
  repository context as one model call.
- deterministic analyzer-only review uses the same task queue state machine and
  records planned, running, and completed task events in shared context.

## Structural Analysis Pipeline

The review pipeline treats ast-grep-backed analysis as a deterministic local
stage before task planning:

1. Repository intake selects reviewable files and rejects unsupported paths.
2. The language-analyzer registry routes each file to one owning adapter.
3. TypeScript and JavaScript analyzers use language-native parsing where it
   provides stronger diagnostics; Python, Go, Rust, and Java use
   `@ast-grep/napi` with registered grammars for AST facts.
4. Analyzer output is normalized to `LanguageFact`, `EvidenceRecord`, and
   `TestMapping` data before it can enter planning or shared context.
5. Task planning uses import and test-mapping facts to build bounded task
   groups.
6. Context assembly may include compact analyzer-output JSON in task packets,
   but it must not include raw AST dumps or rule-authoring traces.

This stage does not call a model provider and does not consume model tokens by
itself. Provider token use changes only when compact analyzer output is included
in a task packet, where it replaces or focuses broader source context instead
of expanding prompts with ast-grep documentation.

The no-content observability artifact must record the `language_analysis` step
with safe metadata for structural engine provenance, ast-grep version, fact
count, evidence count, language count, and test-mapping count. These attributes
must not include source snippets, prompts, raw AST node text, or provider
responses.

## Drift And Security Preflight

Every review run performs deterministic preflight checks before provider
resolution:

1. Validate generated schemas are current when generated artifact checking is
   enabled.
2. Validate public docs and README do not point to missing docs/spec paths.
3. Validate security-sensitive config does not request rejected R1 permissions.
4. Validate specs, docs, and CLI command inventory for stale path references.
5. Emit drift findings for configured categories.

Preflight findings are split into warnings and hard errors by `drift.failOn`
and `drift.warnOn`. Hard errors stop before provider resolution and before any
network-capable path. Warnings are included in run summary and reports.

## Context Ledger

Each context item considered for model context must produce a context ledger
entry. Context item kinds are file, diff hunk, symbol fact, instruction file,
skill file, analyzer output, and previous-run artifact.

`ContextLedgerEntry` fields:

| Field | Type |
| --- | --- |
| `id` | stable string |
| `kind` | `file | diff | symbol | instruction | skill | analyzer-output | prior-artifact` |
| `path` | repository-relative path for repository-backed context; omitted for external metadata |
| `taskId` | optional task ID when the ledger entry describes a task-local decision |
| `sourceLedgerEntryId` | optional original context ledger entry ID for derived decisions |
| `contentHash` | SHA-256 when content was read |
| `decision` | `included | skipped | truncated | summarized` |
| `reason` | stable string |
| `bytesConsidered` | integer >= 0 |
| `bytesIncluded` | integer >= 0 |

Rules:

- completed review reports must not contain budget-driven skipped, truncated,
  or summarized required source context;
- ledger entries must not include raw source, prompt text, or provider output;
- source inside the declared reviewable universe is complete only when the sum
  of included `task-context-source-chunk` bytes for each file equals that file's
  reviewable byte length and all entries are `included`;
- provider task-packet overflow is a hard pre-call failure. The workflow must
  fail with `task_packet_budget_exceeded` rather than shortening source,
  instructions, skills, evidence, analyzer output, or metadata;
- mandatory instruction and skill content must be included exactly or fail
  before provider invocation. Automatic instruction summarization is forbidden
  in R1 because it changes reviewer semantics;
- incomplete final source coverage fails closed with `coverage_incomplete`.
  Successful completed reports require `coverage.status = complete`;
- review runs must persist `context-ledger.json` in the run artifact directory.

## Coverage Certificate

Completed `report.json` must contain a `coverage` object proving review scope
coverage.

`CoverageSummary` fields:

| Field | Type |
| --- | --- |
| `status` | `complete | incomplete` |
| `reviewableFileCount` | integer >= 0 |
| `coveredFileCount` | integer >= 0 |
| `reviewableBytes` | integer >= 0 |
| `coveredBytes` | integer >= 0 |
| `incompleteReasons` | string[] |
| `files` | `CoverageFile[]` |

`CoverageFile` fields:

| Field | Type |
| --- | --- |
| `path` | repository-relative path |
| `contentHash` | SHA-256 of the full reviewed file content |
| `status` | `complete | incomplete` |
| `bytes` | full reviewed file byte length |
| `coveredBytes` | sum of included source chunk bytes |
| `taskIds` | task IDs that covered the file |
| `incompleteReason` | optional redacted explanation |

## Harness Runtime

Rules:

- Use `defineHarness()`.
- Declare model aliases before agents.
- Declare agents before workflows.
- Use workflows for orchestration.
- Use Zod schemas for task input, agent output, candidate findings, evidence,
  admission decisions, and report output.
- Provider-backed structured outputs must use object-root schemas. Array-shaped
  agent outputs must be wrapped before provider calls, for example
  `{ candidates: [...] }`, and unwrapped by the workflow before admission.
- Tests use fake/scripted providers; default tests must not call external
  models.
- Product review must not claim provider-backed completion when no provider was
  resolved and invoked. Scripted providers are limited to tests and explicitly
  labeled hermetic commands until removed by the real pipeline ticket.
- Telemetry must use no-content capture by default.
- Review execution is stateless and one-shot in R1. Harnesses must not configure
  durable runtime, persistent session state, runtime checkpoints, or
  sandbox/workspace session directories. Review workers require no shell,
  network, or filesystem-write tools, and provider task packets are
  source-bearing, so nothing about a run is persisted to disk beyond the
  redacted run artifacts.
- A failed run is not resumable: the next invocation re-plans and re-executes the
  review from scratch. Provider-backed task worker calls must use stable task IDs
  and redacted task packets. Compact per-task replay requires a future storage
  contract that stores only sanitized task-local references and output, not
  source-bearing task input.
- Provider task calls must be retried by the harness model retry policy
  (`ModelRetryPolicy` on the model alias), not by bespoke application retry logic.
  The policy classifies failures: transient/network/timeout, rate limits (HTTP
  429), and provider-unavailable/5xx are retried; oversized context, invalid
  request, authentication, payment/quota, and cancellation are not. Rate limits
  honor `Retry-After`, and provider-instructed waits beyond the active-delay cap
  fail fast (`longRetry: 'error'`) rather than blocking for hours. The policy is
  mapped from provider config: `maxAttempts = provider.maxRetries + 1`,
  `minDelayMs = provider.retryBackoffMs`, `maxActiveDelayMs =
  provider.retryMaxDelayMs`.
- Model prompts must include strong reviewer instructions: prioritize correctness,
  security, reliability, maintainability, minimal noise, evidence-backed
  findings, and concrete suggested remediation. Prompt output must be parsed
  through Zod and treated as untrusted until admitted.
- Provider-backed workflow input must include only bounded, redacted,
  ledger-recorded review context. Context kinds in R1 are selected file content,
  analyzer output, and test mappings. Raw environment variables, local absolute
  paths, git remotes, shell output, ignored files, and unledgered content are
  forbidden.
- Once tasks are assembled, provider-backed workflow input must not duplicate
  run-wide source context outside the task packets. Task packets are the model
  boundary.
- Provider-backed workflows orchestrate queued `review_task` worker calls
  through a bounded rolling worker pool, update workflow-local shared context
  after each completed task, pass compact shared digests to later workers, and
  then run deterministic candidate merging, admission, baseline matching, and
  quality gates.
- Provider-backed Harness defaults must not introduce an implicit whole-run
  timeout. If `review.runTimeoutMs` is unset, Harness run timeout must be
  disabled and provider calls are bounded by `provider.timeoutMs`. If
  `review.runTimeoutMs` is set, Harness and runner timeout handling must map
  run expiry to the provider-stage partial-failure path with redacted artifacts.
- Completed and partial runs must write a no-content `observability.json`
  artifact containing run steps and task events. The artifact must not contain
  prompt text, source snippets, raw provider responses, headers, environment
  values, tokens, or secrets.
- CLI debug logging must be configurable by `observability.logging.level`,
  `CODEREVIEWER_LOG_LEVEL`, `--log-level`, or `--debug`. Logs may include run
  IDs, stage names, counts, task totals, token totals, durations, provider ID,
  model name, and redacted error codes. Logs must not include source snippets,
  prompts, request or response bodies, provider headers, environment values,
  tokens, or secrets.

## Suggested Fixes

Suggested fixes are allowed but never automatically applied in R1.

Rules:

- every admitted suggested fix must be tied to at least one evidence record;
- fixes must be text or structured proposal metadata only, never direct file
  writes;
- structured edit suggestions must stay manual-review only, must be scoped to a
  reviewed task path, and must be redacted before admission/report rendering;
- admission must receive source-derived reviewed line ranges for every reviewed
  head-file path; new-side or whole-file candidate locations outside those
  ranges must be rejected as `location-invalid`;
- `reporterEligibility = inline` is allowed only for new-side findings whose
  line range is valid in reviewed head-file content and whose severity meets the
  configured inline threshold;
- when repository intake provides `DiffMap[]`, `reporterEligibility = inline`
  is allowed only when the finding's new-side line range overlaps a changed
  diff hunk for the same path;
- review execution may receive a trusted precomputed `DiffMap[]` from eval or
  test harnesses; this override is used only for inline-eligibility policy and
  must not replace normal repository intake, changed-file discovery, source
  reading, or coverage accounting;
- deterministic analyzer findings built from whole-file source diagnostics may
  be marked `side = "new"` only when the effective diff map proves the line
  range overlaps a changed new-side hunk for the same path;
- old-side and whole-file findings may remain in local reports when otherwise
  valid, but they are not inline PR comment candidates in R1;
- Markdown and SARIF outputs must render suggested fixes when present;
- future automatic patch application requires a separate spec and approval.

## Shared Context

The shared context is an append-only run-local substrate. Provider-backed
workflows maintain a live shared digest while workers run; review artifacts
persist a JSON snapshot at completion or after a recoverable terminal provider
task failure. Shared context must use actual queue/admission events and backing
references rather than a single repository prompt.

It stores:

- compact shared entries for facts, task states, candidates, findings, and
  admission decisions;
- repository facts;
- exact append-only `taskEvents`, including `round`, `kind`, `paths`,
  `workerId`, and optional message;
- derived `currentTasks` with the latest event per task ID;
- context ledger entries;
- evidence records;
- candidate findings;
- admission decisions;
- admitted findings;
- rejected findings.

State transitions:

```text
planned -> running -> completed
planned -> running -> failed
candidate -> admitted
candidate -> rejected
candidate -> needs-more-evidence
```

Transitions are append-only. Existing task events and decisions are not mutated;
current task state is derived from the latest event for each task ID.
Corrections add a new decision record with `supersedes`.

Compact shared entries contain summaries, source, task ID when available,
evidence IDs, and backing record references. Consumers may unfold backing
evidence by shared entry ID; compact summaries must not inline raw source,
prompt text, secrets, or provider output.

When a provider-backed worker task fails after review context was assembled,
the runner must preserve a partial shared-context snapshot. The snapshot must
include completed task events, failed task events with sanitized stable messages
such as `worker failed`, context ledger entries, analyzer evidence, and any
validated candidate findings from completed tasks. It must not publish admitted
findings for incomplete provider-backed runs.

## Admission Gate

A candidate is admitted only when all checks pass:

1. Candidate validates against schema.
2. Location resolves to a reviewed file.
3. At least one non-model evidence record supports the finding.
4. Finding is in configured scope.
5. It is not a duplicate of an admitted finding.
6. Severity is allowed by policy.
7. Evidence summaries are redacted.
8. Reporter eligibility is computed deterministically.

If check 3 fails but all other checks pass, status is `needs-more-evidence`.

## Baseline Matching

Baseline matching runs after admission and before report rendering.

Rules:

- match by `FindingFingerprint` values;
- never match by title alone;
- mark admitted findings as `new`, `existing`, or `unknown`;
- calculate resolved baseline entries when configured baseline data contains a
  fingerprint absent from current admitted findings;
- `qualityGate.failOnNewOnly` must consider only `new` findings when baseline
  is enabled and configured to fail on new findings only;
- baseline reads and writes must use `path-service` and remain under repository
  root.

## Error Handling

Errors use structured type:

| Field | Type |
| --- | --- |
| `code` | stable string |
| `message` | redacted string |
| `category` | `config | repository | provider | admission | report | internal` |
| `recoverable` | boolean |
| `exitCode` | integer |
| `details` | redacted object |

Raw thrown errors from providers, git, filesystem, or tools must be normalized
before logging or reporting.

Errors must not be swallowed. Recoverable failures produce warnings with stable
codes only when the completed final state remains complete and trustworthy.
Terminal failures preserve the original normalized cause in redacted `details`.

Provider task failures after task execution starts must surface as a partial run
state. The CLI writes `run-summary.json`, `context-ledger.json`,
`shared-context.json`, and `error.json` under the run artifact directory, returns
the provider exit code, and includes `artifactDir` in stderr. `error.json` stores
only normalized/redacted fields. Task event messages must never include raw
provider messages, prompt text, source snippets, tool output, or secrets.

## Cancellation And Timeout

- CLI interrupt cancels pending tasks and writes partial run summary.
- Provider calls use configured `timeoutMs`.
- Timed-out tasks are marked failed and do not publish findings.
- A run with task failures exits `4` unless all failed tasks are non-model
  optional analyzers and report generation still succeeds.
- Partial provider failures add the run warning `partial-run`.

## Verification Matrix

| Requirement | Test |
| --- | --- |
| Intake handles git and explicit files | fixture integration tests |
| Paths work on POSIX and Windows forms | unit tests |
| Provider missing error is actionable | provider-resolution unit test |
| Harness workflow uses scripted provider | workflow integration test |
| Admission rejects weak candidates | admission matrix test |
| Reports include only admitted findings | report snapshot test |
| Context ledger records included source chunks without raw content | context ledger unit and snapshot tests |
| Completed reports include complete coverage certificate | runner and report schema tests |
| Packet overflow fails before provider call without trimming | workflow regression test |
| Baseline marks new/existing/resolved findings deterministically | baseline fixture tests |
| No raw source in default logs | log snapshot/redaction test |
| Provider task failure writes artifact-ready partial state | runner partial-failure regression test |
