# The enumeration gap: located, corroborated, and what to do about it

Date: 2026-07-27
Status: proposal — no code changes beyond the scoring fix noted in §1.

This supersedes the "logic tier is our weak tier" framing in
`reports/2026-07-26-accuracy-and-measurement-plan.md`. That framing was an
artefact. The real defect is different, larger, and better evidenced.

---

## 0. One-paragraph summary

The engine finds roughly **one defect per file**, not one per case. Recall on the
first expectation in a file is **72.8%**; on any later expectation in the *same*
file it is **4.7%**. A later expectation in a *fresh* file scores **79.8%** —
higher than a first one. The defect-type axis collapses once this is controlled
for, so this is an **enumeration failure, not a capability failure**, and it is
worth about **28 recall points** — more than every capability gap combined. The
published literature documents this exact curve, explains why our four previous
interventions could not have worked, and names the mitigations that do.

---

## 1. First, a correction: adjusted precision is inflated

`adjustedPrecision` (reported 95–100%) is absorbing verbosity.

Mechanism, verified in two files:

- `eval-matcher.ts` treats a finding as duplicate only on **zero-tolerance line
  overlap**. In `traefik` the matched finding sits at `kubernetes_http.go:592`
  and the restatements at `:593` — adjacent lines in the same three-line block,
  naming the same nil dereference. They do not overlap, so they escape dedup.
- `eval-plausibility-judge.ts` judges **one finding at a time**, with the file
  but without the matched findings and without its own prior verdicts. Its
  prompt says to decide only from the code in front of it. Every restatement is
  individually true, so every one is confirmed.

Scale, across nine runs and 164 unlisted-real findings:

- **89 (54.3%)** sit within 3 lines of a finding already matched in the same file.
- **63** repeat a `path:line` already counted as unlisted-real in the same case and run.
- Beyond traefik: `gin` (matched `context.go:122`, unlisted-real `:141`, both
  "Copy drops Errors"); `slim` (line 32 and line 57, both the unescaped title);
  `vite` (`utils.ts:14` `wrapId` and `:22` `unwrapId`, both named in one expectation).

| run | raw precision | adjusted precision | unlisted-real (traefik) |
|---|---:|---:|---:|
| 083924 / 091928 | 0.804 | 1.000 | 9 (0) |
| 092459 | 0.766 | 0.923 | 8 (0) |
| 085222 / 091255 / 093118 | 0.55–0.59 | **1.000** | 25–27 (18) |
| 085815 | 0.500 | 0.882 | 26 (15) |

Raw precision halves; adjusted precision does not move. The metric is
structurally blind to the failure mode the engine actually exhibits — verbosity
at one site — which is also the failure mode that most damages a real review.

**Fixed 2026-07-27** (scoring-side only). The plausibility judge now receives
every finding already credited as real in the same file — matched, or credited
as unlisted-real earlier in the same run — and answers a second, orthogonal
question: does this restate one of them? A restatement is excluded from
`unlistedRealFindingCount`. `EVAL_METRICS_VERSION` bumped, so these reports will
not pool with older ones. Red-then-green proof on a fixture reproducing the
traefik shape; 959 tests green; drift check passes.

The matcher's line tolerance was deliberately **left at zero**. Widening it
would merge two genuinely distinct adjacent defects as readily as it catches a
restatement, and would do so silently — the same-defect question is semantic and
belongs to a judge that reads both descriptions, not to a line-distance
threshold.

Expected effect, **estimated not measured**: a majority of
`unlistedRealFindingCount` in affected runs moves to `genuineFalsePositiveCount`,
so adjusted precision should fall from ~95–100% into roughly the 60–85% band,
staying above raw precision (0.50–0.59) because some unlisted-real findings are
genuinely distinct. A real run is needed to pin the number.

**One open inconsistency.** A line-*overlapping* duplicate lands in
`duplicateFindingCount` and is excluded from false positives, while a semantic
restatement at a non-overlapping line now counts as a genuine false positive.
Same phenomenon, two buckets, split by whether line ranges happen to touch. The
current split is defensible under Google's effective-false-positive definition
(a finding nobody acts on counts against you), but it should be made deliberate
rather than incidental.

Note that this cuts both ways: it means the engine's true novel-finding rate is
lower than claimed, **and** that a chunk of what looks like recall headroom is
the engine already looking at the right code and merely restating itself.

---

## 2. The enumeration gap

### 2.1 The measurement

Nine runs, 36 cases, 80 expectations, 720 expectation-instances. Independently
reproduced.

| slice | recall |
|---|---:|
| first expectation in its file | **72.8%** (308/423) |
| any later expectation, same file | **4.7%** (14/297) |
| case-rank 0 | 70.7% (229/324) |
| case-rank 1+, but first in a **new** file | **79.8%** (79/99) |
| case-rank 1+ in a file already used | 4.7% (14/297) |

The 74%/24% rank effect reported yesterday is entirely this. **20 of 25
multi-expectation cases never matched two expectations in one file across all
nine runs.** The cases that ever did are the ones whose expectations span
separate files.

### 2.2 The type axis collapses

Six defect types score 69–100% at file-rank 0 and **exactly zero** at
file-rank 1+: boundary/off-by-one (25/27 → 0/45), branch asymmetry (25/36 →
0/45), concurrency (13/18 → 0/18), missing validation (29/36 → 0/27),
resource release (18/18 → 0/18), caller/callee contract (23/36 → 0/9).

Found-then-missed pairs, same file, same type, where the **missed** one is equal
or higher severity — eleven exist; a sample:

- `typeorm` — `storeInCache` no try/finally (medium) **9/9**; `clear` never
  releases at all (high) **0/9**.
- `netty-kqueue` — operator precedence (medium) **8/9**; missing capacity
  assignment (high, runtime-critical) **0/9**.
- `casbin` — high security **9/9**; high runtime-critical panic **0/9**.
- `werkzeug` — a **low**-severity expectation **9/9**; two mediums in the same
  file **0/9**. So selection is not severity-ranked either.

Counterfactual: at the file-rank-0 rate throughout, corpus recall goes
**44.7% → ~72.8%**.

### 2.3 Two further corrections to yesterday's report

- **There is no `nit` tier.** The census is `logic 44, security 25,
  runtime-critical 11`. The reported "nit 100%" was a vacuous 0/0.
- **Logic is not the weak tier.** At equal attention: **logic 71.1%**,
  security 61.7%, runtime-critical 98.8%. Logic's 35.9% headline is a
  composition artefact — it carries the highest share (36%) of later-in-file
  expectations. The weakest tier is **security**.

---

## 3. The literature says this is a known curve

- **Sovrano, Bauer & Bacchelli, FSE 2025** — *"LLMs for In-File Vulnerability
  Localization Can Be 'Lost in the End'"* ([arXiv:2502.06898](https://arxiv.org/abs/2502.06898)).
  Defects later in larger files are detected significantly less often (p<.05),
  consistently across models and vulnerability types. Mitigation tested:
  **shrink the review unit → +37% average recall.** Warns that reduced global
  context may raise false positives.
- **"Beyond Single Bugs", Dec 2025** ([arXiv:2512.22306](https://arxiv.org/html/2512.22306)).
  Controlled density injection, ~16k files, 4 languages. Recall collapses as
  defect count rises: Llama-3.3-70B **94.4% → 46.4%** (1 → 9 defects),
  GPT-4o-mini 89.9% → 29.6%. "All defects found" **70.2% → 2.1%**. The failure
  is systematic **under-counting**, never over-counting. No mitigation tested.
- **Mitropoulos et al., Apr 2026** ([arXiv:2603.18740](https://arxiv.org/pdf/2603.18740)) —
  the presence of nearby defects *suppresses* detection of a target defect
  (masking, not just positional decay). Direction verified; magnitudes not
  extractable from the PDF, so do not cite numbers.

Our 72.8/4.7 is the same phenomenon at its extreme.

**This explains why all four previous attempts failed.** The enumeration sweep
and the diverse-lens pass both **re-asked over the same artifact**; the sweep
even carried prior findings in the conversation, which anchors rather than
diversifies. A positional/density bias cannot be argued away by asking again.
Cross-file retrieval and the context scout *added* context, and the literature
independently reports monotonic degradation with added context — consistent with
our own measured net-negative.

Convergence worth noting: SWRBench (1,000 verified PRs) finds **logic is its
highest-recall category (54.6%)**. The researcher flagged our "logic is weakest"
as anomalous. Once corrected for file-rank, our logic tier is 71% and the
anomaly dissolves. Two independent routes to the same correction.

---

## 4. Where we actually stand versus published work

| system | recall | precision |
|---|---|---|
| SWRBench best overall | — | F1 **19.4%** |
| CR-Bench, GPT-5.2 single-shot | 27.0% | **3.6%** |
| BitsAI-CR (ByteDance, FSE 2025 industry) | — | **75%** |
| CodeRabbit, own disclosure (post-pipeline) | — | **28.6–39.3%** |
| Martian live board, best (Greptile) | **50.1%** | 77.6% |
| Martian live board, CodeRabbit | 51.3% | 65.9% |
| **this engine** | **46.7%** | high (figure pending §1 fix) |

Martian's board (pulled 2026-07-27, 4,296 scored PRs) is the only continuously
run benchmark by a party that sells no reviewer. Best commercial recall is ~50%.
**Our recall sits in the same band as shipping commercial products.** The recall
gap is a product target, not a technical deficit.

Everything else here is marketing. **Four vendors each claimed "#1 on Martian"
within six weeks of 2026 with mutually incompatible numbers, and the live board
matches none of them.** Three vendors ran the same five-repo corpus and each came
top. The spread for a *single* tool across benchmarks (Greptile: 36% / 46% / 50%
/ 82%) **exceeds the spread across tools within any one benchmark**. No
peer-reviewed paper benchmarks any named commercial reviewer.

### 4.1 The calibration that should worry us more than recall

Google's Tricorder defines an **effective false positive** as any finding where
*developers took no positive action* — technically correct but ignored still
counts against you. Their bar to enable a check: **<10%**; measured overall
**just under 5%**.

Greptile measured their own raw output at **19% good / 2% incorrect / 79% nits**.
The dominant failure of an LLM reviewer is not being *wrong*, it is being **right
and useless**, by roughly 40:1. Their fix was a per-team embedding filter over
historical up/downvotes (block on ≥3 similar downvoted neighbours) — explicitly
**not** prompting and **not** LLM self-evaluation. Ellipsis independently built
the same mechanism.

**Two filters solve two different problems**, and conflating them is the common
design error: a judge/evidence filter for *correctness*, a statistical feedback
filter for *usefulness*. We have the first and no instrument at all for the
second — and §1's duplicate-restatement burst is precisely a usefulness failure
that a correctness filter cannot see.

### 4.2 Non-determinism is larger than the effects we keep chasing

Semgrep ran Claude Code three times on the same application and found **3, then
6, then 11** distinct vulnerabilities. In a 4-tool / 146-PR / 679-finding
independent trial, **93.4% of findings were unique to a single reviewer and zero
findings were converged on by all four**.

Two consequences. First, our sd 4.8pp band is normal, not a defect of our setup,
and any n=1 A/B in this field — ours or a vendor's — is reporting noise. Second,
**every recall denominator in every benchmark is badly incomplete**, which is
independent support for the §6 methodology change.

---

## 5. Plan

### Step 0 — free diagnostics, before buying anything

1. ~~**Refutation kill-rate by tier and by mechanism.**~~ **DONE 2026-07-27 —
   the gate is exonerated, and the result reframes the whole plan.** See §5.1.

   Original reasoning retained below, because the hypothesis was reasonable and
   the answer is what matters.

   If logic candidates are
   generated and then killed, no discovery technique is the right purchase — the
   gate is. A proof obligation calibrated on security sinks will over-kill logic,
   which is intrinsically harder to prove from source alone. Zero provider cost;
   instrumentation already exists.

   This is now the highest-priority diagnostic on the list, because the published
   cost of a refutation stage is **large and wildly uneven**. "Sifting the Noise"
   ([arXiv:2601.22952](https://arxiv.org/abs/2601.22952)) measured LLM agents
   filtering SAST output: **92.1% of noise eliminated — but only 77.7% of true
   positives retained**, i.e. **22% of genuine defects destroyed by the filter**.
   The split by class is the alarming part: injection miss rate **<3%**,
   cryptography miss rate **>77%**.

   We already record **crypto / XSS / SSRF at 0% recall**. A global refuter is
   the wrong shape for exactly those classes, and we have never checked whether
   our own gate is what removes them. If it is, that is a far cheaper fix than
   any new discovery mechanism.
2. **The clean capability experiment.** Review a file whose *only* known defect
   is a current file-rank-1+ miss. This is the one experiment that separates
   "cannot find it" from "stopped looking". Everything in §5 assumes the latter;
   this is what would falsify it. Small, bounded cost.

### 5.1 Result of the free diagnostic: the gate is not the problem

Measured across the same nine runs (653 refutation verdicts, zero provider spend):

| refutation verdict | count | share |
|---|---:|---:|
| proved | 623 | **95.4%** |
| needs-more-evidence | 21 | 3.2% |
| **refuted** | **9** | **1.4%** |

| admission rejection | per run |
|---|---:|
| refuted | 1.0 |
| location-invalid | 1.0 |
| duplicate | 0.1 |
| **total rejected** | **2.1** of ~70 candidates |

**The refuter kills one finding per run.** The "Sifting the Noise" hazard —
a filter destroying 22% of true positives, >77% for crypto — **does not apply to
us**. Our crypto/XSS/SSRF blind spots are not the gate removing them; discovery
never proposes them. This confirms on the current 36-case corpus what earlier
instrumentation showed on the old one, and it removes the cheapest possible
explanation for the enumeration gap.

**Two consequences that change how to read the rest of this plan.**

**(a) Our precision does not come from refutation. It comes from discovery being
conservative.** That is a much more fragile place for it to come from — it means
precision and recall are coupled at the same knob, which is exactly why every
"find more" intervention we tried cost precision.

**(b) The refutation stage has enormous unused capacity, already built and
already paid for.** The literature's recurring prescription is *generate wide,
verify hard*; Cursor's documented v1→agentic rewrite inverted their prompting
from restraint to "investigate every suspicious pattern" and resolution rate went
52% → 70%+. We are currently doing the opposite of the first half while running
a verification stage at 1.4% utilisation.

This substantially de-risks Steps 1 and 2. The windowing and enumeration changes
are supposed to raise candidate volume; the stage that would absorb that volume
is demonstrably not saturated. It also means the honest expectation is that
refutation's kill rate should **rise** when those land — if it stays at 1.4%
after we widen discovery, the refuter is not doing its job and precision will
fall instead.

### 5.2 Capability test result: attention confirmed — but the anchor is the DIFF

Run 2026-07-27, $1.58 of a $2.00 ceiling, 139 provider calls, production model
and prompt (gpt-5.3-codex, temperature 0), no full-corpus eval.

Window rule, fixed in advance and applied identically everywhere: **60-line
windows from line 1, stride 40**. It reads only the file's line count, so it
cannot have leaked defect locations. Two arms:

- **Arm A** — production packet, file section replaced by one window. **The
  whole-file diff still present, as production sends it.**
- **Arm B** — window only, diff withheld.

**Controls first.** Arm A found 3/3 strict controls (7/7 with near-controls) —
a sound harness. Arm B found 0/3 strict (1/7) — a **weak instrument**, so its
negatives prove nothing and only its positives count.

**The decisive number: only 16 of 76 Arm A candidates (21%) point at a line
inside the window they were shown.** `casbin`'s role_manager.go is 1251 lines;
all 31 windows returned exactly one finding, all at **L820** — including window
[1201-1251], where line 820 is 400 lines away and not present in the packet.
`starlette`: 14/14 windows, one finding, all at L516.

**The engine is not reading the file and stopping early. It is answering the
diff and never reading the rest.** On this corpus "one defect per file" is
really **one defect per diff hunk** — and five of six diffs here are one- or
two-line hunks.

The cleanest proof is `slim`, one 84-line file, same model, prompt and
temperature:

| presentation | idx0 | idx1 |
|---|---|---|
| production (full file + diff) | 7/9 | **0/9** |
| Arm A (60-line window + diff) | 2/2 | **0/2** |
| Arm B (60-line window, no diff) | **0/2** | **2/2** |

The model can detect idx1 and never exercises that capability while idx0 is
anchored by the diff. **Attention, demonstrated by construction.**

Recovery: 2 of 7 never-found expectations (`rack-static` idx1 via Arm A 5/5;
`slim` idx1 via Arm B 2/2). Arm B also surfaced genuine defects the key omits
(a `remove()` leak in typeorm, a byte-vs-element copy limit in netty).

| arm | windows | candidates | mean/window | inside own window |
|---|---:|---:|---:|---:|
| A (diff + window) | 69 | 76 | 1.10 (never >2) | **16/76 (21%)** |
| B (window only) | 69 | 50 | 0.72 (0–5) | **50/50 (100%)** |

#### What this does to Step 2

**Step 2 as originally written would have failed.** It proposed windowing the
*file section* while the packet kept the whole-file diff. Arm A is exactly that
configuration and it recovered almost nothing at N× the cost. The file section
was never the binding constraint.

**The variable that must be decomposed is the diff — or the anchor must be
removed for a second pass.** The revised shape (§5.3) is additive, mirroring the
security pass: keep the diff-anchored pass, which is precise and reliably gets
the primary defect, and add an un-anchored windowed pass whose candidates merge
in. That makes the semantic merge (separate proposal) a hard prerequisite, not a
nicety: Arm B's candidates carry different anchors and different ids by
construction.

#### Honest limits — this is one experiment

- **n=1 per window**, against a measured sd 4.8pp band.
- **Arm B moves two variables at once** (unit size *and* the diff). Its five
  negatives are weak evidence for anything.
- **Selection was not random** — 7 of 31 eligible, chosen for language spread and
  the examples this report names. The two recoveries may be the easy end.
- **Five of six diffs are one- or two-line hunks.** Diff anchoring is plausibly
  weaker on a real multi-hunk PR, so the effect size may not transfer.
- **Some of the gap is not addressable by decomposition at all.** `netty` idx1
  and idx2 sit in the same 25-line function; no window scheme of any size
  separates them, and 13 attempts never surfaced idx2.
- Match judgements were made by hand, not by `eval-matcher`, with both sides
  quoted so they are auditable. `slim` idx1 is defensibly scoreable either way.

### 5.3 Revised Step 2 — decompose the anchor, not the file

Supersedes the original Step 2. Same evidence base (Sovrano's +37% still stands;
our result refines *what* to shrink), now constrained by our own measurement:

1. Keep the current diff-anchored pass unchanged. It is what earns our precision
   and it reliably lands the primary defect.
2. Add an **un-anchored windowed pass** — window without the whole-file diff, so
   the model has no changed line to answer and must read what it is given.
3. Merge additively through the semantic merge, then refute as usual. Refutation
   is at 1.4% utilisation (§5.1) and is the stage that must absorb the extra
   volume; expect and require its kill rate to rise.
4. Bound the window count per file. Arm B cost $0.54 for 69 windows across six
   files; unbounded, this is the most expensive item on the list.

Measure before believing: Arm B lost 6 of 7 controls, so an un-anchored pass on
its own is not a reviewer. It is only a candidate generator feeding a gate.

### Step 1 — cheap, evidence-backed, ceiling-breaking

3. **Drop the implicit "primary issue" framing; enumerate; prune by predicted
   effect.** Sun et al., Jun 2026 ([arXiv:2606.01859](https://arxiv.org/html/2606.01859v1)),
   1,438 Go review instances: removing the single-most-important-issue
   constraint gives **+4.68pp, McNemar p<0.05**, candidates 1.0 → 3.1. The
   essential second half is **refinement-guided pruning** — simulate the edit
   each comment would induce, drop comments that induce no change or a change
   duplicating a higher-ranked candidate: pool 7.2 → 3.1 **retaining 99.6% of
   the benefit**. Near-zero cost. We already emit suggestions, so the predicted
   edit is nearly free. The pruning half *also* attacks the traefik duplicate
   problem on the product side, not just in scoring.

4. **Differential / re-derivation prompting for the logic tier.** Li et al.,
   ASE 2023 ([arXiv:2304.11686](https://arxiv.org/abs/2304.11686)): ask for the
   *intended* behaviour, synthesize from that intent, prompt on the **nuances
   between the two versions**. ChatGPT **28.8% → 75.0%** on QuixBugs, 66.7% on
   post-cutoff problems. Mechanism: models are poor at spotting subtle
   differences unless attention is forced onto a diff. Differs from the failed
   lens pass — that changed the *checklist*; this changes the *comparison
   object*. Precedent for cheap prompt-shaped wins here is strong (the one-line
   injection guard moved recall 62.5% → 81.3%).

### Step 2 — the main structural bet

5. **Bounded-window decomposition of the review unit, union-merged.** Review a
   file as overlapping bounded windows or per-declaration units; union the
   candidates; refute each against **full-file** context. This is the only
   intervention with a peer-reviewed effect size on exactly our failure
   (+37%, FSE 2025), and it maps cleanly onto our architecture: it changes
   **discovery only**, so the "less global context → more FPs" risk Sovrano
   flags is absorbed by the refutation stage we already run. Cost ~1.2–2×
   discovery input; caching is unreachable per our probe, so assume real spend.

### Step 3 — priced, optional, capped

6. **k-sampling with union merge — never consensus.** SWRBench self-aggregation:
   recall **+118.8%** at n=10, plateau at n=5, precision flat. But this is
   **ceiling-approaching, not ceiling-breaking**: our measured union ceiling is
   **67%**, so it cannot exceed that, and our cache probe prices it at +40–50%.
   Merge must be union + refutation. Vallecillos-Ruiz et al. 2026: on Defects4J
   the union solves 205 problems vs 112 for the best single model, and **every
   consensus strategy underperformed a naive baseline** — the "popularity trap".
   Majority voting would delete precisely the rare later-rank findings we want.

### Explicitly not doing — the literature reproduces our own failures

| approach | evidence against |
|---|---|
| sequential re-asking / reflexion | CR-Bench: recall 27→32.8% but **signal-to-noise 5.11 → 1.95** |
| consensus / majority voting | popularity trap; every consensus strategy lost to a naive baseline |
| discovery-time checklists | our own A/B (authz traded for injection); rubrics only work at *adjudication*, after a site is fixed |
| more context | monotonic degradation across 8 frontier models; our own net-negative retrieval |
| self-review as oracle | producing model silently endorsed **31.7%** of confirmed semantic drift |
| more adversarial critics | Cross-Model Critic ≈3% of kills; **80+ agents unanimously endorsed a non-existent vulnerability** |
| verdict + explanation + fix in one call | GPT-4o spurious rejection 26–36% → **73–88%** when a fix is also requested |

---

## 6. Measurement: our incomplete-key problem is a solved problem elsewhere

The user's question — *"does 'finds more than the answer key knows' mean we need
a better dataset?"* — has a 20-year-old answer in information retrieval. Our
situation is exactly the **TREC pooling problem**: a curated key under-lists,
the system returns real things the key omits, and they score as false positives.

**Buckley & Voorhees, SIGIR 2004** (`bpref`) established the load-bearing
finding: under incomplete judgments, system rankings shift in a way that
**systematically favours systems that return fewer unjudged items**. Read that
against our engine: our current scoring *penalises the reviewer for finding
things the fixture authors did not think of*. `bpref` and `infAP` fix this by
never assuming unjudged = wrong. Sakai's condensed-list method generalises it:
strip unjudged items from the list, then apply any standard metric.

The actionable consequence is **stop picking one number; report the bracket**:

- **Lower bound** — unjudged findings count as FP. This is our raw precision.
- **Upper bound** — unjudged findings leave the denominator. This is
  approximately what our plausibility probe computes as `adjustedPrecision`.
- The truth is bracketed. Neither is honest alone; **the pair is the result.**

The literature also warns which error is bigger: condensed-list metrics
**overestimate new systems more than traditional metrics underestimate them**.
So the upper bound is the less trustworthy end — which is independently what §1
found by a completely different route.

Positive-Unlabeled learning gives the formal version, and it is clarifying: under
the standard assumption **recall is estimable from PU data but precision is not**
— false positives are not identifiable, because "wrong" and "right but unlabeled"
are indistinguishable. **Our adjusted precision will always be an estimate, never
a measurement.** That is a permanent property, not a gap to close.

### 6.1 Two dataset changes that are legitimate

**(a) Precision from clean cases, measured not estimated.** SWRBench pairs 500
Change-PRs with **500 verified issue-free Clean-PRs**, where *any* comment is a
false positive by construction. That sidesteps the incomplete-key problem for
precision entirely, with no adjudication and no judge. Our 10
`expectedNoFindingZones` are the same idea in miniature and currently score a
clean zero. Spec 17 records three reasons whole clean cases are impossible for
us; that judgement should be **re-examined against this design**, because
expanding the zone mechanism is far cheaper than expanding the answer key and is
immune to the pathology in §1.

**(b) Pool, then judge — with humans.** TREC builds keys from the **union of what
all participating systems returned**, then has humans judge that pool. This is
*not* a licence to mine our own output: the rule stays that engine findings never
enter the key unjudged, because that converts recall into similarity-to-our-2026
-engine. The legitimate version is **pooling plus human adjudication**, and the
place to start is a sample of the `unlistedReal` set — which §1 predicts will
come back majority-duplicate.

Calibrate the judge the way SWRBench does, and report it the same way: not
"90% agreement" but **Cohen's κ against a human-human baseline on the same
task**. Theirs is κ 52.8–62.0 against inter-human 56.3–62.6 — the judge is as
good as a human, and humans are only moderately good. That is the honest shape
of the claim.

---

## 7. Honest limits

- The **capability-vs-attention** claim rests on same-type/same-file
  found-vs-missed pairs and the 79.8% new-file rate. The clean experiment
  (§5 step 0.2) has not been run. It is the cheapest way to be wrong early.
- Every logic-tier technique cited (differential prompting, postconditions,
  metamorphic testing) was evaluated on **single-bug algorithmic functions**
  (QuixBugs, Defects4J, Codeforces), not real repository diffs. Transfer is
  plausible, unproven.
- **Defects4J shows the highest memorization signal** of any bug benchmark, so
  absolute numbers from nl2postcond and METAMON are optimistically biased; the
  mechanisms are safer than the figures.
- The three 0%-recall defect types in the per-type table (`unchecked error`,
  `encoding mismatch`, uninit/randomness) rest on n = 2–3. All three
  `unchecked error` expectations are file-rank 1+, so that type has **never had
  a fair test**. Do not act on those rates.
- **Our incomplete-key problem has no clean literature.** CR-Bench concedes its
  key is non-exhaustive and simply prioritizes verified defects. No code-review
  paper adopts the IR/TREC pooled-judgment machinery (bpref, infAP) this calls
  for. Our plausibility-probe-adjusted precision appears ahead of published
  practice — which is a reason to fix it properly (§1), not to trust it.
