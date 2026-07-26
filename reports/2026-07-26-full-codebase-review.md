# Full codebase review — 2026-07-26

## Verdict

The intended architecture is unusually well considered: provider isolation, Zod
at many public boundaries, read-only repository access, redaction, a
deterministic admission stage, and hermetic tests are all strong foundations.
The main risk is not classic spaghetti code. It is that several important
contracts are only *nominally* deterministic: source locations can be wrong,
the only proof attached to a model finding can be another model's rationale,
and some optional review/context capabilities are incomplete or disconnected.

Do not spend the next iteration on another generic discovery prompt/pass. First
repair the correctness and evidence chain below, then make the evaluation
artifact trustworthy enough to measure a genuinely new multi-defect mechanism.
With the current handoff result (high precision, moderate recall, one-finding
per-file behavior), this is the shortest path to a credible, maintainable code
review product.

## Scope and method

Read-only review of `src/`, `specs/`, `docs/`, CLI/configuration, prompts,
evaluation/corpus code, and git history. Findings were checked against the
approved specs rather than inferred from comments alone. External research was
used only for the product-direction section.

Verification completed:

- `npm run typecheck` — passed.
- `npm test` — 151 files / 844 tests passed.
- `npm audit --omit=dev --json` — no production dependency vulnerabilities.

Passing tests do not invalidate the findings: the key paths below have no
regressions for large-file line anchoring, discovery-to-refutation context
handoff, or end-to-end model-origin inline-comment eligibility.

## Prioritized findings

| ID | Finding | Impact | Effort | Confidence |
| --- | --- | --- | --- | --- |
| P0-1 | Large-file chunks reset source line numbers | Incorrect report/comment anchors and baseline identity | M | High |
| P0-2 | Model findings are never inline-eligible | Main output cannot become PR inline comments | S | High |
| P0-3 | Admission accepts model rationale as its only proof | Precision gate is self-attesting rather than source-proved | M | High |
| P0-4 | Scout/retrieved context is absent from refutation | Correct cross-file candidates are downgraded or unprovable | M | High |
| P0-5 | Evaluation cost/latency omit judging and calibration | Quality/cost decisions are materially misleading | M | High |
| P1-1 | Context scout violates its specified compact-inventory contract | Costly, weakly scoped feature explains measured neutrality | M | High |
| P1-2 | Scout injection can bypass the final input budget | Provider failure, truncation, and unstable cost | S | High |
| P1-3 | `thorough` does not implement its semantic-risk planning contract | Users pay more without promised coverage | M | High |
| P1-4 | Evaluation runs all cases without a case-level concurrency limit | Rate limits and irreproducible measurements | M | High |
| P1-5 | CLI evaluation gate is deliberately unusable | Evaluation cannot be a usable CI health gate | M | High |
| P1-6 | Semantic matching is greedy rather than globally optimal | Under-counted recall/misclassified findings | M | High |
| P1-7 | OTel “enabled” exports no telemetry | Operational control is inert | L / remove S | High |
| P1-8 | Review contracts are owned by the admission domain | Inverted ownership and high-fan-out coupling | M | High |
| P2-1 | Severity is never validated/corrected by refutation | Known 43% severity accuracy drives gates and triage | M | High |
| P2-2 | Model output compatibility aliases hide malformed protocol responses | Silent loss/normalization and duplicate category semantics | S–M | High |
| P2-3 | Evaluation provenance and hydration are insufficient | A comparison may not represent the same code/config/model | M | High |
| P2-4 | Several documented configuration paths are no-ops/dead | User confusion and permanent compatibility burden | S | High |
| P2-5 | Requested model change-intent summary silently falls back | Unexplained quality/cost variance | S | High |
| P2-6 | No unused-code check in normal typecheck | Refactor residue accumulates in critical modules | S | High |

### P0-1 — Preserve absolute source locations through chunking

Evidence: `src/domains/review-workflow/run/context/context.ts:117-150` turns
source into plain string chunks; `:359-365` retains no starting-line metadata.
`src/domains/review-workflow/pipeline/discovery/holistic-task-review.ts:180-185`
then numbers every chunk from one, and `:384-398` uses the returned line as a
file location. Admission validates only that the line exists in the *whole*
file (`src/domains/admission/admission-gate.ts:169-184`).

Impact: a second-or-later chunk can produce a valid-looking location that points
at unrelated code. This corrupts PR anchors, fingerprints/baselines, and user
trust—the most important properties for a reviewer.

Recommendation: create a canonical `SourceChunk` schema with `path`, `content`,
`startLine`, `endLine`, byte range, and content hash. Render absolute numbers;
reject a candidate outside its chunk interval; preserve the chunk/evidence link
into refutation. Test a multi-byte UTF-8 file with a proven finding in chunk two.

### P0-2 — Promote model findings on changed lines to `side: new`

Evidence: every model finding is created with `side: 'file'` in
`src/domains/review-workflow/pipeline/discovery/holistic-task-review.ts:389-395`.
Inline eligibility requires `side === 'new'` in
`src/domains/admission/admission-gate.ts:192-212,288-300`, and comment drafting
requires inline eligibility in `src/domains/reporting/review-comments.ts:102-109`.

Impact: the primary model-backed output is always summary-only, even when it is
precisely on a changed line. This contradicts the review-comment product
surface described by `specs/13-review-comments-and-suggestions.md`.

Recommendation: after validating the absolute location, deterministically mark
the candidate `new` when its range overlaps a new/modified diff hunk; retain
`file` for exposed whole-file defects. Add one end-to-end test: discovery →
refutation → admission → GitHub/GitLab/Bitbucket draft.

### P0-3 — Require source-grounded proof for model-origin admission

Evidence: discovery candidates start with `evidenceIds: []`
(`holistic-task-review.ts:384-398`). The refuter creates a `model-rationale`
record from its own explanation (`pipeline/refutation/evidence.ts:21-36`) and
adds it to a proved candidate (`:58-97`). The admission gate accepts that record
as the required evidence (`admission-gate.ts:457-473`).

Impact: the deterministic gate proves format, scope, redaction, and policy—but
not the source proposition. A correlated hallucination from discovery and
refutation can pass as an actionable defect.

Recommendation: define a source-proof reference in the canonical review
contract: reviewed path, absolute range, evidence/context-ledger ID, and a
bounded proposition. A model rationale may explain it but can never be the sole
admission evidence. Make unavailable proof route to `needs-more-evidence`, not
actionable output. This will temporarily reduce recall; that is an honest cost
of making “proved” mean something auditable.

### P0-4 — Carry dynamic discovery context into refutation

Evidence: the context scout returns a rendered string only
(`pipeline/discovery/context-scout.ts:187-207`); discovery appends it only to
its prompt (`holistic-task-review.ts:485-506`). Refutation reconstructs context
solely from `task.reviewContext` (`pipeline/refutation/packet.ts:66-96`), which
never receives scout bodies or cross-file tool results. The discovery harness
records only retrieval counts (`harness/model-backed-harness.ts:73-86`).

Impact: a candidate correctly discovered using an unchanged definition is often
unprovable by the precision filter. This makes both measured optional
cross-file approaches look worse than their intended designs.

Recommendation: return structured `RetrievedContextDocument` values and
evidence IDs, not a display string. Persist them task-scoped, redacted,
budgeted, and ledgered; include exactly the cited documents in refutation. Test
that a cross-file fact can be discovered, proved, and reported without allowing
the refuter broader repository access.

### P0-5 — Measure the whole evaluation, not only the review call

Evidence: cases run concurrently in `src/cli/index.ts:708-727`; semantic,
plausibility, and calibration work runs later in
`src/domains/evaluation/eval-runner.ts:852-875,1296-1325`. Judge usage is
discarded (`eval-semantic-judge.ts:84-108`,
`eval-plausibility-judge.ts:149-173`), while `metrics.ts:716-722` aggregates
only review-report usage/duration. `specs/06-evaluation-and-quality-gates.md`
defines duration as wall-clock run duration.

Impact: the reported cost/tokens omit the calls used to declare precision;
reported duration is summed review duration, not elapsed evaluation time. A/B
cost or latency choices are not defensible.

Recommendation: record typed per-stage usage/timing (`review`, `semantic
matching`, `plausibility`, each calibration), plus one monotonic top-level
elapsed duration. Render both totals and breakdowns; mark missing usage
explicitly. Use a fake clock/provider test to show parallel duration is not
summed as wall time.

## Correctness, reliability, and evaluation findings

### P1-1 — Restore the context scout’s inventory boundary

The approved contract gives the scout a diff plus a compact deterministic symbol
inventory and no file bodies (`specs/18-context-scout.md:32-40`). The actual call
passes `baseReviewText`, which includes full changed files
(`holistic-task-review.ts:172-187,485-502`); no inventory is built. Its resolver
accepts arbitrary model-supplied names/paths when otherwise eligible
(`context-scout.ts:82-117`).

Build a schema-derived `SymbolInventoryEntry` from deterministic
import/declaration facts and pass only diff + inventory. The model should return
an inventory ID, never a raw path. This both restores the spec/security boundary
and turns the scout into the small selection call that was actually measured.

### P1-2 — Enforce a final budget after optional context is added

Task packets are budget-checked before scouting
(`pipeline/discovery/task-packet.ts:23-57`). Scout content is appended later;
configuration allows up to 40 × 40 KB bodies
(`shared/contracts/config/config.schema.ts:84-95`), with no aggregate cap.

Represent dynamic context as packet content, select the ranked bodies that fit
the remaining final budget, and ledger retained/omitted IDs and bytes. A packet
must never become invalid after it has passed admission to a provider call.

### P1-3 — Make `thorough` true to its contract or remove the promise

`specs/05-review-workflow-and-runtime.md:125-130,206-217` requires bounded
semantic-risk work for `thorough`, including policy task capability. The
implementation exposes only `file | dependency-cluster`
(`review-planning/task-planner.ts:16-35`); its fast path differs, but balanced
and thorough use the same planning path (`:296-325`).

Either implement bounded deterministic semantic-risk tasks and measure their
incremental value, or amend the approved spec/docs so `thorough` clearly means
larger budgets only. Do not retain an expensive mode that promises coverage it
does not create.

### P1-4 — Bound evaluation-case concurrency separately from task concurrency

`eval run` uses unbounded `Promise.all` over cases
(`src/cli/index.ts:708-727`). `--max-concurrent-tasks` only changes
in-case review parallelism (`:583-613`), a limitation documented at
`docs/05-quality/running-an-evaluation.md:117-121`.

Add `evaluation.maxConcurrentCases` and `--max-concurrent-cases`, defaulting
conservatively for provider-backed runs. Use the existing ordered bounded mapper
pattern and test observed peak concurrency. This is required before interpreting
latency, rate-limit, or seed-variance experiments.

### P1-5 — Replace the intentionally failing evaluation exit gate

The CLI hard-codes 100% recall and zero *raw* false positives
(`src/cli/index.ts:746-751`), despite `EvalRegressionThresholdsSchema` already
supporting thresholds. Docs explicitly tell users not to trust this exit code
(`docs/05-quality/running-an-evaluation.md:141-180`).

Move approved threshold profiles into config/CLI. Separate “measurement completed
and judges were trustworthy” from “quality regressed.” Retain perfect raw scores
only as an explicit `strict` profile; otherwise normal evaluations cannot serve
as a CI quality gate.

### P1-6 — Use globally optimal semantic matching

`eval-matcher.ts:201-260` greedily assigns the first accepted finding to each
expected issue and permanently claims it. A later expected issue can therefore
lose its only compatible finding, although another finding could have satisfied
the earlier one.

Cache pair judgments, then apply deterministic maximum-cardinality bipartite
matching with documented tie breaking. Add the collision regression where A
matches 1/2 and B matches only 1. This corrects metrics without changing the
reviewer.

### P1-7 — Implement or remove the inert OpenTelemetry feature

With telemetry enabled, preflight calls setup only
(`run/preflight.ts:56-65`). Setup imports SDK packages and returns metadata but
creates no provider/exporter/spans and has no shutdown/flush
(`observability/open-telemetry.ts:46-75`). Specs require optional no-content
trace export (`specs/07-security-privacy-operations.md:312-320`) and docs
advertise it.

Before release, either remove the enabled configuration and docs, or introduce a
narrow exporter interface, allowlisted no-content attributes only, provider
shutdown in a `finally`, and a fake-collector integration test. This is an
operator-facing trust feature, so a metadata-only implementation is worse than
an absent feature.

### P1-8 — Fix hydration/provenance before trusting cross-run comparisons

Benchmark hydration writes `slice.json` before file materialization and reuses a
cache after checking only marker/type/first file
(`domains/evaluation/benchmark-hydration.ts:395-433,495-531`). Real-corpus
hydration already demonstrates stronger manifest equivalence
(`real-repo-corpus-hydration.ts:301-338`). The eval report records selection but
not corpus digest, effective config, provider/model, reviewer version, or
execution settings (`eval-report-contracts.ts:182-187`).

Hydrate to a temporary case directory, validate every file and a pinned
commit/diff/content-hash manifest, then atomically rename. Embed source-safe
manifest digest, effective config hash, provider/model, build ID, and concurrency
settings in reports. Refuse comparison of incompatible provenance unless the
caller explicitly overrides it.

### P1-9 — Make refutation metrics identity-based

`eval-runner.ts:627-630` retains aggregate proof/rejection counts. `metrics.ts:
640-657` derives refutation false positives/negatives with `min`/`max` formulas,
not candidate-to-finding identity, despite the spec requiring the latter.

Retain an internal `ScoredFinding` identity graph linking candidate, refutation,
admission, semantic match, plausibility, and fix outcome. Derive all rates from
that graph; the current formula is a proxy, not a measurement.

### P1-10 — Surface failed fix-lane runs as failures

`cli/eval-case-runner.ts:123-166` catches any fix-lane error and returns no
outcomes. `eval-runner.ts:225-253` treats no outcomes as skipped and metrics get
zero denominators. Return a typed stage error/provider issue and render it as an
error; only disabled/no-eligible work should be “skipped.”

### Additional verified measurement and runtime gaps

- **Enforce profile-aware expectations.** `semantic-only` expectations are
  permitted only for benchmark-compatible data by
  `specs/06-evaluation-and-quality-gates.md:99-102`, but
  `eval-fixture.schema.ts:106-173` accepts them for every source profile. A
  project or real-corpus case can therefore bypass path/line matching and inflate
  recall. Add an enclosing-case refinement and reject it outside the approved
  profiles.
- **Generate real report timestamps.** The CLI passes a fixed generated-at value
  at `src/cli/index.ts:752`, which makes archived reports hard to order/audit.
  Let the runner timestamp production reports; retain fixed timestamps only in
  test fixtures.
- **Harden judge packet handling.** Semantic and plausibility judges directly
  interpolate untrusted source/finding strings without an explicit data-only
  instruction (`eval-semantic-judge.ts:34-49,84-95`;
  `eval-plausibility-judge.ts:66-85,149-159`). The latter takes the first 64 KiB
  even for a finding near the end of a large file. Delimit untrusted fields,
  assert that embedded instructions have no authority, and use a redacted
  location-centred window.
- **Forward the CLI provider-import seam.** `RunReviewOptions` accepts and
  forwards `providerImport` within the review runner, but the CLI review call
  omits it (`src/cli/index.ts:330-340`), while eval forwards it
  (`src/cli/eval-case-runner.ts:95-120`). This breaks a declared hermetic adapter
  seam for normal `review`; forward it and add a CLI regression test.
- **Make model-summary fallback observable.** Requested model summarization
  catches every provider-resolution failure and silently selects digest
  (`run/context/change-intent-context.ts:73-94`), even though only gather
  failures become warnings. Return a typed fallback reason/error code in the run
  report and evaluation artifact; availability may remain non-fatal, but changed
  context quality must not be invisible.

## Architecture, contracts, duplication, and dead ends

### Move candidate/review packet contracts out of admission

`admission-gate.ts:26-55` owns `CandidateFindingSchema`,
`ReviewedLineRange`, and `ReviewedDiffRange`, while planning and workflow import
them from admission. The architecture says admission must not own candidate
generation (`specs/01-architecture-and-structure.md:79-85`).

Create `src/shared/contracts/review/` as the one owner of candidate, source
chunk, diff range, dynamic-context, and proof-reference schemas/types. Admission
should own only promotion, fingerprinting, and admitted/rejected outputs. This
is the central type-alignment refactor; do it before adding more stages.

### Promote the context ledger into a shared contract

The ledger is owned by `review-planning/context-ledger.ts` but consumed by
evaluation, retrieval, workflow, and shared context. It uses loose strings for
path/task ID (`:38-48`) instead of the canonical primitives. Move its schema and
factory to `shared/contracts`, use `RepositoryRelativePathSchema`, `TaskIdSchema`
and `ContextLedgerIdSchema`, then generate/drift-test its artifact form.

### Replace permissive model-output recovery with a versioned protocol

`pipeline/agent-contracts.ts:314-410` accepts numerous field aliases
(`path`/`filePath`/`file`, several line names), converts values from arbitrary
shapes, and drops malformed optional fields with `.catch(undefined)`. Category
normalization also has two inconsistent inference routes: terms such as race,
lock, and concurrency map differently in prose versus explicit category aliases
(`:151-250`). This is a backward-compatibility workaround at an internal
model-protocol boundary, without versioning or quality telemetry.

Use a strict versioned provider-output schema as the canonical contract. If
recovery is needed for a provider, put it in a small adapter with one declarative
alias taxonomy and emit typed recovery/drop counters. Fail a malformed response
as a recovered provider issue rather than silently changing its meaning.

### Remove or implement dead/no-op paths before release

- `run/planning/task-planning.ts:35-44` has an intentionally empty
  trusted-rule template map; the candidate-generation machinery below is
  unreachable. Remove it until a versioned trusted-rule registry and evaluation
  corpus exist.
- `reporting.sarif.redact`, `security.signals.enabled`, and
  `evaluation.enabled` are accepted but no-op; docs themselves acknowledge
  parts of this (`shared/contracts/config/config.schema.ts:395-415`,
  `docs/03-concepts/pipeline/08-reporting.md:119-120`,
  `docs/01-overview/status-and-limitations.md:61`). Remove them before public
  release or fully implement them. A trust tool must never imply a switch is
  active when it is not.
- `review.mode` is deliberately report metadata only. It is consistently
  documented, so it is not a defect; still, avoid presenting it as a strategy
  selector in future interfaces unless behavior actually varies.

### Make the compiler catch refactor residue

Normal typechecking omits `noUnusedLocals` and `noUnusedParameters`. An audit
with those enabled identifies unused production symbols/imports in the review
runner, context assembly, candidate-review, agent contracts, verification agent,
and eval runner. Remove confirmed residue and enable the checks (with narrow,
documented exceptions rather than global suppression). Add a lightweight
dependency/unused-export check in CI after the initial cleanup.

### Retire duplicate projection pipelines in evaluation

`eval-runner.ts` (1,366 lines) separately assembles metric and report
projections; `metrics.ts` is another 724 lines. This is the structural cause of
proxy metrics and lost usage/provenance. After P0/P1 metric repairs, create one
internal `EvaluatedCase` / `ScoredFinding` schema and derive metrics, report
contract, renderers, and comparisons from it. Do not make the Zod report schema
the working-domain object.

## Prompt and review-quality assessment

The base discovery prompt is good on untrusted-content framing and concrete
failure paths. Its weakness is not a missing checklist: it asks the model to
cover every class/path, but offers no observable mechanism that prevents it from
stopping after the first finding. The handoff’s measured result confirms that
failure mode, and extra general passes have already been neutral/costly.

Recommended prompt and pipeline changes:

1. Add a deterministic coverage plan to the *same* discovery call, generated
   from language-neutral facts: changed control-flow branches, state writes,
   external side effects, input/authorization boundaries, cleanup/error paths,
   and changed interfaces. Require a compact coverage-status item for each
   segment before findings are serialized. This is a hypothesis, not a claimed
   solution; measure it specifically on multi-defect cases.
2. State the actual output limit (12 general / 8 additive security) in the
   structured contract and prompt. `collectCandidates` currently stops at the
   cap (`holistic-task-review.ts:320-353`) without retained/overflow telemetry.
   Record raw, parseable, retained, duplicate, and cap-overflow counts; otherwise
   cap loss is indistinguishable from model recall loss.
3. Make the refuter validate source proof, severity, reachability, and impact
   independently. Add `validatedSeverity`, impact scenario, and proof references
   to its output; do not merely preserve the discovery severity. This directly
   addresses the reported ~43% severity accuracy.
4. Keep the prompt-injection guard, but add the equivalent untrusted-data
   framing to evaluation judges. `eval-semantic-judge.ts:34-49,84-95` and
   `eval-plausibility-judge.ts:66-85,149-159` interpolate untrusted finding/source
   text without that framing. The plausibility judge should use a redacted,
   location-centred bounded window, not the first 64 KiB of a file, so late-file
   evidence remains visible.
5. Define an internal evidence-quality state, not a synthetic confidence score:
   source anchor exists, refutation source proof exists, dynamic context used,
   location valid, and model/provider diversity. Use it to route weaker claims
   to “needs human decision” and audit precision escapes.

## Product strategy: how to improve recall without sacrificing trust

### What not to do

- Do not re-enable enumeration or diverse-lens calls merely because recall is
  low: the handoff measured both as neutral/costly.
- Do not default to agentic repository browsing: the handoff measured it net
  negative, and the present handoff to refutation is incomplete anyway.
- Do not optimize headline recall against incomplete fixture keys. Preserve the
  unlisted-real process, but improve its provenance and periodically sample it
  for human adjudication.

### Next experimental sequence

1. **Instrumentation and corpus first.** Grow the full-checkout corpus,
   deliberately oversampling two-plus-defect files, late-file locations,
   cross-file dependencies, security authorization flows, and large diffs.
   Freeze every case with commit/diff hashes and include a human-reviewed
   evidence map. The present 42 findings / three seeds cannot resolve small
   quality changes.
2. **Repair the evidence/location path.** Complete P0-1 through P0-4 before
   comparing any optional-context method. These bugs can suppress correct
   findings or make them unactionable.
3. **Test one non-redundant multi-defect mechanism.** Deterministic coverage
   segmentation plus one holistic review—not a second generic reviewer. Compare
   it against baseline on a preregistered multi-defect slice and report per-file
   candidate count, cap overflow, recall, adjusted precision, latency, and cost
   across enough matched seeds to overcome observed variance.
4. **Improve severity only on matched findings.** Calibrate a small explicit
   impact/reachability rubric; compare severity only on the intersection of
   matched findings, never across configurations with different recall.
5. **Cost after behavior.** Stabilize static instruction prefixes and provider
   request shape to obtain prompt-cache hits where the selected provider
   supports them. Measure cached/uncached input tokens per stage; never claim a
   cache win without provider usage evidence.

### External evidence and comparable systems

The project’s direction is aligned with current evidence, but the external work
supports a few specific next steps:

- [SWRBench](https://arxiv.org/abs/2509.01494) uses manually verified PRs with
  full project context and reports that multi-review aggregation can improve F1.
  This supports a larger PR-centric corpus and testing aggregation, but it does
  **not** justify another generic pass after this project’s own negative result.
- [DependEval (ACL 2025)](https://aclanthology.org/2025.findings-acl.373/)
  documents substantial gaps in repository dependency understanding across
  models. This supports targeted, bounded evidence retrieval—not broad browsing
  and not treating a model’s assertion as repository proof.
- [ContextCRBench](https://arxiv.org/abs/2511.07017) reports that textual change
  context can matter more than extra code context and evaluates line-level
  localization. This supports the existing untrusted change-intent feature and
  the need to fix absolute anchors; it argues for measuring relevance, not
  maximising context volume.
- Google’s [AutoCommenter experience report](https://homes.cs.washington.edu/~rjust/publ/code_review_automation_aiware_2024.pdf)
  supports narrow, measurable automation for rules that admit clear proof. Use
  this as the bar for future deterministic trusted rules, rather than a broad
  untested rule engine.
- Comparable systems describe multi-stage, context-enriched review, e.g.
  [CodeRabbit’s architecture](https://docs.coderabbit.ai/overview/architecture)
  and [OpenAI’s case study](https://openai.com/index/coderabbit/). These are
  vendor claims, not independent benchmarks. The useful lesson is architectural:
  retrieval, reasoning, validation, and presentation need separate contracts and
  measurement; adding machinery without an evidence handoff is not progress.

## Recommended implementation order

1. **Truth and anchor repair (P0-1, P0-2, P0-3, P0-4).** Establish the
   `shared/contracts/review` boundary as part of this work. Add end-to-end tests
   for large-file location, proof citation, cross-file proof, and inline draft.
2. **Evaluation integrity (P0-5, P1-4, P1-5, P1-6, P1-8, P1-9, P1-10).** Build
   `EvaluatedCase`/`ScoredFinding` first, then migrate metrics/reporting from it.
   Do not compare old and new scores without an explicit metric-version marker.
3. **Remove false product surface (P1-3 decision, P1-7, no-op keys, dormant
   trusted rules).** Prefer removal to compatibility shims while the package is
   private and pre-release.
4. **Context scout repair and experiment (P1-1, P1-2).** Only then remeasure it
   on a fixed corpus. Do not default-enable it on a theoretical argument.
5. **Quality experiments.** Coverage segmentation, severity calibration, prompt
   caching, and independent-refuter policy each get one preregistered test,
   enough seeds, a matched metric definition, and a stop rule.

## Findings deliberately not raised

- No production dependency vulnerability was found by the audit command.
- The codebase is ESM-only and generally uses Zod at external boundaries; these
  are strengths to preserve.
- `review.mode` being metadata-only is documented consistently, so it is not
  classified as an implementation bug—only as product-surface complexity to
  avoid expanding.
- The disabled cross-file and security capabilities are not reported merely for
  being off by default; the report flags their concrete broken handoff/no-op
  behavior and spec drift.
