# Research: detecting security/privacy/robustness weakening in a code change

Date: 2026-07-29. Open research, not a spec. Nothing here is adopted.

Provenance legend:
- **[P]** read from primary source (paper PDF/HTML or vendor doc I fetched)
- **[S]** search-engine summary only, not verified against the source
- **[V]** vendor-published, run by the party that benefits

---

## TL;DR

1. **The technique to build is not taint analysis.** It is a deterministic
   *egress/guard delta detector* over the diff — "an egress appeared", "a guard
   disappeared" — plus a bounded (≤2 hop) binding resolution and one narrow,
   citation-required model classification, gated by 2-of-3 repetition.
2. **Expected precision: 50–70% for guard-removal, 35–50% for
   sink-added-with-local-binding, 15–30% for the genuinely flow-dependent case.**
   The middle number composes the only two measured components that exist
   (SuSi's 71.4% log-sink identification × ~55% sensitivity classification).
   The last is anchored on YASA's **29.3% production precision** with a
   whole-program index — we would have less information, not more. Assume the
   first real measurement lands *below* these: the one independent reproduction
   of the canonical taint tools cut their published numbers by 20–40 points, and
   LLM secret detection loses 44 points from benchmark to real repositories.
3. **Everything about flow propagation must be deterministic or absent.** The
   model is only allowed to answer "is this value a secret/personal datum, and
   on which line does it become one". IRIS's own ablation shows LLM *sink*
   inference made things worse.
4. **Per-language work is catalogue data only** — no analyser, no build, no
   index. CodeQL is 4.5% language-agnostic by line count; that bill is unpayable
   for 7 languages. And the sensitivity catalogue **already exists as open
   source** (CodeQL's `SensitiveDataHeuristics.qll`) — port it rather than
   invent it.
5. **Tractability, honestly: the local half yes, the flow-dependent half no.**
   The flow-dependent half is not tractable at *anyone's* cost or scope today —
   Semgrep disables cross-file taint on PR scans, CodeQL scores 0.6% on
   pre-commit changes, and the best agentic system scores 17.5%. I recommend
   shipping the local half and explicitly declining the flow-dependent half.
6. **The reframe that makes it shippable:** report a *substantiated fact and a
   question*, not a verdict. "This adds an egress of a non-literal where there
   was none, and removes the call that redacted it" is provable from the diff.
   "This leaks credentials" is not, and at 25% precision would poison the ~87%
   precision the product has earned.

---

## 1. The headline numbers, up front

The most important thing found: **every published system in this space has poor
precision, poor recall, or both — and the ones with good numbers are measured on
benchmarks that do not resemble a pull request.**

| System | Scope | Corpus | Precision | Recall / detection | Prov. |
| --- | --- | --- | --- | --- | --- |
| CodeQL (baseline in IRIS) | whole repo, Java, build required | CWE-Bench-Java (120 real CVEs) | FDR 90.03% → **precision ~10%** | 27/120 = 22.5% | [P] |
| IRIS (GPT-4 + CodeQL) | whole repo, Java | CWE-Bench-Java | FDR 84.82% → **precision ~15%**; refined by manual sample to **~54%** | 55/120 = 45.8%; **F1 0.177** | [P] |
| YASA (Ant Group, production) | whole repo, 4 langs, no build | 7.3K apps, 100M LoC | **29.3%** (92 confirmed of 314 reported) | n/a | [P] |
| RepoAudit | demand-driven, repo | 15 projects | 78.43% | not reported as recall | [P] |
| LLMDFA | function-level + SMT | TaintBench (Android) | 74.63% | 60.24% | [S] |
| NESA/LLMSA | compilation-free | TaintBench | 66.27% | 78.57% (F1 0.72) | [P abs] |
| ZeroFalse | triage of SAST alerts | OWASP Benchmark / OpenVuln | >90% | >90% (F1 0.912 / 0.955) | [P abs] |
| Snyk VulnBench JS (best cfg) | agentic, JS fixtures | 10 fixtures, 44 vulns | 91.5% | 68.0% (F1 75.4%) | [P] [V] |
| **AgenticSCR** | **pre-commit diff + repo nav** | **SCRBench: 144 pre-commit changes, 107 CVEs** | **17.5% fully-correct comments** | — | [P] |
| CodeQL on the same pre-commit corpus | whole repo | SCRBench | **0.6%** | — | [P] |
| Semgrep on the same pre-commit corpus | | SCRBench | **3.7%** | — | [P] |
| Snyk on the same pre-commit corpus | | SCRBench | **0.9%** | — | [P] |

Read the bottom four rows together. **On the one corpus in the literature that
actually matches our setting — a code change, reviewed before commit — the
mature whole-repo taint engines score between 0.6% and 3.7%.** The best agentic
LLM system scores 17.5%. This is the single most important calibration in this
document.

Our own reviewer at 64.4% recall in-diff / ~87% adjusted precision is not
measured on SCRBench and is not comparable. But nothing in the literature
suggests a taint engine would rescue our 0% out-of-diff number cheaply.

---

## 2. System-by-system

### IRIS (the canonical "LLM + taint" paper)

*IRIS: LLM-Assisted Static Analysis for Detecting Security Vulnerabilities*,
Ziyang Li, Saikat Dutta, Mayur Naik. arXiv:2405.17238 (v3, Apr 2025); ICLR 2025
(OpenReview 9LdJDU7E91). **[P]**

- **Scoping:** whole repository. CodeQL builds a full database (Java, requires a
  successful build). The LLM does not do the flow analysis; it *writes the
  taint specifications* (which APIs are sources, which are sinks) that CodeQL
  then uses, and afterwards filters CodeQL's alarms with a contextual pass.
- **Deterministic vs model:** flow propagation is 100% deterministic (CodeQL).
  The model supplies (a) source/sink catalogue, (b) post-hoc alarm triage. This
  is the cleanest division of labour in the literature and it is worth copying
  *as a division of labour* even if we copy nothing else.
- **Real numbers [P, Table 1]:** IRIS-GPT4 detects 55/120, average FDR 84.82%,
  **average F1 0.177**. CodeQL: 27/120, FDR 90.03%, F1 0.076. A manual sample of
  50 IRIS alarms found 27 plausible → refined FDR 46%.
- **Ablation [P, Table 3]:** LLM sources + CodeQL sinks = 36; CodeQL sources +
  LLM sinks = 24; both LLM = 55. **Source inference is where the LLM value is**,
  not sink inference. Sink recall of GPT-4 against CodeQL's own sink list was
  87.11%; sinks are the easy, enumerable half.
- **Language:** Java only. Paper's own words: *"while our results on Java are
  promising, it is unknown if IRIS will perform well on other languages."*
- **Verdict for us:** the technique doubles recall over CodeQL and still lands at
  F1 0.177. It requires a build and a CodeQL database. Not portable to us at any
  price. The *transferable idea* is: LLM infers the catalogue, deterministic
  machinery does the propagation.

### RepoAudit

*RepoAudit: An Autonomous LLM-Agent for Repository-Level Code Auditing*, Jinyao
Guo, Chengpeng Wang, Xiangzhe Xu, Zian Su, Xiangyu Zhang. arXiv:2501.18160;
ICML 2025. **[P abstract]**

- **Scoping:** demand-driven. The agent explores on demand, computing data-flow
  facts along feasible paths *within individual functions*, and chains them with
  agent memory. This is the closest architectural analogue to something we could
  afford — it never builds a whole-repo index.
- **Deterministic vs model:** LLM produces intra-procedural data-flow facts; a
  **validator** checks the facts and the satisfiability of path conditions. The
  validator is the precision mechanism.
- **Numbers:** 40 true bugs across 15 projects at **78.43% precision**; 185 new
  bugs in high-profile projects, 174 confirmed/fixed; **$2.54 and 0.44 h per
  project**. No recall figure is published — the denominator is unknown, so
  78.43% precision is a triage-quality number, not a detection-quality number.
- **Verdict for us:** the cost is the right order of magnitude ($2.54/project vs
  our $1.41/review) and the demand-driven scoping is the right shape. But the
  bug classes are memory/null-safety style, and the missing recall denominator
  means we cannot tell whether it finds 5% or 50% of what is there.

### ZeroFalse

*ZeroFalse: Improving Precision in Static Analysis with LLMs*, Mohsen Iranmanesh
et al. (Simon Fraser Univ., Amirkabir, K.N.Toosi, Ferdowsi, Cyber Risk
Solutions, Forward Security). arXiv:2510.02534, Oct 2025. **[P abstract]**

- **This is not a detector.** It is a triage layer: it consumes an existing SAST
  tool's alerts, enriches each with the flow-sensitive trace and CWE knowledge,
  and adjudicates true/false with an LLM.
- **Numbers:** F1 0.912 on the **OWASP Java Benchmark** and 0.955 on OpenVuln.
- **Discount heavily.** The OWASP Benchmark is a synthetic, generated test suite
  with a balanced true/false design; it is well known to be a weak proxy for real
  code and is the friendliest possible corpus for a triager. F1 0.91 there is
  not evidence of F1 0.91 anywhere else. Recall is bounded above by whatever the
  upstream SAST found — which, per §1, is 0.6–3.7% on pre-commit changes.
- **Verdict for us:** structurally inapplicable — we have no upstream SAST alert
  stream to triage. It does validate our existing *refutation* stage design.

### LLM4PFA

*Minimizing False Positives in Static Bug Detection via LLM-Enhanced Path
Feasibility Analysis*, arXiv:2506.10322 (Jun 2025). **[S]**

- Same family as ZeroFalse: a post-filter on static alerts, using agent-driven
  targeted constraint reasoning over path constraints. Reported to filter up to
  96% of false positives. **[S — I did not verify the 96% against the paper.]**
- Same structural inapplicability: requires an alert with a path to reason about.

### LLMDFA / NESA (LLMSA)

- *LLMDFA: Analyzing Dataflow in Code with Large Language Models*, Chengpeng
  Wang, Wuqi Zhang, Zian Su, Xiangzhe Xu, Xiaoheng Xie, Xiangyu Zhang. NeurIPS
  2024, arXiv:2402.10754. Compilation-free. Decomposes into source/sink
  extraction, dataflow summarisation, path feasibility; delegates extraction and
  feasibility to **parsers and an SMT solver** synthesised by the LLM. 87.10%
  precision / 80.77% recall average; **74.63% / 60.24% on real Android
  (TaintBench)**. **[S]**
- *NESA: Relational Neuro-Symbolic Static Program Analysis* (formerly LLMSA),
  Chengpeng Wang et al., arXiv:2412.14399 (Dec 2024, rev. Apr 2026).
  Compilation-free; an analysis policy language (restricted Datalog) decomposes
  the analysis; parsing does syntax, LLM does semantics. **66.27% precision /
  78.57% recall, F1 0.72 on TaintBench.** **[P abstract]**
- **Verdict for us:** this is the most relevant research line — compilation-free,
  decomposed, deterministic where it can be. The honest read of the numbers: on
  the synthetic/curated part they look good; **on real-world code the same
  systems drop to 60–79% precision and 60–79% recall**, and TaintBench is Android
  malware, a domain with unusually well-catalogued sources and sinks (SuSi).

### Semgrep

Primary source, docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro **[P]**:

- Cross-file (interfile, interprocedural) taint is a **Pro Engine** feature.
- **Direct quote: "Note that cross-file analysis does not currently run on
  diff-aware (pull request or merge request) scans."**
- Documented limitations include CommonJS `module.exports` not being tracked,
  and interfile name resolution differing from Semgrep CE.
- No build step is required — this is Semgrep's real advantage.
- Semgrep Assistant's "96% agreement" figure **[P] [V]**: it measures agreement
  with Semgrep's own security researchers on **true-positive triage decisions**,
  over 2,000 findings, evaluated internally by Semgrep. The same post admits
  **agreement on false positives is only 41%**, and that Assistant is
  deliberately biased toward "fix it". It is a triage-agreement number, not a
  detection number, and it is vendor-run.

**This is finding #4 answered by the market leader against itself:** the most
widely deployed diff-aware SAST in the world explicitly turns cross-file taint
*off* for pull-request scans. Whatever we build here, we are not conceding
ground to an existing product.

### YASA (Ant Group) — the honest industrial ceiling

*YASA: Scalable Multi-Language Taint Analysis on the Unified AST at Ant Group*,
Yayi Wang, Shenao Wang, Jian Zhao, Shaosen Shi, Ting Li, Yan Cheng, Lizhong
Bian, Kan Yu, Yanjie Zhao, Haoyu Wang. arXiv:2601.17390v2 (Apr 2026). **[P, read
tables 1, 5–10]**

This paper is the best available evidence on what language-neutral taint
actually costs and actually delivers.

- **Cost of per-language work, measured:** in CodeQL, **only 4.5% of the codebase
  is language-agnostic** — 27,492 LoC agnostic vs 118,622 LoC of extractors plus
  462,578 LoC of language-specific query libraries (Table 1). YASA's own answer
  is a Unified AST with 52 shared semantic functions plus 10–19 language-specific
  handlers per language, ~47,000 LoC for 4 languages (Python, JS, Java, Go) and
  16 framework-specific checkers.
- **Language-agnostic-only degradation, measured (Table 8):** with
  language-specific handlers disabled, benchmark success drops from 74%
  (626/851) to 64% (547/851) — and per-language soundness drops 2% (Java) to 12%
  (Python). So *pure* language-neutrality costs about 10 points, not everything.
  That is the most encouraging number in this document for a language-neutral
  design.
- **Detection on the xAST microbenchmark (Table 6):** YASA leads everything,
  and still only reaches soundness 70–91% and completeness 55–71%. CodeQL scores
  48–66% soundness; Joern 37–63%. Semgrep CE was excluded because **the community
  version does not support interprocedural taint analysis**.
- **Production precision (Table 9): 314 taint paths reported, 92 confirmed =
  29.3% precision.** Of the 222 false positives, **179 (80.6%) were caused by
  sanitisers the engine did not recognise.**
- No compilation required. 31.8 KLOC/min (CodeQL 9.3, Joern 17.1).
- Nothing in the paper indicates diff-scoped or incremental analysis.

**The 29.3% figure is the number to quote to the product owner.** A dedicated
industrial team, 47K LoC, four languages, framework-aware, running on their own
code, gets 29.3% precision on taint paths. And the dominant error mode is
*"there was a mitigation there that I couldn't see"* — which is exactly the error
mode a diff-scoped tool would suffer from worst.

### AgenticSCR — the closest analogue to our actual product

*AgenticSCR: An Autonomous Agentic Secure Code Review for Immature
Vulnerabilities Detection*, Wachiraphan Charoenwet, Kla Tantithamthavorn,
Patanamon Thongtanunam, Hong Yi Lin, Minwoo Jeong, Ming Wu. arXiv:2601.19138
(Jan 2026), under review. **[P, full text]**

- **SCRBench:** 144 pre-commit code changes, 107 CVEs, 92 repositories, 33 CWEs,
  Python/JavaScript/TypeScript, human-verified line-level annotations.
- Agent tools: `open_files`, `expand_code_chunks`, `grep`, `expand_folder`,
  `bash` (git). Diff-centric with repository navigation — i.e. it *does* reason
  across the diff boundary.
- **Results:** localisation 30.8%, relevance 63.5%, type-correctness 70.1%,
  **all three together 17.5%.** Baselines: static-LLM prompt 6.9%, CodeQL 0.6%,
  Semgrep 3.7%, Snyk 0.9%.
- **Per-type:** "Information" vulnerabilities 6.2%, "Control" 0%.
- Limitations the authors state: 144 samples; LLM-as-judge for relevance
  (F1 0.86); 7 days of manual annotation.
- **[P]** No cost or latency reported — a meaningful omission for us.

The 0% on "Control" and 6.2% on "Information" categories is a warning shot: the
categories nearest to our motivating examples are where the best agentic system
scores worst.

### Contextual bias — a correction and a caution

*Measuring and Exploiting Contextual Bias in LLM-Assisted Security Code Review*,
Dimitris Mitropoulos, Nikolaos Alexopoulos, Georgios Alexopoulos, Diomidis
Spinellis. arXiv:2603.18740v2 (Apr 2026). **[P, read pp. 1–7]**

I initially mis-summarised this as evidence that more context hurts. **It is
not** — it is about *framing*, and the real result is more useful to us.

Setup: CrossVul, 250 CVE/patch pairs (247 vulnerable + 250 patched files),
6 models × 5 framing conditions = 14,910 queries.

Neutral framing, Table 2 — detection rate on vulnerable files vs true-negative
rate on the *patched* (clean) files:

| Model | Detects vuln | Correctly clears patched |
| --- | --- | --- |
| GPT-4o-mini | 97.2% | **3.2%** |
| Gemini 2.0 Flash | 95.5% | **7.2%** |
| DeepSeek V3 | 96.8% | **4.5%** |
| Claude 3.5 Haiku | 68.4% | 31.6% |
| Claude Sonnet 4.5 | 97.4% | **4.3%** |
| Claude Opus 4.5 | 95.3% | **11.8%** |

**Asked "is there a vulnerability in this file", frontier models say yes about
95% of the time whether or not there is one.** False-positive rate on already-
patched code is 88–97%. And manual validation found that **57.6%–71.0% of the
"correct" detections on vulnerable files were justified by an unrelated issue** —
the model flagged something, and it happened to be the wrong thing.

Second result, directly relevant to our injection-guard finding: the paper's
attack works by putting persuasive security framing in PR titles, descriptions
and commit messages. Template attacks failed (16/17 rejected) but an
LLM-in-the-loop iterative refinement attack reached **100% success**. The
defence that worked was **redacting PR metadata before review**. Notably, in 12
of 16 successful rejections the agent's stated reason was **semantic
contradiction between the PR's claimed purpose and the actual code** — which is
precisely the mechanism our spec 23 (intent-fulfilment review) proposes.

**Implication for this problem:** a naive "does this change weaken a security
property?" prompt is a machine for producing 90%+ false positives. Any design
must include a mechanism that makes "no" the cheap answer.

### Snyk VulnBench JS — variance evidence

*Snyk VulnBench JS 1.0: Can LLMs Find the Same Bugs Twice?*, Liran Tal, Johannes
Kloos, Arsenii Rudich, Stephen Thoemmes, Manoj Nair (all Snyk). arXiv:2606.15762
(Jun 2026). **[P abstract+results]** **[V — Snyk-authored, ground truth is Snyk
Code's own output, which the authors acknowledge as circular.]**

- 10 JS/Express fixtures, 44 reference vulns, 300 scans (10 × 6 configs × 5 reps).
- Best config (Claude Opus 4.6 Medium): F1 75.4%, recall 68.0%, precision 91.5%,
  sd 0.2pp. Noisiest (Sonnet 4.6 High): F1 64.9%, recall 81.3%, precision 58.6%,
  sd 3.5pp.
- A larger/pricier config scored *worse* (68.8% F1) at 5.67× the cost.
- **The reproducibility result is the valuable one:** 134/158 reference-matched
  findings appeared in all 5 repetitions (stable), but **80/161 unmatched
  ("extra") findings appeared in only 1 of 5 runs.** Findings that match a known
  defect are stable; findings the model volunteers on its own are coin flips.

This is direct external corroboration of our own measured variance (sd 2.4–4.8pp)
and of our "unlisted-real" ambiguity. **Operational rule it suggests: any
speculative flow-based finding should be required to survive k repetitions
before being shown.** That is a precision lever we have not tried, and unlike
extra context it does not change the prompt — it only costs money.

### Retrospective VCC mining (for completeness, low relevance)

SZZ / VCCFinder-style mining identifies vulnerability-contributing commits
*after* a fix is known. Best assessment found: individual techniques ≤0.60
precision at ≤0.89 recall; AND-combination 0.75 precision; ML ensembles 0.80
("Back to the Roots: Assessing Mining Techniques for Java
Vulnerability-Contributing Commits", ACM TOSEM, doi:10.1145/3769105) **[S]**.
These are *retrospective* and require the fix commit as input. They cannot run
on an open PR. Useful only as a corpus-construction technique for our eval set.

---

## 3. Answers to the five questions

### Q2 — how do they bound the search?

| Approach | Bounding strategy | Needs whole-repo index? |
| --- | --- | --- |
| CodeQL / IRIS | full database, whole-program query | Yes + build |
| YASA | whole-program UAST | Yes, no build |
| Joern | whole-program CPG from fuzzy parse | Yes, no build |
| Semgrep Pro | interfile, whole scan only | Yes, no build; **off for diffs** |
| RepoAudit | **demand-driven**, per-function facts + agent memory | **No** |
| LLMDFA / NESA | **compositional**: per-function summaries, composed lazily | **No** |
| AgenticSCR | **diff-centric + on-demand grep/open** | **No** |

The three that need no index are the three that are LLM-driven, and they are
also the three with the least trustworthy recall numbers. That is not a
coincidence: bounded search buys cost and portability by giving up completeness.

### Q3 — language-neutrality, concretely

- **Needs a build:** CodeQL for compiled languages (Java, C#, C/C++, Go).
  Infer. Anything on LLVM/bytecode IR. Disqualified for us outright.
- **Needs per-language analyser but no build:** Semgrep Pro (per-language
  semantics), Joern (per-language frontend + type-recovery pass), YASA
  (per-language parser + 10–19 semantic handlers each). YASA quantifies the
  price of skipping the per-language handlers: **-10 points overall, -2% to -12%
  soundness per language** (Table 8). Joern is explicitly criticised in the YASA
  paper for lacking cross-module analysis, which is exactly our case.
- **Degrades gracefully / genuinely neutral:** LLM-driven decomposition
  (LLMDFA, NESA, RepoAudit, AgenticSCR). They need a parser for anchors, not for
  semantics. Our existing ast-grep layer (7 languages) is already at this level.
- **Concrete conclusion:** no per-language *taint* work is affordable for us.
  A per-language *catalogue* (what is a log sink, what is a secret-shaped name)
  is affordable — it is a data file, not an analyser.

### Q4 — differential / change-scoped taint: does anyone do it?

**No. Nobody computes "which source→sink flows are new in v2, and which
pre-existing sinks became reachable." Not in the literature, not in any shipped
product.** This was checked as a dedicated investigation; the absence is
consistent and well-evidenced.

Three things get *called* differential and are not:

**(a) Incremental for speed** — recompute the whole-repo answer faster. Explicit,
result-preserving, mature:
- *Reviser: Efficiently Updating IDE-/IFDS-Based Data-Flow Analyses in Response
  to Incremental Program Changes*, Steven Arzt, Eric Bodden, ICSE 2014,
  doi:10.1145/2568225.2568243. Taint-capable (IFDS/IDE, Soot/Heros), and the
  paper states it "computes the same results as a full recomputation"; up to 80%
  time saved. **[P — full PDF read by the sub-investigation]**
- *EvoTaint: Incremental Static Taint Analysis of Evolving Android Apps*, Jiawei
  Guo, Haipeng Cai, TOSEM 2025, doi:10.1145/3743132. Closest paper *by title* to
  our question; 51.8–68.9% time reduction "without compromising accuracy" — the
  goal is equivalence with a full scan. **[S]**
- *IncA* (Szabó, Erdweg, Völter, ASE 2016; OOPSLA 2018), *IncIDFA* (PACMPL 2025,
  doi:10.1145/3720436), *Incrementalizing Production CodeQL Analyses* (FSE 2023,
  doi:10.1145/3611643.3613860). All (a). **[S]**
- **CodeQL overlay analysis** is pure caching: an overlay DB over a cached base
  DB from the default branch. GitHub's docs state alerts "appear ... the same way
  as alerts from full scans." **[P]** GA March 2026, ~80% PR scan-time reduction
  claimed. **[S]**

**(b) Genuinely change-scoped semantics** — this tradition exists, and has
**never been pointed at taint**:
- *Differential Symbolic Execution*, Person, Dwyer, Elbaum, Păsăreanu, FSE 2008,
  doi:10.1145/1453101.1453131.
- *Directed Incremental Symbolic Execution (DiSE)*, Person, Yang, Rungta,
  Khurshid, PLDI 2011 / TOSEM 2014, doi:10.1145/2629536 — explores only
  behaviours *impacted by the change*. Closest existing formalism; path
  reachability for regression testing, not source→sink reachability.
- *Differential Assertion Checking*, Lahiri, McMillan, Sharma, Hawblitzel,
  FSE 2013, doi:10.1145/2491411.2491452 — "relative correctness"; evaluated on
  Verisec for *relative memory safety*. Nearest anyone gets to a differential
  security property.
- *Verification Modulo Versions*, Logozzo, Lahiri, Fähndrich, Blackshear,
  PLDI 2014, doi:10.1145/2594291.2594326 — reports only *semantically* new
  alarms, with a soundness guarantee. **This is the correct shape of the answer
  for alarms in general, and the taint-flow analogue has never been built.**
- *Analysis of Software Patches Using Numerical Abstract Interpretation*, Delmas
  & Miné, SAS 2019, doi:10.1007/978-3-030-32304-2_12 — numeric properties only.

**(c) Set-difference filtering** — what industry actually ships, and it is
post-hoc deduplication, not analysis:
- **Infer** `reportdiff --report-current/--report-previous` → `introduced.json`,
  `fixed.json`, `preexisting.json`. Two full runs, subtract. **[P]**
- **Semgrep** `--baseline-commit`. **[P]**
- **CodeQL** diff-informed queries (`restrictAlertsTo`) filter alerts to
  added/modified lines. GitHub's docs warn this "permits but does not guarantee"
  omission of out-of-range alerts. **[P]**

**And where diff-scoping meets flow analysis, the flow analysis is switched
off.** Three independent vendor admissions:
- Semgrep: *"Cross-file analysis is not supported for diff-aware scans."* and
  *"cross-file analysis does not currently run on diff-aware (pull request or
  merge request) scans."* **[P]**
- Checkmarx: incremental scans "cannot find results where all result nodes are
  outside the closure files"; and *"Only full SAST scans are used for
  Exploitable Path, results from incremental scans aren't considered."* **[S]**
- Meta's own framing (CACM 62(8) 2019, Distefano, Fähndrich, Logozzo, O'Hearn)
  treats "incremental scalability needed to support diff time reporting" as a
  *challenge* for deep interprocedural reasoning. **[S — CACM returned 403]**

Mariana Trench and Zoncolan have no documented incremental/differential mode.
**[P for Mariana Trench config docs]** OpenAI's **Aardvark** (Oct 2025) is the
closest *intent* match found — it "monitors commits and code changes for new
vulnerabilities" and validates exploitability in a sandbox, claiming 92%
detection on golden repos — but **publishes no method, no differential formalism,
and no precision number. Vendor-reported. [S]**

**Bottom line: this is a genuine, empty niche.** The literature does not even
have a standard name for it (DiSE's "impacted behaviours" is the closest
vocabulary). But the emptiness is not an oversight — computing a reachability
*delta* honestly requires two whole-program analyses, which is exactly what a
PR-time budget cannot buy. That is why everyone degrades to (c).

**The counter-evidence we must not ignore.** Diff-local framing has a measured
ceiling:
- *CrossCommitVuln-Bench: A Dataset of Multi-Commit Python Vulnerabilities
  Invisible to Per-Commit Static Analysis*, Arunabh Majumdar, arXiv:2604.21917
  (Apr 2026). 15 real Python CVEs whose exploitable condition emerges across a
  mean of 3.1 commits. Semgrep + Bandit: **per-commit detection 13% (2/15),
  whole-codebase detection 27% (4/15)**. **Caveat hard: preprint, single
  independent author, n=15, unreviewed.** Directional only.
- *An Exploratory Study on Regression Vulnerabilities*, Larissa Braz, Enrico
  Fregnan, Vivek Arora, Alberto Bacchelli, ESEM 2022, arXiv:2207.01942,
  doi:10.1145/3544902.3546250. 78 regression vulnerabilities at Mozilla where a
  bug fix introduced one. Security is not discussed during bug fixes;
  **developers assume tools will catch regressions**; dynamic analysis found
  ~30%. This is a peer-reviewed statement of exactly the gap the product owner
  is describing, and it says the demand is real.

Retrospective commit archaeology is a solved-ish adjacent problem and is **not**
what we need: NDSS 2026 s140 (Qixuan Guo et al., 6,920 CVEs / 5.86M commits,
94.94% accuracy, 86.92% recall) and CommitShield (arXiv:2501.03626, ICSE 2025
Companion) both require the *fix* as input. Useful to us only for building an
eval corpus.

### Q5 — secrets/PII to log sinks

The question assumed this is "a narrower, well-studied problem than general
taint." **Narrower yes; well-studied no.** Full treatment in §6; the short form:

- **No published precision/recall exists for any secrets-or-PII-to-log-sink
  detector**, on any public benchmark, from anyone. CodeQL self-*declares*
  `java/sensitive-log` as "medium" precision. Semgrep Secrets and Mariana Trench
  publish no numbers at all.
- The measured numbers live one level down, in the two components:
  - **is this a secret** — best independently-measured precision is **75%**
    (GitHub, at 2.7–36% recall) or **46%** (Gitleaks, at 86–88% recall); five of
    nine benchmarked tools are **below 7%** precision.
  - **is this a log sink** — exactly one measured figure exists in the
    literature: SuSi's **71.4% precision at 100% recall** on the LOG category.
- **Naming alone tops out near 60%** (SuSi's own stated ceiling). That is the
  ceiling on any purely lexical "this variable looks sensitive" heuristic.
- The prevalence of the defect is not in doubt: **42–65% of studied Android apps
  log PII**, and in a 1,000-app study **60.7% leaked**, with **76.9% of instances
  undisclosed by the app's privacy policy**.

---

## 4. What I would actually build

**Recommendation: do not build taint analysis. Build an egress/guard *delta*
detector that makes a deterministic claim, and spend model budget only on the
narrow classification question the diff cannot answer by itself.**

The reframing that makes this affordable: stop trying to output a *verdict*
("this is a vulnerability") and output a *substantiated fact plus a question*
("this change adds an egress of a non-literal value where there was none, and
removes the call that previously redacted it"). We can prove the fact from the
diff. We cannot prove the verdict, and the entire literature confirms that
nobody else can either. Because the capability is **advisory, not gating**, the
fact is the shippable unit.

### Stage 1 — two deterministic triggers, both diff-local (no model, no index)

**Trigger A — egress appeared or widened.** An added line calls something in an
*egress sink catalogue* (logger/print/console, telemetry & span attributes,
HTTP response body & headers, exception messages, serialisers, analytics,
cache/queue writes, URL construction) with at least one **non-literal**
argument. Pure AST over added lines. We already parse 7 languages.

**Trigger B — a guard disappeared or weakened.** A removed/altered line matches a
*mitigation catalogue* (redact/sanitize/scrub/mask/filter/escape/validate/
authorize/allowlist/denylist naming, plus removal of a conditional that
dominated a retained sink, plus removal of an entry from a literal
deny/allow list). Also pure AST + diff.

Why this is the right shape:
- Both are **change-scoped by construction**. They answer "what did this diff do
  to egress and to guards", which is the actual question, without ever computing
  whole-program reachability — the thing nobody can afford (§3, Q4).
- Both **fire rarely**. That is the whole economic argument. Precision becomes a
  question over a small denominator instead of over every hunk.
- The catalogues are **data files, not analysers**. YASA's Table 8 is the
  supporting evidence: pure language-agnostic semantics still passes 64% of
  cases vs 74% with per-language handlers. Catalogues degrade gracefully;
  analysers do not.
- Trigger B alone covers the product owner's **first** motivating example
  (PII filter removed from a logger) essentially deterministically.

### Stage 2 — bounded backward resolution (deterministic, ≤2 hops)

For each non-literal argument reaching a triggered sink, resolve its binding
using our **existing** identifier-boundary reference lookup. Hard cap: 2 hops,
files already in context plus one lookup. Emit a fixed-size evidence packet.

**Explicitly not agentic.** Five context-adding/agentic interventions have
already been built and removed here, and added context measured net-negative
twice. This stage must be a bounded deterministic walk with a fixed budget, or
it will reproduce those failures. If it cannot resolve within 2 hops, it says
"unresolved" and that becomes part of the report, not a licence to explore.

### Stage 3 — one narrow model question, with a cheap "no"

Do **not** ask "does this weaken security". The contextual-bias data (§2) is
unambiguous: asked that, frontier models answer yes on 88–97% of *already
patched, clean* files, and 58–71% of their "correct" hits are justified by an
unrelated issue. That prompt is a false-positive generator.

Ask instead a *located classification*: "Of the values reaching this sink, name
any that carry a secret or a personal datum, and cite the line where it acquires
that property. If none, answer NONE." Requiring a cited line is the mechanism
with the most evidence behind it — it is what our own refutation stage does
(~87% adjusted precision), what IRIS's contextual filter does, and what
RepoAudit's validator does.

### Stage 4 — k-repetition gate, on the triggered subset only

Snyk's VulnBench result is the justification: findings that match a known defect
appeared in 5/5 runs (134/158), but **model-volunteered findings appeared in
only 1 of 5 runs about half the time (80/161)**. Everything Stage 3 produces is
model-volunteered. Require 2-of-3 agreement.

Cost: our own cache probe says k-sampling costs +40–50%, not +5–15% — but here
it applies only to the small triggered subset, not to every review. If triggers
fire on ~10% of hunks, marginal cost is roughly 0.1 × 3 × (small packet), well
under $0.20/review amortised. Compare the removed interventions at +40–61% on
*every* review.

### What must be deterministic vs model

| Concern | Owner | Why |
| --- | --- | --- |
| Sink catalogue, guard catalogue | **Deterministic** (data file) | IRIS ablation: LLM sink inference *hurt* (24 vs 27); sinks are enumerable |
| Trigger detection on the diff | **Deterministic** (ast-grep) | It is a syntactic fact; must be reproducible for baselining |
| Guard-removal detection | **Deterministic** | The claim *is* the diff; needs no inference |
| Binding resolution ≤2 hops | **Deterministic** (existing ref lookup) | Bounded, cheap, already built |
| "Is this value a secret / personal datum?" | **Model** | Genuinely semantic; naming heuristics alone are the known FP source |
| "Is the removed guard load-bearing here?" | **Model, refuted** | Needs a cited line |
| Promotion, dedup, severity, baseline | **Deterministic** | Existing admission stage |

### This is spec 22's pattern, pointed at a different property

Reading `specs/22-change-impact-review.md` (Approved, 2026-07-27) after reaching
the recommendation independently: **it is already the same design.** Its stated
purpose is "tell a human reviewer what a change puts at risk outside the lines it
touches, with the evidence to judge it — **not a verdict**". Its design is
(1) contract delta from the diff, (2) **bounded, directed** dependent lookup —
"not open-ended repository search", (3) adjudication, (4) report as evidence.
And it explicitly contrasts itself with "an open-ended hunt that has failed here
five times".

Swap "contract delta" for "egress/guard delta" and "dependent discovery" for
"backward binding resolution" and you have this proposal. That convergence is
worth something: the pattern has already survived review here for a structurally
identical problem, and spec 22's separate-command / separate-evaluation rule
(don't pool scores across different questions) applies verbatim.

**Recommendation follows from that: build this as a sibling of spec 22, on the
same skeleton, not as a flag on `review`.** Same shared machinery (intake,
provider resolution, config, path service, reporting), same "outside the
admission gate" handling, same directional-anchor discipline.

### Fit with what already exists (checked in the repo)

`src/domains/deterministic-signals/` already has exactly the shape this needs:
a registry (`deterministic-signal-registry.ts`), an ast-grep parser, a polyglot
extractor, a language router, and `SupportedSignalLanguage` covering
**typescript, javascript, python, go, rust, java, ruby** — the 7 languages.
`SupportSignalFactKind` is currently `import | export | declaration |
public-symbol | module`.

The proposal adds **two fact kinds** (`egress-sink`, `guard-mitigation`) and two
catalogue data files. It is an increment to a tested module, not new
infrastructure. That materially lowers the cost of *trying* it — which matters,
because the honest answer below is that it should be measured before it is
believed.

### Per-language work required

Only catalogue entries — a YAML file of call-name patterns per language for
sinks and guards, plus framework aliases (Express `res.send`, Flask/Django
loggers, Go `log`/`slog`, Java SLF4J, etc.). This is hours of work per language
and degrades to "generic identifier-name match" where absent. **No per-language
analyser, no build step, no index.** That is the one design property the
literature says is non-negotiable for us: CodeQL is 4.5% language-agnostic by
line count; we cannot pay the other 95.5% for seven languages.

### Expected precision, and the evidence for it

I will give ranges, and I will say which are supported and which are guesses.

- **Trigger B (guard removed near a retained sink): 50–70% "worth reading."**
  Moderately supported. The claim being made is a diff fact, so the only failure
  mode is "the removal was intentional//harmless" — a human judgement, not a
  reasoning error. There is no published number for exactly this; the closest
  anchor is YASA's finding that **80.6% of its false positives came from
  unrecognised sanitisers** — i.e. sanitiser presence/absence is the dominant
  signal in taint precision, which is what this trigger measures directly.
- **Trigger A + secret classification, value bound inside the diff or ≤2 hops:
  35–50%.** Now composable from measured parts rather than guessed — see §6.7:
  SuSi's **71.4%** log-sink identification × ~**55%** sensitivity classification
  (SuSi's 60% naming-only ceiling / the 51% real-repo LLM figure) ≈ **39%**
  before refutation. Adjusted up modestly because our refutation stage is
  measurably strong (~87% adjusted precision on diff-local defects), not because
  I expect it to double the number.
- **Trigger A, flow-dependent, source outside the diff and beyond 2 hops:
  15–30%, and low recall.** This is the hard version. Anchors: YASA **29.3%** in
  production *with a whole-program UAST*; AgenticSCR **6.2%** on the
  "Information" category and **0%** on "Control" with full repo navigation;
  CodeQL **0.6%** on the same pre-commit corpus. We would have strictly less
  information than YASA and only slightly more targeting than AgenticSCR.

**Bias all three downward on first measurement.** Two independent reproductions
say so: Pauck et al. cut the canonical Android taint tools' published F-measures
by 20–40 points when re-run on equal footing, and LLM secret detection loses
**44 points of precision** moving from a benchmark split to real repositories
(§6.5, §6.6). Every anchor above is a benchmark number or a different domain.

**I would not claim better than these without measuring, and the eval corpus
does not exist yet — SCRBench (144 pre-commit changes, 107 CVEs, Py/JS/TS) is
the obvious thing to try to obtain or reconstruct (§7).**

---

## 5. Is this tractable at our cost and scope? — the honest answer

**Split the question, because the two halves have opposite answers.**

**The local half is tractable and cheap. Build it.**
"A guard was removed", "an egress was added and takes a non-literal", "a value
whose name/type indicates a credential now reaches a log call" — these are
diff-local, deterministic to *detect*, cheap to *evidence*, and they cover the
product owner's first example completely and the second example in the common
case where the token is visible within a couple of hops. This is a real product
capability that nothing on the market ships well, and Semgrep's own
documentation proves the gap is open.

**The flow-dependent half — the taint source three frames up, outside the
diff — is not tractable at our cost and scope. I do not think we should try.**

The evidence, all from primary sources:
1. It is not tractable at *anyone's* cost and scope. YASA — a dedicated
   industrial team, 47K LoC, whole-program UAST across 4 languages, framework-
   aware, running on their own codebase — reports **29.3% precision**.
2. On pre-commit changes specifically, the mature engines score **0.6% (CodeQL),
   0.9% (Snyk), 3.7% (Semgrep)** and the best research agent scores **17.5%**.
3. The market leader in diff-aware SAST **turns cross-file taint off for PR
   scans**, documented in its own manual.
4. The generic prompt that would substitute for the analysis produces **88–97%
   false positives on clean code**.
5. Our own history: five context-adding/agentic interventions built, measured,
   removed; added context net-negative twice. The flow-dependent half is, by
   construction, intervention number six of the same kind. The prior is bad and
   it is our own prior, measured on our own corpus.
6. The two components it depends on are individually capped low: identifying a
   log sink is measured once, at **71.4%**; classifying a value as sensitive
   tops out near **60% on naming** and lands at **51% on real repositories** for
   an LLM. Their product is ~39% *before* any of the flow difficulty.

**One genuinely encouraging counterweight, and it is worth stating.** Because
no precision figure has ever been published for secrets/PII-to-log-sink
detection by anyone (§6.0), there is no incumbent to lose to. And of SuSi's sink
categories, **LOG has the highest recall (100%)** — log sinks are the easiest
sink class in the literature to enumerate. A curated catalogue over 7 languages
is the kind of narrow, high-precision instrument that took GitHub's secret
scanner to 75% precision while everything broader sat under 50%. The local half
is not merely tractable; it is playing to the one measured strength in this
entire field.

There is one important qualifier: because this is **advisory, not gating**, a
25–30% precision informational report *can* be worth shipping — but only if the
claim is honest about what it is. "We noticed a new egress here and could not
determine what flows into it" is a defensible advisory line. "This leaks
credentials" at 25% precision is not, and would poison the ~87% precision the
rest of the product has earned.

### The strongest objection to this design, and my answer

CrossCommitVuln-Bench measures per-commit static analysis at **13%** detection
vs 27% for whole-codebase. If that generalised, a diff-local design would be
capped at half the value of a whole-repo one.

I do not think it generalises, for three reasons:
1. **The dataset is selected for the property it then measures.** Its title is
   "…Vulnerabilities *Invisible to Per-Commit Static Analysis*". Sampling CVEs
   that per-commit analysis misses and then reporting that per-commit analysis
   misses them is close to circular. The 13% is a floor for an adversarially
   chosen slice, not an estimate for PRs in general.
2. n=15, single independent author, unreviewed preprint.
3. It measures **Semgrep + Bandit pattern matching**, not a reasoning reviewer.
   Our own in-diff recall is 64.4%, which already far exceeds 13% on our corpus.

But the objection does land in one place, and I want it on the record: **the
triggers are diff-local by design, so any weakening that spans several PRs is
out of scope and always will be.** We should say that in the capability's own
documentation rather than let a user assume coverage we do not have.

- **Do not build or buy a taint engine.** Per-language, and either a build step
  (CodeQL, Infer) or a whole-repo index (Joern, YASA, Semgrep Pro). Both violate
  the "checkout, fast" constraint. CodeQL's own 4.5%-agnostic ratio is the price
  tag.
- **Do not revive agentic cross-file discovery (spec 16) for this.** AgenticSCR
  is precisely that design, with a stronger tool set than ours, and it reaches
  17.5% overall and 0% on the category nearest our second example.
- **Do not run a second "before" analysis to diff alert sets.** That is what
  baseline-diffing does; it costs two full analyses to get a set difference, and
  it is the reason nobody ships change-scoped taint at PR time.
- **Do not ask the model an open "did this weaken security" question anywhere in
  the pipeline.** §2 quantifies why.

### Two side-findings worth acting on regardless

1. **Spec 23 (intent-fulfilment review) has external validation.** In the
   contextual-bias paper's attack evaluation, the review agent rejected 16 of 17
   template-based adversarial PRs, and in **12 of those 16 the stated reason was
   a semantic contradiction between the PR's claimed purpose and the actual code
   change**. Intent-vs-code contradiction is cheap, diff-local, needs no flow
   analysis, and is empirically the mechanism that caught vulnerability
   re-introduction. It may be a better investment than the flow work.
2. **Spec 11 (external context ingestion) is an attack surface with a measured
   exploit.** The same paper's LLM-assisted iterative refinement attack achieved
   **100% success** by crafting PR titles/descriptions/commit messages, and the
   defence that restored detection in all cases was **redacting PR metadata
   before review**. Our injection guard already helped recall (62.5% → 81.3%);
   this is a different axis — ingested PR prose as a *persuasion* channel, not a
   command-injection channel. Worth an explicit A/B: review with and without PR
   description, and check whether the description is net-negative for security
   findings specifically.

---

## 6. Sinks and secrets specifically

The premise of question 5 was that secrets/PII-to-log-sink is "a narrower,
well-studied problem than general taint." **The first half is true; the second is
not.**

### 6.0 The headline: there is no published number

**No precision or recall figure exists, on any public benchmark, for any
secrets-or-PII-reaching-a-log-sink detector.** Not for CodeQL
`java/sensitive-log`, not for `py/clear-text-logging-sensitive-data`, not for
Semgrep, not for Mariana Trench. What exists is:
- **self-declared query metadata** — CodeQL rates `java/sensitive-log` precision
  **"medium"** and `py/clear-text-logging-sensitive-data` **"high"**, on a
  4-point author-assigned scale. Not a measurement. **[P — query help pages]**
- **prevalence studies** that use planted-value or keyword ground truth and
  explicitly decline to report detector accuracy;
- **vendor pages with no numbers at all** (Semgrep Secrets: zero figures, one
  anecdote **[P]**; Mariana Trench: no precision/recall published, and its
  announcement states the design deliberately prioritises "finding more
  potential issues, even if it means showing more false positives" **[P]**).

So there is no number to inherit. We would be setting the first one. That cuts
both ways: no one can say our result is bad, and no one can tell us what "good"
is before we measure.

### 6.1 The prevalence of the defect is well established

- *Is Your Private Information Logged? An Empirical Study on Android App Logs*,
  Zhiyuan Chen, Soham Sanjay Deo, Poorna Chander Reddy Puttaparthi, Vanessa
  Nava-Camal, Yiming Tang, Xueling Zhang, Weiyi Shang. arXiv:2602.07893. Planted
  PII, grep logs: **610 leak instances in 35/83 apps (42%)**; a newer set, 51/78
  (65%). Authors state they are explicitly *not* building a detector — **no
  precision/recall.** **[S/B]**
- *Do Privacy Policies Match with the Logs?*, Chen, Ahir, Suleiman, Yao, Tang,
  Shang, Hou. EASE 2026, arXiv:2604.18552. 1,000 apps, **86,836,964 log
  entries**; **607 apps (60.7%) leaked**; 62,271 instances, **47,901 (76.9%)
  undisclosed by the privacy policy**. Keyword + GPT-expansion + regex + manual
  FP removal. **No precision/recall.** **[S/B]**
- *A Comprehensive Study of Privacy Leakage Vulnerability in Android App Logs*,
  Chen et al., ASE 2024, doi:10.1145/3691620.3695609. **[S]**

**The product owner's instinct is right about the problem being real** — 42–65%
of studied apps log PII. It is the *detection* accuracy that is unmeasured.

### 6.2 Secret detection: the bottleneck, and it is worse than assumed

*A Comparative Study of Software Secrets Reporting by Secret Detection Tools*,
Setu Kumar Basak, Jamison Cox, Bradley Reaves, Laurie Williams (NC State).
**ESEM 2023**, arXiv:2307.00714. SecretBench: 818 repos, 97,479 labeled
candidates, **15,084 true secrets**. **[P — tables read directly]**

| Tool | Precision | Recall (same line) | Recall (anywhere) | F1 | Derived FP rate |
| --- | --- | --- | --- | --- | --- |
| GitHub Secret Scanner | **0.75** | 0.03 | 0.36 | 0.48 | 24.9% |
| Gitleaks | 0.46 | **0.86** | **0.88** | **0.60** | 54.2% |
| Commercial X (ML) | 0.25 | 0.22 | 0.48 | 0.32 | 75.0% |
| ggshield | 0.19 | 0.23 | 0.46 | 0.26 | 80.7% |
| TruffleHog | 0.06 | 0.31 | 0.52 | 0.11 | 94.0% |
| git-secrets | 0.05 | 0.04 | 0.21 | 0.08 | 94.8% |
| Repo-supervisor | 0.02 | — | 0.17 | 0.04 | 98.0% |
| Whispers | 0.01 | 0.01 | 0.38 | 0.02 | 99.4% |
| SpectralOps (ML) | 0.01 | — | 0.67 | 0.02 | 99.7% |

The paper's own conclusion: *"no current tool has the coveted high precision and
high recall scores."* Five of nine are below 7% precision. **ML did not help** —
the two proprietary ML tools score 25% and 1%.

GitHub's 75% is bought by matching ~180 validated partner patterns with issuer
verification, at 2.7–36% recall. That trade — narrow catalogue, high precision —
is exactly the trade my §4 design makes, and this is the evidence it works.

Also worth knowing, because everyone cites it wrongly: **Meli et al.'s "99.29%"
is not a precision.** *How Bad Can It Git?*, Michael Meli, Matthew R. McNiece,
Bradley Reaves, NDSS 2019 **[P]** — that figure is the pass rate of their own
heuristic filter over regex matches, and the paper's own footnote disclaims it as
non-representative. Their manual review was 240 candidates, κ=0.753, yielding an
**89.10% sensitivity estimate**, not a detector precision. Saha et al. (COMSNETS
2020) already re-publish 99.29% as if it were a precision.

**Entropy is a measurably weak feature.** TruffleHog scores a real 47-char key at
Shannon entropy **4.08** and the English phrase `ThisIsAReallyLongString` at
**4.11** — the dummy ranks higher **[P]**. Real low-entropy passwords
(`password = 'pencil'`) are missed; high-entropy placeholders
(`{{cf-client-secret-development}}`) are flagged.

`detect-secrets` (Yelp), absent from the ESEM study, was measured in production
at JPMorgan Chase (Kerr, Algorry, Ibraimoski, Maciver, Moran, arXiv:2401.01754):
**precision 0.26 / recall 1.00 in code; 0.45 / 0.15 on Confluence.** **[S/B]**

And the deployment reality: *Why secret detection tools are not enough — an
industrial case study*, Md Rayhanur Rahman, Nasif Imtiaz, Margaret-Anne Storey,
Laurie Williams. **EMSE 27:59 (2022)**, doi:10.1007/s10664-021-10109-y —
**developers classified 50% of the tool's warnings as false positives.** **[P
abs]**

### 6.3 The single most useful artifact found

CodeQL's sensitivity classifier is **open source and directly readable**:
`shared/concepts/codeql/concepts/internal/SensitiveDataHeuristics.qll` **[P —
source read]**. It is five positive regexes (`maybeSecret`, `maybeAccountInfo`,
`maybePassword`, `maybeCertificate`, `maybePrivate` — the last with ~40
alternatives covering ssn, passport, card numbers, cvv/iban, birth date, medical
/patient/prescription, blood type, pregnancy, mac address, lat/long) plus one
negative suppression regex (`redact|censor|obfuscate|hash|md5|sha|random|crypt|
encode|certain|concert|secretar|wildcard|coauthor|account(ant|ab|ing|ed)|file|
path|url`).

**This is precisely the catalogue my §4 design needs, already curated, already
tuned by adversarial contact with real code.** Two details in it are worth more
than the regexes themselves:
- **`e(mail|_mail)` is present but commented out**, with the note
  `// this seems too noisy`. GitHub measured email-as-PII and *removed* it. If we
  add email to our catalogue we should expect to rediscover that.
- The negative regex begins `[^\w$.-]`, meaning **any name containing a space or
  punctuation is auto-declared non-sensitive** — a blunt guard against matching
  prose and SQL. Worth copying.
- Changelog-level tuning granularity: *"variables with names that contain 'null'
  (case-insensitively) are no longer considered sources of sensitive
  information."* **[S]** That is the resolution at which this is maintained.

**Action:** before writing a catalogue from scratch, lift this one (verify the
licence — CodeQL query source is MIT, but confirm for the `shared/` tree) and
port it to ast-grep name matching. It saves weeks and starts us at the
state of the art rather than below it.

### 6.4 Log sinks: one measured number exists

*SuSi: A Machine-learning Approach for Classifying and Categorizing Android
Sources and Sinks*, Siegfried Rasthofer, Steven Arzt, Eric Bodden. **NDSS 2014**.
**[P — Tables II–VII read]**

SVM, 144 features, trained on 779 hand-annotated methods (~0.7% of the Android
API). Source/sink classification weighted avg **91.9% precision / 91.9% recall**.
Sink *categorisation* (Table VII):

| Category | Recall | Precision |
| --- | --- | --- |
| **LOG** | **100.0** | **71.4** |
| ACCOUNT | 85.7 | 100.0 |
| NETWORK | 72.7 | 88.9 |
| FILE | 60.0 | 100.0 |
| Weighted avg | 85.7 | 88.0 |

**SuSi's 71.4% precision at 100% recall on the LOG category is, as far as this
survey can establish, the only measured number in the literature for identifying
a log sink.** Encouragingly for a catalogue-based design, log sinks are the
*highest-recall* category — they are easy to find and moderately easy to get
right.

The paper's crucial caveat, and it argues *against* pure naming: *"considering a
method's signature and the syntax of its method body alone is insufficient...
With such features alone we were unable to obtain a precision or recall higher
than about 60%."* **Naming alone tops out near 60%; dataflow features are what
lift SuSi to ~92%.**

### 6.5 The flow half does not rescue it either

*Do Android Taint Analysis Tools Keep Their Promises?*, Felix Pauck, Eric Bodden,
Heike Wehrheim. **ESEC/FSE 2018**, doi:10.1145/3236024.3236029, arXiv:1804.02903.
**[P — §5 and Tables 2–5 read]**

FlowDroid's famous **86% precision / 93% recall** (Arzt et al., PLDI 2014,
doi:10.1145/2594291.2594299) **does not reproduce off its authors' chosen
subset**:

| Tool | Promised F | Reproduced F (DroidBench <3.0) | F on DroidBench 3.0 |
| --- | --- | --- | --- |
| FlowDroid | 0.89 | 0.719 | 0.674 |
| IccTA | 0.98 | 0.735 | 0.667 |
| Amandroid | 0.81 | 0.651 | 0.611 |
| DroidSafe | 0.91 | 0.686 | 0.596 |
| DIALDroid | — | 0.161 | 0.137 |

Averaged across all 18 DroidBench 3.0 categories the best tools sit at **0.504
(FlowDroid) / 0.506 (Amandroid)**, and **six of 18 categories score 0.000 for
every tool** (implicit flows, reflection, dynamic loading, reflection-over-ICC,
self-modification, native). Authors' conclusion: *"we could not reproduce the
accuracy that was claimed in the proposing tool papers apart from one promise
made by Arzt et al. for FlowDroid considering a small set of benchmark cases."*

**This is the most important methodological warning in the whole survey**, and it
should govern how we read every number in §1: the one time someone independently
re-ran the canonical taint tools on equal footing, the published numbers fell by
20–40 points.

### 6.6 LLM approaches, and the benchmark→wild collapse

Two papers, both from the same group (BUET), both largely preprints, both
evaluated on datasets they curated — **discount accordingly, there is no
independent reproduction.** **[S/B]**

- *Secret Breach Detection in Source Code with LLMs*, Rahman, Ahmed, Wahab,
  Sohan, Shahriyar. arXiv:2504.18784. Regex candidates → LLM classify, on
  SecretBench: GPT-4o few-shot P 0.933 / R 0.947; fine-tuned LLaMA-3.1 8B
  P 0.986 / R 0.985.
- *Secret Leak Detection in Software Issue Reports using LLMs*, Ahmed, Rahman,
  Wahab, Uddin, Shahriyar. arXiv:2410.23657. 54,148 instances, κ=0.9545. Regex
  alone P 6.8% / R 100%; GPT-4o few-shot P 70.5% / R 92.9%; fine-tuned Qwen-7B
  P 94.8% / R 94.1%.

**And then the line that matters most in this entire document:** on a real-world
validation set (178 repos, 1,489 issue reports, 30 actual secrets), the same
model scored **86.67% recall but 50.98% precision** — a **~44-point precision
collapse** from the held-out benchmark split, caused by the class imbalance real
repositories have and benchmark splits do not.

### 6.7 What §6 does to my precision estimate

The composition is now estimable from measured parts rather than guessed:

- Identify the log sink: **~71%** (SuSi LOG, the only measured figure) — and our
  hand-curated catalogue over 7 languages should beat that, because we choose the
  catalogue rather than infer it, the way GitHub's 75%-precision scanner does.
- Decide the value is sensitive: **~60% from naming alone** (SuSi's explicit
  ceiling), **~51% for an LLM in the wild** (arXiv:2410.23657 real-repo split).
- Compose, assuming rough independence: **0.71 × 0.55 ≈ 39%** for
  "a sensitive value reaches a log sink", *before* any refutation stage.

Our refutation stage plus a 2-of-3 repetition gate is the only reason to expect
better than 39%. It is worth real points — it is what takes our main reviewer to
~87% adjusted precision — but I would not assume it doubles this.

**Revised estimates, replacing the §4 guesses:**
- **Trigger B (guard removed near a retained sink): 50–70%.** Unchanged, and now
  better supported — YASA's finding that 80.6% of taint FPs come from
  unrecognised sanitisers says sanitiser presence/absence is the dominant signal,
  and Trigger B observes it directly from the diff rather than inferring it.
- **Trigger A + secret classification, binding within 2 hops: 35–50%** (was
  40–60%). Anchored on 0.71 × 0.55 ≈ 39%, adjusted up modestly for refutation.
- **Flow-dependent, source beyond 2 hops: 15–30%.** Unchanged. Anchored on YASA
  29.3%, AgenticSCR 6.2% on "Information", CodeQL 0.6% on pre-commit.

And one honest caveat that applies to all three: **every one of those anchors is
a benchmark or a different domain.** The Pauck reproduction (20–40 point drop)
and the LLM real-repo collapse (44 point drop) both say the same thing — assume
our first real measurement comes in below these numbers, not above.

---

## 7. If we build it, how to measure it

The capability must not ship on the strength of this document. What is needed:

1. **A corpus that isolates the phenomenon — and do not mine it by hand.**
   `eval/corpora/change-impact-candidates/README.md` records the yield of the
   last attempt: **5 candidates / 7 expectations from 66,685 commit bodies
   screened across 27 repositories**, still unvalidated and unhydrated, blocked
   on a schema, a hydration orientation, and two disclosure flags. That is the
   realistic price of naturally-occurring out-of-diff evidence, and it is too
   high to pay again.
   Cheaper routes, in order of preference:
   - **Synthesise by reverting guard-adding fixes.** Find commits whose diff
     *adds* a redaction/sanitisation/validation call on a path that reaches a
     sink, and revert them. Ground truth is the fix itself; the "weakening" is
     the revert. This is the same construction D2A (arXiv:2102.07995) and
     Delta-Bench use, it is mechanisable, and it exactly matches Trigger B.
     It also side-steps the disclosure problem — a synthesised revert cannot
     disclose its own answer the way a mined commit message can.
   - **SCRBench** (AgenticSCR, arXiv:2601.19138) — 144 pre-commit changes, 107
     CVEs, Py/JS/TS, human-verified line-level labels; the closest published
     match to our setting. Check whether the artifacts are public before
     building anything; it would also give us the only directly comparable
     baseline numbers in existence (CodeQL 0.6%, Semgrep 3.7%, AgenticSCR 17.5%).
2. **Controls are mandatory.** The contextual-bias data says an unguarded prompt
   answers "vulnerable" ~95% of the time. Half the corpus must be changes that
   touch sinks/guards *benignly*. Without negative cases the precision number is
   meaningless.
3. **Report the trigger-fire rate separately from precision.** If triggers fire
   on 60% of hunks the design is dead on cost regardless of precision; if they
   fire on 5% it is cheap even at 30% precision.
4. **Replicate.** Our measured variance band is sd 2.4–4.8pp and Snyk's data says
   model-volunteered findings are near-coin-flips run to run. A single run
   showing improvement is not evidence — that lesson is already in our own
   rejected-interventions history.
5. **Kill criteria, agreed before measuring.** Suggested: reject if trigger-fire
   rate >25% of hunks, or precision <35% on guard-removal, or if overall review
   precision drops more than 2pp, or if cost rises more than 15%.

---

## 8. Source index

Retrieved 2026-07-29 unless noted.

**LLM + taint / static analysis**
- IRIS — Li, Dutta, Naik. arXiv:2405.17238; ICLR 2025 (OpenReview 9LdJDU7E91).
  <https://arxiv.org/abs/2405.17238> **[P]**
- RepoAudit — Guo, Wang, Xu, Su, Zhang. arXiv:2501.18160; ICML 2025. **[P abs]**
- ZeroFalse — Iranmanesh, Moradi Sabet, Marefat, Javidi Ghasr, Wilson,
  Sharafaldin, Tayebi. arXiv:2510.02534 (2025). **[P abs]**
- LLM4PFA — Du, Yu, Wang, Zou, Deng, Ou, Peng, Zhang, Lou. arXiv:2506.10322
  (2025). Filters 72–96% of FPs; misses 3 of 45 true positives. **[P abs]**
- LLMDFA — Wang, Zhang, Su, Xu, Xie, Zhang. NeurIPS 2024, arXiv:2402.10754. **[S]**
- NESA / LLMSA — Wang, Gao, Zhang, Liu, Guo, Zheng, Shi, Zhang.
  arXiv:2412.14399 (Dec 2024, rev. Apr 2026). **[P abs]**
- AgenticSCR — Charoenwet, Tantithamthavorn, Thongtanunam, Lin, Jeong, Wu.
  arXiv:2601.19138 (Jan 2026), under review. SCRBench. **[P full]**
- Revelio — arXiv:2606.22263 (Jun 2026). Memory safety, C, sanitizer-verified
  PoV, ~$300/7 projects. Out of scope for us. **[S]**

**Industrial taint**
- YASA — Y. Wang, S. Wang, Zhao, Shi, Li, Cheng, Bian, Yu, Zhao, H. Wang (Ant
  Group + HUST). arXiv:2601.17390v2 (Apr 2026). **[P — Tables 1, 5–10 read]**
- Semgrep Pro cross-file analysis docs —
  <https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro> **[P]**
- Semgrep diff-aware scanning docs —
  <https://docs.semgrep.dev/deployment/customize-ci-jobs> **[P]**
- Semgrep Assistant 96% post (2025) — **[P] [V]**
- GitHub CodeQL incremental/overlay analysis docs + 2026-03-24 changelog **[P]**
- Infer CI/reportdiff — <https://fbinfer.com/docs/steps-for-ci/> **[P]**
- Zoncolan — engineering.fb.com 2019-08-15 **[P]**; Distefano, Fähndrich,
  Logozzo, O'Hearn, "Scaling Static Analyses at Facebook", CACM 62(8) 2019
  **[S — 403]**
- Mariana Trench config docs — <https://mariana-tren.ch/docs/configuration/> **[P]**
- Checkmarx incremental-scan limitations **[S]**
- OpenAI Aardvark (Oct 2025) — 92% claimed, no method. **[S] [V]**

**Incremental (speed) dataflow**
- Reviser — Arzt & Bodden, ICSE 2014, doi:10.1145/2568225.2568243 **[P]**
- EvoTaint — Guo & Cai, TOSEM 2025, doi:10.1145/3743132 **[S]**
- IncA — Szabó, Erdweg, Völter, ASE 2016; OOPSLA 2018 **[S]**
- IncIDFA — PACMPL 2025, doi:10.1145/3720436 **[S]**
- Incrementalizing Production CodeQL Analyses — FSE 2023,
  doi:10.1145/3611643.3613860 **[S]**

**Change-scoped semantics (non-taint)**
- Differential Symbolic Execution — Person, Dwyer, Elbaum, Păsăreanu, FSE 2008,
  doi:10.1145/1453101.1453131 **[S]**
- DiSE — Person, Yang, Rungta, Khurshid, PLDI 2011 / TOSEM 2014,
  doi:10.1145/2629536 **[S]**
- Differential Assertion Checking — Lahiri, McMillan, Sharma, Hawblitzel,
  FSE 2013, doi:10.1145/2491411.2491452 **[S]**
- Verification Modulo Versions — Logozzo, Lahiri, Fähndrich, Blackshear,
  PLDI 2014, doi:10.1145/2594291.2594326 **[S]**
- Delmas & Miné, SAS 2019, doi:10.1007/978-3-030-32304-2_12 **[S]**

**Evaluation / behaviour of LLM reviewers**
- Measuring and Exploiting Contextual Bias in LLM-Assisted Security Code Review —
  Mitropoulos, N. Alexopoulos, G. Alexopoulos, Spinellis. arXiv:2603.18740v2
  (Apr 2026). **[P — pp. 1–7 read, Table 2]**
- Snyk VulnBench JS 1.0 — Tal, Kloos, Rudich, Thoemmes, Nair (Snyk).
  arXiv:2606.15762 (Jun 2026). **[P] [V — circular ground truth]**
- An Insight into Security Code Review with LLMs — Yu, Liang, Fu, Tahir, Shahin,
  C. Wang, Cai. arXiv:2401.16310 (2024, rev. 2026). **[P abs]**

**Commit-level / corpus construction**
- CrossCommitVuln-Bench — Majumdar. arXiv:2604.21917 (Apr 2026). n=15,
  unreviewed. **[P]**
- An Exploratory Study on Regression Vulnerabilities — Braz, Fregnan, Arora,
  Bacchelli. ESEM 2022, arXiv:2207.01942, doi:10.1145/3544902.3546250 **[S]**
- CommitShield — arXiv:2501.03626; ICSE 2025 Companion **[P abs]**
- NDSS 2026 s140 (Guo, VIC via differential patching patterns) **[P]**
- D2A — arXiv:2102.07995 **[S]**
- Back to the Roots (Java VCC mining) — ACM TOSEM, doi:10.1145/3769105 **[S]**

**Secrets, PII, and log sinks (§6)**
- A Comparative Study of Software Secrets Reporting by Secret Detection Tools —
  Basak, Cox, Reaves, Williams. ESEM 2023, arXiv:2307.00714. **[P]**
- SecretBench — Basak, Neil, Reaves, Williams. MSR 2023, arXiv:2303.06729. **[S]**
- How Bad Can It Git? — Meli, McNiece, Reaves. NDSS 2019. **[P]**
- Secrets in Source Code: Reducing False Positives using ML — Saha, Denning,
  Srikumar, Kasera. COMSNETS 2020, pp. 168–175. **[P]**
- Why secret detection tools are not enough — Rahman, Imtiaz, Storey, Williams.
  EMSE 27:59 (2022), doi:10.1007/s10664-021-10109-y. **[P abs; body paywalled]**
- Using AI/ML to Find and Remediate Enterprise Secrets — Kerr, Algorry,
  Ibraimoski, Maciver, Moran (JPMorgan Chase). arXiv:2401.01754 (2024). **[S/B]**
- SuSi — Rasthofer, Arzt, Bodden. NDSS 2014. **[P — Tables II–VII]**
- FlowDroid — Arzt, Rasthofer, Fritz, Bodden, Bartel, Klein, Le Traon, Octeau,
  McDaniel. PLDI 2014, doi:10.1145/2594291.2594299. **[S for the 86/93 pair]**
- Do Android Taint Analysis Tools Keep Their Promises? — Pauck, Bodden,
  Wehrheim. ESEC/FSE 2018, doi:10.1145/3236024.3236029, arXiv:1804.02903. **[P]**
- Amandroid — Wei, Roy, Ou, Robby. CCS 2014 (ext. ACM TOPS 2018). **[S]**
- CodeQL `SensitiveDataHeuristics.qll` (source read) + query-help pages for
  `java/sensitive-log`, `py/clear-text-logging-sensitive-data`,
  `java/log-injection`. **[P]**
- Semgrep Secrets launch post — no numbers. **[P] [V]**
- Mariana Trench announcement — no numbers, recall-over-precision by design.
  **[P] [V]**
- Secret Breach Detection in Source Code with LLMs — Rahman, Ahmed, Wahab,
  Sohan, Shahriyar. arXiv:2504.18784. **[S/B]**
- Secret Leak Detection in Software Issue Reports using LLMs — Ahmed, Rahman,
  Wahab, Uddin, Shahriyar. arXiv:2410.23657. **[S/B]**
- Is Your Private Information Logged? — Chen, Deo, Puttaparthi, Nava-Camal,
  Tang, Zhang, Shang. arXiv:2602.07893. **[S/B]**
- Do Privacy Policies Match with the Logs? — Chen, Ahir, Suleiman, Yao, Tang,
  Shang, Hou. EASE 2026, arXiv:2604.18552. **[S/B]**
- A Comprehensive Study of Privacy Leakage Vulnerability in Android App Logs —
  Chen et al. ASE 2024, doi:10.1145/3691620.3695609. **[S]**

**Could not verify**
- CACM "Scaling Static Analyses at Facebook" — 403 on all mirrors; the
  "diff time reporting is a challenge" quote is snippet-only.
- Aardvark's 92% — no methodology published anywhere I could reach.
- LLM4PFA's benchmark identity — abstract gives the 72–96% range but not the
  corpus; I did not read the full paper.
- No `Bhandari et al.` incremental-IFDS paper exists under that description; the
  name in this space belongs to CVEfixes-style dataset work.
- FlowDroid's exact 86%/93% pair is snippet-sourced; it is corroborated
  arithmetically by Pauck et al.'s record of a promised F-measure of 0.89
  (2·0.86·0.93/(0.86+0.93) = 0.894), so it is almost certainly right, but I did
  not read the PLDI paper itself.
- Basak et al. contain an internal inconsistency: the prose says GitHub Secret
  Scanner recall is "6%" while Table III shows 0.03 (408/15,084) same-line and
  0.36 anywhere. The F1 of 0.48 is consistent with the table, not the prose.
- CodeQL `shared/` tree licence not confirmed — CodeQL *queries* are MIT, but
  verify before porting `SensitiveDataHeuristics.qll`.
- The `detect-secrets` and Semgrep Secrets tools are absent from the only
  independent benchmark (ESEM 2023); their accuracy is effectively unknown.
- **WebSearch budget (200 calls) was exhausted during this survey.** Unrun
  queries include: self-consistency/k-sampling effects on vulnerability-detection
  precision (which would directly support or undermine the 2-of-3 gate in §4),
  exact-phrase hunts for "newly reachable flow" framings, and internal-tooling
  blogs from Google/Uber/Amazon. ACM DL, ResearchGate and CACM returned 403
  throughout.

---
