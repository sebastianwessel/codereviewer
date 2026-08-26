# Research: the model layer for spec 22 change-impact adjudication

Date: 2026-07-29. Read-only research; no repo file modified.

**Provenance convention used throughout.**
- **[P]** = read from the primary source (arXiv PDF or HTML fetched and read here).
- **[S]** = from a search-engine summary only; not verified against the paper.
- **[V]** = vendor-published, run by the party that benefits.
- **[R]** = from this repository's own reports/ledger.

---

## 0. Two corrections to our own ledger, before anything else

### 0.1 The "77.7% of true positives retained" figure is wrong

`reports/2026-07-27-enumeration-gap-and-improvement-plan.md:255-260` states:

> "Sifting the Noise" … measured LLM agents filtering SAST output: **92.1% of noise
> eliminated — but only 77.7% of true positives retained** … injection miss rate
> **<3%**, cryptography miss rate **>77%**.

I read the paper. **[P]** Xiong & Zhang, *Sifting the Noise: A Comparative Study of
LLM Agents in Vulnerability False Positive Filtering*, Proc. ACM Softw. Eng. Vol 3
(ISSTA 2026), Article ISSTA009, DOI 10.1145/3832100, arXiv:2601.22952v3 (23 Jul 2026).

- **92.1% is right**, and it is an *OWASP Benchmark FPR reduction*: 98.3% → 6.3%
  residual FPR, SWE-agent + Claude Sonnet 4 (their Table 3).
- **77.7% is not a TP-retention figure.** The only 77.x in that region of the paper
  is **F1 = 77.8** for OpenHands + Claude Sonnet 4 on Vul4J (their Table 4). Our
  report appears to have read an F1 column as a retention rate.
- **"injection miss <3% / crypto >77%" is the wrong metric.** Those are *residual
  false-positive* rates by CWE, not true-positive loss. Real values (Table 3, Fig 7):
  CWE-78 FP-filtering success 69.9% → **98.4%**; CWE-330 51.6% → **96.0%**;
  crypto CWE-327 is where it fails — OpenHands *regresses* it 55.2% → 29.2%
  (−26.0pp) and CWE-614 74.2% → 32.3% (−41.9pp); GPT-5 agents lift CWE-327 from
  1.7% to only "over 22%".

The *direction* of our claim survives. The magnitude and the metric do not.

### 0.2 The real TP-destruction numbers are worse than the ones we quoted

Their Table 4 (Vul4J, 50 real CodeQL alerts, ground truth 31 FP / 19 TP, manually
triaged, ~20 man-hours) reports four mutually exclusive outcome shares. Recomputing
TP retention = `CorrectRetention / (CorrectRetention + Mis-identifiedFP)`: **[P]**

| backbone | agent | FP identified (recall) | **TP retention** |
|---|---|---:|---:|
| Claude Sonnet 4 | OpenHands | 67.7% | **89.5%** (17/19) |
| Claude Sonnet 4 | Aider | 76.7% | **78.9%** (15/19) |
| Claude Sonnet 4 | SWE-agent | 64.3% | **73.8%** (14/19) |
| Claude Sonnet 4 | vanilla one-shot | 61.3% | **73.7%** (14/19) |
| DeepSeek Chat | OpenHands | 38.7% | **100%** (19/19) |
| DeepSeek Chat | vanilla one-shot | 67.7% | **42.1%** (8/19) |
| GPT-5 | OpenHands | **93.3%** | **33.3%** (6/18) |
| GPT-5 | Aider | 92.6% | **42.8%** |
| GPT-5 | SWE-agent | 89.3% | **52.7%** |
| GPT-5 | vanilla one-shot | 85.7% | **42.9%** |

(All rows verified against the paper's own reported Prec/Rec/Acc; arithmetic is
self-consistent. Row denominators vary 41–50 because some configs failed to
produce a parseable verdict on some cases.)

**The headline is a frontier, not a point.** Across all twelve configurations, FP
removal and TP retention are near-perfectly anti-correlated. The single
best-filtering configuration in the whole study — GPT-5 + OpenHands, removing
93.3% of noise — **destroyed two thirds of the real vulnerabilities.** That is the
strongest available statement of "the known cost of filtering", and it is much
sharper than the number currently in our ledger.

---

## 1. Deterministic-candidates-plus-LLM-adjudication: what the pattern actually buys

### 1.1 The closest published work to spec 22 — and its absolute numbers are humbling

**[P]** Aashish Yadavally & Tien N. Nguyen, *From Seed to Scope: Reasoning to
Identify Change Impact Sets* (RIPPLE), **ICSE 2026**, Rio de Janeiro, ACM ISBN
979-8-4007-2025-3, DOI 10.1145/3744916.3773265. NSF-funded academic work, no
vendor interest.

This is *our task*, done by a research group, published at the top SE venue, four
months ago. Structure:

1. **Phase 1 — recall-focused, deterministic.** Seed edit location → expand by
   (a) evolutionary coupling (methods co-changed with the seed's file in the last
   100 relevant commits) and (b) **dependence coupling**: direct + indirect call
   dependence up to L=1 hop, plus class-member dependence. Yields `I_D`.
   Reported effect: **reduces the candidate space by 86.4% of methods per
   repository while retaining 76.8% recall.**
2. **Phase 2 — precision-focused, LLM.** *Plan-then-predict*:
   - **Planner LLM**: input = ⟨issue summary, issue description, filename, seed
     location code⟩, output = a **Change Plan** — a CoT-structured sequence of
     change steps. One call.
   - **Reasoner LLM**: runs **once per dependence cluster** (connected component
     of the dependence graph over `I_D`), input = ⟨intent, change plan, the
     cluster's methods each augmented with a **1–2 line textual summary**⟩,
     output = ⟨ClassName, methodName⟩… plus a **justification**.
   - K samples per cluster, **intersected** (self-consistency), then **unioned**
     across clusters.

**Table 1 (method-level, 100 untangled bug-fix commits, 25 Apache Java projects):**

| approach | Hit@K | Precision | Recall | F1 |
|---|---:|---:|---:|---:|
| Evolutionary coupling (commit history alone) | 32.0 | 4.9 | 17.1 | 5.2 |
| **Dependence coupling (deterministic call graph)** | **86.0** | **7.6** | **64.7** | 11.1 |
| Conceptual (TF-IDF) | 44.0 | 11.9 | 25.2 | 13.1 |
| ATHENA (prior SOTA, Transformer) | 62.0 | 18.0 | 31.2 | 17.9 |
| RIPPLE w/ Gemini-2.0 Flash | 60.0 | 25.8 | 32.2 | 23.3 |
| RIPPLE w/ Claude-3.5 Sonnet | 70.0 | 18.0 | 38.3 | 24.5 |
| **RIPPLE w/ GPT-4o** | 69.0 | **28.2** | 36.3 | **25.0** |

**Read that second row.** "Dependence coupling" *is* our deterministic reference
list. Alone it scores **7.6% precision at 64.7% recall**. The full LLM
adjudication layer takes precision to **28.2%** — a 3.7× gain — at the cost of
**44% of the recall** (64.7 → 36.3).

That is the pattern's actual exchange rate on this task, measured. Anyone
promising precision without recall loss here is not describing this literature.

**Caveat on comparability, in our favour.** Their ground truth is "methods a
developer co-changed in the fixing commit", which includes conceptually-coupled
methods with no structural link — 51.6% of their failures are exactly that class.
Our task is narrower and easier: our candidate set is *actual reference sites*,
already proven to mention the symbol, and our question is only "does this site
depend on the part that changed". We should expect better than 28.2%. We have no
right to assume how much better.

### 1.2 Granularity is the single largest free lever

**[P]** RIPPLE Table 5, same systems, same data, only the reporting granularity
changed:

| approach | method-level P / R | **file-level P / R / F1** |
|---|---:|---:|
| Dependence coupling | 7.6 / 64.7 | 37.7 / 61.2 / 39.7 |
| ATHENA | 18.0 / 31.2 | 62.0 / 40.9 / 45.3 |
| **RIPPLE w/ GPT-4o** | 28.2 / 36.3 | **60.9 / 62.4 / 54.6** |

Precision 28.2% → **60.9%** and F1 25.0 → 54.6 purely by reporting the impacted
*file* rather than the impacted *method*. This is the cheapest accuracy
intervention in the entire body of work reviewed here: it costs nothing and it
changes the product from unusable to usable.

### 1.3 The "plan" half is worth about half the score

**[P]** RIPPLE Table 6 (ablation):

| variant | Hit@K | Prec | Recall | F1 |
|---|---:|---:|---:|---:|
| History-based only (B1) | 32.0 | 4.9 | 17.1 | 5.2 |
| Dependence-enhanced (B2) | 30.4 | 6.3 | **76.8** | 9.6 |
| **RIPPLE without the Change Plan (B3)** | 39.6 | **14.6** | 31.5 | **17.2** |
| RIPPLE (full) | 69.0 | **28.2** | 36.3 | **25.0** |

**Removing the plan halves precision (28.2 → 14.6) and costs 45.3% of F1.** The
plan is the paper's analogue of our *contract delta*. This is the strongest single
piece of evidence for building spec 22 as **two calls, delta first, adjudication
second** rather than one fused call. It is one paper, one ablation, n=100 commits —
but it is directly on-task and the effect is large.

Also: **35.4%** of the entities RIPPLE correctly identified were *not* structurally
or semantically dependent on the seed — the change plan was what surfaced them.
And 55.6% of commits whose change plan explicitly referenced ground-truth classes
or methods scored F1 33.3 vs 15.7 for those that did not (their Fig 4).

### 1.4 Enrichment vs. the model: ZeroFalse's ablation

**[P]** Mohsen Iranmanesh, Sina Moradi Sabet, Sina Marefat, Ali Javidi Ghasr,
Allison Wilson, Iman Sharafaldin, Mohammad A. Tayebi, *ZeroFalse: Improving
Precision in Static Analysis with LLMs*, arXiv:2510.02534 (2025). Affiliations:
Simon Fraser Univ., Amirkabir, K.N. Toosi, Ferdowsi, **plus Cyber Risk Solutions
and Forward Security (commercial)** — not a product benchmark, but not
disinterested either. Treat the headline as optimistic.

Architecture — and this is the shape our constraint permits:
- **One LLM call per alert.** No loop.
- Input is a five-part deterministic prompt: fixed system role with JSON-only
  guardrails; **scope and evidence constraints forbidding speculation**; a
  **CWE-specific rubric naming risky patterns, benign idioms, and non-sanitizers**;
  an interpretation checklist; a strict output schema. Fields: `{cwe_id}`,
  `{rule_id}`, `{message}`, `{code_snippet}`, `{vulnerability_location}`,
  `{annotated_trace}`.
- Output: schema-constrained JSON with a binary verdict **and a calibrated
  Confidence (High/Medium/Low) explicitly grounded in observable evidence**.
- The trace is *reconstructed*, not windowed: Algorithm 1 walks the propagation
  path, recovers missing definitions, and preserves call sites and return values,
  explicitly rejecting "a fixed window of lines around each dataflow step".

Headline: F1 **0.912** on OWASP Java Benchmark (1,974 cases), **0.955** on
OpenVuln (58 real cases), >90% precision and recall on both, best model grok-4 /
gpt-5.

**How much came from the enrichment rather than the model** (their Table 4,
ΔF1 baseline prompt → ZeroFalse prompt):

| model | OWASP ΔF1 | OpenVuln ΔF1 |
|---|---:|---:|
| gpt-oss-20b | +0.194 (0.690→0.884) | **+0.381** (0.523→0.904) |
| gpt-5 | — | **+0.334** (0.621→0.955) |
| grok-4 | +0.082 (0.830→0.912) | +0.268 (0.655→0.923) |
| o4-mini | +0.088 (0.784→0.872) | — |
| mixtral-8x7b | — | +0.216 (0.553→0.769) |
| deepseek-r1 | **−0.104** | — |
| gemini-2.5-pro | — | **−0.243** |

On *real* code the enrichment is worth **0.22–0.38 F1** — most of the performance.
But two models got materially **worse** with the structured prompt. Enrichment is
a large lever and a model-specific one; it must be A/B'd on our provider, not
assumed.

**Two caveats worth stating loudly.** OWASP Benchmark v1.2 is *synthetic* — Xiong
& Zhang note the vulnerabilities are "implemented and injected into programs
manually" into simple servlets. OpenVuln is **58 cases**. A 0.955 F1 on 58 cases
has a confidence interval you could drive a truck through.

### 1.5 LLM4PFA

**[S]** Xueying Du, Kai Yu, Chong Wang, Yi Zou, Wentai Deng, Zuoyu Ou, Xin Peng,
Lingming Zhang, Yiling Lou, *Minimizing False Positives in Static Bug Detection
via LLM-Enhanced Path Feasibility Analysis*, arXiv:2506.10322 (2025). Abstract read
**[P]**; the results below are **[S]** from a search summary — I did not verify
them in the paper body.

Reported: filters **72–96%** of false positives, **misses 3 of 45 true positives**
(93.3% retention), 41.1–105.7% over baselines. Mechanism is an *iterative* agent
doing targeted constraint reasoning with agent-planned context selection.

Relevance to us: the retention number is good precisely because the task is
*decidable from a trace* — path feasibility is a constraint problem. Contract-delta
reliance is not. Do not import the retention rate as an expectation.

### 1.6 Semgrep Assistant — vendor, and the interesting part is the failure

**[V]** Semgrep blog, "How we built an AppSec AI that security researchers agree
with 96% of the time" (2025) and "Our AI Assistant is handling 60% of incoming
triage work" (2025). Vendor-run, vendor-scored, on a vendor dataset of >2,000
findings triaged by the vendor's own security researchers. The 96% is not a
third-party number and should not be compared with any academic figure above.

What is nonetheless instructive, because it is a *negative* result they published:

- Initial agreement was **~55% overall**, decomposing into **~91% on true
  positives and ~25% on false positives**. The system was good at agreeing that
  something is a bug and bad at agreeing that something is not.
- After optimisation, **FP agreement was still 41%**. The 96% headline is
  agreement on the *true-positive* verdict.
- They deliberately **optimised to minimise false negatives**, i.e. they chose the
  conservative end of the frontier in §0.2.
- Context fed per finding: rule metadata, prior triage decisions on that rule,
  examples of what the rule should and should not catch, **"several dozen lines of
  code surrounding the finding" plus additional lines at each dataflow step**.

The 25%→41% FP-agreement figure is the most useful thing in the post: **the
negative judgement is the hard one.** For us the polarity is inverted — our
"interesting" verdict is *impacted* — but the lesson transfers: whichever verdict
the model is biased toward, it will be good at; the other one is where the error is.

---

## 2. The known cost of filtering: what determines whether a triage stage destroys signal

Four mechanisms, each with a measurement.

### 2.1 Aggressiveness is a dial, and it is nearly linear

§0.2's table is the evidence. Twelve configurations, one dataset, and FP-removal
trades against TP-retention monotonically. There is no configuration that is good
at both. **[P]**

The cleanest single demonstration is in the same paper's post-cutoff C/C++
experiment (Table 5, OSS-Fuzz, 50 alerts, 22 FP / 28 TP, all fixing commits
10–12 months after the backbone's training cutoff, dual-annotated, Cohen's
κ = 0.725): **[P]**

| configuration | FPs removed | **TPs suppressed** | Prec | Rec | F1 |
|---|---:|---:|---:|---:|---:|
| Vanilla one-shot prompt | 8/22 (36.4%) | **1/28** | 88.9 | 36.4 | 51.6 |
| Vanilla + LLM4SA-style prompt template | 17/22 (77.3%) | **9/28** | 65.4 | 77.3 | 70.8 |
| Full agent (SWE-agent + Claude Sonnet 4) | 21/22 (95.5%) | **1/28** | 95.5 | 95.5 | 95.5 |

**A prompt change alone took FP recall 36.4% → 77.3% and multiplied true-positive
destruction by nine (1 → 9 of 28).** Only the *agentic* configuration got both.
This is the mechanism: prompting a one-shot judge to be more decisive buys
throughput by spending signal.

### 2.2 Signal loss concentrates where the judgement is not decidable from evidence

Residual failures in both papers concentrate in the same place: **policy- and
cryptography-oriented weaknesses**, where the verdict depends on intent and
configuration rather than on a traceable fact. **[P]** Their failure-mode table
(Table 7) attributes **all 85** CWE-327 failure trajectories to FM1, *incorrect
CWE attribution* — the agent validated a different issue than the one asked about.

The generalisation for us: **a triage stage destroys signal exactly where the
question it was given is under-determined by the evidence it was given.** Our
contract elements split cleanly along this line:

- *Decidable from the excerpt*: nullability of a consumed return value, arity and
  shape mismatch, an unhandled thrown error, a discarded return.
- *Not decidable from the excerpt*: ordering assumptions, concurrency, resource
  ownership, mutation aliasing. These are exactly the classes a forced-verdict
  adjudicator will get wrong, in whichever direction we biased it.

### 2.3 The suppressed class is invisible in the output

Nothing in a filtered report tells the reader what the filter removed. Our spec 22
already has the right instinct in "withheld sites are counted, not hidden"
(spec 22, *How that requirement is met*). Extend it: **anything the adjudicator
drops must be counted in the summary**, so the filter's aggressiveness is visible
in every report rather than only in an eval.

### 2.4 The better systems avoid it by not filtering — they *rank and evidence*

RIPPLE outputs an impact set plus a justification; ZeroFalse outputs a verdict plus
a calibrated confidence; Semgrep's own conclusion was to optimise against false
negatives. None of them present a hard binary drop as the product. Spec 22's
"evidence, not verdict" is, on this evidence, the correct and the *safer* shape —
it lets us set the aggressiveness dial at the conservative end and let the reader
do the last step.

---

## 3. Excerpt / context shape for a per-site judgement

### 3.1 Nobody who does well sends a raw truncated window

This is the most consistent finding across all four systems, and it directly
answers the spec 16 post-mortem (`docs/03-concepts/optional-capabilities/cross-file-retrieval.md:93`,
"a truncated excerpt of an unfamiliar file misleads more than it informs"):

| system | what is sent per candidate |
|---|---|
| RIPPLE **[P]** | the *cluster*, with each method reduced to a **1–2 line textual summary** (from existing doc comments, else generated), plus its identity. Not raw bodies. |
| ZeroFalse **[P]** | a **reconstructed propagation path**, explicitly rejecting "a fixed window of lines around each dataflow step"; missing definitions recovered; call sites and return values preserved. |
| Semgrep **[V]** | several dozen lines around the finding **plus additional lines at each dataflow step** — i.e. a window, but a *multi-part* one following the dependency, not one contiguous slab. |
| Sifting **[P]** | full repository access with navigation tools. |

The common property is not size. It is that **the context is assembled along the
dependency, not around the line.** A contiguous ±N window centred on a reference
site is precisely the artefact all four avoid.

### 3.2 Adding context volume, by itself, does nothing

**[P]** Xiong & Zhang, Table 5, the "Vanilla LLM + Oracle Context" baseline: they
gave a one-shot model **exactly the same files the successful agent had actually
opened** during its successful runs.

| configuration | Iden. FP | Corr. Ret. | Mis-id. | Missed | Acc | Prec | Rec | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Vanilla LLM | 16.0 | 54.0 | 2.0 | 28.0 | 70.0 | 88.9 | 36.4 | 51.6 |
| **Vanilla LLM + Oracle Context** | 16.0 | 54.0 | 2.0 | 28.0 | 70.0 | 88.9 | **36.4** | **51.6** |
| Full agent | 42.0 | 54.0 | 2.0 | 2.0 | 96.0 | 95.5 | 95.5 | 95.5 |

**Byte-for-byte identical. Zero gain from perfect context.** Their conclusion:
"the advantage comes from iterative evidence gathering and reasoning, not merely
from context volume."

This is simultaneously (a) strong external corroboration of our two measured
net-negative context experiments, and (b) **the most uncomfortable fact in this
report for our design**: the strongest published gains came from a loop we have
constrained ourselves out of. Their ablations put numbers on what the loop bought:
removing cross-file navigation dropped accuracy 96.0% → 44.0% and F1 95.5 → 62.5;
removing multi-turn interaction dropped F1 95.5 → 56.3.

I am not recommending we build the loop. I am recording that the honest expected
value of a bounded two-call design sits nearer the "context-augmented vanilla"
row (F1 66.7, up from 51.6) than the agent row, and that our accuracy bar should
be set accordingly.

### 3.3 Position and size effects

**[P]** Francesco Sovrano, Adam Bauer, Alberto Bacchelli, *Large Language Models
for In-File Vulnerability Localization Can Be "Lost in the End"*, **FSE 2025** /
Proc. ACM Softw. Eng., arXiv:2502.06898, DOI 10.1145/3715758. Defects late in
large files are detected significantly less often (p < .05), consistently across
models and vulnerability types; tuning the input size to the model raises recall
by **>37% on average**. Their abstract does **not** discuss whether shrinking
context raises false positives — our own report's line "warns that reduced global
context may raise FPs" is a reasonable inference, not a quoted result.

Consequence for us: whatever excerpt we send, **the reference line must not sit at
the end of it.** Centre it, or better, put the reference site *first* and the
supporting frame after.

**[S]** One study reported an optimal surrounding-context window of **3 lines**,
with degradation beyond, on an older model class. Search-summary only, model
generation unclear, and it conflicts with Semgrep's "several dozen lines". Treat
the whole question of "how many lines" as **unsettled by the literature** and
decide it by our own A/B.

### 3.4 What actually resolves the "I cannot determine this" case

**[P]** The single most design-relevant number in the Sifting paper: in the
*without cross-file navigation* ablation, the agent's outcome distribution was
20.0 / 24.0 / 0.0 / 24.0 — the remaining **32% of cases returned `UNKNOWN`**.
"Among the 26 full-correct cases missed by this ablation, all become `UNKNOWN`,
showing that the agent can no longer collect enough evidence for a grounded
verdict." Its **precision on the verdicts it did give went to 100.0**.

That is a measured demonstration of exactly what spec 22 asks for: **when the
model is deprived of the evidence and is permitted to say so, it says so, and
what it does claim is clean.** The recall cost is real (45.5%) and visible, which
is the right way for a cost to be paid.

---

## 4. Abstention: making it honest rather than hedging or over-refusing

### 4.1 Abstention does not come for free from capability

**[P]** Polina Kirichenko, Mark Ibrahim, Kamalika Chaudhuri, Samuel J. Bell,
*AbstentionBench: Reasoning LLMs Fail on Unanswerable Questions*,
arXiv:2506.09038v1 (10 Jun 2025), **FAIR at Meta**. 20 frontier LLMs, >35k
unanswerable questions, 20 datasets across 6 scenarios including
**underspecified context** — the closest scenario to ours.

- Abstention is "an unsolved problem, and one where scaling models is of little
  use". **Model scale has almost no effect.**
- **Reasoning fine-tuning *degrades* abstention by 24% on average** (DeepSeek R1
  Distill Llama 70B, s1), including on domains those models were explicitly
  trained for. Increasing the reasoning budget generally makes it worse. Their
  Fig 1c shows instruct beating reasoning variants on abstention recall.
- **"A carefully crafted system prompt can boost abstention in practice"** — but
  the authors are explicit that it "does not resolve models' fundamental inability
  to reason about uncertainty".

Three consequences for spec 22: a system-prompt abstention instruction is the
correct and evidenced lever; picking a reasoning-heavier model will not improve
the abstention outcome and may worsen it; and the abstention rate must be
*measured*, never assumed.

### 4.2 Abstention can be an artefact of the option existing

**[P]** Zipeng Ling, Shuliang Liu, Yuehao Tang, Junqi Yang, Shenghong Fu, Chen
Huang, Kejia Huang, Yao Wan, Zhichao Hou, Xuming Hu, *LLM Abstention Can Be a
Prompt Artifact, in Addition to Genuine Uncertainty*, arXiv:2507.16199v6 (2025).
I read the metadata and abstract-level claims **[P]**; the per-dataset numbers I
have are **[S]** and I did not extract the tables.

Core claim: adding an explicit "cannot determine" / "unknown" option
**measurably changes behaviour on problems the model can actually solve**. A
material share of observed abstention is prompt-induced priming, not uncertainty.
Different abstention framings produce different accuracy on identical questions.

This is the counterweight to §3.4 and it must be designed around, not ignored.
**Giving `undetermined` a first-class slot will manufacture some `undetermined`
answers.** The mitigation is to make abstention *costly to reach* while keeping it
*available*: require the abstention to name **what specific fact was missing**.
An abstention that must be justified by a named absent fact is far harder to emit
reflexively than a bare enum value.

### 4.3 The `undetermined` rate is itself the calibration instrument

Nothing in our eval currently measures it. It should be a first-class reported
metric per contract element, because it is the one number that distinguishes
"honest about a hard class" from "hedging on everything". Spec 22 already reports
recall per reachability class; the abstention rate should be reported the same
way. If `undetermined` exceeds roughly half on a contract element, that element
does not belong in the capability.

---

## 5. What NOT to do

Ranked by strength of evidence.

### 5.1 Do not ask for verdict + explanation + fix in one call — **now properly cited**

Our reports state this as fact with **no citation**
(`reports/2026-07-27-enumeration-gap-and-improvement-plan.md:468`,
`reports/2026-07-27-proposed-spec-semantic-finding-merge.md:126`,
`reports/2026-07-27-impact-and-fulfilment-implementation-plan.md:204`). I found
the source and it checks out.

**[P]** Haolin Jin & Huaming Chen, *Are LLMs Reliable Code Reviewers? Systematic
Overcorrection in Requirement Conformance Judgement*, arXiv:2603.00539v1 (2026),
University of Sydney.

False-negative rate — a *correct* implementation wrongly judged defective:

| model | verdict only | + explanation | **+ explanation + fix** |
|---|---|---|---|
| GPT-4o | 26.2 / 35.9 / 35.0 | 58.5 / 74.1 / 45.0 | **73.2 / 87.9 / 60.0** |
| Claude-4.5 | 26.2 / 58.5 / 40.0 | 34.1 / 55.7 / 40.0 | 36.0 / 62.3 / 50.0 |
| Gemini-2.0 | 25.6 / 34.7 / 25.0 | 23.2 / 35.1 / 22.5 | 34.1 / 39.6 / 32.5 |
| Llama-3.1-8B | 57.3 / 74.7 / 52.5 | 86.6 / 91.9 / 87.5 | 84.1 / 88.2 / 77.5 |
| Mistral-Small-3.1 | 35.9 / 60.9 / 40.0 | 31.1 / 47.8 / 32.5 | 48.8 / 74.3 / 62.5 |

(HumanEval / MBPP / QuixBugs.) Our ledger's "26–36% → 73–88%" is the GPT-4o row
and is accurate. Note the effect is **strongly model-dependent** — Gemini-2.0
barely moves — so this is a hazard to guard against structurally, not a universal
constant.

The mechanism matters more than the magnitude. Their taxonomy: **87.2%** of false
rejections fall into four patterns — Logic Error 48.2%, **Added Requirement
14.1%**, Boundary Error 13.2%, **Misread Spec 11.7%** — and they conclude "models
fabricate unstated constraints rather than identify genuine defects."

**Translate to spec 22.** Our adjudicator's failure will not be missing a caller.
It will be **inventing a reliance the caller does not have**. That is the precision
threat, it has a name in the literature, and it is amplified by asking the model
to elaborate.

Their mitigation was a *Fix-guided Verification Filter* that executes tests
(GPT-4o 88.7% → 40.0% FN on MBPP). **We cannot use it** — no execution. So we get
the warning without the remedy, which means the structural avoidance is all we
have: **never ask this stage for a fix, and never let a config flag make it
possible.** Spec 22 already forbids this; the citation now backs it.

### 5.2 Do not add context to buy accuracy

§3.2: identical output from a one-shot model given oracle context. **[P]**
Corroborates our two measured net-negatives. Also **[R]** RIPPLE's Observation 3:
"increasing the context window results in degradation of IA as LLMs do not
robustly make use of relevant information" — their entire clustering design exists
to *shrink* what the Reasoner sees.

### 5.3 Do not build an agentic investigation loop for this

Out of scope by our constraint, and the evidence cuts both ways: it is what made
Sifting's numbers, and it is also what makes them unaffordable — they report
"large disparities in computational cost across agent frameworks" and an explicit
cost-effectiveness frontier. Our own ledger already prices extra passes at
+40–136% for no measurable recall gain **[R]**.

### 5.4 Consensus — with a caveat our ledger does not currently carry

Our rule (`specs/05-review-workflow-and-runtime.md:556`) forbids consensus,
majority voting and agreement thresholds. That rule was derived from *discovery*
experiments where recall is the objective, and it is right there.

**It does not straightforwardly transfer to a precision-first adjudication
stage.** **[P]** RIPPLE Table 4 measures both merge operators on the same system:

| strategy | micro P | micro R | macro P | macro R |
|---|---:|---:|---:|---:|
| sample-and-marginalize (**intersection**, K samples) | 18.3 | 21.3 | 28.2 | 36.3 |
| sample-and-aggregate (**union**) | 9.0 | 34.6 | 17.5 | 51.3 |

Intersection buys **+103.3% micro / +61.1% macro precision**; union buys
**+62.4% / +41.3% recall**. RIPPLE ships intersection *because it is
precision-first*.

Two reasons we should still not do it now: it costs K calls per cluster, which
breaks our bounded-cost constraint; and our own k=3 measurement **[R]** found the
extra samples were *distinct wrong findings*, not near-misses, which is a
population where intersection would be dominated by sampling noise. Record it as
a known, evidenced, unaffordable precision lever — not as a forbidden one.

### 5.5 Do not send the reference line at the end of the excerpt

§3.3, p < .05, FSE 2025. **[P]**

### 5.6 Do not report at the finest granularity the data supports

§1.2. Method-level 28.2% precision vs file-level 60.9% on identical predictions.
**[P]**

---

## 6. Recommended design

### Call 1 — Contract delta (one call per changed symbol group)

**In**: the diff hunks for the changed symbol(s); the symbol's declaration before
and after; nothing else. No dependents, no repository.

**Out**, per changed symbol, an array of **contract-delta claims**:
```
symbol, element ∈ {nullability, returnShape, errorBehaviour, ordering,
                   mutation, concurrency, resourceOwnership, visibility},
before, after,
evidenceLine  (a line number inside the diff),
undetermined  (boolean, with missingFact when true)
```
Rationale: RIPPLE's plan ablation — removing this stage halved precision and cost
45.3% of F1 **[P]**. Enumerating a fixed element set rather than free-form prose
is ZeroFalse's rubric mechanism, worth ΔF1 +0.22…+0.38 on real code **[P]**. The
element list is language-neutral by construction; it names behaviours, not
languages or frameworks.

**A symbol with zero contract-delta claims is dropped before call 2.** This is the
cheapest precision filter in the design and it costs no extra call.

### Call 2 — Impact adjudication (one call per *symbol × destination file*)

**Batch by destination file, not by site.** One call carries every reference site
for one symbol in one file. Reasons: it is one call per unit as constrained;
file-level is the granularity where precision more than doubles (§1.2); and the
sites in one file share a frame, so the excerpt is assembled once.

**In**, in this order:
1. The contract-delta claims from call 1 for this symbol — **only the claims**,
   not the diff, not the changed body. This is the "annotated trace" analogue.
2. For each reference site: the site line, **first**, then a bounded frame around
   it — the enclosing declaration where the language registry can identify one,
   else ±N lines with the site placed in the first third, never the last
   (§3.3, p<.05).
3. Nothing else. No whole file. No unrelated files. (§3.2 — oracle context bought
   exactly zero.)

**Out**, per site, one record:
```
path, line,
reliedUponElement   (one of the enumerated contract elements, or null)
relianceEvidence    (a verbatim substring of the supplied excerpt)
consequence         (one short sentence, the observable effect)
determination ∈ { relies, doesNotRely, undetermined }
missingFact         (required and non-empty iff determination = undetermined)
```

Design choices and their evidence:

- **`relianceEvidence` must be a verbatim substring of what we sent**, and we
  **verify that deterministically** before admitting the finding. This is not a
  claim about model behaviour; it is a check we run. It kills the "Added
  Requirement" failure class (14.1% of spurious rejections **[P]**) mechanically,
  because a fabricated reliance has no substring to quote. The general
  "verbatim-grounding reduces hallucination" literature I found is **thin and
  largely non-peer-reviewed** — I am recommending this on the strength of it being
  *checkable*, not on the strength of that literature.
- **`undetermined` is first-class but expensive to reach**: it requires
  `missingFact`. §3.4 shows a model given a real evidence gap does emit it and
  keeps 100% precision on what remains **[P]**; §4.2 shows an unguarded option
  manufactures abstentions **[P]**. The `missingFact` requirement is the
  reconciliation.
- **No fix, no remediation, no severity in this call.** §5.1 **[P]**.
- **`consequence` is one sentence and is emitted alongside — not as a
  justification of a verdict.** The overcorrection result attaches to
  self-justifying elaboration; a bounded observable-effect field is not that. This
  distinction is my inference from the mechanism, not something the paper tests.
  It is the one place in this design where I am extrapolating, and it should be
  A/B'd (evidence-only vs evidence+consequence) before being trusted.
- **System-prompt abstention instruction**, explicit: prefer `undetermined` to a
  guess. AbstentionBench found this is the one lever that reliably works **[P]**.
- **Do not select a reasoning-maximal model for this stage** without measuring
  abstention: reasoning fine-tuning degraded abstention 24% **[P]**.

### Report shape

- Group findings **by destination file**, with sites nested. §1.2 **[P]**.
- Report `undetermined` counts per contract element, and withheld/dropped counts,
  in the summary. §2.3.
- Keep production and test buckets separate, as spec 22 already requires.

### Expected accuracy, stated before measuring

The nearest published system on this task reaches **28.2% precision at method
granularity, 60.9% at file granularity** **[P]**, and the purely deterministic
dependence-coupling baseline reaches **7.6% / 37.7%**. Our task is easier — our
candidates are proven reference sites — but "beat the deterministic list" is a
lower bar than it sounds, and "beat a human grepping the deterministic list"
requires the file-level precision figure, not the method-level one.

If the first measurement lands near RIPPLE's method-level precision, that is a
**normal** result for this task, not a failure of implementation.

---

## 7. Ranked build order — cheapest and best-evidenced first

1. **Report at file granularity, sites nested.** Zero model cost, zero new call.
   Evidence: precision 28.2% → 60.9% on identical predictions, RIPPLE Table 5 **[P]**.
   This is the highest ratio of evidence to cost in the whole report.
2. **Drop symbols with no contract-delta claim before call 2.** Zero extra cost;
   it is a consequence of the two-call split. Also reduces spend.
3. **Two calls, delta-then-adjudicate, not one fused call.** Evidence: RIPPLE
   Table 6, removing the plan halves precision and costs 45.3% F1 **[P]**; and
   §5.1, fusing verdict with elaboration triples spurious rejection on some
   models **[P]**.
4. **Verbatim `relianceEvidence` with deterministic substring verification.**
   Cheap, mechanical, kills the named dominant failure class. Weakly evidenced in
   the literature, strongly justified as an engineering check.
5. **Enumerated contract elements as a rubric, not free-form.** Evidence:
   ZeroFalse ablation, ΔF1 +0.22…+0.38 on real code — but **two of ten models
   regressed**, so gate it behind an A/B on our provider **[P]**.
6. **`undetermined` + required `missingFact` + a system-prompt abstention
   instruction.** Evidence: AbstentionBench (prompt works, scale and reasoning do
   not) **[P]**; the cross-file ablation showing honest abstention preserves 100%
   precision **[P]**; the artefact paper showing the option must be made costly
   **[P]**.
7. **Excerpt = enclosing declaration, site placed early, never last.** Evidence:
   FSE 2025 lost-in-the-end, p<.05, +37% recall from input sizing **[P]**. The
   exact line count is **not settled by the literature** — decide by A/B.
8. **Report `undetermined` rate per contract element as a first-class metric.**
   Free; it is the only instrument that distinguishes honesty from hedging.
9. *(Deferred, priced, not recommended now.)* **K-sample intersection at
   adjudication only.** +103% micro precision measured **[P]**, at K× cost, and
   against our own evidence that extra samples here are distinct wrong findings
   rather than near-misses **[R]**. Record it; do not build it.
10. *(Explicitly rejected.)* Agentic investigation loop; any fix generation in the
    adjudication call; any added repository context; consensus at discovery.

---

## Source list

**Primary, read here:**
- Yunpeng Xiong, Ting Zhang. *Sifting the Noise: A Comparative Study of LLM Agents
  in Vulnerability False Positive Filtering.* Proc. ACM Softw. Eng. 3, ISSTA,
  Article ISSTA009, Oct 2026. DOI 10.1145/3832100. arXiv:2601.22952v3.
- Aashish Yadavally, Tien N. Nguyen. *From Seed to Scope: Reasoning to Identify
  Change Impact Sets.* ICSE 2026, Rio de Janeiro. DOI 10.1145/3744916.3773265.
- Mohsen Iranmanesh, Sina Moradi Sabet, Sina Marefat, Ali Javidi Ghasr, Allison
  Wilson, Iman Sharafaldin, Mohammad A. Tayebi. *ZeroFalse: Improving Precision in
  Static Analysis with LLMs.* arXiv:2510.02534, 2025.
- Haolin Jin, Huaming Chen. *Are LLMs Reliable Code Reviewers? Systematic
  Overcorrection in Requirement Conformance Judgement.* arXiv:2603.00539v1, 2026.
- Polina Kirichenko, Mark Ibrahim, Kamalika Chaudhuri, Samuel J. Bell.
  *AbstentionBench: Reasoning LLMs Fail on Unanswerable Questions.*
  arXiv:2506.09038v1, FAIR at Meta, 2025.
- Francesco Sovrano, Adam Bauer, Alberto Bacchelli. *Large Language Models for
  In-File Vulnerability Localization Can Be "Lost in the End".* FSE 2025 / Proc.
  ACM Softw. Eng. arXiv:2502.06898. DOI 10.1145/3715758. (Abstract read here;
  results tables not extracted.)
- Zipeng Ling et al. *LLM Abstention Can Be a Prompt Artifact, in Addition to
  Genuine Uncertainty.* arXiv:2507.16199v6, 2025. (Metadata and abstract read
  here; tables not extracted.)

**Search-summary only, not verified in the paper body:**
- Xueying Du, Kai Yu, Chong Wang, Yi Zou, Wentai Deng, Zuoyu Ou, Xin Peng,
  Lingming Zhang, Yiling Lou. *Minimizing False Positives in Static Bug Detection
  via LLM-Enhanced Path Feasibility Analysis* (LLM4PFA). arXiv:2506.10322, 2025.
- Dhanushka Jayasuriya, Valerio Terragni, Jens Dietrich, Kelly Blincoe.
  *Understanding the Impact of APIs Behavioral Breaking Changes on Client
  Applications.* Proc. ACM Softw. Eng., 2024. DOI 10.1145/3643782. Reported
  figure: behavioural breaking changes impact **2.30%** of client test cases.
  ACM returned HTTP 403; figure is from a search summary and the Zenodo
  replication package (DOI 10.5281/zenodo.11498333) confirmed only authorship.
- Reported optimal surrounding-context window of 3 lines; provenance unclear,
  conflicts with other sources, treat as unsettled.

**Vendor-published (run and scored by the beneficiary):**
- Semgrep. *How we built an AppSec AI that security researchers agree with 96% of
  the time*, 2025. *Our AI Assistant is handling 60% of incoming triage work*, 2025.
