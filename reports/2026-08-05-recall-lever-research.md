# Which recall lever is worth buying — a literature check before building

Date: 2026-08-05
Status: research. No code changes. Commissioned to stop the next recall
intervention being chosen by intuition, after five were built and withdrawn.

Every number below names its study design, and vendor claims are marked as such.
Where the evidence is absent rather than negative, that is stated — the two are
not the same and this project has confused them before.

---

## 0. The result in one paragraph

**There is no validated recall lever available to buy.** Of the four candidates
examined, one is directly contradicted by controlled measurement, two are
promising but unvalidated on anything resembling a real pull request, and the
fourth rests on a single unaudited vendor blog post. The one clearly
evidence-backed and untried change is not a recall lever at all: it is
**cross-file navigation inside the verification stage**, which the strongest study
in the set measured as its single largest factor. That is what this project should
build next, and it should be pre-registered as a precision-and-verdict-quality
change rather than sold as a recall win.

---

## 1. The correction this research forces

The parity analysis (§4a, now corrected) argued that a 1.4% refutation kill rate
meant spare verification capacity, and cited "generate wide, verify hard" as the
literature's prescription. **That was wrong, and the evidence against it is
direct.**

**CR-Bench** (Pereira et al., arXiv:2603.11078, 584 SWE-Bench-derived review
instances, 174 manually verified) measures widening on code review specifically:

| agent | model | recall | precision | signal-to-noise |
|---|---|---:|---:|---:|
| single-shot | GPT-5.2 | 27.01% | 3.56% | **5.11** |
| Reflexion | GPT-5.2 | 32.76% | 5.10% | **1.95** |
| single-shot | GPT-5-mini | 18.39% | 3.51% | 2.89 |
| Reflexion | GPT-5-mini | 27.59% | 3.19% | **0.91** |

Recall rises; signal-to-noise falls by roughly a third to a half. The absolute
precision figures are far below ours and almost certainly reflect raw-match
scoring against an incomplete key rather than a comparable measurement — so take
the **shape**, not the magnitudes.

**ISSTA 2026** (Xiong & Zhang, *Sifting the Noise*, arXiv:2601.22952 — peer
reviewed, top venue) finds noise removal and true-positive retention explicitly
anti-correlated, and that agentic filtering **helps only the strongest models**:
DeepSeek-Chat got *worse* (11.2% → 13.1% FPR), GPT-5 improved (20.4% → 14.1%).

Read against those, our 1.4% kill rate is evidence the refuter is **not built to
absorb a flood** — not evidence that it is idle. "Raise the cap and let refutation
catch it" is the most directly contradicted change on the table.

---

## 2. The four candidate levers, judged

### 2.1 Differential / re-derivation prompting — UNVALIDATED for this task

Li et al. (ASE 2023, arXiv:2304.11686) report direct prompting **28.8% → 77.8%**
on QuixBugs by inferring intent, synthesizing variants, and differencing. Note the
number: 77.8%, not the 75.0% this project has been paraphrasing.

**The disqualifying detail is the benchmark.** QuixBugs is single-function
algorithmic code, not a multi-file diff. The nearest real-repository descendant,
**Testora** (arXiv:2503.18597, ICSE 2026), infers intent from the PR description
rather than from the code, targets behavioural regressions, and — decisively —
**publishes no precision or false-positive rate at all**. It reported 19 candidate
regressions with 11 of 13 confirmed, at ~$0.003 and 12.3 min per PR.

So the honest status of this family on real diffs is **"precision untested"**, not
"works". Building it here would be a bet, not an application of a result. Given
five withdrawn interventions already, a bet needs a better prior than this.

### 2.2 Refinement-guided pruning — HALF ALREADY SPENT, half unreplicated

Sun et al. (arXiv:2606.01859) — and the scope matters: **Go code review,
DeepSeek-V3**.

- Removing the implicit "report the single most important issue" constraint:
  **+4.68pp, McNemar p<0.05, Cohen's g=0.26**, candidates 1.0 → 3.1.
- Edit-simulation pruning: candidates **7.2 → 3.4** overall while retaining
  **99.6%** of the full-list benefit. (Correction to how this project has quoted
  it: 3.4 is the overall average; 3.1 is a top-5-cutoff figure. Do not merge them.)

**The first half is already implemented here.** The discovery prompt carries an
explicit coverage instruction — "do not stop at the first defect… there is no
limit on how many findings you may return and no severity floor here". So that
+4.68pp is already banked, and cannot be bought twice.

The pruning half remains, but it is a **usefulness** mechanism, not a recall one:
it removes candidates whose induced edit is empty or duplicate. Our adjusted
precision is already ~96% on this corpus, so there is little measured noise for it
to remove. It is also a single unreplicated study on one language/model pair.

### 2.3 The usefulness filter — MECHANISM PLAUSIBLE, EVIDENCE THIN

**Tricorder** (Sadowski et al., Google, peer-reviewed, years of org-wide data) is
solid on the *definition*: an "effective false positive" is any finding a
developer did not act on, the enable bar is <10%, and Google's achieved rate is
just under 5%. But it governs **static analysers tuned by humans**, not LLM prose,
and the mechanism was a feedback channel to analyser authors, not a learned filter.

**Greptile** is the only published *learned* design: embed each comment, compare
against the team's up/downvoted history, block on similarity to ≥3 downvoted
neighbours. Reported address rate **19% → 55%+** in two weeks. This is a vendor
blog post: no ablation, no interval, no independent audit, and the public material
does not state whether raw code or comment text is centralised before embedding.

Treat 19→55 as a marketing number with a plausible mechanism behind it. The
mechanism is worth copying eventually; the number is not portable, and building it
means budgeting to measure it ourselves.

### 2.4 Out-of-diff adjudication — A GENUINE EVIDENCE GAP, and a warning

**RIPPLE** (*From Seed to Scope*, ICSE 2026, peer-reviewed) is this task done
academically: expand the impact set for recall, then use an LLM plan-then-predict
phase for precision. Reported **39.7%–380.8% F1 improvement** over impact-analysis
baselines; on one slice, precision 40.3% / recall 29.8%.

**But the published abstract does not disaggregate how much of that comes from the
LLM adjudication phase versus the recall-expansion phase.** So the specific
question — does LLM adjudication of "does this dependent rely on what changed"
beat a raw reference list, and by how much — is **unanswered in the literature**.
We shipped adjudication on 2026-08-05 without that answer, which is defensible
only because it ships disabled.

The warning sits beside it. In the one adjacent sub-problem where precision *was*
solved — API breaking-change detection — the fix was **deterministic semantic
modelling, not an LLM**: Roseau (ICSME 2025) reaches **F1 0.99** against japicmp
0.86 and Revapi 0.91. Spec 22's own design already reflects this instinct
(deterministic wherever the category admits it, model only for the residue), and
this result says that instinct is right and should be pushed further before more
model judgement is added.

---

## 3. What to build instead: tools in the verification stage

The largest single effect measured anywhere in this research is not about
generation at all. In ISSTA 2026, **ablating cross-file navigation from the
verification agent collapsed F1 from 95.5% to 62.5%** — the biggest lever in the
paper. The same study found that giving the verifier the same files *without*
iteration (an oracle-context baseline) reached only 36.4% FP-identification, so it
is the ability to *go and look*, not the volume of context, that carries the
effect.

This engine's refutation stage is **explicitly toolless**. Its instructions say:
"Use only the provided candidates, reviewedDiffRanges, evidence, reviewContext,
supportSignalCandidates, instructions, skills metadata, sharedDigest, and
provenance." Discovery holds `repo_read`/`repo_list`/`repo_grep`; the verifier
does not.

That is the evidence-backed, untried, architecturally-matched change. Three honest
cautions before it is sold as anything:

1. It is a **verification-quality** change. It may move recall in either
   direction: a better-informed refuter may rescue `needs-more-evidence`
   candidates (recall up) or refute candidates it previously let pass (recall
   down, precision up). Both are legitimate outcomes and the pre-registration must
   name them in advance.
2. The ISSTA gains concentrate in the strongest models. Our measured model is
   `openai/gpt-5.3-codex`; nothing here transfers to a smaller one.
3. It costs tool calls per refutation batch, and refutation runs per discovery
   partition. Price it before enabling.

---

## 4. What not to do

| Approach | Evidence against |
|---|---|
| Raise the candidate cap / widen discovery and let refutation absorb it | CR-Bench: SNR 5.11 → 1.95. ISSTA: retention anti-correlated with filtering. Our 1.4% kill rate says the refuter is not a flood absorber |
| Differential prompting, shipped on the strength of its published number | 77.8% is single-function QuixBugs; the real-repo descendant published no precision at all |
| Edit-simulation pruning, expecting the published magnitude | Single unreplicated study, Go + DeepSeek-V3; and the half that helps recall is already implemented here |
| A preference filter built on vote counts, trusting 19→55% | Vendor blog, no ablation, no interval, unstated data-centralisation story |
| More LLM judgement for out-of-diff precision | No study isolates it; the adjacent solved sub-problem was solved deterministically (Roseau F1 0.99) |

---

## 5. Sources

- Li et al., *Nuances are the Key*, ASE 2023 — https://arxiv.org/abs/2304.11686
- Testora, ICSE 2026 — https://arxiv.org/abs/2503.18597
- Sun et al., Go code review, Jun 2026 — https://arxiv.org/html/2606.01859v1
- Xiong & Zhang, *Sifting the Noise*, ISSTA 2026 — https://arxiv.org/html/2601.22952v3
- Pereira et al., *CR-Bench*, Mar 2026 — https://arxiv.org/html/2603.11078v1
- Sadowski et al., *Lessons from Building Static Analysis Tools at Google*, CACM —
  https://cacm.acm.org/research/lessons-from-building-static-analysis-tools-at-google/
- Greptile embedding filter (vendor) —
  https://www.zenml.io/llmops-database/improving-ai-code-review-bot-comment-quality-through-vector-embeddings
- *From Seed to Scope* (RIPPLE), ICSE 2026 —
  https://conf.researchr.org/details/icse-2026/icse-2026-research-track/223/From-Seed-to-Scope-Reasoning-to-Identify-Change-Impact-Sets
- Roseau, ICSME 2025 — https://arxiv.org/abs/2507.17369
