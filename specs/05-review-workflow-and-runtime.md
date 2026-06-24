# 05: Review Workflow And Runtime

Status: Approved
Date: 2026-06-19

## End-To-End Flow

1. Parse CLI args.
2. Load and validate config.
3. Load root `.env` when present and merge process env.
4. Resolve repository root from CLI or current working directory.
5. Create run directory.
6. Collect repository intake, including the raw unified diff.
7. Load reviewer instruction metadata.
8. Load mounted skill index when enabled.
9. Run deterministic drift/security preflight checks.
10. Build deterministic support signals.
11. Plan review tasks.
12. Resolve provider when model-backed review is enabled.
13. Run holistic discovery: two serial diverse-lens recall-first whole-file
    reviews per task (a general pass, then a pass focused on commonly-missed
    high-impact defects) whose findings are unioned and deduped into candidate
    findings.
14. Run refutation per candidate finding.
15. Admit or reject candidates against the admission gate.
16. Match actionable admitted findings against baseline.
17. Render reports.
18. Evaluate optional quality gate.
19. Record available token/cost metadata and optional no-content telemetry
    configuration.
20. Exit with mapped code.

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

## Deterministic Support Signal Contract

Deterministic support signal extractors implement:

```text
detect(files) -> SignalDetection
extract(changedFiles, repositorySnapshot, diffMaps) -> DeterministicSignal[] + EvidenceRecord[]
lookupContextHints(paths, repositorySnapshot) -> ContextHint[]
```

R1 signal targets:

- line anchors and diff hunk overlap;
- declaration/symbol spans when cheap local parsing supports them;
- import/reference hints for changed files;
- related test/config/documentation path hints;
- duplicate fingerprints and stable de-duplication keys;
- known contradiction checks, such as invalid line ranges, out-of-scope paths,
  unchanged-only evidence, or framework guard hints.

Generic signal requirements:

- emit language-neutral `DeterministicSignal` and `EvidenceRecord` data only;
- never publish findings directly, except future explicitly scoped
  safety/gate errors defined outside semantic review;
- never duplicate CodeQL/linter/formatter/unit-test/build checks as the
  product's primary detection mechanism;
- use structured parsers when available for symbol spans, but parser absence
  must degrade to fewer hints rather than blocking the LLM review;
- keep raw AST dumps, parser traces, rule-authoring notes, and external tool
  transcripts out of provider prompts and default artifacts;
- validate every signal path/location through path-service before it can enter
  planning, model context, refutation, or reports;
- never execute project code as part of default signal extraction.

## Review Planning

Task grouping:

- one task per changed file for `fast`;
- bounded dependency/context-cluster tasks for `balanced`;
- dependency/context-cluster plus bounded semantic-risk tasks for `thorough`.
  Semantic-risk tasks must reuse bounded path/evidence clusters and must not
  create a single all-changed-files sweep.

Task limits:

- hard cap `maxConcurrentTasks`;
- dependency clusters must be split into bounded task packets. Connected import
  components larger than the task path cap must be split deterministically
  rather than sent as one oversized worker packet;
- per-task source, deterministic signal, instruction, and metadata packet must fit the
  configured model-bound task input budget before a provider call starts;
- workflow context assembly must split source into exact included chunks when a
  file or dependency cluster cannot fit in one packet. Large files and large
  dependency clusters create more review tasks; they must not create skipped or
  truncated required source;
- workflow context assembly records every included source chunk in the context
  ledger with reason `task-context-source-chunk`, task ID, byte counts, and
  content hash. Budget pressure is not an evidence record unless another
  signal extractor or reviewer produces evidence that references it;
- deterministic support signals remain available for context, contradiction,
  and admission safety even when a provider-backed model is configured. Signal
  output is not the main actionable finding source by default, but a narrow
  trusted-rule allowlist may seed deterministic candidates directly when the
  rule has local evidence and a concrete remediation.
- model-backed task execution is a focused review-workflow boundary. The
  ai-harness builder defines agents and injects raw agent calls, while task
  execution owns holistic candidate-finding discovery, per-candidate refutation,
  and task result assembly.
- Provider-call adapters are a focused review-workflow boundary. The ai-harness
  builder keeps agent definitions, delegation, and typed `ctx.agents.*`
  invocation; adapters own consistent provider-call logging metadata and
  output normalization for holistic discovery and refutation calls.
- Harness agent step policy is role-specific. The context-heavy semantic agents
  `review_task` and `refute_finding` may use the mounted read/list/grep skill
  tools with a bounded four-step loop when skills are enabled, and stay
  single-step/tool-free when no skills are mounted. This gives discovery and
  refutation roles enough harness budget to inspect mounted review guidance
  without broad repository or shell access.
- Review-runner budget derivation is a focused review-workflow boundary. The
  helper owns existing context, task input, source chunk, and AI review
  retrieval budget policy derived from config depth, provider presence,
  provider caps, and explicit context overrides.
- Review-runner context assembly is a focused review-workflow boundary. The
  helper owns source reads, reviewed line/diff range derivation, UTF-8-safe
  source chunking, instruction and skill context loading, support-signal context
  packing, and context-ledger entry creation before workflow input assembly.
- Review-runner workflow-input assembly is a focused review-workflow boundary.
  The helper owns model workflow packet semantics, including context evidence
  generated from reviewed file contexts, task input budget mapping, AI review
  budget fields, promotion policy propagation, provenance metadata, baseline
  fingerprint cloning, and quality-gate threshold projection.
- Review-runner result assembly is a focused review-workflow boundary. The
  helper owns run summary creation, coverage summary calculation,
  schema-validated report assembly, and shared-context snapshot reconstruction
  for completed and partial runs.
- Review-runner provider workflow invocation is a focused review-workflow
  boundary. The helper owns provider resolution, token usage wrapping,
  model-backed ai-harness creation, workflow session invocation, live task-event
  forwarding, abort-signal forwarding, and harness shutdown. The main review
  runner only decides whether provider review is enabled and handles partial-run
  failure shaping around the returned output or raised provider error.

`ReviewTask` fields:

| Field | Type |
| --- | --- |
| `id` | `task_<hash>` |
| `round` | integer >= 1 |
| `kind` | `file | dependency-cluster | policy` |
| `paths` | repository-relative path array |
| `signalIds` | deterministic signal IDs in scope |
| `evidenceIds` | evidence IDs in scope |
| `contextEntryIds` | ledger entry IDs included in task context |
| `priority` | deterministic integer |

`TaskReviewInput` fields:

| Field | Type |
| --- | --- |
| `runId` | string |
| `task` | `ReviewTask` |
| `reviewedDiffRanges` | reviewed changed ranges in task scope |
| `reviewedDiffText` | the task's raw unified-diff segment so the holistic reviewer sees the actual diff |
| `evidence` | evidence records in task scope |
| `candidates` | support-signal seed candidates in task scope |
| `instructions` | redacted instruction documents |
| `skills` | redacted skill metadata |
| `sharedDigest` | compact admitted shared-context digest with relevant-entry filtering, per-summary truncation, and recency-preserving byte cap |
| `provenance` | workflow provenance input |

Task queue rules:

- tasks are leased in deterministic `round`, `priority`, `id` order;
- later rounds must not be claimed while an earlier round still has planned or
  running tasks;
- no more than `maxConcurrentTasks` tasks may be running at one time;
- same-round task groups may be clustered before leasing when the clustered
  packet fits `maxTaskInputBytes`; the cluster inherits the earliest priority in
  the group and remains in the same round; oversized clusters fall back to their
  original individual tasks;
- provider-backed task execution must use a rolling worker pool: as soon as one
  worker finishes a task, the next eligible task in the same round may start
  without waiting for slower sibling tasks;
- provider-backed workflows must enforce the same `maxConcurrentTasks` value at
  the task queue and Harness child-agent delegation boundary so active model
  calls cannot exceed the configured cap;
- provider-backed workflows must also enforce a scale-derived total
  child-agent call cap at the Harness delegation boundary. The cap is derived
  from planned task count (with two serial holistic discovery passes per task),
  per-candidate refutation calls, and a small concurrency buffer. It must never
  use an effectively unbounded constant. The
  R1 hard ceiling is 2048 child agent calls per run, with a minimum floor of 16
  for small reviews;
- task state transitions are append-only: `planned -> running -> completed`
  or `planned -> running -> failed`;
- worker inputs contain only task-scoped context, evidence, deterministic signals,
  instructions, mounted skill references, and a compact shared digest from
  earlier admitted task output;
- live shared digests passed to later workers must not include raw candidate
  findings or admission decisions before they pass the configured safe digest
  boundary. Raw candidate content may remain in its owning task packet and final
  admission input, but only admitted findings and other explicitly safe shared
  entries are rendered into live worker digests;
- provider-backed review invokes worker agents per task, never with the entire
  repository context as one model call.
- signal-only review uses the same task queue state machine and
  records planned, running, and completed task events in shared context.

## Holistic Discovery

Provider-backed review runs two serial diverse-lens recall-first whole-file
reviews per task. The `holistic_review` agent performs both passes and emits
candidate findings directly; their findings are unioned and deduped by candidate
id before refutation.

- Pass 1 is the general review (no lens). Pass 2 re-reads the same change through
  a focused lens that hunts specifically for commonly-missed, high-impact defects
  (concurrency and atomicity, unawaited async, error/failure-path handling,
  security, resource leaks, interface/contract violations, and edge cases). The
  passes run serially to stay within the workflow's parallel child-agent budget.
- The review input is the task's unified-diff segment plus the full
  line-numbered changed files, alongside deterministic support signals,
  instruction/skill metadata, and a compact safe digest. The focused pass
  prepends its lens directive before the diff.
- The reviewer follows four steps: understand the intent of the change; trace
  control and data flow on every path; verify correctness against that intent;
  then systematically sweep defect classes.
- The defect-class sweep covers correctness/logic, side effects and control,
  concurrency and state, interface/type alignment, security, memory and
  resources, and data leaks and privacy.
- A defect anywhere in a changed file is in scope, whether it was introduced on
  changed lines or merely exposed elsewhere in the same changed file.
- The reviewer must report concrete defects only. Style, naming, formatting,
  documentation, and cleanup-only concerns are out of scope.
- Candidate findings are capped per task.
- Candidate findings are untrusted until they pass refutation and admission.
  Raw candidates do not influence later workers before they pass the configured
  safe digest boundary.

## Refutation

Every candidate finding passes a per-candidate precision filter run by the
`refute_finding` agent before admission.

- The refuter may use only the provided candidate, `reviewedDiffRanges`,
  evidence, review context, support-signal candidates, instructions, skill
  metadata, shared digest, and provenance. It receives no direct repository
  tools beyond the bounded mounted skill read/list/grep loop.
- The refuter returns a verdict of `proved`, `refuted`, or
  `needs-more-evidence`. In admission, `proved` becomes actionable, `refuted` is
  rejected, and `needs-more-evidence` is dispositioned by
  `promotionPolicy.modelWeakOrRefuted`.
- A real defect anywhere in a changed file is in scope, whether introduced on
  changed lines or exposed elsewhere in that file.
- Refutation input construction is a model-bound packet boundary that uses the
  shared `maxTaskInputBytes` provider budget. Under budget pressure, it omits
  the shared digest first, then support-signal corroboration candidates, then
  ambient review context before failing the packet budget. It must preserve the
  candidate, candidate-scoped evidence, reviewed diff ranges, instructions,
  skill metadata, and provenance before a provider call starts. If those
  mandatory fields still exceed the packet budget, the workflow records the
  shared packet-budget error instead of truncating source-bearing fields.
- Model-origin candidates below `aiReview.actionableSeverityThreshold` (default
  `medium`) are rejected as `below-threshold` rather than admitted as actionable,
  keeping the actionable surface focused on impactful runtime/security defects.
  Trusted deterministic-rule candidates are exempt from this floor.
- Provider failures during refutation record a recovered provider issue and keep
  the candidate out of actionable output. Unrecovered provider issues must
  remain visible in JSON, Markdown, and eval summaries. Provider issue
  normalization is a shared review-workflow boundary: each provider issue must
  include a normalized code, stage, recovered flag, and report-safe message
  capped before persistence.
- Markdown reports must render candidate fields, refutation summaries,
  refutation evidence, and refutation check evidence as cited evidence IDs or
  `none cited` so humans can audit refutation without opening JSON artifacts.

## Deterministic Support Signal Pipeline

The review pipeline treats local structural analysis as a support stage before
task planning:

1. Repository intake selects reviewable files and rejects unsupported paths.
2. Deterministic signal extractors route supported files to cheap local
   structural, diff, and scope checks.
3. Extractor output is normalized to `DeterministicSignal` and `EvidenceRecord`
   data before it can enter planning, model context, refutation, or
   reports.
4. Task planning uses import, symbol, test, config, and diff signals to build
   bounded context groups.
5. Context assembly may include compact signal JSON in task packets, but it must
   not include raw AST dumps, external tool transcripts, or rule-authoring
   traces.

This stage does not call a model provider and does not consume model tokens by
itself. Provider token use changes only when compact signal output is included
in a task or refutation packet, where it focuses context selection and
refutation rather than expanding prompts with parser documentation.

The no-content observability artifact must record the `deterministic_signals`
step with safe metadata for structural engine provenance, signal count, evidence
count, supported extension count, and skipped unsupported path count. These
attributes must not include source snippets, prompts, raw AST node text, external
tool raw output, or provider responses.

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

Each context item considered for model context or retrieval must produce a
context ledger entry. Context item kinds are file, diff hunk, symbol fact,
instruction file, skill file, deterministic signal output, mediated tool
result, and previous-run artifact.

`ContextLedgerEntry` fields:

| Field | Type |
| --- | --- |
| `id` | stable string |
| `kind` | `file | diff | symbol | instruction | skill | support-signal-output | tool-result | prior-artifact` |
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
- mediated read/list/grep retrieval must use `kind = "tool-result"` so
  follow-up context can be distinguished from initial source, symbol, and
  support-signal context;
- source inside the declared reviewable universe is complete only when the sum
  of included `task-context-source-chunk` bytes for each file equals that file's
  reviewable byte length and all entries are `included`;
- provider task-packet overflow is a hard pre-call failure. The workflow must
  fail with `task_packet_budget_exceeded` rather than shortening source,
  instructions, skills, evidence, deterministic signal output, or metadata;
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
- Use Zod schemas for task input, candidate finding output, refutation output,
  internal candidate findings, evidence, admission decisions, and report output.
- Provider-backed structured outputs must use object-root schemas. The review
  worker returns `{ findings: [...] }` (candidate findings) and the refuter
  returns a verdict object. Candidates are untrusted until they pass refutation
  and admission.
- Tests use fake or hermetic provider fixtures; default tests must not call external
  models.
- Product review must not claim provider-backed completion when no provider was
  resolved and invoked. Hermetic provider fixtures are limited to tests and explicitly
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
- Model prompts must include strong reviewer instructions: prioritize semantic
  correctness, security, reliability, maintainability, minimal noise,
  evidence-backed findings, active refutation, and concrete suggested
  remediation. Prompt output must be parsed through Zod and treated as untrusted
  until admitted.
- The task-reviewer prompt must include a benchmark-derived semantic bug
  checklist before returning no findings: falsy zero handling, wrong variable
  reuse, nullable or optional access without guards, non-deterministic
  hash/order assumptions, numeric operations on datetime or non-numeric keys,
  and unsynchronized shared mutable state.
- The task-reviewer prompt must constrain candidate-finding generation to
  concrete semantic correctness, security, reliability, data-integrity, or
  maintainability defects visible in the bounded task packet. It must return no
  finding for style, preference, naming, formatting, helper-refactor, or
  cleanup-only concerns unless the packet proves concrete user-visible,
  runtime, security, or data-integrity impact. It must not guess about callers,
  configuration, tests, file content, dependencies, or runtime behavior omitted
  from the packet.
- Provider-backed workflow input must include only bounded, redacted,
  ledger-recorded review context. Context kinds in R1 are selected file content,
  deterministic signal output, mediated tool summaries, and context hints.
  Raw environment variables, local absolute paths, git remotes, shell output,
  ignored files, and unledgered content are forbidden.
- Once tasks are assembled, provider-backed workflow input must not duplicate
  run-wide source context outside the task packets. Task packets are the model
  boundary.
- Provider-backed workflows orchestrate queued `review_task` worker calls
  through a bounded rolling worker pool, update workflow-local shared context
  after each completed task, pass compact shared digests to later workers, and
  then run refutation, candidate admission, baseline matching, and quality
  gates.
- Provider-backed harness creation must pass the scale-derived child-agent call
  cap from the provider workflow boundary, where workflow input task count and
  AI review budgets are available. Direct harness construction may fall back to
  the small default floor but must still use the shared delegation helper.
- Provider-backed agents must use the shared role-specific harness option
  helper. Hardcoded per-agent `maxSteps` or builtin-tool settings in the harness
  builder are forbidden because they drift from the role-specific budget policy.
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
- effective diff ranges passed to provider-backed tasks must preserve
  `changeKind` metadata (`new`, `modified`, or `deleted`) when known, so
  refutation can distinguish new-file findings from existing-file context;
- review execution may receive a trusted precomputed `DiffMap[]` from eval or
  test harnesses; this override is used only for inline-eligibility policy and
  must not replace normal repository intake, changed-file discovery, source
  reading, or coverage accounting;
- model-origin candidate locations and deterministic-signal-derived diagnostic
  locations may be marked `side = "new"` only when the effective diff map proves
  the line range overlaps a changed new-side hunk for the same path;
- old-side and whole-file findings may remain in local reports when otherwise
  valid, but they are not inline PR comment candidates in R1;
- Markdown and SARIF outputs must render suggested fixes when present;
- SARIF output must render provider issues as redacted run metadata, not as
  diagnostic results, so CI consumers can inspect provider degradation without
  creating false code-scanning alerts;
- SARIF output must exclude `artifact-only` admitted findings from diagnostic
  results and driver rules so weak/refuted/provider-diagnostic output cannot
  become code-scanning alerts;
- future automatic patch application requires a separate spec and approval.

## Shared Context

The shared context is an append-only run-local substrate. Provider-backed
workflows maintain a live shared digest while workers run; review artifacts
persist a JSON snapshot at completion or after a recoverable terminal provider
task failure. Shared context must use actual queue/admission events and backing
references rather than a single repository prompt.

Review context documents supplied to model tasks may be partial excerpts
selected for budget. Model instructions and refutation must not treat omitted
file content as evidence that a file is truncated, malformed, or missing closing
syntax. Model-only truncation or malformed-file claims require deterministic
contradiction-safe evidence for the same path before they can become actionable.

It stores:

- compact shared entries for deterministic signals, task states, candidate
  findings, refutation results, and admission decisions;
- repository facts and deterministic signals;
- exact append-only `taskEvents`, including `round`, `kind`, `paths`,
  `workerId`, and optional message;
- derived `currentTasks` with the latest event per task ID;
- context ledger entries;
- evidence records;
- candidate findings;
- refutation results;
- admission decisions;
- admitted findings;
- rejected findings.

Shared context stores at most one evidence record per stable evidence ID,
preserving the first-seen record for deterministic snapshots and evidence
unfolding. It also stores at most one candidate finding per stable candidate ID,
preserving the first-seen candidate and digest entry. Before admission and final
report output, workflow completion must also deduplicate evidence records and
candidate findings by stable ID while preserving the first-seen record.
Admission candidates are also deduplicated by stable candidate ID before the
admission gate runs; duplicate-policy checks still apply to distinct candidate
IDs that describe the same finding. Candidates with an existing rejected or
needs-more-evidence pre-admission decision are not re-submitted to the admission
gate, and completion preserves only the first terminal pre-admission rejection
and decision for each candidate ID. These boundaries keep reused context
artifacts and overlapping runtime paths from inflating or contradicting
admission inputs, shared context snapshots, and JSON/Markdown/SARIF report
evidence and candidate sections. Workflow completion also deduplicates identical
provider issue tuples before report output so recovered retry/fallback paths do
not inflate human summaries, SARIF run metadata, or eval provider-issue counts.
Context ledger entries are deduplicated by stable ledger ID at workflow
completion, preserving the first-seen ledger record while keeping distinct
retrieval/context records visible.
Workflow completion must also deduplicate stable-ID model artifacts before
report output, preserving the first-seen `candidateFindings` and
`refutationResults` entries for each ID.

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
such as `worker failed`, context ledger entries, deterministic signal evidence,
provider issues, candidate findings, and refutation results from completed
tasks. It must not publish actionable admitted findings for incomplete
provider-backed runs unless every admitted finding's refutation completed before
the terminal failure.

## Admission Gate

A candidate is admitted only when all checks pass:

1. Candidate validates against schema.
2. Location resolves to a reviewed file.
3. Model-origin candidates reference a `RefutationResult.verdict = "proved"`.
4. At least one redacted evidence record supports the candidate. Evidence may
   include deterministic signals and model-rationale summaries, but
   model-generated confidence scores are not accepted as evidence or report
   fields.
   Deterministic support-signal overlap can corroborate a candidate, but it must
   not bypass the refutation result or admission sequence for a model-origin
   candidate.
5. Finding is in configured scope. Blast-radius scope applies: a candidate in a
   changed file is in scope; only candidates in files with no reviewed change
   are out of scope. Literal hunk overlap is used only for inline-comment
   eligibility.
6. It is not a duplicate of an admitted finding.
7. It is not contradicted by deterministic safety checks.
8. It is not only a duplicate of expected external CodeQL/linter/formatter/test
   or build output unless semantic context adds a distinct issue.
9. Severity is allowed by policy.
10. Evidence summaries are redacted.
11. Reporter eligibility is computed deterministically.

If evidence sufficiency fails but the location and schema are valid, status is
`needs-more-evidence` or artifact-only according to promotion policy. Refuted,
out-of-scope, and provider-error outcomes are rejected or demoted according to
promotion policy.

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
- A run with task failures exits `4` unless all failed work is optional
  deterministic support signal extraction and report generation still succeeds.
- Partial provider failures add the run warning `partial-run`.

## Verification Matrix

| Requirement | Test |
| --- | --- |
| Intake handles git and explicit files | fixture integration tests |
| Paths work on POSIX and Windows forms | unit tests |
| Provider missing error is actionable | provider-resolution unit test |
| Harness workflow uses hermetic provider fixture | workflow integration test |
| Admission rejects weak/internal candidates | admission and promotion matrix test |
| Reports include admitted findings plus clearly marked artifact-only/refuted/provider-issue sections | report snapshot test |
| Context ledger records included source chunks without raw content | context ledger unit and snapshot tests |
| Completed reports include complete coverage certificate | runner and report schema tests |
| Packet overflow fails before provider call without trimming | workflow regression test |
| Baseline marks new/existing/resolved findings deterministically | baseline fixture tests |
| No raw source in default logs | log snapshot/redaction test |
| Provider task failure writes artifact-ready partial state | runner partial-failure regression test |
| Model candidate cannot become actionable without passing refutation | refutation workflow test |
