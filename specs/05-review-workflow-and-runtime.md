# 05: Review Workflow And Runtime

Status: Approved
Date: 2026-07-21

## End-To-End Flow

1. Parse CLI args.
2. Load and validate config.
3. Load root `.env` when present and merge process env.
4. Resolve repository root from CLI or current working directory.
5. Run deterministic drift/security preflight checks. These run first, so a hard
   drift error stops before repository IO and before any network-capable path.
6. Collect repository intake, including the raw unified diff.
7. Build deterministic support signals.
8. Plan review tasks.
9. Assemble bounded task context: read source chunks, load reviewer instruction
   metadata, and load the mounted skill index when enabled.
10. Ingest external change-intent context when configured: gather from bounded
    providers, redact, summarize with a dedicated model call (or a deterministic
    digest), and inject the brief as a context-only `change-intent` document. See
    `11-external-context-ingestion.md`. This step is skipped when the feature is
    disabled and never fails the run on a provider error.
11. Load configured baseline data.
12. Resolve provider when model-backed review is enabled.
13. Run holistic discovery: a recall-first whole-file review per task, plus the
    optional dedicated security pass (`15-security-focused-review.md`) when enabled. That
    pass is additive and cannot displace a candidate the primary review raised.
14. Merge candidates that describe one defect, per Semantic Finding Merge below.
15. Run refutation once per task, adjudicating every candidate that task raised.
16. Admit or reject candidates against the admission gate.
17. Match actionable admitted findings against baseline.
18. Evaluate optional quality gate.
19. Run the optional fix lane and the optional verification flow when configured
    (`12-verification-flow.md`). Both are advisory: neither changes admission,
    severity, or the gate.
20. Create the run directory, render reports and run artifacts, and record the run
    in the run index.
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
- The reviewed change set is the set of changes present on `headRef` since it
  diverged from `baseRef`. Intake must resolve the merge base of `baseRef` and
  `headRef` with `git merge-base <baseRef> <headRef>` and use the resulting
  commit as the diff base for both the name-status and unified diff calls.
  Commits that landed on `baseRef` after the divergence point must not appear
  as changed files.
- When no merge base exists (unrelated histories, or a clone shallow enough to
  exclude the divergence point), intake must fail with the structured error code
  `merge_base_unavailable`, category `repository`, exit code 3. Intake must not
  silently fall back to a direct `baseRef`-to-`headRef` diff, because that
  produces a changed-file set that includes unrelated base-branch commits.
- The resolved merge-base commit must be recorded on `RepositorySnapshot` as
  `mergeBaseRef` so run artifacts state which base the review actually used.
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
- workflow context assembly must NOT split source on a byte budget. A change is one
  task unless the provider refuses the packet as exceeding its context length, in
  which case the task is halved and each half retried (spec 26). Large files and
  large dependency clusters must never create skipped or truncated required source;
- every source chunk must carry the absolute line range it occupies in its file,
  and chunks must be cut on line boundaries (a single line longer than the split
  size is the only exception and keeps one line number across its pieces). This
  requirement applies to reactively split halves exactly as it applies to any
  other chunk.
  Discovery must number a chunk's lines from that absolute origin, so a finding
  in the second chunk of a split file reports the file's real line and not a
  chunk-relative one. Chunk-relative numbering is a correctness defect, not a
  cosmetic one: the finding fingerprint anchors on the text at the reported
  line, so a wrong line silently gives the finding a wrong identity and breaks
  baseline suppression and cross-run matching;
- workflow context assembly records every included source chunk in the context
  ledger with reason `task-context-source-chunk`, task ID, byte counts, and
  content hash. Budget pressure is not an evidence record unless another
  signal extractor or reviewer produces evidence that references it;
- deterministic support signals remain available for context, contradiction,
  and admission safety even when a provider-backed model is configured. Signal
  output is not the main actionable finding source by default, but a narrow
  trusted-rule allowlist may seed deterministic candidates directly when the
  rule has local evidence and a concrete remediation.
- workflow context assembly injects bounded "referenced-definition" context for
  unchanged dependency files that the changed files import. For each task it
  resolves the changed files' RELATIVE imports (`./`/`../`) to existing repo
  files outside the task's paths, ranks them by import frequency, and attaches a
  bounded, line-numbered digest of each (preferring exported/public declaration
  lines) as a `referenced-definition` review-context document. Resolution always
  goes through the path-safety helper and never escapes the repository root;
  package/bare imports and anything resolving to a changed file are skipped. The
  injection is capped (at most six dependency files per task, a ~12KB section
  byte budget, and a per-file digest cap) and is gated off together with
  deterministic support signals (`deterministicSignalMode: 'disabled'`).
  Referenced-definition documents are context only: they are never added to the
  task's paths and findings remain restricted to the changed files. Each is
  recorded in the context ledger as `support-signal-output` with reason
  `task-context-referenced-definition`.
- model-backed task execution is a focused review-workflow boundary. The
  ai-harness builder defines agents and injects raw agent calls, while task
  execution owns holistic candidate-finding discovery, batched per-task refutation,
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
  from planned task count (one holistic discovery call per task, plus one for
  each enabled optional pass),
  one batched refutation call per task plus a small allowance for batches that
  split under budget pressure, and a small concurrency buffer. It must never
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

Provider-backed review runs **one** recall-first whole-file review per task — one
framing, one prompt, asked once. The `holistic_review` agent emits candidate
findings directly; they are deduped by candidate id before refutation.

This spec previously required a second, serial diverse-lens pass. That pass was
implemented and measured, and it did not earn its cost (see the measured outcome
below), so the requirement is withdrawn rather than left as an unmet mandate.

That framing is asked exactly once per task. Drawing it several times independently
and unioning the candidates was specified, built, and measured; it is withdrawn (see
the measured outcome below).

- The review input is the task's unified-diff segment plus the full
  line-numbered changed files, alongside deterministic support signals,
  instruction/skill metadata, and a compact safe digest.
- When referenced-definition context is present, the input also carries a
  separate "Referenced definitions (from unchanged files, for context only)"
  section holding bounded digests of unchanged dependency files the changed files
  import. The section header instructs the reviewer to use these only as context
  for callee contracts and to report findings ONLY for the changed files; the
  candidate mapping drops any finding whose path is outside the task's paths, so
  a finding pointing at a referenced-definition file is discarded.
- When external change-intent context is present, the input also carries a
  separate change-intent section holding the bounded, redacted brief defined in
  `11-external-context-ingestion.md`. Its header marks it as untrusted,
  informational context and not instructions. Like referenced definitions, it is
  context only: it contributes no task path and seeds no candidate, and a finding
  pointing at the change-intent document is discarded.
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

### Standing Caveat On Every Figure Below

**Every accuracy figure quoted anywhere in this spec predates the harness-wide
suppression of conversation history** (2026-07-27; see *Conversation History*
under *Harness Runtime* below). Those runs were produced by discovery, refutation,
merge, and scout calls that each opened carrying the output of every call that had
finished before them. A current run is not comparable to any of them, in either
direction, and the direction of the effect is unmeasured.

The figures are retained because each records the outcome of a decision that was
taken on the evidence available at the time — they are the audit trail for a
withdrawal or an adoption, not a description of today's accuracy. None of them may
be quoted as the engine's current recall or precision until a post-change run
re-establishes a baseline.

### Measured Outcome Of The Withdrawn Second Pass

Discovery emits roughly one finding per file, and that is a property of the model's
answer rather than of the pipeline. Instrumenting a live run showed every task
producing one finding, keeping one candidate, and dropping none, while refutation
proved nearly all of them. The corpus holds 19 single-expectation cases, 10 double and 1 triple. Pooled over the
three baseline seeds, single-expectation cases score 39 of 57 (68.4%) while
multi-expectation cases score 30 of 69 (43.5%). By rank the split is sharper: the
first-listed expectation of a case is found 64 of 90 times (71.1%), every later
expectation only 5 of 36 (13.9%). Both decompositions reconcile to the published
54.8%. No later expectation in the corpus is high-severity -- all fourteen highs are
first-listed -- and every one of the seven later `medium` expectations was missed in
all three seeds.

Two additional passes were built against this and measured on that corpus, three
seeds each: an enumeration sweep that re-asks what the previous round missed, and
the diverse-lens pass this section used to require. Baseline recall is 54.8%
(50.0 / 54.8 / 59.5, sd 4.8pp). The sweep gives 54.8% (50.0 / 52.4 / 61.9) at about
+40% cost. The lens pass gives 54.0% (57.1 / 52.4 / 52.4) at about +47% cost.
**Neither is a measurable improvement**, so both were removed along with their
configuration rather than kept as unproven switches.

Precision about what this does and does not establish: at three seeds with a 4.8pp
deviation the resolution is roughly ±5.5pp, so a small real effect would be
invisible. The passes are removed as unproven and expensive, not as disproven. One
signal ran the other way and is worth recording for anyone who revisits this: the
lens pass surfaced more plausibility-confirmed defects the answer key never listed,
7.3 per run against 5.3, at 100% adjusted precision in all three seeds. That is a
real-world gain that this corpus's recall metric cannot see, and it is also inside
the noise band. Chasing it needs a targeted experiment, not a retained switch.

Two implementation lessons are worth keeping. The first lens measurement was invalid:
the additive merge suppressed any candidate sharing a (path, line) with an earlier
one, and a probe caught the pass returning two findings that were both discarded for
sharing a start line with the general finding. A line can hold more than one defect,
so the general-purpose passes now suppress on (path, line, category). And a response
truncated by the output-token budget used to parse as "no findings", making an
exhausted review indistinguishable from a clean file.

The one-finding-per-file limit therefore remains **open and unfixed**. What is
established is that neither re-asking the same question nor asking a differently
framed one recovers the missed defect, so a future attempt should start somewhere
else.

### Measured Outcome Of The Withdrawn Un-Anchored Pass

A third attempt at the same limit was built, measured, and removed on 2026-07-27:
an optional additive pass that reviewed a changed file as bounded units **with the
diff withheld**, so the reviewer had no changed line to answer. Its detail is in
`reports/2026-07-27-unanchored-pass-ab-result.md`.

It was tried because the diagnosis was measured rather than assumed. In a
controlled experiment on the same decomposition, only 16 of 76 candidates (21%)
from the diff-BEARING arm pointed at a line inside the unit they were shown, while
the diff-withheld arm placed 50 of 50 inside their own unit. The reviewer answers
the diff; removing the anchor demonstrably made it read the code it was handed.

The A/B on the 36-case / 80-expectation real-repository corpus (base n=6, enabled
n=3) gave **+0.83pp recall, 95% CI [−3.13, +4.79], 10 expectations gained and 9
lost, p = 0.82, for +136% cost**. Ten gained against nine lost is a coin flip. The
decision rule fixed in advance required significance, intact precision, and a
defensible cost per additional matched expectation to ship it enabled, and a
genuine recall rise even to retain it disabled; it met none of those, so it was
removed entirely rather than kept as an expensive switch.

The negative result is treated as **general**, not as a property of this corpus,
because the corpus was recorded in advance as close to the best case for the
change: median 7 changed lines per case, median 2 hunks, 17 of 36 cases
single-hunk. A small diff is where the anchor pulls hardest, so it is where
removing the anchor has the most to add.

Two findings from the same measurement survive the removal and should inform any
future decomposed-discovery work:

- **The refutation gate has real headroom.** Under a 56% increase in candidates
  its kill rate rose from 1.3% to 16.0% while adjusted precision held (0.804 →
  0.792). A "generate wider" experiment can lean on that instead of building its
  own filter.
- **The semantic finding merge is load-bearing under decomposition.** Merge
  collapses rose from 1.7 to 19.3 per run, so roughly nineteen restatements per
  run would otherwise have reached the reader, and the paired test showed no
  one-sided loss (9 lost against 10 gained is symmetric noise, not the systematic
  deletion a defective merge would produce). It is retained on its own merits.

What this does not establish is that decomposed discovery is worthless — it
establishes that withholding the diff, at this geometry, on the corpus most
favourable to it, does not pay for itself. A future proposal should bring a
different mechanism, not this one at a different unit size.

### Withdrawal Of The Context Scout, Without A Valid Measurement

The context scout was a **separate pre-review model call that chose which
out-of-change symbols the reviewer should be shown**: it named symbols,
deterministic code extracted their bodies, and those bodies were injected into the
discovery packet as referenced-definition context while discovery itself stayed
single-shot and tool-free. It had its own spec (18), its own `context_scout` agent,
and a `review.contextScout` configuration block, off by default. All of it was
removed on 2026-07-27, including the spec and the configuration keys; a config that
still sets them fails validation with exit code 2, as with the withdrawn passes
above.

This withdrawal is different in kind from the two above, and the difference must not
be smoothed over. **The scout's only A/B is void and may not be quoted in either
direction.** It was run against a build that did not implement the spec it was being
measured as — a symbol inventory the prompt required every request to draw from was
never built, and the scout was handed the full line-numbered packet while its own
prompt asserted it had no file bodies — and it also predates the suppression of
conversation history recorded above. A void measurement is not a failed one. The
scout was never validly tested, and it is **not** removed for having failed a test.

It is removed on three grounds that hold independently of any measurement:

1. **It adds context to a reviewer that is not reading the context it already
   has.** The controlled experiment recorded above measured exactly that: only 16 of
   76 candidates (21%) from the diff-bearing arm pointed at a line inside the unit
   they were shown, and one 1251-line file returned the same finding at line 820
   from all 31 of its units — including the unit whose packet did not contain line
   820 at all. The reviewer answers the diff. Enlarging the packet of a reviewer
   that is not reading its packet is an unlikely remedy.
2. **The blind spot it was built for was closed by a different, cheaper change.**
   The scout existed for cross-file and caller-dependent defects, which were the
   dominant residual misses on the sixteen-case corpus. Those were recovered by a
   single added prompt instruction — the untrusted-input guard, whose measurement is
   in `15-security-focused-review.md` — at unchanged cost, and neither cross-file
   retrieval (`16-agentic-cross-file-discovery.md`) nor the scout recovered them.
   The honest size of that guard is roughly four points of recall on the larger
   benchmark rather than the eighteen the small corpus first suggested, as spec 15
   itself records; the point here is the direction and the mechanism, not the
   magnitude. Framing beat retrieval.
3. **It did not implement its own spec, and making it do so is real work.** An
   alignment audit recorded six unmet requirements: the missing symbol inventory and
   the contradicted "no file bodies" premise above; resolution by heuristic text
   scan rather than the deterministic import/declaration facts the spec required; no
   total byte cap across extracted bodies; and a section appended after budget
   fitting, so `maxTaskInputBytes` could neither measure it nor shed it under
   pressure. Closing those is the entry price of a *first* valid measurement of a
   hypothesis that points 1 and 2 give reason to disbelieve.

**What this does not establish.** It is not evidence that demand-driven or
pre-assembled context is impossible, and it is not a measured verdict on separating
context selection from judgment — that separation has still never been validly
tested here. What is established is that this implementation was never validly
measured and that the mechanism argues against it. Anyone proposing demand-driven
context should bring a design that answers point 1 — some reason the reviewer will
read what it is handed — rather than a better selector in front of the same
reviewer.

### Measured Outcome Of The Withdrawn Discovery Posture

A configurable **discovery posture** existed briefly: `review.discoveryPosture`,
with `precise` (the default and current behaviour) against `investigative`, an
appended instruction segment that lowered the evidentiary bar the reviewer applied
to **itself** before raising a candidate. It had its own spec (20), its own
capability entry (CAP-AI-008), and no other effect — no defect categories, no
change to the call count, the packet, or its field order. All of it was removed on
2026-07-27, including the spec and the configuration key; a config that still sets
`review.discoveryPosture` fails validation with exit code 2, as with the withdrawn
passes and the context scout above.

The A/B, n=4 per arm on the 36-case / 80-expectation real-repository corpus, paired
finding-level test (`reports/eval-results-ledger.md`):

| | `precise` | `investigative` |
|---|---:|---:|
| Recall | **45.94%** | **44.69%** |
| Adjusted precision | 0.819 | 0.873 |
| Genuine false positives / run | 8.3 | 5.3 |
| Candidates / run | 74.8 | **70.8** |
| Cost / run | $1.32 | $1.36 |

Recall delta **−1.25pp**, 95% CI **[−4.38, +1.25]**, 5 gained against 5 lost,
**p = 1.0000**. Spec 20's rule, fixed before the run, read "remove if recall does
not rise". Recall did not rise.

**The intervention did not do the thing it was built to do.** The posture existed
to *widen* discovery, and the candidate count **fell**, 74.8 → 70.8. So this arm
never tested "widen discovery and see whether the refutation gate absorbs it" —
discovery never widened. The added paragraph appears to have made the reviewer more
careful rather than less, plausibly because it repeats that severity must reflect
impact rather than confidence and asks the reviewer to state what it could not
determine. A future attempt at this idea should first demonstrate on a handful of
cases that the prompt actually raises candidate count, before spending on an arm.

The precision movement is **not** a reason to keep it. Adjusted precision rose
0.819 → 0.873 and genuine false positives fell 36% at equal cost, but that is a
post-hoc reading of an experiment that failed its primary endpoint, on the arm
whose candidate count happened to fall — the classic shape of a result that does
not replicate. It is recorded as a hypothesis worth its own pre-registered test
(*does an instruction that makes the reviewer more explicit about uncertainty
improve precision at no recall cost?*), not as a finding.

**What this does not establish, and it is the most important line here.** This was
not a faithful test of the idea it came from. The source changed **two** things: it
replaced a fixed pipeline with an agent that **calls tools and decides its own
investigation depth**, *and* it made prompting aggressive. **We implemented only the
prompt.** This engine's discovery lane is single-shot and tools-off by design, so
the reviewer was told to investigate every suspicious pattern **with no mechanism to
investigate anything** — words were added, not capability, and that is a plausible
reason candidate count fell rather than rose. **What was measured here is a prompt.
The source's actual architecture — aggressive prompting paired with an agent that
can act on the instruction — is untested in this engine, and this record must not be
cited as evidence against it.**

### Measured Outcome Of The Withdrawn Independent Sampling

Discovery could be **sampled**: `review.discoverySampleCount` (`k`, default `1`,
bounded at 5) drew that many mutually blind samples of the same review over a
byte-identical packet and combined their candidates by union, deduplicated only by
the Semantic Finding Merge. Consensus, majority voting, and agreement thresholds
were forbidden by construction. It had its own spec (21) and its own capability
entry (CAP-AI-009). All of it was removed on 2026-07-27, including the spec and the
configuration key; a config that still sets `review.discoverySampleCount` fails
validation with exit code 2.

The A/B, `k = 1` against `k = 3`, n=3 per arm on the 36-case / 80-expectation
real-repository corpus (`reports/eval-results-ledger.md`):

| | `k = 1` | `k = 3` |
|---|---:|---:|
| Recall | 46.25% | **48.33%** |
| Adjusted precision | **0.819** | **0.628** |
| Genuine false positives / run | **8.3** | **23.3** |
| Candidates / run | 74.8 | 127.0 |
| Semantic merge collapses / run | ~1.7 | **78.0** |
| Cost / run | $1.43 | $2.38 (**+67%**) |

Recall delta **+2.08pp**, 95% CI **[−1.67, +6.25]**, 7 gained against 5 lost,
**p = 0.56**. Recall did not rise significantly, adjusted precision fell by 0.19,
and genuine false positives nearly tripled.

**It also falsified its own premise.** Spec 21 was written on an assumed union
ceiling of ~67% against ~46% single-run recall — roughly 20pp of run-to-run
variance waiting to be harvested — a figure taken from a different corpus and
configuration. Measured here: single run 46.3% (mean of 3), post-hoc union of those
same 3 runs **50.0%**, `k = 3` inside one run 48.3%. **The harvestable variance is
about 4pp, not 20pp, and `k = 3` already captured most of it.**

The mechanism behind the small ceiling is visible in the same run. The merge fired
78 times per run, up from ~1.7, and adjusted precision still fell hard — so the
extra candidates are **distinct wrong findings**, not restatements. Independent
samples disagree about what is wrong rather than agreeing about a defect one of
them missed. Run-to-run variance here is mostly noise, not near-misses.

Spec 21's literal rule would have permitted retaining this disabled-by-default
("retain as configuration if recall rises without significance at n=3"). The
deviation is deliberate: the rule was written assuming ~20pp was available, the
measurement falsified that assumption, and retaining an option nobody should ever
enable is configuration surface for a strictly worse setting.

**What survives the removal.** The Semantic Finding Merge stays. This arm exercised
it under the only load that tests it — 78 collapses per run — and it did its job
with no one-sided loss. The harness-wide suppression of conversation history landed
under spec 21 but is independent of sampling; its requirement is rehomed under
*Harness Runtime → Conversation History* below.

**What this does not establish, and it is the most important line here.** This was
not a faithful test of the idea it came from. The published sources used **n = 10**
with a plateau at 5 and an aggregation call, and one of them **randomised the diff
order across parallel passes specifically to force different reasoning paths**. We
used `k = 3` with **byte-identical packets**, so the only diversity available to a
sample was sampling randomness. **The ~4pp ceiling measured here therefore bounds
identical-input resampling only. Input-perturbed sampling has a higher potential
ceiling and is untested in this engine.**

The honest expectation — recorded explicitly **as a prediction, not as a
measurement** — is that input-perturbed sampling would still not pay: precision
collapsed hard at `k = 3`, the extra candidates were distinct wrong findings rather
than near-misses, and inducing more diversity should produce more of them. Nothing
measured here establishes that, and it may not be quoted as if it did.

## Refutation

Every candidate finding passes a precision filter run by the `refute_finding`
agent before admission. The filter is **batched per task**: one call adjudicates
every candidate raised for that task and returns one verdict per candidate.

Batching is a token-consumption decision, not a quality one. Candidates from a
task share one review context — the changed file — and the previous
per-candidate packet re-sent that whole context once per candidate, so a task
with fourteen candidates sent its file fourteen times. Input tokens dominate this
engine's cost by roughly 23:1 over output, so the shared context is sent once.
Each candidate is still judged on its own merits and receives its own verdict;
sharing a call must not make one candidate's verdict depend on another's.

- The refuter may use only the provided candidates, `reviewedDiffRanges`,
  evidence, review context, support-signal candidates, instructions, skill
  metadata, shared digest, and provenance. It receives no direct repository
  tools beyond the bounded mounted skill read/list/grep loop.
- Each verdict carries the `candidateId` it belongs to. A verdict whose id
  matches no candidate in the batch is discarded, and a candidate the model did
  not adjudicate is treated as `needs-more-evidence`: absence of a verdict is
  absence of signal, never an admission.
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
  candidates, candidate-scoped evidence, reviewed diff ranges, instructions,
  skill metadata, and provenance before a provider call starts. A batch that
  still exceeds the budget is split in half and each half retried, so an
  oversized task costs more calls rather than losing its candidates; a single
  candidate that cannot fit records the shared packet-budget error instead of
  truncating source-bearing fields.
- Packet fields are ordered so everything shared across batches comes first and
  the per-candidate payload last, keeping the longest possible stable prompt
  prefix for provider prompt caches.
- A batch that fails because the model's response did not validate — an
  output-schema failure or a response the provider adapter could not parse into
  a structured object at all — gets exactly ONE retry over the identical packet
  before it degrades. This is deliberately narrower than "any refutation
  failure": a hard provider failure (auth, rate limiting, network, an
  unavailable provider) already carries its own retry policy in the provider
  layer and must not be retried again here. The retry composes with the
  packet-splitting above rather than multiplying it, because splitting happens
  before any call is made (while sizing the packet) and the retry applies only
  to the call itself; a split half gets its own single retry, never a multiple
  of the parent batch's. If the retry also fails, the batch degrades exactly as
  an unretried failure would — every candidate in it records a recovered
  provider issue and resolves to `needs-more-evidence`.
- The rule that refutes a finding reachable only by violating a declared type,
  signature, schema, or contract is load-bearing for precision and must not be
  relaxed without evidence. Removing its guard-rail — by exempting values that cross
  a trust boundary — was measured on the real-repository corpus: it admitted a
  correct finding the rule had suppressed, but adjusted precision fell from 100% to
  86.7% with two genuine false positives and no net recall gain, so it was reverted.
  A future attempt needs a mechanism that separates a type violated by an attacker at
  a boundary from one violated by a caller that cannot exist.
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
- **No review agent call may forward prior conversation.** This MUST be the
  harness default, so a stage added later inherits it, and any stage that
  genuinely needs history MUST opt in at its own invocation, where the reason is
  visible. See *Conversation History* below.
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

### Conversation History

This requirement arrived under `21-independent-sampling.md` and is **independent of
that spec**. It is recorded here because it is a property of how this harness
invokes every agent, not of any one stage, and it must survive spec 21's
withdrawal.

The harness forwarded the accumulated session conversation into every review agent
call. What the calls actually received was captured at the provider boundary rather
than inferred: the harness appends each completed call's output to the shared
session as an `assistant` message, so a call arrived holding the JSON output of
every call that had finished before it — across tasks and across stages —
**attributed to the model itself**. A refutation call opened appearing to have
already asserted the very candidates it was about to adjudicate and, from the
second task onward, holding its own earlier verdicts, which is incompatible with
the refuter's own instruction to judge each candidate strictly on its own merits.
The semantic finding merge carried the same freight, as did discovery and the
context scout that has since been withdrawn.

**No review agent call forwards prior conversation.** Blindness is the harness
default rather than a per-invocation option, so a stage added later inherits it and
a stage that genuinely needs history must opt in at its own invocation, where the
reason is visible. The requirement is stated harness-wide for that reason: a
narrower, single-stage wording would permit a future stage to reintroduce the
defect without contradicting any spec.

Consequences, which must not be glossed:

- **The whole engine was re-baselined, not just discovery.** Every recall and
  precision figure recorded before 2026-07-27 was produced with history-carrying
  discovery, refutation, merge, and scout calls, and none of them is comparable to
  a post-change run. See *Standing Caveat On Every Figure Below* above.
- **The change is not an accuracy improvement.** The forwarded conversation was
  removed because it contradicts what those stages are specified to do, not because
  it was shown to be harmful. The paired re-baseline measured **−0.00pp** recall
  (CI [−3.13, +2.71], p = 0.56) and a **26% cost reduction**. The cost reduction is
  the real, measured benefit; the accuracy claim is that nothing moved.

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
- admission must also receive the absolute line range of the source chunk each
  review task was given, and must reject as `location-invalid` a candidate whose
  location falls outside the chunk of its own task. The whole-file range cannot
  catch this: a chunk-relative number from a split file still lands inside the
  file. A file that fits in one chunk has a chunk range equal to its whole-file
  range, so this check never changes single-chunk admission; a task with no chunk
  provenance for the path (for example a deterministic candidate) is not checked;
- `reporterEligibility = inline` is allowed only for findings whose line range is
  valid in reviewed head-file content, whose location can be anchored on the new
  side of the change, and whose severity meets the configured inline threshold;
  old-side findings are never anchorable;
- when repository intake provides `DiffMap[]`, `reporterEligibility = inline`
  is allowed for a new-side finding only when its line range overlaps a changed
  diff hunk for the same path;
- a whole-file finding (`side = "file"`, the shape every model-origin candidate
  carries because discovery shows the model line-numbered file content rather
  than diff sides) is anchorable only when its reported `startLine` falls inside
  a reviewed diff hunk for the same path. Admission decides this because it is
  the only stage holding the reviewed diff ranges; discovery must not reclassify
  a location as `side = "new"` on a guess. With no diff ranges at all, no
  whole-file finding is inline-eligible, because nothing proves the line changed;
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
- old-side findings, and whole-file findings whose line falls outside every
  reviewed hunk, may remain in local reports when otherwise valid, but they are
  not inline PR comment candidates in R1. A defect a change merely exposes
  elsewhere in a changed file stays a reported finding; it simply has no changed
  line a review comment could anchor to;
- Markdown and SARIF outputs must render suggested fixes when present;
- SARIF output must render provider issues as redacted run metadata, not as
  diagnostic results, so CI consumers can inspect provider degradation without
  creating false code-scanning alerts;
- SARIF output must exclude `artifact-only` admitted findings from diagnostic
  results and driver rules so weak/refuted/provider-diagnostic output cannot
  become code-scanning alerts;
- Markdown output must render `artifact-only` admitted findings as UNRESOLVED
  items a human can decide on, carrying the severity, category, location,
  description, and the recorded reason the candidate stayed unresolved (its
  refutation verdict and rationale). A suspicion the engine could not settle —
  most often because the evidence sits outside the context it could reach — is
  reported for a human to confirm or dismiss rather than reduced to an
  identifier. These items stay out of the quality gate and out of inline
  comments, so surfacing them neither blocks a build nor adds review noise;
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

## Severity Rubric

Severity is a property of a **finding**, not of the run that produced it and not
of anyone's confidence that the code is wrong. It answers exactly one question:
how bad is it if this defect stays in the code? This section is the single
normative definition of that answer. Every producer assigns severity by this rule
-- model discovery, trusted deterministic rules, and anything that restates a
finding downstream -- and every consumer reads that one meaning: the admission
floor below, inline-comment eligibility, quality-gate counts, report ordering,
and the `severityAccuracy` measurement in `06-evaluation-and-quality-gates.md`.
The rubric lives here rather than in the evaluation spec because a finding
carries a severity into a user-facing report whether or not an evaluation ever
runs; it lives here rather than beside the `Severity` enum in
`03-contracts/finding-evidence-report.md` because that spec's own source rule
scopes it to shapes that a schema can validate, and an assignment rule is a
judgement no schema can express.

Severity is the product of two independent judgements: **impact**, the worst
consequence that follows from the defect's own contract, and **reachability**,
how much has to be true -- beyond the containing code running at all -- before
that consequence occurs. Neither axis is about how likely the reviewer is to be
right.

### Impact Bands

| Band | Meaning |
| --- | --- |
| Control defeated | An untrusted party acts as a principal it is not, reads or writes state it must not, or has input of its choosing interpreted as code or protocol. Also: persisted data destroyed or corrupted, or the service permanently stops serving. |
| Silently wrong | The unit returns, stores, or transmits a wrong result, or does not perform a function it states it performs, and the caller gets no signal that this happened. An unbounded resource leak belongs here: nothing reports it until the resource is gone. |
| Signalled or bounded | The outcome is wrong or degraded, but the caller can see it -- an error, a refused request, a visible failure -- or the effect is bounded and self-correcting. |
| None | No behavioural difference at all. Readability, naming, or consistency only. |

Two rules make the impact band decidable when the reviewed code is a reusable
component rather than a whole application, which is the usual case:

- Judge the consequence that follows from the reviewed unit's **own** stated
  contract. Where the worst outcome additionally needs the calling application to
  make a further decision of its own, the band drops by one. A function
  contracted to return a trustworthy value that returns a caller-controlled one
  instead is *silently wrong*; it is *control defeated* only where the unit
  itself is the thing that grants, denies, escapes, or binds.
- A missing defence-in-depth measure, whose absence causes harm only after
  another independent failure, is *silently wrong*, not *control defeated*.

### Reachability Bands

Count the conditions that must hold beyond the containing function being called
at all. Input that an untrusted party supplies for itself counts as **no**
condition, because an untrusted party will choose the value that triggers the
defect.

| Band | Meaning |
| --- | --- |
| Routine | No further condition, or only values an untrusted party supplies itself. The defect fires on the ordinary path. |
| Conditional | Exactly one further legitimate condition: an error path, an opt-in setting, an uncommon but supported input from a trusted caller, or a concurrent interleaving that ordinary load produces. |
| Remote | Two or more independent further conditions, or a single condition that a correct deployment is expected to avoid. |

### The Matrix

| Impact \ Reachability | Routine | Conditional | Remote |
| --- | --- | --- | --- |
| Control defeated | `critical` | `high` | `medium` |
| Silently wrong | `high` | `medium` | `low` |
| Signalled or bounded | `medium` | `low` | `low` |
| None | `info` | `info` | `info` |

### Boundary Cases

These are the cases that produce disagreement between two competent reviewers.
The rubric decides them, and the decision is normative:

- **A defect on an error path.** The error path counts as exactly one condition,
  never as a disqualification: error paths execute in production, and the reason
  they are under-reviewed is the reason they hold defects. A resource leaked on
  every failed call is *silently wrong* plus *conditional* -- `medium` -- and
  becomes `high` only if the leak also occurs on the success path.
- **A defect requiring an unusual input.** An unusual input from a *trusted*
  caller is one condition (`conditional`). An unusual input from an *untrusted*
  party is no condition at all (`routine`), because choosing it is free. This
  distinction, not the strangeness of the input, is what separates the two.
- **A defect that is certain but low-impact.** Certainty never raises severity.
  A defect that fires on every call but whose worst outcome is *signalled or
  bounded* is `medium`, and one whose outcome is *none* is `info` no matter how
  provable it is.
- **A defect that is severe but hard to reach.** A *control defeated* outcome
  behind two independent unusual conditions is `medium`, not `high`. Severity is
  not a synonym for defect class: an injection or disclosure defect that a
  correct deployment's configuration already prevents ranks below a silent
  wrong-result defect that fires on every request.
- **`critical` is deliberately rare.** It requires the worst outcome to be
  reachable with no further condition at all. A defect whose exploitation waits
  on an opt-in setting, a specific deployment shape, or a decision the calling
  application makes is `high`.

Two prohibitions follow, and both are requirements rather than advice. Severity
must not be rounded up to clear a threshold: a finding is assigned the band this
rubric produces, and if that band is below the actionable floor, the correct
outcome is a recorded below-threshold rejection, not an inflated label. And
severity must not be raised because a finding's evidence is strong or lowered
because it is thin; that judgement belongs to refutation and admission, which
decide whether the finding exists at all.

### Measured Outcome Of The Severity Rubric

The discovery prompt implements this rubric, and the pair was measured together on
the 36-case corpus, three seeds per arm, with the actionable threshold lowered to
`low` on both arms as this spec's evaluation counterpart requires.

Severity agreement moves from 48.5% (48 of 99 checks) to 55.0% (61 of 111), a gain
of 6.5 percentage points at z = 0.94, p = 0.35. **That is directional, not
established.** Recall is unharmed at 46.3% against a 46.7% default-floor baseline,
and adjusted precision is unchanged.

Cost is a 2.5% increase on warm runs. The first treatment run cost noticeably more
because changing the prompt invalidates its cached prefix; that is a one-off on any
prompt edit and not a property of the clause.

The clause ships despite the result being inconclusive, because the argument for it
is not the measurement. This spec now defines severity normatively, and the previous
prompt clause did not implement it: its `high` band read "a defect that produces
wrong results, a security weakness, or a failure on a realistic path, that would
block release", which covers nearly anything worth reporting, while `medium` was
defined only negatively. A reviewer following it literally rates almost everything
`high`, which is what nineteen archived runs show — 96% agreement with a `high`
expectation, 4% with a `medium`, none with a `low`, and no `critical` or `low`
findings emitted at all. Leaving that clause in place would be a spec violation
whatever the metric said. The measurement's role was to establish that implementing
the spec costs neither recall nor precision, and it does not.

## Semantic Finding Merge

Discovery may produce several candidates that describe one underlying defect.
This happens whenever more than one call examines overlapping code — the additive
security pass, and any future decomposition of a file into overlapping review
units — and it also happens within a single call, which may restate one defect at
neighbouring lines.

Before admission, candidates for the same file MUST be grouped by whether they
describe the **same underlying defect**, and each group MUST be reduced to one
admitted finding.

**Positional identity is not sufficient and MUST NOT be the test.** Two findings
one line apart are frequently one defect; two findings on the same line are
frequently two defects — a missing null check and a wrong comparison operator on
one expression are distinct problems a reviewer needs both of. A line-distance
threshold fails in both directions, and it fails silently in the direction that
loses a real defect.

The grouping decision is therefore semantic and is made by a model call that
reads the candidate descriptions. That call:

- Receives the candidates for one file, together with the file, and returns
  **groups**. It MUST NOT be asked which candidate to discard.
- MUST treat proximity as no evidence at all. Two candidates are the same defect
  only when they share a root cause *and* a code element. Distinct defects that
  happen to sit near each other are separate.
- MUST default to NOT grouping when uncertain. The costs are asymmetric: a wrong
  merge silently removes a real defect from the review, while a missed merge
  produces a redundant comment. The visible failure is the acceptable one.
- MUST remain generic and language-neutral, per the Non-Negotiable in spec 15.

Selection of the representative candidate from a group is **deterministic and
made in code**, not by the model: highest severity first, then the most specific
location, then the lowest candidate index. Non-representative members of a group
are recorded, not silently dropped, so the merge is auditable and its rate
observable.

This stage MUST be a separate model call from refutation. Refutation asks whether
a finding is true; merging asks whether two findings are one. Combining unrelated
judgements into one call is a documented cause of degraded refutation quality.

The evaluation's own duplicate detection MUST remain independent of this
mechanism. If scoring reused the product's merge, a defective merge would conceal
itself.

### Why This Exists

Merging was previously deduplication by model-assigned `id` plus the security
pass's additive `(path, line)` rule. Neither asks whether two findings describe
the same defect, and the gap is measured: across nine archived runs, 89 of 164
unlisted-real findings (54.3%) sat within three lines of a finding already
matched in the same file. In one case the engine emitted six findings per file —
three phrasings of one line, three of the next — for a single nil dereference,
halving raw precision in the affected runs.

It is also a prerequisite for decomposed discovery. Reviewing a file as several
units and unioning the candidates produces duplicates by construction: the same
defect described from two units, at two anchors, by two calls that never see each
other's output. Merging by `id` cannot help because the ids come from different
calls, and merging by `(path, line)` cannot help because the anchors differ.
Without this stage a recall gain and triplicated findings are indistinguishable
in the measurement.

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
- a baseline entry and an admitted finding match when they share at least one
  fingerprint with the same `algorithm` and `value`;
- mark admitted findings as `new`, `existing`, or `unknown`;
- calculate resolved baseline entries when configured baseline data contains a
  fingerprint absent from current admitted findings;
- `qualityGate.failOnNewOnly` must consider only `new` findings when baseline
  is enabled and configured to fail on new findings only;
- baseline reads and writes must use `path-service` and remain under repository
  root.

## Baseline Generation

The baseline file is produced by the product, not hand-authored.

Rules:

- `codereviewer baseline write` reads a completed `report.json` and writes the
  configured `baseline.path` as the baseline file contract defined in spec 03;
- the source report defaults to the most recent run recorded in the run index
  and may be overridden with an explicit report path;
- the command writes every admitted finding's `fingerprints` array verbatim; it
  must not recompute fingerprints, because recomputation without the original
  source state would produce values that cannot match a later run;
- the command fails with `baseline_source_unavailable`, category `repository`,
  exit code 3 when no source report can be resolved;
- writing the baseline is an explicit operation. The `review` command must never
  write the baseline file, so that a review run cannot suppress its own
  findings.

## Run Index

Run artifacts are addressable across runs.

Rules:

- each completed or partially completed run writes `index.json` at the root of
  the artifact directory, containing an ordered list of run entries with `runId`,
  `startedAt`, `completedAt` when known, `status` (`completed` or `failed`),
  and the repository-relative `reportPath` when a report was written;
- the newest entry is first; the index is capped at 50 entries and older entries
  are dropped from the index only, never deleted from disk;
- index writes use `path-service` and stay under the artifact directory;
- a corrupt or unreadable index is replaced with a fresh single-entry index
  rather than failing the run, because artifact bookkeeping must not fail a
  review that otherwise succeeded.

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
| Intake fails with `merge_base_unavailable` instead of diffing `baseRef` to `headRef` directly | repository intake unit tests |
| Paths work on POSIX and Windows forms | unit tests |
| Provider missing error is actionable | provider-resolution unit test |
| Harness workflow uses hermetic provider fixture | workflow integration test |
| Admission rejects weak/internal candidates | admission and promotion matrix test |
| Semantic merge groups restatements of one defect and keeps distinct defects on one line apart | semantic merge unit tests |
| Semantic merge issues no call below two candidates and degrades to no grouping on failure | semantic merge unit tests |
| Semantic merge runs only once every candidate for a task exists, ahead of refutation and admission | holistic task review unit tests |
| The group representative is chosen in code by severity, then location specificity, then candidate index | semantic merge unit tests |
| Merged-away candidates stay on the record rather than disappearing | handler test |
| Merged-away candidates are held out of refutation and admission | handler test |
| A candidate whose line falls outside its own task's source chunk is rejected as `location-invalid` | admission gate unit test |
| Baseline write copies fingerprints verbatim and cannot be triggered by `review` | baseline writer and CLI baseline command tests |
| Run index caps entries, keeps the newest first, and survives a corrupt index | run index unit tests |
| Reports include admitted findings plus clearly marked artifact-only/refuted/provider-issue sections | report snapshot test |
| Context ledger records included source chunks without raw content | context ledger unit and snapshot tests |
| Completed reports include complete coverage certificate | runner and report schema tests |
| Packet overflow fails before provider call without trimming | workflow regression test |
| Baseline marks new/existing/resolved findings deterministically | baseline fixture tests |
| No raw source in default logs | log snapshot/redaction test |
| Provider task failure writes artifact-ready partial state | runner partial-failure regression test |
| Model candidate cannot become actionable without passing refutation | refutation workflow test |
