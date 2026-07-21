# Eval Breakdown, Root Causes & Improvement Plan

_Last updated: 2026-06-25. Based on the confirmed shipping run (`gpt-5.3-codex`,
single-pass, semantic judge, 59-case Code-Review-Bench-style pack). Numbers are
self-measured; treat with the same skepticism as any vendor benchmark._

Companion to [`competitive-analysis.md`](competitive-analysis.md).

---

## 0. Strategic reframe (2026-06-25): deterministic-catchable vs. semantic residual

The right question (per the user): which defects can deterministic tools — type
checkers, builds, linters, SAST — catch, so the LLM can focus on what's *left*?
We researched it and measured our own benchmark. The answer reframes the whole
effort.

**What the research says.** The field splits cleanly: SAST/linters/type-checkers
catch *deterministic patterns* (type errors, unused/undefined, floating promises,
known vuln signatures, injection sinks) at high precision but cannot see *semantic*
defects; LLMs catch semantic/logic/intent issues but are genuinely *weak at
multi-step reasoning* (loops, nested conditionals, tracking state across steps),
where they miss boundary conditions. The best documented pattern is **SAST-first,
then LLM**: run static tools, feed their hits to the LLM as verification targets,
and let the LLM both triage SAST false positives and find the semantic residual.

**What our data says (the surprise).** Classifying all 133 golden findings in the
benchmark by whether a mature deterministic tool would likely catch them:

| Class | Share | Examples |
| --- | --- | --- |
| **Deterministically catchable** | **~8%** (11/133) | type/build errors, invalid Zod schema, SSRF `open(url)`, one forEach-async |
| **Semantic residual (LLM-only)** | **~92%** (122/133) | logic/intent errors, contract drift, unimplemented abstract methods, business-rule bugs, concurrency, edge cases |

(Keyword classifier — conservative, so deterministic is a floor; even generously
it is a minority.)

**Why this is not an accident — it's the definition of code review.** The goldens
are *human review comments*. Humans don't comment on what the compiler/linter
already flags before review — they comment on the semantic residual. So the
benchmark's target *is* the residual, by construction. Deterministic tools handle
their slice **before** review; review is what's left.

**Implications (honest):**
1. **Offloading to deterministic tools is correct but a thin slice (~8–15%).** It
   will not meaningfully shrink our problem. Its real value is *precision*, not
   recall: in CI those tools already run, so we should **suppress** the
   deterministic-catchable class from our output (don't re-report what the build/
   lint already failed on) and use type facts to **refute type-impossible LLM
   claims** (a modest FP win), rather than treat static tools as a recall source.
2. **Security (SAST) is the exception worth wiring.** Injection/SSRF is small in
   count but high-value and we under-catch it (validation recall ~27%); semgrep/
   CodeQL fire at high precision here. Worth integrating *for the security slice*.
3. **Do not reinvent linters.** The P1 spike rebuilt `no-misused-promises` as a
   custom detector — badly. If we want a deterministic class, run the real tool.
4. **The residual is the product AND the hard problem.** ~92% of real review is
   semantic, exactly where LLMs are weakest. There is no shortcut around making the
   LLM better at the residual — i.e. **stronger verification/refutation (P3)** and
   evidence-grounded reasoning. The field's ~40–50% ceiling reflects this.
5. **Reframe the metric.** Measure recall on the *semantic-residual* subset; the
   deterministic ~8% is "already covered by CI" and shouldn't flatter or penalize
   our number.

**Net:** the user's instinct is right and gives a cleaner architecture (stop
competing with linters; suppress their class; use them for precision + security),
but it is a *precision/scoping* win, not the recall lever we hoped. The recall
lever remains the semantic residual — P3.

---

## 1. Where we are

Overall: recall **33.1%**, precision **53.0%**, F1 **40.7** (productRecall 39.4%).
Competitive on F1 and best-in-class on precision; recall is the gap. This document
breaks the recall gap down by **language**, **severity**, **category**, and
**issue type**, links each weakness to an **architectural root cause**, and
proposes **targeted improvements**.

---

## 2. The breakdown

### By language

| Language | Expected | Caught | Recall | False positives |
| --- | ---: | ---: | ---: | ---: |
| Java | 24 | 11 | **46%** | 4 |
| TypeScript | 31 | 10 | 32% | **16** |
| Go | 22 | 7 | 32% | 6 |
| Ruby | 28 | 8 | 29% | 9 |
| Python | 28 | 8 | 29% | 4 |

TypeScript is the noisiest by far (16 of 39 total FPs). Java leads on both axes.

### By severity (the most important cut)

| Severity | Expected | Caught | Recall |
| --- | ---: | ---: | ---: |
| Critical | 9 | 5 | **56%** |
| High | 41 | 19 | **46%** |
| Medium | 45 | 15 | 33% |
| Low | 38 | 5 | **13%** |

We catch serious bugs well and (deliberately) drop nits. The low-severity 13% is
mostly intentional suppression — it drags _overall_ recall but not productRecall.

### By category

| Category | Expected | Caught | Recall | Share of FPs |
| --- | ---: | ---: | ---: | ---: |
| Security | 41 | 18 | **44%** | 3 / 39 |
| Performance | 20 | 6 | 30% | 2 / 39 |
| Bug (logic/correctness) | 72 | 20 | 28% | **34 / 39** |

The generic "bug" bucket is simultaneously our **lowest recall** and the source
of **87% of our false positives**.

### By issue type (theme mining of the 89 misses vs 44 catches)

| Issue type | Catch rate | Note |
| --- | ---: | --- |
| Test / docs / docstring nits | 13% | ✅ by design — not real defects |
| **Cross-file / caller-impact** | **20%** | ⚠️ structural |
| **Input validation / sanitization / injection** | **27%** | ⚠️ SSRF, raw SQL, case-bypass |
| Performance / query / N+1 | 32% | weak |
| Concurrency / race / atomicity | 35% | moderate |
| Error / failure-path handling | 35% | largest bucket (26 missed) |
| Logic / wrong-value · null/undefined · edge cases | 44–46% | ✅ strong zone |

**Representative hard misses (real high/critical bugs we let through):** unawaited
`forEach` async callbacks; stale-read-under-concurrency (`retryCount + 1`); race in
lazy index building; asymmetric cache-trust logic; nil-request panic; SSRF via
`open(url)`; case-sensitivity blacklist bypass; a component called with fewer args
than an inner dependency requires (cross-file).

---

## 3. How our architecture differs (recap)

| Capability | Ours | Greptile / CodeRabbit / Cursor BugBot |
| --- | --- | --- |
| Context scope | Diff + changed files + limited forward import digests (R4) | Whole-repo graph / embeddings / agentic retrieval |
| Exploration | Single-shot, tools off | Agentic (model pulls context on demand) |
| Static analysis | AST (ast-grep + TS compiler) for clustering/context/evidence | + 40 linters fed as inputs (CodeRabbit) |
| Multi-pass | Single pass | 8 parallel passes (BugBot) |
| Verification | ✅ refutation pass | ✅ verification agent (CodeRabbit) |

We **match** the field on the verification pattern (our strength → precision). We
**lag** on context breadth and on the power of that verification.

---

## 4. Root-cause map

Each weakness traces to one of three causes:

### Cause A — narrow context (diff + changed file only)
- **Drives:** cross-file/caller-impact misses (20%), part of security
  (input often originates elsewhere), part of async/contract misses.
- **Why:** discovery and refutation both see only the changed file(s). We never
  resolve _who calls_ a changed symbol or _what a changed call expects_ beyond a
  thin forward-import digest. Competitors reason over the whole repo.
- **Benchmark caveat:** the slices are minimal (often only the changed files).
  Cross-file bugs whose other half is an _unchanged_ file are **unreachable on
  the benchmark** regardless of effort — but reachable in real repos. Cross-file
  bugs _within the changed set_ (multiple files changed in one PR) **are**
  fixable on the benchmark with better in-set cross-referencing.

### Cause B — under-powered refutation
- **Drives:** the generic "bug" bucket (28% recall **and** 87% of FPs), TS noise.
- **Why:** the refuter sees the same narrow context as discovery, so for plausible
  logic claims it can neither firmly _prove_ (→ misses real ones it can't confirm)
  nor firmly _refute_ (→ admits fakes it can't disprove). On TS especially the
  model speculates about runtime states the file alone can't settle.

### Cause C — no targeted detectors for known high-value classes
- **Drives:** async-misuse, races, dangerous-sink security (SSRF/injection),
  resource leaks — all detectable patterns we currently rely on the model to
  notice unaided.
- **Why:** discovery is a single generic prompt. We removed the focused 2nd pass
  because it flooded noise — but the _classes_ it targeted are real gaps. We have
  the AST machinery (ast-grep + TS compiler) and don't yet use it to **seed**
  these specific patterns.

---

## 5. Improvement plan

Guiding constraints from prior experiments (measured, not guessed):
- **Volume hurts.** Broad 2-pass discovery and "hunt harder" prompts raised FPs
  and net-lowered F1. Do **not** add undirected recall.
- **The lever is alignment + verification**, not raw discovery.
- So every recall idea below is either (a) **deterministic + model-confirmed**
  (precision-safe) or (b) **more context for the existing steps** (helps both
  recall and precision).

### P1 — Targeted generic AST detectors → model-confirmed candidates  *(Cause C)*

The precision-safe way to add recall. **Static analysis raises candidate findings;
the LLM judges them.** This is deliberately **not** "inject more facts into the
prompt" — that was tried (structural facts + parse diagnostics in the review text)
and gave no recall gain and slight FP increase, because such facts are not
bug-relevant and the model ignores them. P1 instead makes AST detectors emit
**candidate findings** that flow through the **existing refutation gate**, exactly
like the model's own candidates.

**Principle:** the deterministic detector contributes *recall* (raises a suspicion
the generic prompt overlooked); refutation contributes *precision* (the model must
confirm it, killing false hits).

**Reuses machinery we already have.** Deterministic signals already mint
`CandidateFinding`s today (`run/planning/task-planning.ts`, `proposedBy:
'deterministic-trusted-rule'`) and the ast-grep engine is in place
(`domains/deterministic-signals/ast-grep/`). P1 adds new detectors that feed the
same path.

**High-level pipeline integration:**
1. **Detector pass** (new module, e.g. `deterministic-signals/detectors/`): run a
   small set of ast-grep patterns over the *changed* files only (scope = diff).
2. **Emit candidates:** each match → a `CandidateFinding` with category, severity,
   precise location, a generic title/description, and `proposedBy:
   'deterministic-detector'` (a distinct provenance so we can measure their
   precision separately).
3. **Merge into the candidate pool** alongside the holistic model candidates,
   deduped by location/title (so a detector hit the model also found collapses to
   one).
4. **Refutation judges every candidate** — including detector ones — using the
   existing per-candidate refutation. False detector hits are refuted and dropped.
5. **Admission** admits the survivors as normal.

**Initial detector catalog (start with the 2 highest-signal, then expand):**

| Detector | Pattern (illustrative) | Recovers |
| --- | --- | --- |
| Unawaited async in array iteration | `$ARR.forEach(async $CB)`, `map`/`filter` with async cb whose result is discarded | the TS critical `forEach`-async miss |
| Dangerous dynamic sink (SSRF/injection) | `open($DYN)`, `requests.get($DYN)`, string-concatenated SQL, `eval`/`exec`/deserialize | the Ruby SSRF, raw-SQL misses |
| Resource not released on all paths | handle/URL/connection created, no `close`/`revoke`/`defer` | leak misses |
| Unsynchronized read-modify-write | `$X = $X + …` / get-then-set on shared state w/o guard (heuristic) | stale-read & race misses |

**Hard rules (non-negotiable, from prior failures):**
- **Generic only, never benchmark-fitted.** A previous deterministic-rule layer was
  ripped out (commit R7) because it hardcoded specific benchmark signatures
  (`slotEndTime`, `BuildIndex`, `backupCodes`). Detectors must be universal
  language patterns that fire on *any* repo. Validate by running them on held-out
  code, not the benchmark.
- **High-precision patterns, few, bounded.** Each detector hit costs a refutation
  call and risks an FP if refutation rubber-stamps it (same flood failure mode as
  2-pass). Start with 1–2 detectors where a match is *usually* a real bug; cap hits
  per task; measure precision per detector and drop any that net-add FPs.

**Wiring task to verify first.** Today `supportSignalCandidates` mainly serve as
*corroboration* for model candidates in the refutation packet. For P1 to add
*recall* (catch what the model missed entirely), a detector candidate must be
**independently refutable and admissible** — i.e. reach `admission` on its own when
the model raised nothing there. Confirm/extend this path; the emission + refutation
machinery already exist.

**Effort:** medium. **Risk:** low–medium (generic + model-gated, but precision is
coupled to refutation quality → pairs with P3).

#### P1 spike result (2026-06-25) — path proven, forEach detector too broad to ship

A spike implemented the `forEach(async …)` detector end-to-end (ast-grep candidate
→ trusted-rule template → merge → refutation → admission) and smoked it on the two
benchmark cases that expect a forEach-async bug:

- **The path works.** Detector-originated candidates flowed through refutation and
  were **admitted and matched** to the previously-missed expected findings:
  cal-dot-com-01 went 0→**2/2 matched** (incl. the *critical* forEach miss);
  cal-dot-com-05 matched the forEach-async expected finding it had missed. ✅
- **But precision cratered.** The detector accurately fires on **every**
  `forEach(async)` site (all hits verified as real), and the golden set credits
  only *one* per case — so cal-dot-com-05 gained **7** "unawaited async forEach"
  findings scored as false positives, and **refutation could not filter them
  because they are genuinely real** instances of the pattern (verdicts came back
  "proved", correctly). ❌

**Lessons (refine before any full eval):**
1. **`forEach(async)` is too common to be a good first detector.** A P1 detector
   must be *rare* and *almost always worth flagging*; a ubiquitous pattern floods.
2. **Refutation can't rescue an over-eager detector when the hits are real** — it
   correctly "proves" them. So detector *selectivity* matters as much as detector
   correctness; this is a detector-side problem, not only a P3 problem.
3. **Fixes:** (a) make the detector far narrower (e.g. cap to one finding per
   function/file, or require additional risk signal), and/or (b) lead with a
   genuinely *rare* high-precision detector instead — dangerous dynamic sinks
   (SSRF `open($DYN)`, raw-SQL) fire seldom and are almost always worth a comment.

**Status:** spike code is kept but **NOT enabled by default / not merged** — the
mechanism is validated; the specific detector needs selectivity work first.

### P2 — Reverse-reference context (callers) for changed symbols  *(Cause A)*

**Principle:** a change is only safe if its *callers* still agree with it. Today we
see what the changed file depends on, but not what depends on the changed file — so
we are blind to the most common cross-file defect: a change that breaks its own
call sites. P2 supplies that missing half as **context** (not as findings).

**Current state (R4, forward only).** `run/context/referenced-definitions.ts`
resolves the changed files' *relative imports* to existing unchanged files
(`relativeImportCandidates` + `resolveExistingPathInsideRoot`), ranks by import
frequency, and injects a bounded, byte-capped digest as a context-only
`referenced-definition` document. It answers "what does this change *call*?" — the
**callee** direction.

**P2 adds the caller direction.** For each **changed exported symbol** (function,
method, class, type — we already extract symbol facts via the TS compiler / ast-grep):
1. **Find its references** across the repo with an ast-grep usage search (the
   symbol name as a call/identifier), excluding the changed file itself.
2. **Extract the call site** — a small line window around each usage (the actual
   call expression + a little surrounding context), not the whole file.
3. **Bound it** with the same discipline as R4: cap distinct caller files, total
   byte budget, rank by relevance (e.g. most-referenced symbol / nearest match
   first) so the highest-signal call sites win the budget.
4. **Inject as a new context-only document kind** (e.g. `referencing-call-site`),
   clearly labelled "callers of changed symbols — context only, do not report
   findings here unless the changed code makes the call wrong."

**What it catches (the 20% cross-file class):**
- Caller passes wrong / too few arguments after a signature change (the Go
  `RuleActionsButtons` miss).
- A changed return shape / type not handled at the call site
  (`parseRefreshTokenResponse` returning a `safeParse` result class of miss).
- Contract / invariant drift — one site updated, its siblings not.

**Feeds both stages.** The caller digest goes into the **discovery** context (so
the model can *spot* the break) **and** is available to **refutation** (so it can
*verify* a contract claim by reading the actual call site instead of guessing) —
which is why P2 also strengthens P3.

**Important honesty caveats:**
- **Benchmark-slice limit.** Many benchmark slices contain only the changed files.
  Callers living in *unchanged* files are absent from the slice, so P2 cannot help
  those cases *on the benchmark* — but it helps them in real repos. P2's benchmark
  gain is limited to multi-file PRs where the caller is itself in the changed set;
  its real-world gain is larger. **Measure on a real repo, not only slices.**
- **Reference search is heuristic.** Name-based ast-grep matching can over-match
  (same name, different symbol). Keep windows small, cap counts, and treat it as
  context the model weighs — never as an auto-finding.

**Effort:** medium. **Risk:** low (context-only; cannot itself create findings).

### P3 — Stronger, context-richer refutation  *(Cause B — the biggest precision+recall lever)*
The refuter is where both our FP problem and our "can't confirm real bugs" problem
live. Three concrete upgrades:
1. **Give refutation the same enriched context** as P2 (callers/callees) so it can
   actually trace a claim instead of guessing.
2. **Use TS-compiler type facts deterministically** to auto-refute type-impossible
   claims (e.g., "null deref" on a statically non-nullable value with no
   contract-violating caller) — kills a chunk of the 34 "bug" FPs, especially TS.
3. **Category-aware proof bar:** require logic/"bug" claims to cite a concrete
   triggering input/path to be "proved"; keep security slightly more lenient.
   Tightens the over-ready "proved" verdict without nuking recall.

Expected: raises precision (fewer "bug" FPs, less TS noise) **and** recall (keeps
real bugs it can now verify). Effort: medium–high. Risk: medium — must be
eval-gated to avoid over-killing.

#### P3 spike results (2026-06-25) — the two PROMPT sub-levers failed

Smoked the two cheapest refuter-prompt sub-levers on cal-07 / cal-03 / grafana-05:

- **Category-aware proof bar** ("name the concrete trigger to prove a bug"): **no-op.**
  Verdict mix unchanged (~7–8 "proved" per case), FPs flat. The refuter over-proves
  out of *confidence, not vagueness* — it can narrate a plausible trigger for a
  confident-but-wrong claim, so a "name the trigger" bar doesn't filter it.
- **Anti-anchoring reframe** (treat the candidate as the proposer's *unverified
  hypothesis*; re-derive independently; default skeptical): **backfired.** "proved"
  went UP (7→10, 8→9, 1→2), FPs UP on all three, and cal-07 lost a match. Asking the
  model to "independently verify" a plausible claim makes it re-construct a
  justification and confirm *more*, not less.

**Conclusion:** prompt-level refuter changes do not fix the over-proving — it is an
intrinsic model-confidence problem, not instruction-addressable. This is now the
**5th prompt/discovery lever to come up empty** (2-pass, prompt-strengthening,
language focus, proof bar, anti-anchoring). The only structurally-different,
untried sub-levers remain (2) deterministic **TS type-fact** auto-refutation
(narrow, real precision but only covers type-disprovable claims — a minority) and
the **adversarial multi-vote** (redundancy, not instruction — could work where
prompts can't, but N× cost and it sharpens precision, already our strength, not the
recall gap). Both reverted/uncommitted. **Recommendation: stop prompt experiments;
the cheap/medium levers are exhausted.**

### P4 — Light static-analysis fusion  *(Cause C, optional)*
Optionally run a couple of fast, high-signal linters per language (e.g.
type/unused/await rules) and feed results as **support signals** (not findings).
CodeRabbit's edge is partly 40+ analyzers. Start with 1–2 per language and measure.
Effort: medium. Risk: low–medium (dependency + noise management).

### Explicitly NOT doing (already disproven or low-ROI)
- Re-enabling undirected 2-pass discovery (tanked precision).
- Prompt "deep analysis / per-language checklist" strengthening (net-negative ×2).
- Chasing low-severity/nit recall (intentionally suppressed).

---

## 6. Suggested sequence

1. **P1 (async + dangerous-sink detectors)** — fastest path to recovering named
   hard misses, precision-safe. One full eval to confirm.
2. **P3.2 (TS-type-fact auto-refutation)** — directly attacks the TS FP cluster;
   cheap precision win.
3. **P2 (reverse-reference context)** — unlocks cross-file/contract class; measure
   on a real repo, not just slices.
4. **P3.1 + P3.3 (richer + category-aware refutation)** — the deeper recall+precision
   lever, once P2 context exists to feed it.
5. **P4** only if P1–P3 plateau.

Every step is **eval-gated**: keep the change only if F1 improves _without_
precision dropping below ~50% (our differentiator). Watch per-language precision —
TypeScript is the canary.

---

## 7. One-line root-cause summary

> We are precision-first and context-narrow. Our misses come from **(A)** not
> seeing beyond the changed file, **(B)** a refuter too weakly-contexted to confirm
> or kill plausible logic claims, and **(C)** no targeted detectors for the
> high-value patterns (async/races/dangerous sinks) the generic prompt overlooks.
> The fixes are structural (more context, deterministic seeds, stronger
> verification) — **not** more prompting or more passes, both of which we measured
> as net-negative.
