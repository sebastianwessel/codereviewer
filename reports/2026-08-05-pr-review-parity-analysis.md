# Does this engine do what a real PR review does?

Date: 2026-08-05
Status: analysis — no code or spec changes. Action items are proposals, each named
with its decision owner. Written to be consumable by humans and by implementation
agents in later sessions.

Method: four parallel read-only audits of the current tree (capability inventory
against specs; output/process surfaces; context-visibility trace; external
research), joined with the repo's own measurement record
(`reports/eval-results-ledger.md`, `reports/2026-07-27-enumeration-gap-and-improvement-plan.md`,
`reports/2026-07-27-in-diff-vs-out-of-diff-recall.md`) and the spec set. Every
rate below names its corpus and model. All model-dependent rates were measured on
**openai/gpt-5.3-codex**; they are properties of that model+prompt pair, not of
the engine alone.

---

## 0. Verdict in one paragraph

Measured against what a **strong human reviewer** does on a pull request, this
engine is at or above human level on exactly one half of the job — **"is the
changed code correct?"** — and it is more honest, more consistent, cheaper, and
faster there than any human: in-diff recall 61.1% (sd 0.96pp) at 99.1% adjusted
precision (37-case real-repo corpus, three runs at one pinned engine, codex), with every
finding evidence-linked, every limit disclosed, and a principled severity rubric
humans don't have. It is measurably **absent** on the other half — **"is this
the right change?"** — the consequence-elsewhere question (0/27 measured
out-of-diff), test adequacy, design fit, and the feedback conversation. Most of
that second half is absent **by measured decision rather than neglect** (the
convention-conformance capability was built, measured at 14× its noise budget
with zero true positives, and killed; three prompt/structural attacks on the
out-of-diff wall were built, measured, and withdrawn). The honest headline: this
is a **correctness auditor with an advisory intent/impact stack**, competitive
with the best commercial AI reviewers on recall and ahead of them on
precision/auditability — and "comparable to a full human review" is today a
**scope claim it should not yet make**. The plan below is what would close the
gap, in order of measured leverage.

---

## 1. The yardstick: what a PR review actually is

Two reference points, used deliberately:

**1a. The idealized checklist** (what review guides ask for — see §1b for
sources): (1) understand the intent and context of the change; (2) judge the
design/approach; (3) verify functional correctness including edge cases; (4)
check consequences beyond the diff (callers, invariants, compatibility); (5)
security; (6) performance; (7) test adequacy; (8) readability/naming/
maintainability; (9) consistency with codebase conventions; (10) docs/changelog
alignment; plus the process itself: calibrated severity ("blocking" vs "nit"),
questions when uncertain, iteration with the author, and knowledge transfer.

**1b. The empirical human** (what reviewers measurably do). Research on modern
code review consistently finds the median human review is far below the
checklist. Verified calibration numbers (full citations in §9; each flagged
primary or secondary as the research pass could confirm it):

- At Microsoft, only **~15% of reviewer comments identify a possible defect**;
  ≥50% concern long-term maintainability (Czerwonka, Greiler & Tilford, ICSE
  2015 — primary). Bacchelli & Bird (ICSE 2013 — primary, qualitative) found
  the same gap between the top *stated* motivation (finding defects) and the
  actual dominant outcome (code improvement + knowledge transfer).
- Review effectiveness collapses beyond **200–400 LOC** and **60–90 minutes**
  per session; under those disciplined conditions the SmartBear/Cisco field
  study reports 70–90% defect discovery — a vendor-run study, at the
  optimistic end of the literature.
- Controlled experiments: **single-inspector detection 20–40%**
  (Porter/Votta/Basili line); full Fagan-style multi-reviewer inspection
  averages **~60%** (range 35–65%); lightweight industrial variants only
  **13–30%** (Shull et al. 2002 synthesis). Nobody runs Fagan inspection on
  PRs. (A commonly quoted "25–60%" summary figure could not be traced to any
  single primary source and is used nowhere in this report.)
- Rubber-stamping is endemic; review latency, not depth, dominates in practice.

The parity target this report uses is the **strong, engaged human reviewer** —
the checklist practiced honestly — because that is the goal the product states
("better than humans"), and because beating the *median* human on defect
detection is a bar the engine already clears (§3, row 2).

---

## 2. What the engine is today

One paragraph of identity, then the pipeline in human terms.

**Identity.** A local-first, provider-agnostic, language-neutral (7 languages,
one ast-grep engine) semantic review CLI with three stages: `review` (blocking,
the only stage that can fail a pipeline), `intent check` and `impact check`
(advisory by spec, cannot block — a deliberate, research-cited decision, not a
default). Precision-first: model output is untrusted until an independent
refutation pass and a deterministic admission gate accept it. Explicitly out of
scope by product definition: everything CI already does (linters, formatters,
tests, builds, CodeQL), publishing authority, and auto-applied fixes.

**The pipeline, mapped to how a disciplined human reviews:**

| Human step | Engine equivalent | Notes |
|---|---|---|
| Read the PR description / ticket first | Change-intent ingestion (spec 11): PR/ticket text becomes a bounded, redacted "orientation only, NOT authorization" brief in every discovery packet | Off by default in the library; **on in the shipped GitHub CI config** (PR title+body auto-ingested). One-way by design: refutation never sees it, so an injected description cannot argue a finding away |
| Read the diff, then the whole file | Whole-file packets, line-numbered ("THIS is what you review"), diff shown as orientation | Files >500KB are skipped entirely (disclosed), never truncated |
| Chase suspicions into the repo | Mediated `repo_read`/`repo_list`/`repo_grep` (on by default), depth-scaled budgets, every truncation disclosed to the model | Findings stay hard-restricted to the files the call was shown — retrieval informs, never expands scope |
| Form comments, self-check | Candidate findings → semantic merge → independent refutation (proved / refuted / needs-more-evidence) | Refuter sees no conversation history and no intent brief; judges each candidate on the packet alone |
| Decide blocking vs nit vs question | Two-axis severity rubric (impact band × reachability band); gate thresholds; `needs-more-evidence` → "Unresolved — Needs Human Decision" section | Severity may not be inflated by evidence strength — that separation is written into the spec |
| Post, iterate across pushes | Idempotent summary comment (edit-in-place), inline comments deduped by content fingerprint across force-pushes, optional baseline for pre-existing findings | Stateless re-review each push; no reading of author replies |

**Current measured position** (all codex):

| Measure | Value | Corpus / date |
|---|---|---|
| In-diff recall | **61.1%**, sd 0.96pp (61.7 / 60.0 / 61.7) | 37-case real-repo, shipped defaults, engine `6781a26`, 2026-08-02, three runs |
| Out-of-diff recall | **0.0%** (0/27, all three runs) | same runs; replicated as 0/81 on archived-run analysis |
| Adjusted precision | **99.1%** (100 / 97.3 / 100). Raw is lower; the pair brackets the truth — precision under an incomplete key is permanently an estimate | same runs |
| Controlled exhaustive corpus | 85.7% recall / 100% adj. precision | proof-quality corpus, 2026-07-24 |
| Line placement | 97.2% | 2026-07-26 |
| Refuter kill rate | 1.4% (precision comes from conservative discovery, not the gate) | 9-run analysis, 2026-07-27 |
| Cost | $1.20–2.24 per 30–37-case corpus run | 2026-07/08 |
| Run variance | sd **0.96pp** in-diff, 0.66pp blended | three pinned runs, 2026-08-02 — supersedes the ±4.8pp band used for months, which was estimated from too few samples |

Position vs commercial AI reviewers (Martian live board, the only
continuously-run benchmark by a party that sells no reviewer, pulled 2026-07-27):
best commercial recall ≈ 50–51% (Greptile, CodeRabbit). This engine's recall is
in the same band, with a precision/auditability posture none of them publish.

---

## 3. Function-by-function parity

Verdicts: **ahead** (better than a strong human), **parity**, **partial**,
**absent**, **out-of-scope** (deliberate, defensible exclusion).

| # | Review function | Engine today | Evidence | Verdict |
|---|---|---|---|---|
| 1 | Understand intent & context | Change-intent brief to discovery (CI: on, auto-fed PR title+body); `intent check` maps stated obligations → evidence; commit messages never read (deliberate); reviewer `instructions`/`skills` as a separate trusted channel | spec 11, 23; agent-trace §1–4 | **partial→parity** in CI; the injection-resistant one-way design is **ahead** of human practice |
| 2 | Correctness of changed code | Whole-file discovery + refutation; edge cases, concurrency, resources, error handling explicitly in the sweep | 61.1% in-diff @ 99.1% adj. precision; ~1.2 findings/file ceiling open | **parity-to-ahead** vs median human; below a strong human's ~everything-eventually |
| 3 | Consequences beyond the diff | Measured **0/27** in `review` (attention, not information — all 27 sat in files shown in full); findings hard-scoped to shown files; `impact check` reports dependents but adjudication (spec 22 step 3) unimplemented | out-of-diff reports; spec 22 | **absent** — the single largest gap vs a strong human |
| 4 | Security | General sweep on; dedicated pass off (n=1: labeled security fell, +61% cost — honest "unproven"); deterministic source/sink layer (Mechanism 2) unbuilt; measured discovery blind spots: crypto/XSS/SSRF ~0% (not the gate's fault — 1.4% kill rate) | spec 15; security-mechanism baseline 2026-07-24 | **partial** |
| 5 | Performance | One clause ("expensive work on hot paths"); category exists; no dedicated lens; recall unmeasured | agent-instructions.ts | **partial/thin** |
| 6 | Test adequacy of the change | Absent. `testMappings` computed but context-only; refuter actively downgrades testing concerns; `test` category = bugs *in* tests | inventory §2.7 | **absent** — the only checklist row with no measured attempt and no spec |
| 7 | Design / architecture fit | Out of scope, suppressed at three layers (prompt, rubric, severity floor); advisory reuse/architecture lane exists as concept (M4), unbuilt | agent-instructions.ts; concept doc | **out-of-scope** today; concept exists |
| 8 | Readability / naming | Deliberately excluded (noise policy; linter territory) | vision VIS-006 | **out-of-scope**, defensible |
| 9 | Codebase-convention conformance | **Built, measured, killed**: spec 24 fired 7.0/PR vs 0.5 kill criterion, 0 true positives in ~300 hand-judged | spec 24 outcome 2026-08-02 | **absent, with evidence** — do not revive as-is |
| 10 | Dependency changes (new deps, licenses) | Absent; lockfiles excluded by default; manifests reviewed only as plain text | inventory §2.11 | **absent** (minor) |
| 11 | Docs/changelog alignment | Absent as a PR dimension (the drift checker audits the *tool's own* docs, not the reviewed repo's) | inventory §2.12 | **absent** (minor) |
| 12 | Severity calibration & gating | Two-axis rubric; three consumer tiers (gate-failing / reported / unresolved-needs-human); advisory stages non-blocking **by measurement** (spurious-rejection research) | spec 05 §severity; spec 23 | **ahead** — humans have no rubric and gate by mood |
| 13 | Questions when uncertain | `needs-more-evidence` → artifact-only → dedicated "Unresolved — Needs Human Decision" report section | markdown-reporter | **partial**: exists, but never reaches the PR comment surface (§4c) and is phrased as findings, not questions to the author |
| 14 | Iteration across pushes | Stateless re-review; fingerprint-deduped comments; baseline (manual `baseline write`) suppresses pre-existing from the gate; resolved-since-baseline computed but surfaced nowhere human-readable | outputs-audit §3 | **partial** |
| 15 | Conversation with the author | Absent by design (own comments are only read to find markers) | outputs-audit §3.4 | **absent** — integration-layer decision, see §6/C3 |
| 16 | Consistency, stamina, latency, cost | Uniform care on every file of every PR; minutes; ~$1–2/corpus-run; no fatigue curve; anti-anchoring (zero conversation history between calls) | design + measurements | **ahead**, by construction |
| 17 | Honesty about its own limits | Every truncation/limit disclosed to model and human; provenance (engine SHA, model, config hash) on every artifact; precision reported as a bracket | this repo's defining trait | **ahead** — no human review discloses what it didn't look at |
| 18 | Learning from team feedback over time | Static steering exists (instructions/skills); no feedback loop; the repo's own research names this the missing "second filter" (correctness filter ≠ usefulness filter, Tricorder/Greptile evidence) | enumeration report §4.1 | **absent** |

Aggregate: of the 10 checklist content-dimensions, the engine fully covers ~3,
partially covers ~4, and doesn't attempt ~3 — but the 3 it covers include the
one with the highest stakes (correctness), and rows 12/16/17 are things **no
human review provides at all**.

---

## 4. Do we do it the *right* way? — judgment on the process shape

The pipeline's shape matches a disciplined human's process closely (§2 table),
including things most tools skip (read-the-ticket-first, chase-suspicions,
must-fix-vs-question separation). Four structural judgments, honestly:

**a) The precision architecture is right — and CORRECTED 2026-08-05, its idle
verification stage is not the invitation this section originally called it.**
Precision was designed to come from refutation; it is measured to come from
**discovery being conservative** (refuter kills 1.4%). That couples precision and
recall at the same knob, which is why every "find more" intervention so far cost
precision.

This section first read the 1.4% as spare capacity and cited "generate wide,
verify hard" as the literature's prescription. **A targeted literature check
contradicts that**, and the correction is worth more than the original claim
because it rules out the obvious move:

- **CR-Bench** (584 review instances) measured this exact trade on code review:
  Reflexion-style widening raised recall +5.75pp and cut signal-to-noise from
  **5.11 to 1.95**.
- **ISSTA 2026** (*Sifting the Noise*) finds noise removal and true-positive
  retention are anti-correlated, and that gains concentrate in the strongest
  models — weaker ones get *worse* under agentic filtering.
- Our own 1.4% kill rate is evidence the refuter is **not built to absorb a
  flood**, not evidence that it is idle.

So "raise the candidate cap and let refutation catch it" is the most directly
contradicted change available, and the conservative-discovery regime this engine
already runs is the empirically safer one.

What the same ISSTA study *does* identify is a different lever, and the largest
single one it measured: **cross-file navigation inside the verification stage** —
ablating it collapsed F1 from 95.5% to 62.5%. This engine's refutation is
explicitly toolless; discovery has the retrieval tools and the verifier does not.
That is the evidence-backed gap, and it improves verification quality rather than
discovery volume. Full sourcing in `2026-08-05-recall-lever-research.md`.

**b) The intent trust model is better than a human's.** A human both benefits
from and is misled by the PR description ("looks right because the description
says so"). The engine reads it for orientation and structurally denies it to the
verifying stage. Commit messages are excluded entirely (the eval hydrator even
refuses to read them because "the fix commit message is the answer key" — the
same reasoning protects production against author-authored suggestion). Keep
this; publish it as a differentiator.

**c) The engine's honesty doesn't fully survive its own integration layer.**
Three places where the precision-first design's *compensating half* is lost
before a PR reader sees it (all in `scripts/github/`, none in the engine):
the summary comment renders unresolved (needs-more-evidence) findings
indistinguishably from finished findings (`reporterEligibility` is dropped in
`report-digest.ts`); `rejectedFindings` never reach the PR surface at all; and
`resolvedBaselineEntries` ("N findings fixed since baseline") are computed but
rendered nowhere human-readable. A reviewer-tool that prides itself on
disclosure currently under-discloses exactly at its most-read surface.

**d) Advisory-by-measurement is the right chassis for everything opinion-shaped.**
The engine already has the pattern every missing dimension needs: a stage that
cannot block, with its own artifacts and its own measured precision (intent
check ships with a research citation for *why* it cannot block). Test adequacy,
design fit, reuse advisories — if they come — belong on this chassis, never in
the blocking gate. The conformance failure (row 9) is the cautionary measurement:
opinion-shaped review at LLM precision is noise unless a deterministic
pre-filter carries the burden of proof.

**What bounds recall today — three measured facts, one sentence each:**
discovery yield tracks the **number of discovery calls**, not context size or
prompt wording (partitioning sweep: default `maxFilesPerDiscoveryCall: 2` is the
only arm ever to reach p<0.05); the out-of-diff wall is **attention anchored by
the diff** (all 27 misses were in files shown in full; prompt reframing moved
literally nothing; the un-anchored pass recovered 2/7 at +136% cost and was
withdrawn); and within a file the engine reports **~1.2 findings** (first-listed
expectation 71.1%, later 13.9%).

---

## 5. Where the engine is already better than a human

Worth stating plainly, because the parity question cuts both ways:

1. **Precision discipline.** ~100% adjusted / high-90s raw-adjusted bracket, a
   1-genuine-FP-per-corpus-run record, and a rubric that forbids severity
   inflation. Humans post wrong and useless comments routinely (Greptile's own
   raw-output audit: 79% nits).
2. **Disclosure.** Truncations, caps, withheld context, and coverage gaps are
   disclosed to both the model and the reader. No human review states what it
   did not look at.
3. **Provenance.** Engine SHA, model, config hash, instruction hashes on every
   artifact; scorers refuse to pool mixed engines. Reproducibility no human
   process has.
4. **Uniform stamina.** File 40 of a 3,000-line PR gets file-1 attention. The
   human fatigue cliff at ~400 LOC does not exist here.
5. **Injection resistance** (§4b) — humans are the *most* injectable reviewer.
6. **Anti-anchoring.** Zero conversation history between model calls; each
   verdict is independent. Humans anchor on their first impression.
7. **Cost/latency.** Minutes and roughly a dollar per review vs hours-to-days
   of senior-engineer time; review depth no longer rationed by seniority.

---

## 6. Action plan

> **Status, end of 2026-08-05.** Everything in Tier 1 shipped, plus B5, C5 and
> the whole of B3 except its measurement. What remains is Tier 2's measurement
> bundle (B1/B2/B4/B6) and the Tier 3 product decisions. Per-item status is
> marked ✅ below. Three defects were found while building and are worth
> remembering because none was on this list: reviewer instructions never reached
> the discovery call at all (loaded, redacted, ledgered, then dropped — refutation
> was the only stage they affected); the changed-symbol key was spelled two ways
> so every contract delta missed its lookup; and a partitioned sub-task's
> candidates matched no planned task, so refutation silently fell back to
> workflow-wide context. The last two were invisible in aggregate output.

Rules honored throughout: evals are rare and expensive — everything measurable
is **bundled into the one re-baseline run that is already owed** (this session
bumped `metricsVersion` and changed model-visible behavior, so the published
rates no longer describe the shipped engine). Nothing tunes to fixtures. Every
new capability gets a pre-registered kill criterion (the conformance lesson).
Decision owner marked **[human]** where it is a product/scope call.

### Tier 1 — integration honesty (no model cost, no eval needed, hours not days)

| ID | Action | Why |
|---|---|---|
| A1 ✅ | Carry `reporterEligibility` through `scripts/github/report-digest.ts`; render unresolved findings as their own collapsed "needs human decision" block in the PR summary comment | §4c — the uncertain tier is the compensating half of precision-first and currently reads as ordinary findings |
| A2 ✅ | Surface `resolvedBaselineEntries` as a count ("N baseline findings no longer present") in `report.md` + summary comment | Humans acknowledge fixes; the engine computes this and shows it nowhere |
| A3 ✅ | Add a one-line rejected/merged accounting ("X candidates rejected, Y merged; see artifact") to the summary comment | Rejected findings currently invisible from the PR; visibility is the precision story |
| A4 ✅ | Fix the stale "no GitHub Action / no PR publishing" bullets in `docs/01-overview/status-and-limitations.md` (contradicted by the shipped workflow since 2026-07-31) | Docs drift found during this audit |
| A5 ✅ | Per-item records for semantic-merge drops (currently only an aggregate count — the one suppression channel with no per-item audit trail) | Closes the last silent-ish kill path |

### Tier 2 — measurement-gated engine work (bundle with the owed re-baseline)

| ID | Action | Evidence base | Pre-registered success / kill |
|---|---|---|---|
| B1 | **Re-baseline at current HEAD** (3 seeds, pinned engine + pinned `node_modules`, arm order randomized — the cache-warm confound is documented) | metricsVersion bump + disclosure notices now reach the model; current published rates describe engine `6781a26`'s ancestor | This is the instrument, not a bet |
| B2 | **Enumeration, the one untried lever:** differential/re-derivation prompting (ask for intended behavior, then the nuances between intended and actual — changes the comparison object, not the checklist) + refinement-guided pruning (drop candidates whose induced edit is empty/duplicate). Both from the 2026-07-27 plan's Step 1; neither in the withdrawn graveyard | Sun et al. +4.68pp (p<0.05); Li et al. 28.8→75.0% on logic; our injection-guard precedent shows framing can move recall massively at zero cost | Success: in-diff +≥5pp at ≤+10% cost, adj. precision holds. Kill: any precision drop outside the band |
| B3 ✅ (built, unmeasured) | **Out-of-diff: stop attacking the wall frontally; route around it.** Frontal attacks are exhausted (reframing: 0 movement; un-anchored pass: withdrawn; splitting: harmful). The remaining mechanism with a spec is **impact-check adjudication** (spec 22 step 3): dependents of changed symbols are *enumerated deterministically* — a bounded model judgment per dependent ("does this caller rely on what changed?") converts the reference report into consequence findings without asking discovery to look away from the diff | Impact coverage measured 74.1%; the wall is attention, and adjudication sidesteps attention by making each consequence its own task | Success: >0 of the 27-population equivalent via the impact lane at advisory precision ≥ intent check's band. Kill: firing rate > ~1/PR at <50% precision |
| B4 | **Spec 16 replication** rides along free (it is on by default now; +5.7pp/p=0.096 needs its replicate before the default is *proven* rather than plausible) | spec16 re-run 2026-08-01 | Confirm or revert default |
| B5 ✅ | **Test-adequacy advisory (new, smallest honest version):** deterministic-only first — "changed production files with zero changed/related test files" as one advisory summary line, from the already-computed `testMappings`. No model call. Measure firing rate + human-judged usefulness on real PRs before any model-backed judgment of test *quality* | The only checklist row with no attempt; deterministic pre-signal is free; conformance lesson says start deterministic, kill on noise | Kill: fires on >~half of legitimately test-free PRs (docs-only, refactor-covered) without a way to suppress |
| B6 | **Security:** hold the line — keep the dedicated pass off (unproven at n=1, +61% cost); the measured blind spots (crypto/XSS/SSRF at ~0% discovery-side) are the concept doc's M2 case (analyzer/SARIF ingestion: deterministic evidence, model judges reachability). Do not buy more prompting here | spec 15 outcome; enumeration report §"not doing" | M2 is a **[human]** milestone decision, priced in the concept doc |

### Tier 3 — product/scope decisions **[human]**

| ID | Decision | The honest framing |
|---|---|---|
| C1 | **Declare the two products.** PR review (diff-scoped; what ships) and repository audit (out-of-diff; the concept doc's north star). The 0/27 population is largely *pre-existing defects near the diff* — a strong human flags some opportunistically, but a PR reviewer is not obliged to. Deciding this explicitly converts the engine's largest measured "failure" into a scoped roadmap item and makes the blended recall figure honest (it is already split in reports) | The in-diff/out-of-diff report says it exactly: "a product decision, not a measurement result" |
| C2 | **The usefulness instrument** (row 18): the GitHub layer could record, per posted comment, whether it was reacted to/resolved/replied — the Tricorder "effective false positive" signal, the industry's proven second filter, and the only way to ever measure "better than humans" on real PRs rather than fixtures. Privacy/telemetry posture is a product call | Enumeration report §4.1: "We have the first [correctness filter] and no instrument at all for the second" |
| C3 | **Conversation** (reply-to-author): large integration lift, real parity value — but the commercial field is split on it (CodeRabbit/Greptile/Qodo yes; Copilot/Bugbot/Claude Code explicitly no), so deferring is a defensible position, not a deficiency. Dishonest only if parity is claimed while it is absent | outputs-audit §3.4; §8 |
| C4 | **Performance lens**: leave incidental, or give it one sweep bullet? Cheap to try inside B1's bundle (one prompt line), but recall for the category is unmeasured — measure before and after or don't bother | inventory §2.5 |
| C5 ✅ | **Path-scoped reviewer instructions**: `instructions.files`/`inline` apply run-global; per-path scoping (monorepo teams steering different areas differently) is universal in the commercial field. Small config-schema + packet-assembly feature; no model-cost implication; decide whether the demand exists before building | context-trace §4; §8 |

### What NOT to do (measured refusals — do not re-litigate without new evidence)

Re-ask/enumeration passes over the same context (+40–47% cost, no gain, twice);
diverse-lens checklists at discovery (traded authz for injection); un-anchored
windowed pass (+0.83pp n.s., +136% cost); independent k-sampling (precision
−19pp, +67% cost); consensus/majority voting (popularity trap — literature);
proactive byte-splitting (spec 26: −8.5pp); reviving conformance as-is (14× kill
criterion, 0 TPs); widening the matcher's line tolerance (merges distinct
adjacent defects); numeric confidence scores on findings (irreproducible,
spec 12 outcome); mining engine output into answer keys (converts recall into
self-similarity).

---

## 7. Standing measurement debts

1. The published rates (docs/status-and-limitations) describe a superseded
   engine; B1 re-baselines them. Until then, any external claim should say
   "measured at engine `1152751`, 2026-07-31, openai/gpt-5.3-codex".
2. `maxBytesPerRead` (spec 28's read-budget-reduction-then-retry) is spec'd,
   Draft, and unimplemented — the self-audit's one recorded gap.
3. Intent-check precision (51.5% raw) is diagnosed as question-mismatch, with a
   65–80% achievable band via reporting semantics already partially shipped
   (evidenced/not-evidenced/undetermined vocabulary); n=1, no variance band —
   re-measure inside the B1 bundle if intent changes are claimed.
4. Line placement on real-repo (path-semantic) corpora is deliberately
   unscored; the 97.2% figure is from the fixture corpus. Say so when quoting.

---

## 8. Competitive context (external research, 2026-08-05)

Eight products scanned against ten features (Copilot code review, CodeRabbit,
Greptile, Qodo Merge, Graphite Agent, Cursor Bugbot, Sourcery, Claude Code
review; full matrix and per-product sources in the research annex — §9). What
matters for this engine's positioning:

**Where this engine leads the field:** refutation-gated precision with a
published raw/adjusted bracket (no vendor publishes one); artifact-level
auditability and engine/model/config provenance; SARIF; advisory intent/impact
stages (Qodo's "ticket compliance" is the only comparable, and it is
blocking-capable — this engine's advisory-by-measurement stance is unique and
defensible); injection-resistant one-way intent handling (no vendor documents
anything similar); local-first/BYO-provider. Notably, the closest design
relative is Claude Code's review feature — candidate-then-verify, correctness-
scoped, non-blocking, test review off by default — independent convergence on
this engine's architecture shape.

**Where the field leads this engine:** (1) *conversation* — CodeRabbit,
Greptile, Qodo reply in-thread; Copilot, Bugbot and Claude Code explicitly do
not, so the field is split and this is a differentiator choice, not table
stakes; (2) *team-preference learning loops* — CodeRabbit "learnings", Greptile
memory, Qodo rule miner, Cursor learned rules (4 of 8); this engine has none
(§3 row 18); (3) *path-scoped custom instructions* — effectively universal
(8 of 8, e.g. Copilot `applyTo` globs, Claude Code hierarchical `CLAUDE.md`);
this engine's `instructions` are run-global only; (4) *auto-resolve of
addressed comments* — e.g. Claude Code auto-resolves a thread when the flagged
issue is fixed; this engine computes resolved-since-baseline and shows it
nowhere (A2); (5) *managed ticket connectors* (Jira/Linear) vs this engine's
filesystem inbox + unimplemented `platform`/`mcp` providers; (6) *test review*
— CodeRabbit and Qodo ship it as a feature (coverage commentary, `/test`
tools), reinforcing B5's gap diagnosis.

**Benchmark reality:** vendor accuracy claims remain marketing-grade — both
CodeRabbit and Qodo have published "#1 on Martian" posts citing different
snapshots (~51.2% F1 and 64.3% F1 respectively), and Greptile's "3X more bugs"
has no disclosed methodology. The Martian Code Review Bench (independent,
open dataset/judge/pipeline, 17 tools, live) is the only neutral reference;
this engine's measured recall sits in the band of that board's leaders
(2026-07-27 snapshot: best commercial ≈50–51% recall), with a precision
posture none of them publish. Any public claim this project makes should name
corpus, engine SHA, and model — the same provenance discipline the vendors
lack is itself the credibility differentiator.

## 9. Sources

**Human review — reference model and empirical calibration (§1):**

- Google Engineering Practices, *What to look for in a code review* —
  https://google.github.io/eng-practices/review/reviewer/looking-for.html
  (dimensions verified from the live page: Design, Functionality, Complexity,
  Tests, Naming, Comments, Style, Consistency, Documentation, Every Line,
  Context, Good Things).
- Bacchelli & Bird, *Expectations, Outcomes, and Challenges of Modern Code
  Review*, ICSE 2013 — https://sback.it/publications/icse2013.pdf (primary;
  motivation-vs-outcome gap confirmed qualitatively; exact percentage tables
  not re-verified).
- Czerwonka, Greiler & Tilford, *Code Reviews Do Not Find Bugs*, ICSE 2015
  SEIP — https://www.microsoft.com/en-us/research/wp-content/uploads/2015/05/PID3556473.pdf
  (primary; ~15% defect comments, ≥50% maintainability).
- SmartBear/Cisco case study (Cohen, *Best Kept Secrets of Peer Code Review*)
  — https://static0.smartbear.co/support/media/resources/cc/book/code-review-cisco-case-study.pdf
  (vendor field study; 200–400 LOC, <500 LOC/h, 60–90 min, 70–90% under
  discipline).
- Porter, Votta & Basili 1995 / Porter & Votta 1998 (single-inspector 20–40%;
  ad hoc ~43% vs checklist ~35%, n.s.) — via https://arxiv.org/pdf/0909.4260;
  Shull et al., *What We Have Learned About Fighting Defects*, IEEE Metrics
  2002 (Fagan ~60%, range 35–65%; light industrial 13–30%) — secondary-sourced.

**AI-reviewer feature scan (§8), primary docs where available:**

- GitHub Copilot code review — https://docs.github.com/copilot/using-github-copilot/code-review/using-copilot-code-review
  (non-blocking; no replies; path-scoped instructions; severity labels 2026).
- CodeRabbit — https://docs.coderabbit.ai/ (incremental default; in-thread
  chat; "learnings"; Jira/Linear; autofix; gate-capable).
- Greptile — https://www.greptile.com/docs/code-review/key-features (graph-
  first context; memory; Jira; agent-handoff fixes; "3X" claim unmethodized).
- Qodo Merge — https://docs.qodo.ai/code-review (ticket/PR compliance; rule
  miner; `/test`; blocking-capable; self-published benchmark with public
  dataset: Qodo 79%P/71%R vs Claude Code review 79%P/52%R — vendor-interested).
- Graphite Agent (ex-Diamond) — https://graphite.com/docs/diamond-customization
  (custom prompts; mergeability checks; several features undocumented).
- Cursor Bugbot — https://cursor.com/docs/bugbot (explicit precision-first
  stance; incremental toggle; `BUGBOT.md` + learned rules; no replies;
  blocking-capable; self-published BugBench).
- Sourcery — https://docs.sourcery.ai/Code-Review/Overview/ (incremental;
  path-scoped rules; much else unconfirmed).
- Claude Code review — https://code.claude.com/docs/en/code-review
  (candidate-then-verify; Important/Nit/Pre-existing tiers; neutral check,
  never blocks; auto-resolves fixed threads; test review off by default;
  no team-memory).
- Martian Code Review Bench (independent; open dataset/judge/pipeline; live
  leaderboard) — https://codereview.withmartian.com/ and
  https://withmartian.com/post/code-review-bench-v0.

**This repository's own evidence (all rates codex):** `reports/eval-results-ledger.md`;
`reports/2026-07-27-enumeration-gap-and-improvement-plan.md`;
`reports/2026-07-27-in-diff-vs-out-of-diff-recall.md`; spec outcome sections in
`specs/05`, `15`, `16`, `22`, `23`, `24`, `25`, `26`, `27`, `28`;
`concept/repository-semantic-review.md` (north star, non-canonical).
