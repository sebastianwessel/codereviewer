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
10. Build deterministic support signals.
11. Plan review tasks and investigation budgets.
12. Resolve provider when model-backed review is enabled.
13. Generate model suspicions.
14. Run bounded runtime-mediated investigations.
15. Assemble proof packets.
16. Run refutation gates.
17. Promote proof packets to candidates and admit/reject/artifact-only output.
18. Match actionable admitted findings against baseline.
19. Render reports.
20. Evaluate optional quality gate.
21. Record available token/cost metadata and optional no-content telemetry
    configuration.
22. Exit with mapped code.

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
  planning, model context, proof/refutation, or reports;
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
  execution owns model suspicion conversion, suspicion caps, investigation slot
  reservation, proof-loop invocation, optional sibling sweep orchestration, and
  task result assembly.
- Provider-call adapters are a focused review-workflow boundary. The ai-harness
  builder keeps agent definitions, delegation, and typed `ctx.agents.*`
  invocation; adapters own consistent provider-call logging metadata and
  output normalization for intent planning, refutation, aggregate proof review,
  and optional judge calls.
- Harness agent step policy is role-specific. Compact orchestration agents
  (`plan_review_intents`, `aggregate_findings`, and `sweep_sibling_suspicions`)
  must stay single-step and tool-free. Context-heavy semantic agents
  (`review_task`, `investigate_suspicion`, `refute_finding`, and
  `judge_finding`) may use the mounted read/list/grep skill tools with a
  bounded four-step loop when skills are enabled, and stay single-step/tool-free
  when no skills are mounted. This keeps planning/aggregation cheap while
  giving proof and critic roles enough harness budget to inspect mounted review
  guidance without broad repository or shell access.
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
  generated from reviewed file contexts, intent-planning mode selection, task
  input budget mapping, AI review budget fields, optional judge flag propagation,
  promotion policy propagation, provenance metadata, baseline fingerprint
  cloning, and quality-gate threshold projection.
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
- provider-backed workflows emit `ReviewIntent[]`. `aiReview.intentPlanning =
  "auto"` records deterministic one-intent-per-task artifacts for local or
  single-task runs and uses a compact planner agent for multi-task non-local
  reviews. `model` forces the planner for multi-task runs; `deterministic`
  disables the extra planner call. The planner receives task, path, evidence,
  and candidate summaries only, must not invent task IDs or paths, and invalid
  or incomplete planner output falls back to deterministic intent coverage.
  Each intent includes compact `verificationQuestions` so bounded workers and
  proof reviewers can answer explicit proof questions instead of relying only
  on broad objective text. Multi-task model intents whose tasks are in the same
  queue round execute as one bounded `dependency-cluster` task when the
  clustered task packet fits the configured provider input budget. The cluster
  carries unioned paths, evidence IDs, candidate IDs, context entries, review
  context, and compact intent fields. Single-task intents, deterministic
  fallback intents, cross-round groups, and clusters that would exceed the task
  packet budget keep their original task shape. Task reviewer packets include
  the filtered
  `ReviewIntent[]` entries that reference the leased task or one of its paths
  when the packet budget allows it, preserving grouped intent context without
  broadening repository context or adding provider calls. If those compact
  intent entries would push the packet over budget, the workflow drops
  `reviewIntents` first and retains the flattened task objective, focus areas,
  risk areas, and verification questions as the minimum intent context. If the
  packet is still too large only because of optional prior-result context, the
  workflow omits shared digest text next before failing the task packet budget.
  It must preserve task source context, scoped evidence, candidates,
  instructions, skills, reviewed diff ranges, and provenance.

`ReviewTask` fields:

| Field | Type |
| --- | --- |
| `id` | `task_<hash>` |
| `round` | integer >= 1 |
| `kind` | `file | dependency-cluster | policy` |
| `paths` | repository-relative path array |
| `signalIds` | deterministic signal IDs in scope |
| `evidenceIds` | evidence IDs in scope |
| `suspicionIds` | suspicion IDs in scope after suspicion generation |
| `contextEntryIds` | ledger entry IDs included in task context |
| `intentId` | optional `intent_<hash>` assigned by intent planning |
| `objective` | optional end-to-end verification objective |
| `focusAreas` | optional concrete behaviors to verify |
| `riskAreas` | optional correctness/security/reliability risks |
| `verificationQuestions` | optional compact proof questions inherited from the review intent |
| `priority` | deterministic integer |

`TaskReviewInput` fields:

| Field | Type |
| --- | --- |
| `runId` | string |
| `task` | `ReviewTask` |
| `reviewIntents` | filtered `ReviewIntent[]` relevant to the task, omitted first under tight task-packet budgets |
| `reviewedDiffRanges` | reviewed changed ranges in task scope |
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
- model-planned same-round task groups may be clustered before leasing when the
  clustered packet fits `maxTaskInputBytes`; the cluster inherits the earliest
  priority in the group and remains in the same round; oversized clusters fall
  back to their original individual tasks;
- provider-backed task execution must use a rolling worker pool: as soon as one
  worker finishes a task, the next eligible task in the same round may start
  without waiting for slower sibling tasks;
- provider-backed workflows must enforce the same `maxConcurrentTasks` value at
  the task queue and Harness child-agent delegation boundary so active model
  calls cannot exceed the configured cap;
- provider-backed workflows must also enforce a scale-derived total
  child-agent call cap at the Harness delegation boundary. The cap is derived
  from planned task count, model intent planning, configured investigation
  slots, investigation rounds, proof-loop refutation, optional critic/judge
  work, optional sibling sweeps, and a small concurrency buffer. It must never
  use an effectively unbounded constant. The R1 hard ceiling is 2048 child
  agent calls per run, with a minimum floor of 16 for small reviews;
- task state transitions are append-only: `planned -> running -> completed`
  or `planned -> running -> failed`;
- worker inputs contain only task-scoped context, evidence, deterministic signals,
  instructions, mounted skill references, and a compact shared digest from
  earlier admitted task output;
- live shared digests passed to later workers must not include raw model
  suspicions, rejected suspicions, proof packets, or admission decisions before
  they pass the configured safe digest boundary. Raw suspicion/proof content may
  remain in its owning task packet and final admission input, but only admitted
  findings and other explicitly safe shared entries are rendered into live
  worker digests;
- provider-backed review invokes worker agents per task, never with the entire
  repository context as one model call.
- signal-only review uses the same task queue state machine and
  records planned, running, and completed task events in shared context.

## Agentic Suspicion, Mediated Investigation, Proof, And Refutation

Provider-backed review uses a four-stage loop. The model must not emit
actionable findings directly.

### Suspicion Generation

- Each task receives changed source context, diff maps, deterministic support
  signals, instruction/skill metadata, and a compact safe digest.
- The output is `ModelSuspicion[]`.
- A suspicion must identify suspected changed behavior, risk category,
  likely path/symbol, requested follow-up context, and initial evidence IDs.
- Weak, generic, duplicated, or static-analysis-only suspicions are rejected or
  kept as artifact-only diagnostics according to promotion policy.
- Model suspicion conversion must deduplicate repeated generated candidates
  before investigation slots are reserved. Repeated model output for the same
  task, path, start line, and title must count as a duplicate drop rather than
  consuming another investigation/proof/refutation call.

### Mediated Investigation

- Every non-rejected suspicion enters a bounded investigation loop.
- In R1, repository access remains runtime-mediated rather than an unrestricted
  shell or filesystem tool. A suspicion may carry structured `contextRequests`
  for bounded read/list/grep operations plus human-readable `requestedContext`
  audit text before the first investigation call.
- Runtime-owned `context-retrieval` executes structured requests directly,
  falls back to conservative prose interpretation only when structured requests
  are absent, validates repository containment, path scope, read/search budgets,
  redaction, and context ledger entries, de-duplicates identical structured
  requests before spending retrieval budget, and emits evidence records for
  later proof/refutation.
- Retrieval-level structured request de-duplication uses the same
  repository-relative path normalization as retrieval, so equivalent safe path
  spellings are executed once inside a structured request list.
- Within a proof-loop batch, identical mediated context requests should reuse
  the same report-safe context artifacts for related suspicions instead of
  spending another repository retrieval. Candidate-specific fallback reads may
  only be shared when the fallback path and task are the same.
- Structured context request cache keys are canonicalized as de-duplicated
  tool/path/query sets. Reordered equivalent structured requests must reuse the
  same context artifacts, while prose fallback requests remain order-sensitive
  because their interpretation is heuristic.
- Structured request paths in cache keys must use the same repository-relative
  normalization as retrieval, so equivalent safe spellings such as
  `src/file.ts`, `./src/file.ts`, and `src//file.ts` do not split cache reuse.
- When structured `contextRequests` are present, compatibility prose
  `requestedContext` is audit text and must not fragment the context artifact
  cache. Prose request text participates in the cache key only when no
  structured requests are present and prose fallback retrieval is used.
- Primary model suspicions and optional sibling-sweep suspicions from the same
  model-backed task review share the proof-loop context artifact cache, so a
  sibling proof can reuse context already retrieved for the primary proof when
  the structured request and safe fallback key match.
- If `investigate_suspicion` returns `needs-more-evidence`, it may also return
  structured `contextRequests` and compatibility `requestedContext`. The
  workflow may execute those requests and rerun the investigator until the
  suspicion is proved/refuted, no safe follow-up context is available, provider
  recovery stops the loop, or `aiReview.maxInvestigationRounds` is reached.
- Requested context that cannot be safely mapped to a supported retrieval
  operation is ignored rather than expanded into shell, filesystem write,
  network, git mutation, PR publishing, provider-configuration access, or
  broad repository crawling.
- The investigation evidence should help prove or disprove guards, alternate
  code paths, framework semantics, tests/config that change behavior, and
  deterministic contradictions before actionability is considered.
- After retrieval, an `investigate_suspicion` model agent receives only the
  suspicion, candidate, task metadata, a capped `proofQuestions` checklist,
  scoped evidence, retrieved review context, instructions, skill metadata,
  shared digest, and provenance. It must
  return `proved`, `refuted`, or `needs-more-evidence` before proof packet
  assembly. `proved` requires cited available evidence plus changed behavior,
  execution/data path, violated invariant, impact, introduced/exposed-by-change
  rationale, contradiction checks, and fix direction. `refuted` and
  `needs-more-evidence` do not create proof packets.
- Investigation packet construction must not backfill task evidence by matching
  only the candidate path. Initial task evidence is included only when the model
  suspicion cited exact task evidence IDs that exist in the task packet.
  Under-evidenced suspicions may still become provable by requesting mediated
  context that produces new `context-retrieval` evidence.
- `proofQuestions` must be derived without another provider call from the
  task's compact verification questions, matching review-intent verification
  questions, and the fixed proof obligations for changed behavior,
  reachability/data flow/configuration path, violated invariant, concrete
  impact, and possible contradictions. It is capped at eight unique questions.
- Investigation input construction is a separate model-bound packet boundary.
  It uses the same `maxTaskInputBytes` provider budget as task/refutation and
  critic packets, carries review context only at top level rather than inside
  the nested task object, prefers focused retrieved context over ambient task
  context when both exist, and preserves candidate, suspicion, cited evidence,
  proof questions, and explicit retrieved context. Under budget pressure, it
  omits optional shared digest text before dropping ambient task context,
  retrieved review context, or failing the packet budget. If the packet is still
  too large after optional context removal, the workflow records a recovered
  provider issue and keeps the suspicion out of actionable output.
- Each investigation persists an `InvestigationTrace` in `report.json` and
  Markdown with report-safe tool-call summaries, context ledger entry IDs,
  bounded budget counters, and outcome `proof | refuted |
  needs-more-evidence | provider-error`. Trace budget counters include the
  configured maximum investigation rounds and the rounds actually used. When a
  mediated context retriever is available, trace budget counters also include
  the configured read/search maxima while keeping consumed read/search counts
  scoped to the context artifacts used by that trace.
- Future direct model tool invocation, symbol lookup, import/caller reference
  lookup, test/config lookup, and prior evidence lookup require an explicit
  capability update that declares provider `tool_use` requirements, tool
  schemas, budgets, logging, tests, and release compatibility.

### Proof Packet Assembly

- A suspicion becomes potentially actionable only when the investigator emits a
  `ProofPacket`.
- The proof packet must include changed behavior, execution/data path, violated
  invariant or contract, concrete impact, why the reviewed change introduced or
  exposed the issue, evidence IDs, contradiction checks, and fix direction.
- Proof packets that only restate the diff, cite generic risk, lack
  reachability, lack impact, or lack exact evidence remain artifact-only or are
  rejected.
- Deterministic corroboration strengthens a proof but is not required when the
  proof obligations are complete and refutation passes.
- Deterministic contradiction rejects or demotes the proof according to
  promotion policy.

### Refutation Gate

- Every complete proof packet must pass a refutation gate before promotion.
- Refutation attempts to disprove the proof through reachability, guards,
  framework semantics, outside-scope status, deterministic contradictions,
  evidence sufficiency, and duplicate/static-analysis checks.
- When `aiReview.judgeFindings = false`, the refutation gate runs the
  `refute_finding` agent before admission.
- When `aiReview.judgeFindings = true`, admission reuses matching proof-loop
  proof/refutation artifacts and must not run an additional `refute_finding`
  call for that same proved model candidate. The saved call budget is spent on
  the optional aggregate critic or per-candidate judge path instead.
- Proof-loop refutation artifact lookup and conversion for admission must live
  in a focused review-workflow helper so optional judging can reuse prior proof
  state without coupling the admission orchestrator to artifact search details.
- Refutation rationale evidence and proved-candidate enrichment must live in a
  focused review-workflow helper so report-safe evidence IDs, redacted fix
  summaries, and same-file fix edits are handled consistently before admission.
- Model-origin candidate scope checks and out-of-scope rejection shaping must
  live in a focused review-workflow helper so reviewed-diff eligibility stays
  testable outside the admission orchestrator.
- Refutation input construction is a separate model-bound packet boundary. It
  starts from workflow evidence plus task-produced proof evidence, then
  preserves only candidate-scoped evidence, matching proof/refutation artifact
  evidence, support-signal candidates that overlap the candidate location or
  share candidate evidence IDs, reviewed diff ranges, task review context,
  instructions, skills, shared digest, and provenance. It uses the shared
  `maxTaskInputBytes` packet budget before provider execution.
  Under budget pressure, it must omit optional shared digest text first, then
  support-signal corroboration candidates, then ambient task review context. It
  must preserve the candidate, candidate-scoped proof evidence, reviewed diff
  ranges, instructions, skill metadata, and provenance before a provider call
  starts.
  If those mandatory fields still exceed the packet
  budget, the workflow records the shared packet-budget error instead of
  truncating source-bearing fields.
- Refutation output must be `proved`, `refuted`, `needs-more-evidence`, or
  `provider-error`.
- Only `proved` can become actionable. Other outcomes are rejected or retained
  as artifact-only diagnostics according to promotion policy.
- Model-origin candidates below `aiReview.actionableSeverityThreshold` (default
  `medium`) are rejected as `below-threshold` rather than admitted as actionable,
  keeping the actionable surface focused on impactful runtime/security defects.
  Trusted deterministic-rule candidates are exempt from this floor.
- Provider failures for one investigation/refutation record a provider issue and
  continue when policy permits. Unrecovered provider issues must remain visible
  in JSON, Markdown, and eval summaries.
- Provider issue normalization is a shared review-workflow boundary. Each
  provider issue must include a normalized code, stage, recovered flag, and
  report-safe message capped before persistence.
- Markdown reports must render investigation trace budgets, investigation
  tool-call summaries, proof packet evidence, changed behavior, execution/data
  path, impact, introduced-by-change rationale, fix direction, contradiction
  checks, refutation summary, refutation evidence, refutation check evidence,
  aggregate result evidence, aggregate decision evidence, aggregate
  similar-issue check evidence, judge result evidence, and judge
  verification-check evidence as cited evidence IDs or `none cited` so humans
  can audit investigation/proof/critic evidence without opening JSON artifacts.

### Optional Aggregate Critic

- When `aiReview.judgeFindings = true` and a run has more than one proof
  packet, the workflow may run one batch `aggregate_findings` critic call
  before per-candidate admission. Aggregate review is a batch
  rejection/de-duplication pass: it reuses proof-loop refutation artifacts and
  may only remove candidates it rejects (`false-positive`/`needs-more-evidence`).
  A `valid` aggregate verdict is a batch sanity check, not a validation that
  substitutes for the per-candidate judge; aggregate review never elevates a
  candidate to actionable on its own. Only the candidates the aggregate critic
  rejects are treated as aggregate-covered.
- Before aggregate review, a task with at least one proof packet and multiple
  changed ranges or task paths may run one `sweep_sibling_suspicions` call. The
  sweep receives the task packet plus existing proof packets, the suspicions
  covered by those proof packet IDs, and the matching investigation traces. It
  must not receive weak/refuted/needs-more-evidence suspicions or unrelated
  traces from the same proof-loop batch. It may return only same-pattern sibling
  suspicions in other changed ranges or task paths.
- Sibling sweep output is not trusted as actionable. Returned sibling
  suspicions must pass the same conversion, bounded context retrieval,
  investigation, proof packet, refutation, aggregate, and admission gates as
  ordinary model suspicions. Before investigation slots are reserved, sibling
  candidates are deduplicated by category, path, and start line against primary
  task candidates and earlier sibling candidates. The sweep is skipped when
  optional judging is off.
- The aggregate critic receives only compact review intents, candidates, proof
  packets, refutation results, investigation traces, relevant evidence, shared
  digest, and provenance. It does not receive direct repository tools.
  Aggregate packet construction must scope review intents to the proof-covered
  candidate task IDs or paths, refutation results to the proof packet IDs being
  aggregated, investigation traces to those proof packet suspicion IDs, and
  evidence to the remaining proof/refutation citations.
- The aggregate critic remains a compact single-step agent. It compares already
  proved/refuted artifacts in one batch and must not spend extra harness tool
  steps; deeper context gathering remains owned by the investigation and
  per-candidate judge loops.
- Aggregate review orchestration is a separate review-workflow boundary. It
  owns optional aggregate gating, packet construction, provider failure
  recovery, result normalization, and mapping non-valid aggregate decisions into
  rejected findings/admission decisions before per-candidate admission.
- Aggregate critic provider execution must live in a focused helper so packet
  construction, provider call forwarding, aggregate output normalization,
  packet provider-issue recovery, and provider-call recovery are tested outside
  optional aggregate gating and outcome mapping.
- Aggregate review outcome mapping must live in a focused helper so non-valid
  aggregate decisions produce consistent rejected findings, admission decisions,
  rejected candidate sets, and aggregate-covered candidate sets outside
  aggregate provider orchestration.
- Aggregate input construction is a separate model-bound packet boundary. It
  uses the same `maxTaskInputBytes` provider budget as task/refutation/judge
  packets, removes review intents, investigation traces, and shared digest text
  before proof-bearing material when needed, and preserves candidates, proof
  packets, refutation results, and directly cited evidence. If the packet is
  still too large after optional context removal, the workflow records a
  recovered provider issue and falls back to the normal per-candidate path.
- The aggregate critic returns report-safe `valid`, `false-positive`, or
  `needs-more-evidence` decisions per candidate, plus compact sibling/similar
  issue checks. Aggregate output normalization is owned by the aggregate packet
  boundary: unknown candidate IDs, unknown evidence IDs, out-of-scope related
  candidates, and similar-issue evidence IDs not cited by the aggregate output
  are discarded before persistence. A decisive aggregate result verdict `valid`
  with no validated cited evidence is treated as `needs-more-evidence` in the
  persisted batch result. A decisive aggregate decision with verdict `valid` or
  `false-positive` and no validated cited evidence is treated as
  `needs-more-evidence` before aggregate rejection/admission mapping.
- `false-positive` and `needs-more-evidence` aggregate decisions reject the
  candidate before admission and remove contradictory promotion decisions.
- When an aggregate result is present, only a rejecting aggregate decision
  (`false-positive`/`needs-more-evidence`) marks that candidate as
  aggregate-covered and removes it before admission. A `valid` aggregate
  decision does not cover the candidate: every proved candidate that survives
  aggregate rejection still runs the strict per-candidate judge when judging is
  enabled. This keeps the compact batch critic from rubber-stamping findings the
  strict judge would reject, raising promotion precision. If aggregate review
  fails, the provider issue is recorded as recovered and the workflow falls back
  to the normal per-candidate path.

### Optional Critic Judge

- When `aiReview.judgeFindings = true`, model-origin candidates that pass
  proof-loop refutation with `proved` must pass a separate critic judge before
  admission unless a normalized aggregate critic decision already rejected that
  candidate. A `valid` aggregate decision does not exempt a candidate from the
  judge.
  The judge replaces the additional admission-time refutation call for that
  candidate.
- The judge receives only the candidate, reviewed diff ranges, review intents,
  proof/refutation artifacts, curated evidence/context, instructions, skill
  metadata, shared digest, and provenance. Its evidence pool includes workflow
  evidence and task-produced proof-loop evidence, then the packet boundary
  filters that pool to the candidate, proof packet, refutation, and explicit
  follow-up evidence IDs.
- When skills are mounted, the judge may use the same bounded read/list/grep
  skill-tool policy as the investigator and refuter. It must not receive shell,
  network, filesystem-write, or unbounded repository tools.
- Judge input construction is a separate model-bound packet boundary. It uses
  the same `maxTaskInputBytes` provider budget as task/refutation packets,
  removes filtered review intents before shared digest text, and removes
  ambient review context only after those optional fields cannot fit. It
  preserves candidate/proof/refutation artifacts plus directly cited and
  explicit follow-up evidence. If the packet is still too large after optional
  context removal, the workflow records a recovered provider issue and keeps
  the candidate out of actionable output.
- The judge must try to falsify the candidate and return `valid`,
  `false-positive`, or `needs-more-evidence`.
- The judge must return compact `challengeQuestions` that name the assumptions,
  reachability claims, invariants, and changed-range facts it attempted to
  falsify. These questions are report-safe and must not contain raw source.
- The judge must return `verificationChecks` for decisive challenge questions.
  Each check records a kind, `passed | failed | unknown`, report-safe summary,
  and evidence IDs copied from available evidence/proof/refutation artifacts.
  Unknown evidence IDs are discarded before report persistence.
- Judge result `evidenceIds` must contain only evidence IDs explicitly cited by
  the judge and validated against available evidence/proof/refutation artifacts.
  The workflow must not backfill candidate, proof, or refutation evidence when
  the critic returns no evidence IDs; missing critic evidence must remain visible
  in the report. Judge output with decisive verdict `valid` or
  `false-positive` and no validated cited evidence is treated as
  `needs-more-evidence` before admission.
- When the judge returns `needs-more-evidence`, it may request a small set of
  structured `contextRequests` with tool `read`, `list`, or `grep`, optional
  repository-relative path/query, and a short reason. Runtime-owned context
  retrieval may satisfy those requests through the same repository containment,
  redaction, budget, and context-ledger controls used by investigation, then
  rerun the judge until it returns `valid` or `false-positive`, no safe
  follow-up context is available, provider recovery stops the loop, or
  `aiReview.maxInvestigationRounds` follow-up rounds have been used. Legacy
  prose `requestedContext` is retained only as human-readable
  compatibility/audit text and as a fallback when no structured request is
  present. The final judge verdict after the bounded follow-up loop is the
  recorded result, and reports retain structured requests and bounded prose
  summaries from all judge rounds for human audit.
- Optional per-candidate judge reviews in the same admission-preparation pass
  should share identical mediated context artifacts. The shared cache must not
  make judging mandatory; it only avoids repeated read/list/grep retrieval when
  `aiReview.judgeFindings` is enabled and multiple judge checks request the same
  bounded context.
- Admission preparation for independent model candidates may run with bounded
  concurrency up to `maxConcurrentTasks`, but the merged admission candidates,
  evidence, rejected findings, judge results, provider issues, and admission
  decisions must preserve deterministic candidate order. Each optional judge
  packet receives base workflow evidence, candidate-scoped task proof evidence,
  that candidate's own refutation evidence, and explicit follow-up evidence; it
  must not inherit unrelated proof or refutation evidence produced for earlier
  or concurrently reviewed candidates.
- The ordered bounded-map primitive used for admission preparation must live in
  a focused workflow helper so low-level worker scheduling and result ordering
  are tested independently from refutation, judge, and admission policy.
- Admission candidate outcome containers and merge assembly must live in a
  focused helper so final result ordering and evidence prepending are tested
  independently from refutation, judge, and promotion policy.
- Refutation provider-error rejected findings, recovered provider issues, and
  admission decisions must be assembled through a focused admission helper so
  provider recovery shaping remains consistent across refutation-packet and
  refutation-check failures.
- Refutation verdict outcome shaping for refuted, weak, artifact-only, and
  proved candidates must live in a focused admission helper so rejected finding
  reasons, evidence IDs, and artifact-only promotion behavior are tested outside
  the admission orchestrator.
- Optional judge outcome shaping for passed and rejected/provider-error critic
  results must live in a focused admission helper so critic evidence, judge
  result, provider issue, and proved-candidate enrichment assembly is tested
  outside the admission orchestrator.
- Admission preflight outcome shaping for support-signal pass-through,
  no-refuter fallback, and out-of-diff-scope model candidates must live in a
  focused admission helper so non-model artifact-only behavior and early
  rejection decisions are tested outside the admission orchestrator.
- Admission refutation execution must live in a focused helper so proof-loop
  reuse, refutation-packet construction, active refuter calls, and
  provider-error recovery are tested independently from candidate admission
  orchestration.
- Per-candidate model admission review execution must live in a focused helper
  so support-signal pass-through, diff-scope rejection, refutation execution,
  weak/refuted handling, optional judge gating, and proved-candidate fallback
  are tested independently from bounded candidate concurrency and result merge
  orchestration.
- Proof-loop promotion artifact assembly must live in a focused helper so
  proof packet, refutation result, and promotion decision construction are
  tested independently from investigation orchestration.
- Proof-loop deterministic evidence signal classification must live in a
  focused helper so static-analysis duplicate and deterministic contradiction
  promotion inputs are tested independently from investigation orchestration.
- Proof-loop evidence selection must live in a focused helper so investigation
  citations are filtered to available evidence, scoped fallback evidence is
  applied consistently, and zero-evidence proved outputs are demoted before
  promotion.
- Proof-loop suspicion seeding must live in a focused helper so stable
  suspicion IDs, reviewer-visible requested context defaults, and model
  suspicion base fields are tested independently from investigation
  orchestration.
- Proof-loop investigation follow-up state accumulation must live in a focused
  helper so suspicion context requests, requested context strings, and retrieved
  context artifacts are merged consistently outside investigation orchestration.
- Proof-loop candidate evidence selection must live in a focused helper so seed
  evidence IDs and originally cited evidence are selected from task evidence
  consistently outside investigation orchestration.
- Proof-loop evidence pool assembly must live in a focused helper so final
  context evidence records and available/fallback evidence ID lists are built
  consistently outside investigation orchestration.
- Proof-loop investigation provider recovery must live in a focused helper so
  packet construction failures and investigation provider failures produce
  consistent `needs-more-evidence` investigation outputs and recovered provider
  issues outside investigation orchestration.
- Proof-loop non-proved promotion decision shaping must live in a focused
  helper so `refuted` and `needs-more-evidence` investigation verdicts produce
  consistent rejected or policy-selected promotion decisions outside
  investigation orchestration.
- Proof-loop task result aggregation must live in a focused helper so
  per-candidate suspicions, traces, proof packets, refutation results,
  promotion decisions, evidence, and provider issues are appended consistently
  outside proof-loop orchestration.
- Proof-loop investigation trace result shaping must live in a focused helper
  so provider-issue overrides and effective investigation verdict mappings are
  applied consistently outside proof-loop orchestration.
- Proof-loop suspicion status shaping must live in a focused helper so
  effective investigation verdicts produce consistent suspicion statuses
  outside proof-loop orchestration.
- Proof-loop default investigation output shaping must live in a focused helper
  so runnerless investigations and missing investigation results produce
  consistent needs-more-evidence outputs outside proof-loop orchestration. A
  runnerless path never self-asserts `proved`: with no investigator verdict the
  cited evidence is unverified, so the result stays inconclusive (VIS-001
  requires a real proof packet before a candidate can become actionable).
- Proof-loop investigation follow-up eligibility must live in a focused helper
  so verdict, context retriever availability, remaining rounds, and requested
  context gates are applied consistently outside proof-loop orchestration.
- Proof-loop follow-up context artifact usability must live in a focused helper
  so missing or empty retrieved follow-up context stops investigation
  consistently outside proof-loop orchestration.
- Proof-loop investigation execution must live in a focused helper so
  runnerless default outputs, investigation-packet provider recovery, and
  investigation-call provider recovery are applied consistently outside
  proof-loop orchestration.
- Proof-loop candidate artifact finalization must live in a focused helper so
  evidence selection, suspicion and trace shaping, proof/refutation artifact
  assembly, non-proved promotion, and provider issue propagation are applied
  consistently outside proof-loop orchestration.
- Per-candidate proof-loop execution must live in a focused helper so initial
  retrieval, suspicion seeding, bounded investigation rounds, follow-up
  context retrieval, provider recovery, and candidate artifact finalization are
  tested independently from task-level candidate iteration and aggregation.
- Model task sibling sweep execution must live in a focused helper so optional
  sweep eligibility, proof-scoped sweep input, duplicate sibling pruning,
  investigation slot budgeting, sweep proof-loop execution, and recovered
  provider issue shaping are tested outside primary model task review
  orchestration.
- Model task candidate selection must live in a focused helper so model
  suspicion conversion, duplicate/drop accounting, per-task suspicion caps, and
  global investigation-slot reservations are tested outside provider-call,
  proof-loop, and sibling-sweep orchestration.
- Model task suggestion runner instrumentation must live in a focused helper so
  task-review provider-call start logging, signal forwarding, and model
  suspicion suggestion pass-through are tested outside candidate selection,
  proof-loop, and sibling-sweep orchestration.
- Model task investigation runner instrumentation must live in a focused helper
  so suspicion investigation provider-call start/completion logging, signal
  forwarding, and result pass-through are tested outside primary task-review
  orchestration.
- Model task primary proof execution must live in a focused helper so selected
  primary candidates, selected context requests, shared context-artifact cache
  use, task-level investigation runner instrumentation, proof-loop artifact
  propagation, and provider issue propagation are tested outside task-review
  orchestration.
- Model task completion logging must live in a focused helper so task ID,
  task round, suggestion count, primary plus sibling candidate counts, primary
  plus sibling suspicion counts, primary plus sibling proof counts, and dropped
  suspicion reasons are calculated consistently outside task-review
  orchestration.
- Sibling-sweep candidate selection must live in a focused helper so model
  suspicion conversion, primary-candidate duplicate pruning, same-location
  duplicate pruning, remaining per-task suspicion caps, and global
  investigation-slot reservations are tested outside sibling provider calls and
  proof-loop execution.
- Sibling-sweep provider execution must live in a focused helper so
  proof-scoped sweep input shaping, provider-call start logging, signal
  forwarding, provider-failure logging, and recovered provider issue shaping are
  tested outside sibling candidate selection and proof-loop execution.
- Sibling-sweep proof execution must live in a focused helper so selected
  sibling candidates, selected context requests, proof-loop artifact
  propagation, completion logging, and schema-validated sibling result assembly
  are tested outside sibling sweep gating, provider calls, and candidate
  selection.
- Model task review result assembly must live in a focused helper so primary
  model candidates, primary proof-loop artifacts, sibling-sweep candidates, and
  sibling-sweep artifacts are concatenated and schema-validated independently
  from provider calls, investigation loops, and sibling sweep orchestration.
- Optional judge result normalization must live in a focused helper so critic
  evidence filtering, verification-check evidence filtering, no-evidence
  demotion, stable judge IDs, and proof/refutation links are tested
  independently from judge follow-up orchestration.
- Optional judge provider-error outcome shaping must live in a focused helper
  so packet, first-pass judge, follow-up packet, and follow-up judge provider
  failures produce consistent rejected findings, admission decisions, and
  recovered provider issues outside judge orchestration.
- Optional judge verdict outcome shaping must live in a focused helper so
  `valid`, `false-positive`, and `needs-more-evidence` critic verdicts produce
  consistent review outcomes, rejected findings, admission decisions, judge
  results, and provider issue pass-through outside judge orchestration.
- Optional judge follow-up context accumulation must live in a focused helper
  so additional evidence, requested evidence IDs, and review-context artifacts
  are deduplicated consistently outside judge orchestration.
- Optional judge follow-up output accumulation must live in a focused helper so
  challenge questions and requested context strings are deduplicated while
  structured context requests preserve follow-up order outside judge
  orchestration.
- Optional judge follow-up execution must live in a focused helper so bounded
  context retrieval, follow-up packet rebuilds, follow-up judge reruns,
  provider-error recovery, accumulated context, and accumulated challenge output
  are tested outside first-pass judge orchestration.
- `false-positive` rejects the candidate as refuted. `needs-more-evidence`
  rejects the candidate as insufficiently proved. Provider errors in this stage
  are recorded as recovered provider issues and keep the candidate out of
  actionable output through the shared provider issue boundary. Workflow
  completion must preserve the first provider issue for each exact `(code,
  stage, recovered, message)` tuple and keep distinct tuples visible.

## Deterministic Support Signal Pipeline

The review pipeline treats local structural analysis as a support stage before
task planning:

1. Repository intake selects reviewable files and rejects unsupported paths.
2. Deterministic signal extractors route supported files to cheap local
   structural, diff, and scope checks.
3. Extractor output is normalized to `DeterministicSignal` and `EvidenceRecord`
   data before it can enter planning, model context, proof/refutation, or
   reports.
4. Task planning uses import, symbol, test, config, and diff signals to build
   bounded context groups.
5. Context assembly may include compact signal JSON in task packets, but it must
   not include raw AST dumps, external tool transcripts, or rule-authoring
   traces.

This stage does not call a model provider and does not consume model tokens by
itself. Provider token use changes only when compact signal output is included
in a task or investigation packet, where it focuses context selection and
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

Each context item considered for model context or investigation must produce a
context ledger entry. Context item kinds are file, diff hunk, symbol fact,
instruction file, skill file, deterministic signal output, investigation tool
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
- mediated investigation read/list/grep retrieval must use
  `kind = "tool-result"` so follow-up context can be distinguished from initial
  source, symbol, and support-signal context;
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
- Use Zod schemas for task input, model suspicion output, proof/refutation
  output, internal candidate findings, evidence, admission decisions, and report
  output.
- Provider-backed structured outputs must use object-root schemas. The review
  worker returns `{ suspicions: [...] }`; internal candidates are assembled only
  after suspicion conversion, investigation, proof, refutation, and promotion
  policy.
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
  evidence-backed proof, active refutation, and concrete suggested remediation.
  Prompt output must be parsed through Zod and treated as untrusted until
  admitted.
- The task-reviewer prompt must include a benchmark-derived semantic bug
  checklist before returning no suspicions: falsy zero handling, wrong variable
  reuse, nullable or optional access without guards, non-deterministic
  hash/order assumptions, numeric operations on datetime or non-numeric keys,
  and unsynchronized shared mutable state.
- The task-reviewer prompt must constrain suspicion generation to concrete
  semantic correctness, security, reliability, data-integrity, or
  maintainability defects visible in the bounded task packet. It must return no
  suspicion for style, preference, naming, formatting, helper-refactor, or
  cleanup-only concerns unless the packet proves concrete user-visible,
  runtime, security, or data-integrity impact. It must not guess about callers,
  configuration, tests, file content, dependencies, or runtime behavior omitted
  from the packet.
- Provider-backed workflow input must include only bounded, redacted,
  ledger-recorded review context. Context kinds in R1 are selected file content,
  deterministic signal output, investigation tool summaries, and context hints.
  Raw environment variables, local absolute paths, git remotes, shell output,
  ignored files, and unledgered content are forbidden.
- Once tasks are assembled, provider-backed workflow input must not duplicate
  run-wide source context outside the task packets. Task packets are the model
  boundary.
- Provider-backed workflows orchestrate queued `review_task` worker calls
  through a bounded rolling worker pool, update workflow-local shared context
  after each completed task, pass compact shared digests to later workers, and
  then run proof/refutation promotion, internal candidate merging, admission,
  baseline matching, and quality gates.
- Provider-backed harness creation must pass the scale-derived child-agent call
  cap from the provider workflow boundary, where workflow input task count and
  AI review budgets are available. Direct harness construction may fall back to
  the small default floor but must still use the shared delegation helper.
- Provider-backed agents must use the shared role-specific harness option
  helper. Hardcoded per-agent `maxSteps` or builtin-tool settings in the harness
  builder are forbidden because they drift from the proof/critic budget policy.
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
- effective diff ranges passed to provider-backed tasks and investigations must preserve
  `changeKind` metadata (`new`, `modified`, or `deleted`) when known, so model
  investigation/refutation can distinguish new-file findings from existing-file
  context;
- review execution may receive a trusted precomputed `DiffMap[]` from eval or
  test harnesses; this override is used only for inline-eligibility policy and
  must not replace normal repository intake, changed-file discovery, source
  reading, or coverage accounting;
- model-origin proof locations and deterministic-signal-derived diagnostic
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

Review context documents supplied to model tasks or investigations may be
partial excerpts selected for budget. Model instructions and proof/refutation
must not treat omitted file content as proof that a file is truncated,
malformed, or missing closing syntax. Model-only truncation or malformed-file
claims require deterministic contradiction-safe evidence for the same path
before they can become actionable.

It stores:

- compact shared entries for deterministic signals, task states, suspicions,
  proof packets, findings, and admission decisions;
- repository facts and deterministic signals;
- exact append-only `taskEvents`, including `round`, `kind`, `paths`,
  `workerId`, and optional message;
- derived `currentTasks` with the latest event per task ID;
- context ledger entries;
- evidence records;
- model suspicions;
- investigation traces;
- proof packets;
- refutation results;
- promotion decisions;
- candidate findings;
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
report output, preserving the first-seen `modelSuspicions`, `proofPackets`,
`refutationResults`, `aggregateResults`, and `judgeResults` entries for each
ID. Investigation traces and promotion decisions remain append-only because
they do not use the same stable artifact-ID contract.

State transitions:

```text
planned -> running -> completed
planned -> running -> failed
candidate -> admitted
candidate -> rejected
candidate -> needs-more-evidence
suspicion -> investigating
suspicion -> proof | refuted | needs-more-evidence
proof -> refutation
refutation -> promoted | rejected | artifact-only
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
provider issues, suspicions, proof/refutation summaries, and promotion decisions
from completed tasks. It must not publish actionable admitted findings for
incomplete provider-backed runs unless every admitted finding's proof and
refutation completed before the terminal failure.

## Admission Gate

A candidate is admitted only when all checks pass:

1. Candidate validates against schema.
2. Location resolves to a reviewed file.
3. Model-origin candidates reference a complete `ProofPacket`.
4. Model-origin candidates reference `RefutationResult.verdict = "proved"`.
5. At least one evidence record supports every proof obligation. Evidence may
   include deterministic signals and model-rationale summaries, but
   model-generated confidence scores are not accepted as evidence or report
   fields.
   Deterministic support-signal overlap can corroborate a proof, but it must not
   bypass the proof packet, refutation result, or admission sequence for a
   model-origin candidate.
6. Finding is in configured scope.
7. It is not a duplicate of an admitted finding.
8. It is not contradicted by deterministic safety checks.
9. It is not only a duplicate of expected external CodeQL/linter/formatter/test
   or build output unless semantic context adds a distinct issue.
10. Severity is allowed by policy.
11. Evidence summaries are redacted.
12. Reporter eligibility is computed deterministically.

If proof or evidence sufficiency fails but the location and schema are valid,
status is `needs-more-evidence` or artifact-only according to promotion policy.
Refuted, out-of-scope, provider-error, static-analysis-duplicate, and
deterministic-contradiction outcomes are rejected or demoted according to
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
| Model suspicion cannot become actionable without proof and refutation | proof/refutation workflow test |
| Deterministic contradiction demotes or rejects model proof | promotion policy test |
