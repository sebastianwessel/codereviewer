# Analysis and plan: one configured run, a shared context spine, and closing the evidence gap

Written 2026-08-10. Analysis only — no code was changed for this document. Facts
below were gathered by three read-only surveys and every load-bearing claim was
re-verified by hand at the cited line; corrections against earlier session reports
are marked. Costs quoted are measured, on `openai/gpt-5.3-codex` unless stated.

---

## Part 1 — The verified evidence base

### 1.1 The product is three processes that never talk

In CI, one pull request triggers **three separate OS processes** — `review`,
`intent check`, `impact check` — spawned one after another by
`scripts/github/pipeline.ts:315-322` / `scripts/github/main.ts:57-87`, each with
identical `--base-ref`/`--head-ref`/`--config`. Work redone per push:

| work | times done | sites |
| --- | --- | --- |
| config load + validation | 3× | `command-config.ts:15` via each command |
| git intake (merge-base, diff, name-status subprocesses) | 3× | `repository-input.ts:55`, `impact-run.ts:440`, `intent-fulfilment-run.ts:311` → all `intake-service.ts:575` |
| changed-file content reads | 3× | review via `readChangedSourceFiles`; impact and intent each build a **fresh** `createContextRetriever` (`impact-check.ts:72`, `intent-check.ts:69`) |
| ast-grep deterministic-signal extraction | 2× | `deterministic-signals.ts:57` (review), `changed-symbols.ts:318` (impact) — same function, same files, re-parsed |
| external context ingestion (`gatherContextFragments`) | 2× | `change-intent-context.ts:336` (review), `intent-fulfilment-run.ts:345` (intent) — same providers, same changed files |
| provider/model resolution | 3–4× | `provider-workflow.ts:57`, `change-intent-context.ts:157`, `change-impact-lane.ts:72`, `intent-fulfilment-lane.ts:72` |

**No stage reads another stage's output. Anywhere.** The only composition is the
GitHub script stitching each subprocess's *stdout digest* into one comment after
all three exit (`pipeline.ts:334-357`). The impact report — the product's answer
to "consequences beyond the diff" — is written to disk and read by nobody in the
review workflow (the only "consumers" are two prose comments in `context.ts:343,368`
describing a future that was never built).

### 1.2 The verifier is starved by construction, and both of its evidence channels are dead

Measured this session (72-case security corpus; full write-up in
`2026-08-10-artifact-only-separation-result.md`, ledger 2026-08-10):

- Refutation verdicts over 3 archived seeds: **proved 192 / needs-more-evidence 45 /
  refuted 9**. The dominant cause of a silent review is "could not prove", not
  "disproved": 25% of reviews post nothing while only 7% found nothing.
- The parked (artifact-only) findings are **52% real**, worth **10.3pp recall**
  (63.1% → 73.4%), but promoting them wholesale takes genuine false positives from
  3 → 24 per 216 reviews.
- Mechanism, verified in code: `candidateFromFinding` hardcodes `evidenceIds: []`
  (`holistic-task-review.ts:422`) — **discarding the `evidenceIds` the model schema
  actually parses** (`agent-contracts.ts:507`; correction to the earlier report,
  which said the field didn't exist). Consequently the refutation packet's
  `evidence` filter (`packet.ts:121`) and `supportSignalCandidates` filter
  (`packet.ts:40`, requires `proposedBy !== 'review-agent'` while the sole
  candidate producer hardcodes `'review-agent'`) are **both always empty**. The
  refuter is instructed to "prove only when the provided context proves the
  finding" while holding two empty arrays.

### 1.3 Newly verified structural gaps (this analysis)

1. **Deterministic signal facts never reach discovery.** `review-packet.ts` renders
   only `file`, `referenced-definition` (:296), `analyzer-signal` (:329) and
   `change-intent` (:340). There is **no branch for `support-signal-output`**, and
   the holistic input is a single rendered `reviewText`
   (`agent-contracts.ts:525-529`) — so the facts are computed, ledgered, byte-counted…
   and never shown to the discovery model. Meanwhile refutation receives them as
   raw JSON (reviewContext passes wholesale, `packet.ts:117`). The exact inversion
   of change-intent, which reaches discovery but is deliberately withheld from
   refutation.
2. **Dead contract surface** (all verified zero-producer): 12 of 17
   `EvidenceRecord` kinds (`diff` exists only in a test fixture; `symbol`,
   `command`, `config`, `policy`, `data-flow`, `related-location`, `rule`,
   `baseline`, `deterministic-signal`, `proof`, `refutation` nowhere);
   `ContextLedgerKind` `diff`/`symbol`/`prior-artifact`; `reviewContext` kind
   `test-mapping`; the entire `DeterministicSignalSchema` contract (exported from
   `src/index.ts:111-112`, no producer, no consumer).
3. **Impact has a ready-made integration path.** The `analyzer-signal` pattern
   (`analyzer-signal-context.ts:55-158`) is an exact template: a new reviewContext
   kind is injected per task after context assembly, and because refutation only
   filters `change-intent` (`packet.ts:96-98`), a new kind reaches **both**
   discovery and refutation with no further wiring. `ImpactReliance` entries also
   map 1:1 onto the `analyzer-evidence.ts:43-79` evidence pattern.

### 1.4 Duplication is real but small — most suspects were already consolidated

Confirmed (each with a behavioral wrinkle, not just cosmetics):

| what | copies | note |
| --- | --- | --- |
| path+line overlap predicate | `packet.ts:14-23`, `corroboration.ts:46-52` (plus each its own `endLine ?? startLine` helper) | **behavioral difference**: corroboration normalizes paths, packet compares raw `===` — the packet copy can silently under-match |
| truncation-with-mark | `markCut` (`holistic-task-review.ts:375`) vs shared `truncateForContract` | `markCut` has a latent `slice(0,-1)` bug at `max<=1`, currently unreachable |
| sha256 bypass | `stable-json-digest.ts:64` uses `createHash` directly | trivial; the only bypass in the repo |
| severity enum re-declared | `scripts/github/report-digest.ts:19` | the one *closed* enum in a file whose looseness is otherwise a documented non-goal |

Refuted (do NOT redo): line-range overlap is already consolidated for its three
historical call sites (`shared/text/line-ranges.ts`); `createStructuredError`
already derives exitCode/recoverable from category by table with the signature
making overrides a compile error; there is exactly one path-safety implementation
(`platform/path-service.ts`); `uniqueSorted` exists and the remaining
`[...new Set]` sites are dedupe-only by intent. The `report-digest.ts` loose
mirrors, `clampEscaped`, and the three differently-shaped provenance schemas are
**documented non-goals** — leave them.

### 1.5 Ledger priors this plan must respect

- Attention levers closed (4 mechanisms), prompt-tuning closed (5 clauses, incl. a
  rejected impact-framing clause), model-tier closed. **What has never been tried
  is feeding the refuter data through its two structurally-empty channels** — those
  channels have been dead since inception, so no prior null covers them.
- Spec 05's refutation-retrieval failure (adjusted precision fell, FPs up) now has
  a candidate explanation: a refuter with no citation to check goes *looking* for
  support. Checking a supplied citation is a different mechanism — but the prior
  failure prices the risk and demands kill rules.
- Discovery yield is call-bound; sub-file splitting failed; one-finding-per-case is
  the selection constraint. Orchestration must not silently change call counts.
- 3 seeds resolve ~11pp; separator studies at n≈12/seed have 29–60% familywise
  false-alarm across plausible separators. Smoke-first ($0.24 for 6 cases), one
  full seed is $3.93.

---

## Part 2 — Target architecture

One configured run. Stages stay **distinct steps** (per the product decision) but
execute in **one process over one shared context**, in dependency order:

```
intake (git, files, config)          — once
  └─ deterministic signals (ast-grep) — once
  └─ context ingestion (fragments)    — once
       ├─ intent lane (advisory)      — obligations, verdict-free as today
       ├─ impact lane (deterministic tier) — dependents map
       └─ review
            ├─ discovery   ← change-intent + analyzer + signal facts + impact dependents
            ├─ refutation  ← candidate citations + analyzer/impact evidence + support signals
            ├─ admission → unified report (review + intent + impact sections)
            └─ platform adapter (GitHub) reads ONE artifact set
```

Principles:

- **Shared, not persisted.** A `RunContext` object (intake result, retriever with
  one file cache, signal facts, fragments, one provider session) threaded to
  lanes. No cross-invocation cache layer, no new storage — the dead
  `prior-artifact` ledger kind is removed, not resurrected.
- **Steps remain independently runnable.** `intent check` / `impact check` CLI
  commands survive as thin wrappers that build a `RunContext` and call the same
  lane functions — reuse, not duplication. The orchestrated one-go run is what CI
  calls; config's existing per-stage `enabled` flags (they all exist already:
  `intentFulfilment.enabled`, `changeImpact.enabled`, …) select the stages.
- **Advisory lanes stay advisory.** Intent remains verdict-free and non-blocking
  (spec 23 guarantee) even when embedded in the unified run; impact remains
  non-blocking (spec 22).
- **Information crosses stages through existing contract shapes** — reviewContext
  kinds and EvidenceRecords — never through prompt-clause wording (closed family)
  and never bypassing the untrusted-data framing.

---

## Part 3 — The plan, in waves

Ordering rule: zero-risk consolidation first, structure second (provably
behavior-neutral), measured information-sharing third (cheapest information
first), the big evidence A/B last — each measured item gated by a smoke and a
pre-registration. Every item is written to be executable by an autonomous agent
without this conversation.

### Wave C0 — consolidation and dead-surface removal (no provider calls, no behavior change except two latent-bug fixes)

| id | action | anchors | acceptance |
| --- | --- | --- | --- |
| C0.1 | Add `locationsOverlap(a,b)` (+ shared effective-end-line helper) beside `lineRangesOverlap`; route `packet.ts` and `corroboration.ts` through it. **Decide semantics: normalize paths** (the corroboration behavior) — the packet copy's raw `===` is the defective variant. | `shared/text/line-ranges.ts:15`, `packet.ts:14-23`, `corroboration.ts:46-52` | both call sites import the helper; a new test covers the `./`-prefixed path case that previously under-matched; full suite green |
| C0.2 | Replace `markCut` with `truncateForContract`. | `holistic-task-review.ts:375-376,415-416`, `shared/text/truncate.ts:27` | no `markCut` remains; suite green |
| C0.3 | `stableJsonDigest` calls shared `sha256`. | `stable-json-digest.ts:1,64` | zero `createHash` outside `shared/hash/hash.ts` |
| C0.4 | `report-digest.ts` imports the severity vocabulary (type-only) instead of re-declaring; leave every other loose mirror alone (documented non-goal at its lines 1-16). | `scripts/github/report-digest.ts:19`, `config.schema.ts:3` | one severity enum definition repo-wide |
| C0.5 | Remove dead contract surface: unproduced `EvidenceRecord` kinds **except** those Wave 2 will produce (keep `deterministic-signal`; add nothing yet), ledger kinds `diff`/`symbol`/`prior-artifact`, reviewContext `test-mapping`, and the unused `DeterministicSignalSchema` export. Update specs (auto-approved) + generated schemas. | §1.3 item 2 sites | grep proves zero references; schema drift check green; spec tables match code |
| C0.6 | Keep `AdmittedFinding.cwe`/`securitySeverity`/`relatedLocations`/`dataFlow` — 0/78 on the eval corpus reflects *no analyzer artifacts supplied there*, not dead code (`analyzer-ingestion` populates them). Record this in the spec so nobody deletes them on the same evidence I almost did. | `finding.schema.ts:260-265` | spec note present |

### Wave 1 — one-go orchestration (no provider-behavior change, proven by golden output)

| id | action | anchors | acceptance |
| --- | --- | --- | --- |
| 1.1 | Introduce `RunContext` built once per invocation: config, intake result, one `createContextRetriever` (shared file cache), signal facts, ingestion fragments, one provider resolution. Lanes (`runChangeImpact`, `runIntentFulfilment`, review runner) accept it instead of self-building. The redone-work table in §1.1 goes to 1× each. | `intake-service.ts:575`, `impact-check.ts:69-93`, `intent-check.ts:69-88`, `changed-symbols.ts:318`, `change-intent-context.ts:336` | **golden test: stage packets byte-identical** to pre-change on a fixture repo (packet bytes are the cache key — field order matters); reports identical; measured subprocess count and wall-clock reduction recorded in the PR |
| 1.2 | Config-driven one-go run: the review command (or a new `run` command — implementer's choice, breaking changes accepted, no alias kept) executes enabled stages in dependency order in-process. GitHub pipeline drops its 3-subprocess loop and stdout-digest stitching for one CLI call + one artifact read. `report-digest.ts` keeps its loose-mirror boundary. | `pipeline.ts:113-124,315-357`, `stage-outcomes.ts:33-56`, `.github/workflows/code-review.yml:89-119` | one spawn per PR push in the pipeline test; stage skip/failure still isolates (a failed impact lane must not fail review — preserve current per-stage error containment) |
| 1.3 | Unified report: extend `ReviewReportSchema` (breaking, bump schemaVersion) with optional `intent` and `impact` sections carrying the **imported** stage report schemas — no mirroring. Separate artifact files may remain for the standalone commands, produced from the same objects. | `review-report.schema.ts:237-269`, `run-artifacts.ts:106,215,251` | strictObject parse of a full run's report; GitHub comment renders from the one artifact; specs 06/22/23 updated |
| 1.4 | **Sequencing guard:** the branch `feat/external-context-ingestion` carries uncommitted spec-30 conversation-lane work in `scripts/github/`. Land or park that first; Wave 1.2 touches the same files. | `scripts/github/*` (git status) | no clobbering; rebase note in PR |

Wave 1's cost claim is latency and duplication, not tokens — same model calls,
same packets. Any token win here is provider-cache alignment from identical bytes,
to be *measured* (cache probe exists) and reported, not assumed.

### Wave 2 — cross-stage information, cheapest first, every item pre-registered

Protocol for every item: 6-case smoke (~$0.24) → pre-registration with kill rule →
A/B via `ab-run.sh` (alternating arm order; no precision claims from this harness
without it) → paired per-expectation sign test → ledger entry win or lose.
Engine pinned, judge pinned. Success bars are set in each item's own prereg BEFORE
its first full seed; the plan deliberately does not pre-commit numbers here.

| id | hypothesis | mechanism | anchors | risk/kill |
| --- | --- | --- | --- | --- |
| 2.1 | Signal facts rendered into discovery's `reviewText` recover some of the cross-function/implementation misses (55–70% band) | add the missing `support-signal-output` render branch — closing a gap, not adding a lever; also render a compact form for refutation instead of raw JSON | `review-packet.ts` (no branch today), `context.ts:452-457` | attention levers are closed as a *family of prompt mechanisms*; this ships previously-computed data. If flat: keep the render for report honesty, close the question |
| 2.2 | Impact dependents as context lift **cross-file recall (35–48%, the worst band)** and give the refuter corroboration for cross-file candidates | new reviewContext kind `impact-dependents` via the `analyzer-signal-context.ts` template (reaches discovery AND refutation for free); deterministic tier only — **zero extra model calls** (adjudication stays off per its own failed promotion) | `analyzer-signal-context.ts:55-158`, `impact-report.ts` reliances, `packet.ts:96-98` | the *impact-framing prompt clause* was rejected — this is data, not wording, but cite that entry; kill if cross-file recall flat at 3 seeds |
| 2.3 | **Citation spine.** Discovery cites the lines that ground each finding (quote + line span — by content, since holistic input has no evidence IDs to reference); a **deterministic verifier** checks the quote appears at the cited location and mints an `EvidenceRecord` (new kind `citation`); refutation's `evidence` field becomes non-empty; hallucinated-citation candidates are downgraded before any refuter call | populate what `candidateFromFinding` discards (`evidenceIds` already parsed at `agent-contracts.ts:507`); the deterministic quote-check is free precision *before* spending refuter tokens | `holistic-task-review.ts:422`, `packet.ts:57-59,121-123` | spec 05's retrieval failure is the prior: checking a citation ≠ searching for support, but kill on ANY adjusted-precision drop or FP rise, exactly as that rule was written. Injection: quotes are attacker-controlled source — redaction + untrusted-data framing mandatory, and the citation verifier is deterministic so it cannot be argued with |
| 2.4 | Re-measure the silence funnel (25% silent / 7% empty / 5:1 needs-more-evidence) **after** 2.1–2.3; only then decide the artifact-only ranking question | the population under study changes if 2.3 works; the separator study needs 8–10 seeds at today's population and is mispriced until then | ledger 2026-08-10 | do not run the separator study before this gate |

### Wave 3 — cost measurement, continuous

No new mechanism. After Wave 1: re-run the cache probe (cold/warm per-PR cost, %
cached) and publish the deltas with the model named. After each Wave-2 item: cost
per review in both arms is part of its prereg. Token-reduction *work* (packet
dedupe beyond what RunContext gives) only if the probe shows re-sent bytes
surviving Wave 1 — measured, not speculative.

---

## Part 4 — What this plan deliberately does not do

- **No wholesale promotion of artifact-only findings** (measured: 8× FP increase).
- **No refuter retrieval revival** (spec 05, measured, removed — 2.3 is a
  different mechanism with the same kill rule).
- **No new prompt clauses** for attention/security framing (closed families).
- **No persistence/caching layer across invocations**, no interaction telemetry
  (decided 2026-08-06), no back-compat aliases for renamed CLI/report shapes.
- **No merging of the GitHub loose-mirror schemas into shared contracts** — the
  version-skew boundary is documented and correct.
- **No claim that 2.3 will work.** The mechanism is real and measured; the fix is
  a hypothesis with an unfavorable prior at the same stage and a favorable one for
  the never-tried channels. That is exactly what pre-registration is for.

## Part 5 — Expected value, honestly bounded

| wave | value | confidence |
| --- | --- | --- |
| C0 | two latent bugs fixed, one enum, ~15 dead contract values gone; smaller drift surface | certain (mechanical) |
| 1 | 3× → 1× intake/AST/ingestion/provider setup; one artifact; one comment path; measured latency drop | certain (structural), token win unproven until probed |
| 2.1/2.2 | first-ever data into two structurally-dead channels; targets the two worst recall bands (cross-file 35–48%, implementation 55%) | open — priors mixed, cost of knowing ~$12–25 per item |
| 2.3 | the 10.3pp parked-recall headroom plus refuter FP reduction via free deterministic citation checks | open — the largest prize and the most guarded |
| 2.4 | correctly-priced decision on the last open lever (ranking) | gated |
