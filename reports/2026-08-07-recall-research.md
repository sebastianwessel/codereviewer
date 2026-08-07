# What the published evidence says actually raises recall in LLM code review

Research date: 2026-08-07. Read-only; no project files inspected or modified.
Scope: 2025–2026 peer-reviewed / arXiv empirical work with stated evaluation setups.
Vendor blogs and unbenchmarked claims excluded.

---

## 0. Headline judgement

Three things worth saying before the list.

**(a) The engine is already above published SOTA on real-world defects.** The largest
project-scale study to date measures LLM-based detectors at **21.09% recall (C/C++) and
33.82% (Java)** across 222 real vulnerabilities in 24 active OSS projects
([arXiv:2601.19239](https://arxiv.org/abs/2601.19239)). The engine's 60.8% on 51
advisory-confirmed defects is not in the same regime. Expect small increments, and treat
any paper promising a large generic jump as suspect until its baseline is checked.

**(b) The specific phenomenon — a reviewer emitting an empty finding set on defective
code — is essentially unstudied.** I searched abstention, under-reporting, refusal,
calibration, sensitivity/specificity and false-negative analysis. The abstention
literature ([arXiv:2407.18418](https://arxiv.org/html/2407.18418v1), survey;
[arXiv:2605.20351](https://arxiv.org/html/2605.20351), 13-corpus review;
[arXiv:2606.05396](https://arxiv.org/html/2606.05396), abliteration) is almost entirely
about **safety refusal on malicious prompts** — a different task. Papers that do report
false negatives report them as a confusion-matrix cell and do not separate "said secure"
from "said nothing". This is a genuine gap, not a search failure. The 9.0% empty-array
rate is, as far as the published record goes, an original observation.

**(c) The one direct test of "proactively supply the callee" came out negative.** Details
in §3. This is the single most decision-relevant finding for the stated gap, and it does
not support the intervention.

---

## 1. Contextual bias / trust-conferring framing — TOP CANDIDATE

**Paper:** *Measuring and Exploiting Contextual Bias in LLM-Assisted Security Code Review*
— [arXiv:2603.18740](https://arxiv.org/pdf/2603.18740)

**Measured on:** 6 models (GPT-4o-mini, Gemini 2.0 Flash, DeepSeek V3, Claude 3.5 Haiku,
Claude Sonnet 4.5, Claude Opus 4.5); 497 files (247 vulnerable / 250 patched) from
CrossVul; **14,910 queries** across five framing conditions. Plus a real-world arm: **17
CVEs across 10 projects driven through a Claude Code review agent.**

**Effect size.** Detection rate on *identical vulnerable code* as a function of surrounding
narrative framing:

| Model | Neutral | "Strong bug-free" framing | Delta |
|---|---|---|---|
| GPT-4o-mini | 97.2% | 3.6% | **−93.5pp** |
| Claude 3.5 Haiku | 68.4% | 8.5% | −59.9pp |
| DeepSeek V3 | 96.8% | 53.8% | −42.9pp |
| Claude Sonnet 4.5 | 97.4% | 80.6% | −16.7pp |

Bias in the other direction raised FP rates on *patched* code by 24–94pp. So this is a
genuine operating-point lever in both directions, not a free win.

**Validated mitigation, with effect size** (on the 17 real CVEs):
- Debiasing-1, *programmatically redact the PR description*: recovers **12/17 (70%)**.
- Debiasing-2, redaction **+** an explicit instruction to ignore metadata: **16/17 (94%)**.

The authors explicitly prefer redaction over instruction: programmatic removal of the bias
element is the safer of the two, with the instruction as an additive second layer.

**Cost:** essentially zero. Redaction *reduces* tokens. The added instruction is one line.

**Transfer assessment: HIGH — and it is the only candidate corroborated by this project's
own history.** The repo has already measured that a single injection-guard prompt line
moved recall 62.5% → 81.3%/87.5% at equal cost with 100% precision, and has separately
concluded the out-of-diff wall is attention/framing rather than retrieval, and that
reverse-review comment contamination let a fix's own comments act as an answer key. Those
are three independent in-house observations of exactly the mechanism this paper isolates
under controlled conditions. That convergence is the strongest signal in this report.

**Concrete, pre-registerable intervention:** audit what trust-conferring text reaches the
discovery packet — commit message, PR/MR description, changelog text, and in particular
*code comments and docstrings that assert the code validates/sanitises/checks something*.
Redact or neutralise them programmatically. The paper's finding predicts the largest
effect where the model must rely on a *claim about behaviour it cannot see* — which is
precisely the `callee` (25%) and `implementation` (15%) silence concentration. A comment or
a reassuring function name is the cheapest possible substitute for reading the callee, and
the model appears to accept it.

**Honest caveat:** this paper's own silence analysis says models rarely go *fully* silent
under bias; they instead flag unrelated issues (57–71% of neutral-condition detections
already cite the wrong issue). The engine's 9% empty-array is a stronger form. So the
mechanism is well-evidenced but the specific manifestation is an extrapolation.

---

## 2. Input size and in-file position — SECOND, and it is cost-negative

**Papers:**
- *LLMs for In-File Vulnerability Localization Can Be "Lost in the End"* —
  [arXiv:2502.06898](https://arxiv.org/abs/2502.06898)
- *LLMxCPG* (USENIX Security '25) — [arXiv:2507.16585](https://arxiv.org/abs/2507.16585)

**Measured:** the first finds LLMs **significantly (p < .05) underperform on vulnerabilities
located toward the end of larger files**, independent of vulnerability type, across XSS,
SQLi and path traversal. Reported effect: **average recall increase of over 37% across all
models purely by optimising input size.** LLMxCPG independently reports that graph-guided
slicing cuts code size **67.84–90.93%** while preserving the vulnerability-relevant
context, and improves F1 15–40% over baselines.

**Cost:** negative. Both interventions shrink the packet.

**Transfer assessment: HIGH for the diagnostic, MEDIUM for the fix.** The 37% figure is
from Feb-2025-era models (GPT-3.5/GPT-4) and should not be expected to replicate at that
magnitude on a 2026 frontier model — cite it as direction, not as a target. LLMxCPG's
F1 numbers are **fine-tuned** (see §6) and its slicing is bound to a CPG the project does
not build; only the size finding transfers.

**The zero-cost move this implies, and it should be done first.** Before spending anything
on a new intervention, test on *existing run data* whether the 9% empty-array cases are
predicted by **packet byte size and the position of the defect within the packet**, rather
than by the semantic need for callee knowledge. The `callee`/`implementation` depths are
plausibly also the *largest* packets — which would make "depth" a confound for "size", and
would mean the diagnosis of the gap is wrong. This is a retrospective correlation on data
already on disk, costs nothing, and can invalidate the entire premise of §3 before any
money is spent. Given that this project has now twice paid for a guess, run this first.

---

## 3. Proactively supplying callee/caller definitions — MEASURED, NEGATIVE

**Paper:** *Vulnerability Detection with Interprocedural Context in Multiple Languages:
Assessing Effectiveness and Cost of Modern LLMs* (EASE 2026) —
[arXiv:2604.08417](https://arxiv.org/abs/2604.08417)

This is the only paper I found that tests **exactly** the intervention in question.

**Setup:** 509 vulnerabilities from ReposVul (drawn from 6,134 CVEs / 1,491 projects);
C, Python, C++; models Claude Haiku 4.5, GPT-4.1 Mini, GPT-5 Mini, Gemini 3 Flash. Three
conditions, all **proactively placed in the prompt, no on-demand retrieval**:
- **CO** — target function only
- **CC** — target + functions it directly invokes (callees)
- **CK** — target + functions that directly invoke it (callers)

**Result (C):**

| Model | CO | CC (callees) | CK (callers) | Effect size |
|---|---|---|---|---|
| Claude Haiku 4.5 | 0.9803 | 0.9804 | 0.9788 | ≤0.074, negligible |
| Gemini 3 Flash | 0.9937 | 0.9577 | 0.9680 | Φ=0.211, **negative** |
| GPT-5 Mini | 0.9052 | 0.8426 | 0.7946 | Φ=0.259, **negative** |
| GPT-4.1 Mini | 0.7556 | **0.5098** | 0.6878 | Φ=0.436, **large negative** (χ²=37.1, p<0.0001) |

**Of 12 McNemar pairwise comparisons, only 3 were significant — and all 3 favoured the
configuration with LESS context.** Token cost: **+102% (callees), +94% (callers)**.

**Transfer assessment: MEDIUM-CONFIDENCE NEGATIVE. Do not build this.** Caveats I want on
the record, because the paper is not airtight: (i) the baseline accuracies of 0.98–0.99
strongly suggest a near-degenerate label balance, so these are accuracy deltas and cannot
be cleanly read as recall deltas; (ii) every model is a mini/flash tier, and the damage
scales inversely with model strength — Claude Haiku 4.5 was flat, GPT-4.1 Mini collapsed,
which is consistent with weak models being *distracted* rather than *informed*; a frontier
model might behave differently. But the direction is unambiguous, it is the only direct
test, it doubles cost, and it lands in a project that has already burned two interventions
on plausible-sounding guesses. The expected value is negative.

The mechanism worth noting: dumping callee *source* adds tokens and pushes the target code
away from the position where the model attends best — i.e. §3 fails partly *because of*
§2. The two findings are consistent, not independent.

---

## 4. Distilled API/callee *behaviour rules* rather than source — MEDIUM, worth one test

**Papers:**
- *Generating API Parameter Security Rules with LLM for API Misuse Detection* (GPTAid,
  NDSS 2025) — [ndss-symposium.org](https://www.ndss-symposium.org/ndss-paper/generating-api-parameter-security-rules-with-llm-for-api-misuse-detection/)
- *The Midas Touch: Triggering the Capability of LLMs for RM-API Misuse Detection*
  (ChatDetector) — [arXiv:2409.09380](https://arxiv.org/pdf/2409.09380)

**Measured:** GPTAid generates 311 API parameter security rules at **92.3% precision /
71.0% recall**. ChatDetector extracts API usage constraints from official documentation and
finds **80.85% more RM-API pairs than expert-knowledge baselines at 98.21% accuracy**.

**Why this is distinct from §3.** These do not paste the callee's body into the prompt.
They pre-distil *what the API guarantees and requires* into a short constraint statement.
That is a small number of tokens, and it does not displace the target code — so it dodges
both the size penalty and the position penalty that plausibly sank §3.

**Transfer assessment: MEDIUM.** Honest limits: the 71.0% and 80.85% figures describe the
quality of the *extracted rules*, **not** an end-to-end detection recall lift — no paper I
found measures "distilled API contract in prompt → reviewer recall delta". So this is an
inference from mechanism, not a measured transfer. It also only helps the
framework/library-API slice of the gap, not the project-local `callee` slice, and it needs
a rule corpus built and maintained. Rank it third, behind two interventions that cost
nothing.

---

## 5. Multi-agent role diversity — the honest reading of the one positive result

**Paper:** *MultiVer: Zero-Shot Multi-Agent Vulnerability Detection* —
[arXiv:2602.17875](https://arxiv.org/html/2602.17875)

**Setup:** 4 agents (security w=0.45, correctness 0.35, performance 0.15, style 0.05);
PyVul balanced test set, 202 Python samples (100 vulnerable / 102 fixed), function-level.

**Ablation:**

| Configuration | TPR | FPR |
|---|---|---|
| Full system (4 agents + RAG) | 82.7% | **85.0%** |
| Security agent only | 65.7% (−17.0pp) | — |
| Without correctness agent | 71.7% (−11.0pp) | — |
| Weighted voting instead of union | 37.7% (−45.0pp) | 35.3% |

**Cost:** $0.46 and 55s per sample; self-consistency alone accounts for $0.26 of that.

**Assessment: the headline +17pp is not a technique, it is an operating-point move — reject
the method, keep one idea.** Union voting means *any* agent's warning fires. That produces
82.7% recall at **85% FPR and 48.8% precision**. On a precision-first engine that is
disqualifying, and the authors' own weighted-voting variant — the version that actually
tries to be precise — collapses to 37.7% TPR, *below* the security-only agent. That is the
tell: the ensemble is not finding more, it is guessing more.

**The one transferable idea, and it is cheap.** 11 of the 17pp come from the **correctness**
agent, not the security agent. If that replicates, it says the productive lens on a
security defect is often "does this function do what it claims" rather than "is this
exploitable". This project has already tested and rejected adding a *security* checklist
lens (traded authz 41→27%) and found a dedicated security pass unproven. It has not, on
this record, tested the inverse: framing discovery as a **correctness/contract-violation**
review with security as a consequence. That is a single-pass prompt reframing at zero
marginal cost, and it is orthogonal to the two lenses already rejected. Worth one
pre-registered A/B — but note the base evidence is n=1, Python-only, 202 samples, and
sits inside a method whose overall result I am rejecting.

---

## 6. Explicitly NOT worth trying here

**6.1 Self-consistency / N-sampling / majority vote.** *Self-Consistency Is Losing Its Edge:
Diminishing Returns and Rising Costs in Modern LLMs* —
[arXiv:2511.00751](https://arxiv.org/html/2511.00751) — finds gains plateau early while
cost scales linearly, and performance sometimes *declines* at high sample counts;
increasing ensemble size j=1→7 at T=1.0 gave **no significant gain (≤0.02)**. Corroborated
by [arXiv:2604.26954](https://arxiv.org/pdf/2604.26954). This independently reproduces this
project's own rejection of extra discovery passes (+40–47% cost, no gain). **Closed. Do not
re-litigate.**

**6.2 "More passes" generally / reactive task splitting.** Nothing in the 2026 record
rehabilitates this. MultiVer is the only paper showing a large multi-pass recall gain and
it buys it with an 85% FPR (§5). The project's own −8.5pp on reactive splitting is
consistent with the literature, not anomalous.

**6.3 Proactively pasting callee/caller source.** §3. Doubles tokens; every significant
measured effect went the wrong way.

**6.4 Fine-tuned / CPG-fitted detection pipelines** — LLMxCPG (fine-tuned Qwen2.5-Coder-32B
+ QwQ-32B via LoRA, [arXiv:2507.16585](https://arxiv.org/abs/2507.16585)), VULPO
([arXiv:2511.11896](https://arxiv.org/html/2511.11896)), MulVul
([ACL 2026](https://aclanthology.org/2026.acl-long.391/)), iAudit. **These are exactly the
fit-a-detector-to-a-dataset results the brief rules out**, and I want to flag that their
reported gains (15–40% F1; MulVul "41.5% over best baseline") are presented as method
results when they are substantially dataset-adaptation results. The rebuttal is published:
*Calibration Without Comprehension* —
[arXiv:2606.20502](https://arxiv.org/abs/2606.20502) — shows fine-tuning **shifts the output
threshold without changing the decision policy**, with best detection reaching only **52.1%
(+2.1pp above chance)** and exact CWE Top-1 below **1.3%**, concluding the security
reasoning is simply absent regardless of fine-tuning strategy. Treat this whole family as
non-evidence for a general-purpose reviewer.

**6.5 In-prompt CWE checklists.** *An Insight into Security Code Review with LLMs*
([arXiv:2401.16310](https://arxiv.org/html/2401.16310v6), 534 files from OpenStack/Qt)
finds the best prompt is **model-dependent** — a CWE list was optimal for GPT-4/ChatGPT,
while CoT-plus-commit-message was optimal for DeepSeek-R1. Effect sizes are tiny
(I-Score 4.58% → 5.30%). This project already measured a checklist lens as a net loss.
No reason to revisit.

**6.6 Adding the commit message as guidance.** The paper above finds it helped DeepSeek-R1
— but §1 shows commit/PR narrative is precisely the *bias vector* that collapses detection
by up to 93.5pp. These recommendations are in direct conflict and the contextual-bias
study is far better powered (14,910 queries vs a prompt-variant comparison). Side with §1.

**6.7 Calibration / confidence-threshold work.** Real but orthogonal: it reshapes an
existing score distribution. It cannot recover a defect on a case where discovery emitted
an empty array — there is no score to threshold. Not a recall lever for this failure mode.

---

## 7. Ranked by expected value

| # | Candidate | Expected effect | Cost | Confidence |
|---|---|---|---|---|
| 0 | **Retro-analysis: is silence predicted by packet size + defect position, not depth?** | Could invalidate the whole callee premise | **zero** | — |
| 1 | **Redact trust-conferring context** (PR/commit text, reassuring comments/docstrings) + ignore-metadata instruction | 70% → 94% recovery on 17 real CVEs; corroborated in-house by the injection-guard win | ~zero, token-negative | **High** |
| 2 | **Shrink the packet; move the target code away from the tail** | +37% recall (2025 models; expect less) | negative | Medium-high |
| 3 | **Distilled API/callee behaviour contracts** (not source) | Mechanism-plausible; no measured end-to-end transfer | low | Medium |
| 4 | **Reframe discovery as correctness/contract review** | 11pp of MultiVer's 17pp, n=1 | zero | Low-medium |

Candidates 1, 2 and 4 are all prompt/packet-shaping changes that cost nothing to test. That
is the right shape of bet for a project that has twice paid for a guess — and note that 1
and 2 both predict effects that are *measurable on data already collected* before any run
is commissioned.

---

## 8. Where the literature is genuinely thin

Stated plainly rather than padded:

- **No published work measures a code reviewer returning an empty finding set on defective
  code**, or the rate at which it does so, or what moves that rate. §1 is the closest and it
  measures wrong-issue detections, not silence.
- **No published work measures the recall delta from supplying a distilled callee/API
  contract** to a reviewer that already has retrieval tools. §4 is an inference.
- **No paper I found evaluates a precision-first single-pass reviewer with retrieval
  enabled.** Nearly every study is binary function-level classification on a balanced set,
  which is a different task with a different failure surface. Effect sizes should be
  treated as directional evidence about mechanism, never as transferable numbers.
- Reported recall figures vary from 3% to 98% across these papers largely as a function of
  benchmark construction. Cross-paper number comparison is meaningless here.

---

## Sources

- [arXiv:2601.19239 — LLM-based Vulnerability Detection at Project Scale](https://arxiv.org/abs/2601.19239)
- [arXiv:2603.18740 — Measuring and Exploiting Contextual Bias in LLM-Assisted Security Code Review](https://arxiv.org/pdf/2603.18740)
- [arXiv:2604.08417 — Vulnerability Detection with Interprocedural Context in Multiple Languages (EASE 2026)](https://arxiv.org/abs/2604.08417)
- [arXiv:2602.17875 — MultiVer: Zero-Shot Multi-Agent Vulnerability Detection](https://arxiv.org/html/2602.17875)
- [arXiv:2502.06898 — LLMs for In-File Vulnerability Localization Can Be "Lost in the End"](https://arxiv.org/abs/2502.06898)
- [arXiv:2507.16585 / USENIX Security '25 — LLMxCPG](https://arxiv.org/abs/2507.16585)
- [arXiv:2606.20502 — Calibration Without Comprehension](https://arxiv.org/abs/2606.20502)
- [arXiv:2511.00751 — Self-Consistency Is Losing Its Edge](https://arxiv.org/html/2511.00751)
- [arXiv:2604.26954 — Impact of LLM Self-Consistency and Reasoning Effort on Accuracy and Cost](https://arxiv.org/pdf/2604.26954)
- [arXiv:2401.16310 — An Insight into Security Code Review with LLMs](https://arxiv.org/html/2401.16310v6)
- [arXiv:2604.01637 — SecLens: Role-Specific Evaluation of LLMs for Security Vulnerability Detection](https://arxiv.org/html/2604.01637v1)
- [arXiv:2606.22263 — Revelio: Cost-Efficient Agentic Memory Safety Vulnerability Detection](https://arxiv.org/pdf/2606.22263)
- [arXiv:2409.09380 — The Midas Touch / ChatDetector: RM-API Misuse Detection](https://arxiv.org/pdf/2409.09380)
- [NDSS 2025 — GPTAid: Generating API Parameter Security Rules with LLM](https://www.ndss-symposium.org/ndss-paper/generating-api-parameter-security-rules-with-llm-for-api-misuse-detection/)
- [arXiv:2511.11896 — VULPO](https://arxiv.org/html/2511.11896)
- [ACL 2026 — MulVul](https://aclanthology.org/2026.acl-long.391/)
- [arXiv:2407.18418 — The Art of Refusal: A Survey of Abstention in LLMs](https://arxiv.org/html/2407.18418v1)
- [arXiv:2605.20351 — Refusal Evaluation in Coding LLMs and Code Agents](https://arxiv.org/html/2605.20351)
- [Awesome-LLMs-for-Vulnerability-Detection (index used for coverage)](https://github.com/huhusmang/Awesome-LLMs-for-Vulnerability-Detection)
