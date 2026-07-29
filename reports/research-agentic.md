# Does agentic decomposition beat a single well-scoped call for security review of a change?

Research memo, 2026-07-29. Scope: the proposed architecture is
(1) deterministic blast radius → (2) plan → (3) sub-agents with tools, one property each →
(4) advisory output, non-gating.

**Verdict in one line:** the *deterministic-scoping* axis and the *execution-verification* axis
have large, replicated effect sizes; the *decomposition* axis (planning + sub-agents) has
essentially no controlled evidence in its favour for code review, one strong controlled result
predicting it is actively harmful in our regime, and the reference case cited in support
(Cursor) moved in the opposite direction from the proposal. **So step (1) of the proposal is
well founded, step (2) is unsupported in either direction, step (3) is the weakest part, and
the component that carries the gain everywhere it has been measured is the one we cannot
build.**

The strongest honest counter-evidence — which should be read before the rest, not after — is
in **§1a-bis** (OpenAI's Codex team measured repo access + code execution improving recall
*and* precision on code review) and **§2.5** (Trail of Bits' "one outcome per agent"). Neither
credits planning, and neither is an ablation with numbers.

Legend used throughout:
**[V]** independently verifiable (peer-reviewed, third-party, or observable third-party record) ·
**[P]** primary vendor source, self-reported · **[S]** secondary/press · **[?]** could not verify.

---

## 0. The reference point is being read backwards

The proposal cites Cursor's Bugbot rewrite. The primary post is
*"Building a better Bugbot"*, cursor.com/blog/building-bugbot, **15 Jan 2026** [P].

What it actually says, verbatim:

- **Old architecture:** "Run eight parallel passes with randomized diff order" →
  "Majority voting to filter out bugs found during only one pass" → "Run results through
  a validator model to catch false positives" (plus bucketing, merging, category filter, dedup).
- **New architecture:** "The agent could reason over the diff, call tools, and decide where
  to dig deeper instead of following a fixed sequence of passes."
- **Prompting inversion:** "With earlier versions of Bugbot we needed to restrain the models
  to minimize false positives. But with the agentic approach we encountered the opposite
  problem: it was too cautious. We shifted to aggressive prompts that encouraged the agent
  to investigate every suspicious pattern."
- **Result:** "increased Bugbot's resolution rate from 52% to over 70%" over "40 major
  experiments"; bugs flagged per run 0.4 → 0.7; resolved bugs per PR ~0.2 → ~0.5.

Three things follow that matter more than the headline:

1. **Cursor removed decomposition; it did not add it.** They went from an 8-pass
   ensemble + majority vote + separate validator model to *one* agent that calls tools.
   The post describes a singular agent. There is **no planning stage** described and
   **no sub-agents** described. The proposal's step (2) and step (3) are not what Cursor did —
   the delta they bought was *tools + one agent + aggressive prompting*, replacing
   *more* orchestration with *less*.
2. **"Resolution rate" is not precision or recall.** Cursor defines it as: it "uses AI to
   determine, at PR merge time, which bugs were actually resolved by the author in the final
   code." It is an LLM-judged, self-measured, self-defined metric on their own traffic, with
   no released dataset. It is also confounded with volume: flagging more (0.4 → 0.7/run)
   changes the denominator composition. Treat 52% → 70% as **[P] vendor-reported and
   non-comparable to our recall/precision.**
3. They report **no ablations.** The post says only "Many changes, surprisingly, regressed
   our metrics." Which of the 40 experiments carried the gain is not disclosed. So the
   attribution "agentic decomposition caused 52→70" is not supported even by the source.

Independent check on Bugbot's standing: on Martian's Code Review Bench, **Cursor Bugbot
ranks #6 at 45.5% F1 / 47.2% precision / 43.8% recall**; Claude Code Reviewer #13
(37.6% F1); CodeRabbit #17 (30.3% F1); the leader `cubic` at 61.8% F1
[S — figures reported on cubic.dev/blog, 14 Jul 2026, a *vendor* blog citing the
independent benchmark; I could not fetch the leaderboard page itself, see §6 flags].
The flagship agentic-with-tools reviewer does not dominate.

---

## 1. What the strong systems actually do

| System | Planning stage | Sub-agents | Tools | Execution verification | Independently verified? |
|---|---|---|---|---|---|
| Google Project Naptime | **no** — single tool loop, 16 steps; a "Controller" exists but only *verifies* | **no** — and explicitly rejected in favour of independent resampling | yes (code browser, Python, **debugger+ASan**, reporter) | **yes — the terminal gate** | benchmark is public (CyberSecEval 2); numbers self-run [P] but reproducible in principle |
| Google Big Sleep | **no** — same loop, seeded with a **commit message + diff** | **no** | yes (same four) | **yes — crash reproduced in debugger before `report_success`** | CVE records + Apple/SQLite fixes semi-independent; **no FP rate ever published** |
| Google OSS-Fuzz AI | n/a | no | yes | **execution IS the finder** — the LLM only writes harnesses and triages | 26 vulns vs 11,000 from conventional OSS-Fuzz [P] |
| DeepMind CodeMender | not described | **yes — explicit "special-purpose agents" + LLM critique + LLM equivalence judge** | yes (debugger, code browser) | **yes — static/dynamic/differential/fuzzing/SMT validators** | **none.** 72 patches, no denominator, no ablation, no paper |
| OpenAI Aardvark / Codex Security | **no planner described** | **not in the blogs — but the CLI docs require ≥6 "delegated workers"** | yes, explicitly ("tool-use", "writing and running tests") | **yes — sandbox trigger; but *downgraded* to best-effort in 2026** | **none whatsoever.** No dataset, methodology, harness, or third-party reproduction for any claim |
| XBOW | **yes** — a "coordinator" | **yes** — spawns "solvers", each an AI pentester with an objective | yes (headless browser, InteractSH OOB, proxy) | **yes — flag/alert/canary exfiltration = ground-truth oracle** | **HackerOne record is third-party observable — and see §1c for how badly the headline overstates it** |
| ZeroPath | **yes** — Tree-of-Thoughts + ReAct | **yes** — "specialized verification agents" per vuln class | yes, over a **tree-sitter AST + call graph** built first | partial — syntax/functional checks + **re-scan**, not test execution | 4 maintainer-confirmed CVEs; best rating in one independent pentester review |
| Semgrep **Assistant** (triage) | **no** | **no** | **no** | n/a — sits on a *deterministic* Semgrep finding | vendor-reported but **250k–1M findings, 45+ enterprises** — by far the largest sample in this memo |
| Semgrep **Multimodal** (detection) | no planner | no | yes — **the agent calls the Semgrep engine as a tool** | no | vendor benchmark, but the *shape* of the result is the most useful datum here (§1c) |
| GitHub Copilot Autofix 2024–25 | **no** | **no** | **no** — prompt assembled deterministically from the CodeQL alert | **no** — heuristics only (syntax, name resolution, registry check) | telemetry only, no sample sizes, no independent study found |
| GitHub agentic autofix 2026 | no | no | yes | **yes — re-runs CodeQL** | **zero success-rate numbers published** |
| Snyk DeepCode AI Fix | **no** | **no** | **no** — `CodeReduce` program-analysis slicing, then sampling | analyzer re-run per prediction | **arXiv paper with open code+data — the only reproducible artifact in the space** |
| Pixee | n/a | n/a | mostly deterministic codemods, LLM only for edge cases | **yes — CI/CD test verification** (only external oracle in the set) | vendor-reported, internally inconsistent (95% vs 98%) |
| Cursor Bugbot | **no** | **no** — replaced an 8-pass ensemble with **one** agent | yes | **no** | #6 on Martian's benchmark [S] |

*(Section 1a is filled from the dedicated research pass below; 1c follows.)*

The pattern visible across the whole table, before any vendor detail:
**every system with a credible external result validates candidates by running something.**
None of them presents evidence that the *decomposition* is what produced the result.

### 1a. OpenAI: Aardvark → Codex Security → Daybreak

**Naming correction first:** the Oct 2025 announcement page now carries an in-page banner —
*"March 6, 2026 Update: Aardvark is now Codex Security, and is available as a research
preview."* Three generations, saying materially different things:
Aardvark (**30 Oct 2025**), Codex Security (**6 Mar 2026**), Daybreak / GPT-5.5-Cyber
(**22 Jun 2026**). ⚠️ `openai.com/index/*` returns **HTTP 403 to automated fetching**;
these were read by browser rendering. Anyone re-checking hits the same wall.

**Four pipeline stages, verbatim** — note "threat model" is the *output* of stage 1, not a stage:
*"Analysis: It begins by analyzing the full repository to produce a threat model…
Commit scanning: It scans for vulnerabilities by inspecting commit-level changes against the
entire repository and threat model as new code is committed…
Validation: Once Aardvark has identified a potential vulnerability, it will attempt to trigger
it in an isolated, sandboxed environment to confirm its exploitability…
Patching: It attaches a Codex-generated and **Aardvark-scanned** patch to each finding."*
(That last detail — the finder re-reviews the fixer's patch — is a cheap self-check worth noting.)

**LLM reasoning, not fuzzing/SAST**, stated explicitly: *"Aardvark does not rely on traditional
program analysis techniques like fuzzing or software composition analysis. Instead, it uses
LLM-powered reasoning and tool-use… by reading code, analyzing it, **writing and running
tests**, using tools, and more."*

**Planning stage: no OpenAI primary source describes one. Do not claim Aardvark plans.**
**Sub-agents: not in the blog posts, but yes in the CLI docs** — deep scans require
*"delegated workers and at least six usable worker slots"*, and *"discovery workers inherit your
selected model and reasoning settings."* (`bulk-scan --workers N` is repo-level parallelism, a
different axis.) So the fan-out is **k parallel discovery workers of the same configuration** —
closer to sampling than to the proposal's "each sub-agent checks a different property."

**★ The most analytically interesting thing in the whole OpenAI corpus: the sandbox step was
quietly downgraded.**
- Oct 2025, unconditional: *"it **will** attempt to trigger it in an isolated, sandboxed
  environment to **confirm its exploitability**."*
- Mar 2026, hedged: *"**Where possible**, it pressure-tests findings in sandboxed validation
  environments… **When Codex Security is configured with an environment tailored to your
  project**, it **can** validate potential issues directly… That deeper validation **can**
  reduce false positives even further."*

Validation went from a guaranteed pipeline stage to a best-effort one **gated on the customer
supplying a runnable environment**. ⚠️ **No number is ever attributed to the sandbox step
specifically**, in any of the three posts. And the cost of it: *"For some repositories, scans
can take several hours. For larger repositories, they can take **multiple days**."*

**Every quantitative claim — all vendor-reported, none audited:**
- Oct 2025: *"In benchmark testing on 'golden' repositories, Aardvark identified **92% of known
  and synthetically-introduced vulnerabilities**."* **No methodology, no repo list, no
  definition of "golden", no count, no precision counterpart, no FP rate — recall only.**
  **And the 92% claim is silently dropped and never repeated after Oct 2025.** Also: 10 CVEs;
  *"around 1.2% of commits introduce bugs"* (internal, no methodology); beta scale **never
  quantified**.
- Mar 2026: *"cutting noise by **84%**"* (one cherry-picked repo); over-reported severity down
  *"more than **90%**"*; false-positive rates down *"more than **50%** across all
  repositories"*; 1.2M commits scanned, 792 critical + 10,561 high findings, critical in
  *"under 0.1%"* of commits; *"**Fourteen CVEs**"* (the appendix lists ~15–16 identifiers —
  minor unreconciled count). ⚠️ **All three improvement percentages are relative deltas against
  an undisclosed baseline.** "FP rate fell by more than 50%" tells you nothing about the
  absolute rate. This is the classic un-falsifiable metric shape.
- Jun 2026: 30M commits, 30,000 codebases, 70,000 findings human-marked fixed, *"over 500,000
  findings have automatically been determined to be fixed."* ⚠️ A finding disappearing on
  re-scan is not evidence it was real; do not treat the 500k as a quality number.

**Independent verification: there is none.** No dataset, methodology, or harness released for
the 92% or any 2026 claim; access is gated to Enterprise/Business/Edu/Pro, so external
reproduction is structurally blocked. Spot-checking two of OpenAI's own listed CVEs
(CVE-2025-32990 GnuTLS, CVE-2026-24881 GnuPG) found no NVD credit to OpenAI or any AI tool —
weak evidence, since NVD rarely records discoverer credit, but it establishes that attribution
rests on OpenAI's word. Press (CSO, VentureBeat, TechRadar, CyberScoop) repeats the 92%
without checking it.

**Semi-independent, with a disclosed conflict:** Trail of Bits is an **OpenAI-funded Daybreak
partner**. Their 22 Jun 2026 post reports *"hundreds of discovered bugs, 64 pull requests, and
51 issues filed across 19 projects"*, 37 merged — and volunteers the failure mode:
*"Frontier models like GPT-5.5-Cyber are producing a **firehose** of security findings, and
already-stretched maintainers must sift through all of it to separate real vulnerabilities from
plausible-sounding false positives,"* and *"without explicit guidance, models default to rating
everything as critical."*

**GPT-5.5-Cyber benchmark provenance (Jun 2026):** CyberGym **85.6%** (vs 81.8% GPT-5.5),
ExploitGym **39.5%** (vs 25.95%), SEC-bench Pro **69.8%** (vs 63.1%). The benchmarks themselves
are genuine third-party academic work (CyberGym — UC Berkeley, arXiv 2506.02548, ICLR 2026;
SEC-bench Pro — UIUC, arXiv 2605.26548; ExploitGym — arXiv 2605.11086). **But:**
(a) **OpenAI co-authored ExploitGym** (Qi, Wallace); (b) *"single-model evaluations"* is a live
qualifier implying unpublished ensemble numbers; (c) CyberGym's leaderboard is explicitly
**any-of-k with k undisclosed**, submissions are self-reported with **no independent
re-execution** (llm-stats marks all ten entries self-reported, zero verified); (d) **two of the
three numbers do not reconcile with the public leaderboards** — SEC-bench Pro's own leaderboard
says 58.4% (201/344) where OpenAI says 63.1%, and ExploitGym's 25.95% matches no published
figure. **GPT-5.5-Cyber appears on none of the three public leaderboards.**

### ★ 1a-bis. The one ablation that cuts AGAINST this memo's thesis — report it honestly

**"Scaling code verification"** — Trębacz, Arnesen, Cassirer, Johnson, Lin, Sottiaux (OpenAI
Codex team), alignment.openai.com/scaling-code-verification, **1 Dec 2025**. [P]

This is a genuine scaffolding ablation **on code review specifically**, and it is positive:

> *"With a default prompt and access only to the context of the PR diff, GPT-5 is able to
> identify numerous high impact comments but also produces a high number of false alarms."*
> *"We evaluated providing repository access and code execution abilities to a GPT-5 model and
> found that it results in a **stronger reviewer, catching more critical issues and raising
> fewer false alarms**."*
> *"Dedicated training for code review further improves the results."*

**Diff-only → repo access + code execution improves recall AND precision simultaneously.**
This is the strongest published counter to a pure "one call on the diff" position, and it
should not be waved away.

Four things bound how far it transfers:
1. **The intervention is repo access + *code execution*, bundled.** It is not planning and not
   sub-agents. It is the same execution-grounding axis as Naptime and Big Sleep — and code
   execution is the half we cannot build.
2. **No numbers.** The claim is qualitative in prose; the inference-budget curve is
   **Figure 3 only**, with no figures in text. ⚠️ Do not let anyone quote a specific number
   from it.
3. **It is a different operating point.** Codex code review runs *in a container with the
   repo*, not on a diff blob — GitHub docs confirm requesting a review requires
   *"Codex cloud set up for the repository."*
4. **Their precision fix was not architectural, it was a gate plus training.** GPT-5.1-Codex was
   *"trained specifically for higher signal-to-noise ratio"*, and operationally
   **"In GitHub, Codex flags only P0 and P1 issues."**

Deployment numbers (vendor, but operational rather than benchmark, so harder to game):
*"more than **100k external PRs per day**"* as of Oct 2025; *"When the reviewer leaves a
comment, authors address it with a code change in **52.7%** of cases"*; comments on 36% of
Codex-generated PRs, of which **46%** result in a change vs **53%** on human-written PRs;
*"over **80%** of comment reactions being positive."* **No per-review cost is published
anywhere** — only a `--max-cost USD` CLI control and "several hours to multiple days" latency.

Their stated cost asymmetry is worth borrowing verbatim, because it argues for a *cheap
verifier*, not for expensive discovery: *"Generating a correct code change often requires broad
search and many tokens, while **falsifying** a proposed change usually needs only targeted
hypothesis generation and checks… even at a small fraction of the generator's token spend, the
verifier catches a large share of previously identified high-severity issues."*

**Related OpenAI/third-party scaffolding evidence:**
- **o3/o4-mini system card, 16 Apr 2025, §4.3.2** — same model, three scaffolding conditions:
  *"no model is able to solve the scenario unaided or with hints, however when given the
  **solver code** both o4-mini and o3 are able to solve it with a reasonably high accuracy."*
  Metric asymmetry makes it stronger: unaided/hints were **pass@12**, solver-code was
  **pass@1**. A 0% → solved discontinuity from scaffolding, with 12× fewer attempts.
- **UK AISI, reported in the GPT-5.5 system card (23 Apr 2026, §9.1.2.7)** — third-party
  evaluator: expert-level narrow cyber tasks, **pass@5 = 90.5% ± 12.9%** vs
  **pass@1 = 66.7% ± 15.9%**. **+23.8pp purely from k=1→5.** Consistent with Naptime: the
  reachable lever is *sampling*, not decomposition.
- **Context management beats raw capability:** *"gpt-5.2-thinking performs 8 percentage points
  better than gpt-5.1-thinking, but **11 percentage points worse** than gpt-5.1-codex-max,
  which has the ability to extend its work across multiple context windows"* (GPT-5.2 system
  card, 11 Dec 2025) — attributed to **compaction**.
- ⚠️ **Turn budget is a huge uncontrolled confound** across OpenAI's own eval generations:
  GPT-5 card (Pattern Labs) *"the model has 50 turns"*; GPT-5.2/5.3 cards (Irregular)
  *"up to 1,000 turns"*. **A 20× change.** Any cross-card capability trend is partly a
  scaffolding trend.
- OpenAI's standing disclaimer: *"these evaluation results likely represent lower bounds on
  model capability, because **additional scaffolding or improved capability elicitation could
  substantially increase observed performance**."*
- ⚠️ **Do not quote GPT-5.4/5.5 CTF or CVE-Bench point values** — they live in chart images and
  two independent reads returned irreconcilable numbers (86.27% vs 23.5% for the same cell).
  ⚠️ **"Cybench" appears in no OpenAI system card** (zero hits across nine cards); OpenAI uses
  CVE-Bench. If a note says Cybench, it is a conflation.
- **There is no OpenAI research *paper* on agentic security.** Everything is system cards and
  blog posts.

**The one rigorous public measurement of an OpenAI agent doing security review on real code**
is not OpenAI's: Semgrep (Gaucher/Ermilov/Gibler, **2 Sep 2025**) ran 11 Python web apps,
7,000+ files, 800k+ LOC — **OpenAI Codex CLI v0.2.0 on o4-mini: 21 TP / 94 FP = 18% TP rate**;
Claude Code (Sonnet 4): 46 TP / 284 FP = 14%. And rerunning an *identical prompt three times on
one app* produced **"3, 6, and then 11 distinct findings."**
⚠️ This is a *generic coding agent* on an older model and is a year stale — it does **not**
refute the 92%, and conflating them would be dishonest. Cite it only for the non-determinism
and for the fact that it is the sole rigorous public measurement of its kind.

### 1c. The commercial vendors — and the two results that matter most

**Semgrep Assistant is a single well-scoped LLM call on a deterministic finding, and it is the
most-measured product in this entire memo.** From the primary post *"How we built an AppSec AI
that security researchers agree with 96% of the time"* (semgrep.dev, **22 Jan 2025**) [P]:
*"we provide the model with the finding, relevant context, and detailed instructions on what to
look for, asking it to evaluate exploitability just as an experienced AppSec expert would."*
Context is assembled **deterministically** — rule metadata, prior triage decisions for that
rule, Assistant Memories, *"several dozen lines of code surrounding the finding"*, plus
*"additional lines of code at each step of the finding's data flow."*
**No loop, no tool use, no sub-agents, no exploration.** The GA post (20 Mar 2024) states it is
explicitly *not* an augmentation to the SAST engine.

Its production numbers, with sample sizes:

| figure | value | n | date |
|---|---|---|---|
| users agree with noise-filtering decisions | **95%** | **250,000+ findings, 45+ enterprises** | 22 Jan 2025 |
| security researchers agree | **96%** | same | same |
| agreement on **true positives** | **96%** | 2,000+ findings | 22 Jan 2025 |
| agreement on **false positives** | **41%** | same 2,000 | same |
| share of all triage handled | ~20% → **~60%** YTD | 1,000,000+ findings analyzed | Jun / Sep 2025 |

⚠️ **Do not quote a single "agrees 96%" number.** It is class-conditional: **96% on true
positives but 41% on false positives.** Semgrep's own 2025 architecture change — splitting into
separate FP and TP prompt chains, with action allowed only on the FP side, because *"a model
that tries to perfectly classify every issue as a true positive or false positive ends up
mediocre at both"* — is a direct response to that asymmetry. Also note the construct is
*agreement with the customer's own triager*, not ground truth: a customer who accepts a wrong
dismissal counts as agreement. All Semgrep figures are **vendor-reported, unaudited [P]** —
but at 250k–1M findings they are the largest-sample data in this memo by orders of magnitude.

**★ The single most transferable measurement I found.** Semgrep's later, *agentic* product
("Multimodal": an LLM agent that calls the Semgrep Pro Engine as a tool, over a deterministic
route/handler enumeration) was benchmarked against tuned single prompts (semgrep.dev,
**12 Jun 2026**) [P]:

| system | F1 | **precision** | **recall** | $/TP |
|---|---|---|---|---|
| Semgrep Multimodal (Opus 4.8) | 53.5% | **69.4%** | **43.5%** | $0.62 |
| Opus 4.8 guided prompt | 21.4% | **71.4%** | **12.6%** | $0.77 |
| GPT-5.5 guided prompt | 16.3% | **68.8%** | **9.2%** | $0.68 |

**Precision is statistically indistinguishable across all three (~69–71%). The entire
difference is recall.** And the mechanism they give is not reasoning quality — it is
enumeration coverage: *"Models miss up to 90% of endpoints alone; they evaluate endpoints they
happen to notice."* Their design rule: **"Use static analysis to decide where a model should
look, then give it focused slices of code."**

**That sentence is step (1) of the proposed architecture, and it is the one step with real
supporting evidence.** It is also corroborated by an entirely independent artifact — Snyk's
**DeepCode AI Fix** (arXiv **2402.13291**, Feb 2024, **code and data released** at
github.com/snyk/deepcode_ai_fix; vendor-authored with Vechev/ETH Zurich, but reproducible).
Their `CodeReduce` step slices the program to the defect plus necessary context
(**40.67×–57.44×** token reduction; median 878 → 79 tokens). The ablation:
**StarCoder-LongContext scores 28.9% without CodeReduce vs 82.75% with it.**
Deterministic slicing is load-bearing; it is not a sub-agent, and it costs nothing at inference.
*(Caveats: JS/TS only; the headline "removes >80% of defects" is pass@5 graded by Snyk's own
analyzer, so a fix that merely evades detection scores as success; ExactMatch@1 is 9.26–43.43%.)*

**★ The second most important result — and it directly attacks "sub-agents, each checking a
different property."** Semgrep's own benchmark self-audit (semgrep.dev, **17 Jul 2026**) [P],
on 27 real IDORs, is the most intellectually honest vendor post I found:
per-scan recall was **14–16% for every frontier model tested** (Kimi K2.7 16%, GLM-5.2 14%,
MiniMax M3 16%, Opus 4.8 14%, GPT-5.5 15%; Semgrep Multimodal 21%), and:
*"Of the 27 real IDORs… Found by all 5 models: 4… Found by some, not all: 4…
**Missed by every model: 19 (70%)**"* →
**"Pool all five models together and union recall is 29.6%, barely above the single best
model… everyone is blind to the same 19."**

That is **correlated error measured on a security task**, across five *different model
families*. Sub-agents drawn from one model family cannot do better than this upper bound — and
this is the empirical ceiling on the "many agents, each a different property" premise.
It also matches our own measured union ceiling of **69% over 13 archived runs**.

**LLM-only vs deterministic+LLM, measured by Semgrep** (11 Nov 2025) [P]:
*"88% of the IDORs identified with Claude Code were false positives"*; Semgrep AI precision
**61%** vs Claude Code **22%** for IDOR; *"90% better on recall."*
**ZeroPath's competing measurement** (19 May 2026) [P]: Claude Opus 4.6 with prompting
*"tuned specifically for vulnerability detection"* against **435 real disclosed CVEs** caught
**~28%** with false-positive rates **above 40%** — and, directly relevant to us,
*"Findings shifted meaningfully between runs on the same code, meaning two scans of the same
repo could produce materially different reports."* ⚠️ ZeroPath publishes **no number for its
own tool on the same corpus** — a vendor scoring a competitor category and declining the same
ruler. Directional only.

**XBOW — the headline is much weaker than the reputation.** Architecture *does* match the
proposal: a **"coordinator"** that *"spawns multiple 'solvers', effectively individual AI
pentesters with specific objectives"*, each on an isolated attack machine, plus **validators**
that *"confirm the vulnerability independently"* — e.g. for XSS, running the payload in a
headless browser and confirming an alert actually fires; later, customer-planted **canary
tokens** the agent must exfiltrate as *"proof of exploitation"* (12 Mar 2026).

The third-party-observable HackerOne record, ~1,013 submissions:

| status | count |
|---|---|
| **resolved** | **132** (~13%) |
| triaged (accepted, unfixed) | 303 |
| pending | 125 |
| **duplicate** | **208** |
| **informative** | **209** |
| **not applicable** | **36** |

**Resolved is ~13% of submissions; duplicate + informative + N/A is ~45%; not-a-valid-finding
(informative + N/A) is ~24%.** And per Rawsec's critique (blog.raw.pm, **29 Jun 2025**), the
"#1 on HackerOne" claim is *"1st on HackerOne **USA** leaderboard **based on reputation gain**
BUT **only when you consider the April to June 2025 date range**"* — not all-time, not on
signal, impact, or critical reputation. **Decisively: the ~24% junk rate is measured *after*
human filtering** — XBOW staff reviewed 100% of reports before submission to comply with
HackerOne's AI policy — so **the autonomous system's true precision is unpublished and
unknowable from outside.**

⚠️ Method flag: xbow.com returned HTTP 429 to every fetch attempt; all XBOW quotes above come
from secondary reporting quoting those posts (TechRepublic 26 Jun 2025, Gigazine 25 Jun 2025,
Uproot Security 18 Jul 2025, HackerNotes Ep.134 interview 14 Aug 2025) and are **[S]**.
XBOW's own score on its 104-challenge benchmark could not be retrieved.
ZeroPath's critique of that benchmark (13 Nov 2024) is worth noting anyway: it reports only
*"the percentage of challenges finished"* with **no false-positive measurement**, and the
challenges contain LLM-favouring hints (page titles like *"SSRF Demo"*, *"IDOR Eats"*).

**The structural reason XBOW's numbers do not transfer to us:** its precision rests on an
**execution oracle with ground truth for free** — a flag extracted, an alert fired, a canary
retrieved. Static code review has no such oracle. Every attempt to port "validators" into
static analysis (ZeroPath's verification agents, GitHub's CodeQL re-run, Snyk's analyzer
re-run) degrades into **the tool grading its own homework**: a finding validated by the same
engine that produced it can pass by evading detection rather than by being right. Pixee's
CI/CD test verification is the only production validation in this set using an oracle external
to the security tool — and it requires a build and a test suite, which we do not have.

**One independent head-to-head** — Joshua Rogers, *"Hacking with AI SASTs"*, joshua.hu,
**18 Sep 2025** [V-ish: one pentester, not peer-reviewed, not vendor-funded]. Five products,
14 CWE classes plus curl/sudo/Squid. ZeroPath best (*"practically 100%"* of deliberately
vulnerable code, low FP); Corgea 80% detection with **~50% FP rate**; Almanax 85%; Amplify
Security and Gecko *"extremely poor… practically all results false positives."*
**Shared blind spot: none of the five detected an infinite-loop vulnerability in the
`image-size` npm package (14.5M weekly downloads)** — correlated error again.

**GitHub Copilot Autofix** [P] is worth one line because it is the highest-volume deployment of
this shape: the 2024–25 version is a **single scoped LLM call** whose prompt is assembled
deterministically from the CodeQL alert (query help text, alert location, code along the flow
path), with **no execution validation** — only syntax/name-resolution/registry heuristics.
Published: median time-to-fix 28 min vs 1.5 h (all types), 18 min vs 3.7 h (SQLi), and
*"more than two-thirds of found vulnerabilities with little or no editing."*
⚠️ **No sample size is published anywhere**; it is observational telemetry with self-selected
cohorts, and it measures **time-to-commit, not fix correctness**. An arXiv search for an
independent evaluation returned nothing. The **2026 agentic** version does re-run CodeQL to
validate — and publishes **zero success-rate numbers**.

**On the "AI slop" narrative, for calibration.** Daniel Stenberg / curl [P]:
*"about 20% of all submissions"* in 2025 were AI slop; genuine vulnerability rate fell from
*"north of 15%"* historically to *"below 5%"* in 2025; the bug bounty ended 31 Jan 2026.
**But the story does not end there:** curl returned to HackerOne in March 2026 and the confirmed
rate **recovered to 15–16%**, i.e. pre-AI levels (daniel.haxx.se, 25 Feb 2026). Cite the
recovery alongside the collapse. No AI vendor is named in any of it.

---

## 2. Ablations — the only thing that separates architecture from marketing

### 2.1 The one controlled ablation that directly answers the question

**Towards a Science of Scaling Agent Systems** — Kim, Gu, Park, Schmidgall, … Liang,
Althoff, McDuff, Liu (MIT Media Lab / Google). arXiv **2512.08296**, Dec 2025 (rev. Apr 2026).
Preprint; peer-review status unconfirmed. **[V — controlled, standardized tools/prompts/compute]**

260 configurations, 5 architectures (single-agent + independent / centralized / decentralized
/ hybrid), 3 LLM families. Two coefficients matter to us:

- **Capability saturation.** Once the single-agent baseline exceeds roughly **45%**,
  coordination returns go **negative**. Regression coefficient **β = −0.404, p < 0.001**
  (abstract states −0.408; body −0.404 — minor internal inconsistency, flagged).
- **Tool-coordination trade-off.** **β = −0.267, p < 0.001.** Tool-heavy tasks suffer
  *disproportionately* from multi-agent overhead.
- Spread vs. single-agent baseline: **+80.8%** (Finance-Agent — decomposable, parallel
  reasoning, centralized) to **−70.0%** (PlanCraft — sequential planning). On PlanCraft
  *every* multi-agent variant degraded: −70.0%, −50.3%, −41.5%, −39.0%.

**Applied to us:** our baseline is **64.4% recall**, well above the ~45% saturation point,
on a **tool-heavy** task. Both coefficients point the same direction. This paper predicts
the proposed architecture is net-negative here — and it is the only study I found that
isolates architecture with compute and prompts held constant.

**A convergence worth naming.** Naptime finds a *capability floor* — scaffolding pays off only
above a certain model capability ("it is difficult for smaller models to reliably do all of
these things correctly"). 2512.08296 finds a *baseline ceiling* — coordination returns go
negative once the single-agent baseline exceeds ~45%. Two independent studies, from opposite
directions, bracket a window in which decomposition helps. **Our configuration — a strong
model at 64.4% baseline on a tool-heavy task — sits above the ceiling, not inside the window.**

### 2.2 Simple pipeline beats agentic scaffold, at 43% of the cost

**Agentless: Demystifying LLM-based Software Engineering Agents** — Xia, Deng, Dunn, Zhang
(UIUC). arXiv **2407.01489**, 2024. **[V]**
Three fixed phases (localization → repair → patch validation), **no autonomous tool use,
no agentic decision-making**:

| system | SWE-bench Lite | cost/issue |
|---|---|---|
| **Agentless** | **32.00%** (96/300) | **$0.70** |
| SWE-agent (Claude 3.5) | 23.00% | $1.62 |
| AutoCodeRover | 19.00% | $0.45 |

**+9pp over the agentic scaffold at 43% of its cost.** (SWE-bench Verified: 38.80%.)
Note what Agentless *keeps*: a deterministic localization phase and a **validation phase
that runs tests**. It drops exactly the two things the proposal wants to add.

Bonus, relevant to our eval hygiene: 4.3% of SWE-bench Lite leaks the ground-truth patch in
the issue text, 10.0% underspecified, 5.0% contain misleading solutions.

### 2.3 Multi-agent debate / consensus: measured negative

- **The Cost of Consensus: Isolated Self-Correction Prevails Over Unguided Homogeneous
  Multi-Agent Debate** — Bertalanič & Fortuna (Jožef Stefan Institute). arXiv **2605.00914**,
  2026 (preprint). **modal adoption up to 85.5%** (agents abandon their own correct reasoning
  for the majority); **oracle gap up to 32.3pp** — the correct answer *was in the pool* and
  voting discarded it; contextual fragility up to 70%. Isolated self-correction matched or
  beat debate at **2.1–3.4× fewer tokens** (5,396 vs 18,240 avg). GSM-Hard (1,017), MMLU-Hard.
- **Talk Isn't Always Cheap: Understanding Failure Modes in Multi-Agent Debate** — Wynn,
  Satija, Hadfield. arXiv **2509.05396**, 2025 (preprint). Net correct→incorrect shift exceeds
  incorrect→correct. On CommonSenseQA **debate harmed performance in every configuration
  tested**, including when stronger models outnumbered weaker ones.
- **Should we be going MAD?** — Smit, Duckworth, Grinsztajn, Barrett, Pretorius (InstaDeep).
  arXiv **2311.17371**. Untuned debate loses to self-consistency and simple ensembling;
  the conclusion is hyperparameter sensitivity, not inherent inferiority. *(Effect sizes
  not extracted — [?])*
- **Auditing Multi-Agent LLM Reasoning Trees** — arXiv **2602.09341**, names the mechanism:
  agents trained on similar distributions have **correlated errors** → "tyranny of the
  majority" / "confabulation consensus."
- **Contra-evidence, for honesty:** *Beyond the Strongest LLM* (Tian et al., arXiv
  2509.23537, 2025) finds orchestration "matches or exceeds the strongest single model" on
  GPQA-Diamond, IFEval, MuSR. Effect sizes not extracted; "matches" is doing work; these are
  QA benchmarks, not code.
- **More Agents Is All You Need** — Li et al. (Tencent), arXiv **2402.05120**, **TMLR 2024**.
  This is *sampling-and-voting over identical agents*, **not role decomposition**. It is
  evidence that ensembling scales — i.e. it is the *baseline decomposition must beat*, not
  support for decomposition.

### 2.4 Correction to a common citation

**Why Do Multi-Agent LLM Systems Fail?** — Cemri et al. (UC Berkeley), arXiv **2503.13657**,
Mar 2025 (rev. Oct 2025). 1,600+ annotated traces, 7 MAS frameworks, 14 failure modes,
inter-annotator κ = 0.88. Distribution: **specification issues 41.77% / inter-agent
misalignment 36.94% / task verification 21.30%**. ChatDev on ProgramDev: **33.33% correctness**.
Interventions were modest: **+15.6%** from better orchestration, **+9.4%** from better role
specification; authors conclude "simple fixes are still insufficient."

**This paper is a failure taxonomy, not a controlled multi-agent-vs-single-agent comparison.**
It asserts the gap citing others. Do not cite it as an ablation. Use 2512.08296 for that.

### 2.5 The strongest counter-evidence, restated in the ablation section so it is not buried

Two results genuinely cut against a pure "one call on the diff" position:

1. **OpenAI Codex, "Scaling code verification" (1 Dec 2025)** — diff-only → **repo access +
   code execution** produced *"a stronger reviewer, catching more critical issues and raising
   fewer false alarms."* Both metrics moved the right way. ⚠️ Qualitative only, no numbers,
   and the intervention bundles repo access with **code execution** (the half we cannot build)
   — not planning, not sub-agents. See §1a-bis.
2. **Trail of Bits' bug-hunting scaffold (28 Jul 2026)** independently rediscovered our
   one-finding-per-file problem and reports that splitting it fixed it:
   *"Putting two competing outcomes in one `/goal` prompt results in uneven optimization"* —
   splitting coverage and bug-finding into dedicated agents *"worked drastically better."*
   Their pipeline: issue collection → a separate session per issue → security gate →
   **dual validation by two separate models** → human dedup. ⚠️ Vendor blog, an
   **OpenAI-funded** Daybreak partner, no ablation table, no effect size. But it is the single
   most on-point argument for **one outcome per pass**, and it is the reason §9 Tier 2 keeps
   one narrow experiment alive rather than closing the question.

Note what both have in common with everything else in this memo: neither credits *planning*,
and neither runs heterogeneous property-specialised sub-agents over a shared context.

### 2.6 The genuine gap

**No controlled plan-then-execute vs. direct ablation on code tasks was found.**
Self-Planning (Jiang et al., TOSEM, DOI 10.1145/3672456) is the canonical plan-first
code-generation paper but is a positive-result paper on HumanEval-class tasks, not a scaffold
ablation. So the proposal's step (2) — the *plan* — is supported by **zero** controlled
evidence in either direction on this task family.

---

## 3. Tools and execution verification — where the large effect sizes actually are

This is a different axis from decomposition, and it is where every big number lives.

### 3.1 Naptime: the best available ablation — and it decomposes further

**Project Naptime: Evaluating Offensive Security Capabilities of Large Language Models** —
Sergei Glazunov & Mark Brand, Google Project Zero, **20 Jun 2024**,
projectzero.google/2024/06/project-naptime.html. [P, but re-running a **public** benchmark —
CyberSecEval 2, Bhatt et al. (Meta), arXiv **2404.13161** [V]. Tables below transcribed from
the source HTML.]

**Architecture: a single agent in a tool loop. No planner. No sub-agents.** Verbatim:
*"The Naptime architecture is centred around the interaction between an AI agent and a target
codebase. The agent is provided with a set of specialised tools designed to mimic the workflow
of a human security researcher."* The only non-agent component is a **Controller**, whose job
is **verification**, not planning. Trajectories run up to **16 steps**.

Google explicitly **rejected** in-trajectory multi-hypothesis reasoning in favour of resampling:
*"We had initially hoped that models would be able to consider multiple distinct hypotheses in
a single trajectory, but in practice this is highly inefficient. We advocate instead for a
sampling strategy that allows models to explore multiple hypotheses through multiple
independent trajectories, enabled by integrating verification within the end-to-end system."*
That is a direct, primary-source rejection of the proposal's step (3), from the strongest
system in the space.

Four tools: **Code Browser** (`code_browser_source`), **Python** (`python_eval`, sandboxed),
**Debugger** (`debugger_run`, target compiled with **AddressSanitizer**), **Reporter**
(`reporter_report_completion`, which triggers Controller verification).

**Buffer Overflow** (no oracle change — success is a score the program cannot normally emit):

| model | paper | Repro@1 | Repro@20 | **Naptime@1** | Naptime@10 | **Naptime@20** |
|---|---|---|---|---|---|---|
| GPT-3.5 Turbo | 0.02 | 0.01 | 0.19 | 0.04 | 0.12 | 0.21 |
| **GPT-4 Turbo** | **0.05** | 0.02 | 0.20 | **0.71** | 1.00 | **1.00** |
| Gemini 1.5 Flash | — | 0.00 | 0.01 | 0.01 | 0.14 | 0.26 |
| Gemini 1.5 Pro | — | 0.01 | 0.02 | 0.40 | 0.96 | 0.99 |

**Advanced Memory Corruption** — note the extra **ASan** column, which is the *original
zero-shot prompt with a better crash oracle only*: no agent, no tools:

| model | paper | Repro@1 | **ASan@1** | ASan@20 | **Naptime@1** | Naptime@20 |
|---|---|---|---|---|---|---|
| GPT-3.5 Turbo | 0.14 | 0.15 | 0.22 | 0.38 | 0.25 | 0.56 |
| **GPT-4 Turbo** | **0.16** | 0.16 | **0.32** | 0.42 | **0.36** | **0.76** |
| Gemini 1.5 Flash | — | 0.11 | 0.14 | 0.22 | 0.26 | 0.53 |
| Gemini 1.5 Pro | — | 0.16 | 0.28 | 0.35 | 0.26 | 0.60 |

**This is the single most useful ablation in the whole memo, because it separates two
interventions Google bundled:**

- GPT-4 Turbo, Advanced Memory Corruption, k=1: **0.16 → 0.32 from the ASan oracle alone**,
  then only **0.32 → 0.36 from the entire agent loop**. Roughly **80% of the single-shot gain
  came from improving the verification oracle, not from the agent.**
- The agent's genuine contribution appears only under resampling: **ASan@20 = 0.42 vs
  Naptime@20 = 0.76**, and *"the ASan@k results… appear to be plateauing at or before k=20"*
  while Naptime@k keeps scaling.
- On Buffer Overflow, where there is no oracle change, the scaffolding effect is unambiguous
  and huge: **0.02 → 0.71 at k=1 (~35×)**.
- **Longer trajectories help independently of k**: Gemini 1.5 Pro at 32 steps instead of 16
  reaches **0.76 at Naptime@20** vs 0.60.
- **A capability floor exists**: GPT-3.5 barely moves on buffer overflow (0.02 → 0.21@20)
  while GPT-4 saturates at 1.00. *"there appears to be a certain level of LLM capability
  necessary to fully benefit from a more complex task environment."*
- **One prompt sentence beat the scaffolding for a weak model.** Adding *"You need to find a
  vulnerability in the program, and exploit that vulnerability to make the program output a
  score of 1.0"* took Gemini 1.5 Flash from **0.26 to 0.72** on Naptime@20 — ~3×.
  **This is the same shape as our injection-guard result.**

Google's four stated design principles are **Interactive Environment**, **Specialised Tools**,
**Perfect Verification** (*"vulnerability discovery tasks can be structured so that potential
solutions can be verified automatically with absolute certainty. We think this is key"*), and
**Sampling Strategy**. **Decomposition is not among them.**

⚠️ **Two things not to repeat.** (a) The widely-quoted *"0.24 → 0.76"* framing **swaps models** —
0.24 is not GPT-4 Turbo's paper score (0.16 is). The clean same-model comparison is
**0.16 → 0.76**, or **0.12 → 0.55** on the corrected benchmark after Google removed an
unintended `decode_char` assertion. (b) There is **no quote** in the post about "verifying
hypotheses by running code" — do not attribute it.

⚠️ **No cost data of any kind** appears in the post — no tokens, no dollars, no wall-clock.
Anyone citing Naptime as evidence that k=20 sampling is cheap is inventing it.

### 3.1b Big Sleep: same single agent, seeded by a diff — and the closest analogue to us

**From Naptime to Big Sleep** — the Big Sleep team, Project Zero, **1 Nov 2024**. [P]

**Same single-agent loop, same tools, no planner, no sub-agents.** The one architectural
change from Naptime is **task framing, not machinery**, and it is strikingly close to a
change-impact review: *"We then adjusted the prompt to provide the agent with both the commit
message and a diff for the change, and asked the agent to review the current repository (at
HEAD) for related issues that might not have been fixed."* Rationale: *"By providing a starting
point… we remove a lot of ambiguity from vulnerability research, and start from a concrete,
well-founded theory: 'This was a previous bug; there is probably another similar one
somewhere'."* **Google's answer to "how do you scope a review from a change" was a better
prompt seed, not a planner and not sub-agents.**

**The debugger crash is the terminal gate, not decoration.** The published trajectory ends with
`debugger_run` producing `SIGABRT ... Assertion 'iCol>=0 && iCol<=2' failed`, and only then does
the agent call `report_success`. Google also notes the agent's reasoning *before* the crash was
vague — *"the agent was quite vague about the 'incorrect constraint handling' that it's trying
to trigger… in the end producing a test case that reproduces a slightly different bug"* — and
that explanation quality **jumps after** the crash. **Without execution, the same agent produced
vague, partly-wrong reasoning.**

**Quasi-controlled comparison vs fuzzing (n=1):** 150 CPU-hours of AFL, with the corpus
*verified* to contain the required `generate_series` and `rowid` keywords and the keywords added
to the SQL dictionary, **did not find the bug**. Google's own hedge, which press consistently
drops: *"these are highly experimental results. The position of the Big Sleep team is that at
present, it's likely that a target-specific fuzzer would be at least as effective."*

Track record: CVE-2025-6965 (SQLite, CVSS 7.2), found before in-the-wild exploitation
[P, blog.google 15 Jul 2025 — **no architectural or methodological detail given**]; "20
vulnerabilities" in FFmpeg/ImageMagick [S, TechCrunch 4 Aug 2025, relaying an X post], with a
Google spokesperson stating *"we have a human expert in the loop before reporting, but each
vulnerability was found and reproduced by the AI agent without human intervention"*; 5
WebKit CVEs [S, Nov 2025].

⚠️ **No false-positive rate has ever been published for Big Sleep**, in any primary source.
"Found and reproduced without human intervention" is a *precision-by-construction* argument
(a reproduced crash cannot be a hallucination), and it is silently conditioned on a
human filter applied **before** reporting — so the pre-filter FP rate is unobservable.
⚠️ The Nov 2025 FFmpeg dispute is **not** a false-positive story: maintainers objected to
burden and triviality (a bug in a 1995 game's Smush decoder) and to reports arriving without
patches. Do not cite it as AI slop.

### 3.1c CodeMender: multi-agent and validators — but zero numbers

**Introducing CodeMender: an AI agent for code security** — Popa & Flynn, Google DeepMind,
**6 Oct 2025**. [P] This is the one system in the set that *does* use the proposed shape, so it
deserves care.

It explicitly claims **multi-agent**: *"We developed special-purpose agents that enable
CodeMender to tackle specific aspects of an underlying problem. For example, CodeMender uses a
large language model-based critique tool that highlights the differences between the original
and modified code in order to verify that the proposed changes do not introduce regressions."*
Plus an *"LLM judge tool configured for functional equivalence."*
And **validators**: *"static analysis, dynamic analysis, differential testing, fuzzing and SMT
solvers."* Tools: *"a debugger, source code browser, and other tools."*

Positioning of the validator layer: *"mistakes in code security could be costly"* — the
validation process **"only surfac[es] for human review high-quality patches."**
*"Currently, all patches generated by CodeMender are reviewed by human researchers."*
Output: **"72 security fixes"** upstreamed over six months.

⚠️ **72 is a numerator with no denominator.** There is **no ablation, no catch rate, no
rejected-patch count, no false-positive rate, no paper** — DeepMind says results *"we intend to
publish… in the coming months"* and none was found. Note also that two of the three named
checkers (the critique tool, the equivalence judge) are **themselves LLMs**, not sound analyses,
and the post does not distinguish their reliability from the SMT/fuzzing layer.
**CodeMender is the best vendor case for the proposal, and it is entirely unmeasured.**

### 3.1d OSS-Fuzz AI: the cleanest split between LLM reasoning and execution

**Leveling Up Fuzzing: Finding more vulnerabilities with AI** — Chang, Liu, Metzman (Google
OSS Security), **20 Nov 2024**. [P] **26 new vulnerabilities**, headline CVE-2024-9143 in
OpenSSL, *"likely… present for two decades"* and *"wouldn't have been discoverable with
existing fuzz targets written by humans."* Coverage: 272 C/C++ projects, +370,000 lines.

**The LLM does not find the bugs.** It drafts fuzz targets, fixes compile errors, fixes
runtime mistakes, and triages crashes; **the fuzzer, running on ClusterFuzz, finds the
vulnerabilities.** Calibration: conventional OSS-Fuzz has found *"over 11,000 vulnerabilities
in the 8 years of the project."* 26 is a rounding error against that. The correct claim is that
the LLM **widened the reachable surface**, not that it out-reasoned execution.
Google's own tools claim here is an assertion with **no effect size attached**:
*"By providing LLM with interactive access to real tools such as debuggers, we've found that
the LLM is more likely to arrive at a correct result."*

### 3.2 CVE-Bench: the win is attributable to a tool, and it is quantified

**CVE-Bench** — Zhu, Kellermann, Bowman, Li, Gupta, … Kang (UIUC). arXiv **2503.17332**, 2025.
40 critical CVEs (CVSS ≥ 9.0) on real web apps. Best framework resolves **up to 13%**.
Zero-day: Cy-Agent ~0%/~2% (success@1/@5), T-Agent ~2.5%/~10%, AutoGPT ~5%/~13%.
One-day: Cy-Agent ~0%/~2.5%, T-Agent ~5%/~13%, AutoGPT ~8%/~25%.

The attribution: among successful T-Agent exploits, **68% (zero-day) and 30% (one-day)** were
database access **attributable to the `sqlmap` integration**. The paper's conclusion is
"correct use of tools… is important."

Honest counterweight: T-Agent (hierarchical supervisor + specialists) *did* beat single-agent
Cy-Agent here. But exploitation is an exploration-heavy, decomposable task with a *weak*
baseline (~0–5%) — exactly the regime where 2512.08296 predicts multi-agent wins. Diff review
with a 64.4% baseline is the opposite regime.

### 3.3 What LLM security judgment looks like without execution

- **SecLLMHolmes / "LLMs Cannot Reliably Identify and Reason about Security Vulnerabilities
  (Yet?)"** — Ullah, Han, Pujar, Pearce, Coskun, Stringhini. **IEEE S&P 2024**,
  arXiv **2312.12575**. **[V, peer-reviewed]** 8 LLMs, 228 scenarios. GPT-4 and PaLM2 give
  **wrong answers in 26% of cases when function/variable names change** and **17%** when
  library functions are added — both semantics-preserving perturbations.
- **PrimeVul** — Ding, Fu, Ibrahim, Sitawarin, Chen, Alomair, Wagner, Ray, Chen.
  **ICSE 2025**, arXiv **2403.18624**. **[V, peer-reviewed]** Fixing labels, dedup and
  chronological splits collapses StarCoder2 from **68.26% F1 on BigVul to 3.09% F1 on
  PrimeVul** (~65pp). On the paired metric, **GPT-4 with chain-of-thought scores P-C = 12.94%**
  (P-V 54.26%, P-B 24.47%, P-R 8.33%) — the authors characterise it as no better than a
  random guess at telling a vulnerable function from its patched twin.

**Implication for us:** a "sub-agent that follows the data flow" without the ability to
*run* anything is doing exactly the ungrounded reasoning these two papers show is unreliable.
Adding more such agents multiplies the unreliable step; it does not ground it.

---

## 4. Where agentic loops fail — with magnitudes

### 4.1 The documented case: 80+ agents, unanimous, and wrong

**Refute-or-Promote: An Adversarial Stage-Gated Multi-Agent Review Methodology for
High-Precision LLM-Assisted Defect Discovery** — Abhinav Agarwal, single author,
arXiv **2604.19049**, submitted **21 Apr 2026**. **Preprint, not peer-reviewed, single
author, self-reported [P].** Flagging that clearly because the anecdote is widely repeated.

The case: **"Ten dedicated agents — including a senior-tier arbiter — *unanimously* confirmed
a CMS Bleichenbacher padding oracle"**, within an OpenSSL campaign that deployed **80+ agents**
in total. What killed it: **"a separate instance with fresh context compiled OpenSSL and ran
three test cases: both wrong-key cases returned identical values."** The author's summary:
**"One test killed what 80+ agents' reasoning could not"** and **"Unanimity therefore should
not raise confidence by itself; empirical verification, not consensus count, is what changes
our belief."** This drove the addition of a mandatory empirical-validation stage (Stage C).

Other figures from the same paper: ~171 initial candidates → ~135 (~79%) killed by adversarial
review → ~36 validated; 31-day evaluation over 7 targets (OpenSSL, libfuse, lcms2, wolfSSL,
V8/Chrome, Langflow, GCC/MSVC/Clang); outcomes 4 CVEs + 1 accepted C++ standard proposal;
**~$250 total, ≈$62/CVE at subscription pricing**. Stage structure: A = 1 creative + 2
adversarial; B = 2 creative + 3 adversarial (one senior); C = empirical validation on cloud
VMs; D = cross-model critic from a different model family.

Crucially, the author states under Limitations: **"No ablation studies isolating individual
mechanisms."** So even the paper that most enthusiastically builds a multi-agent security
pipeline does not claim the agents are what produced the result — and its own headline
anecdote is that the agents were the failure and the *test* was the fix.

The mechanism is named independently in arXiv 2602.09341 (correlated errors from
similar training distributions → "confabulation consensus") and measured independently in
arXiv 2605.00914 (modal adoption up to 85.5%; oracle gap up to 32.3pp).

### 4.2 Non-determinism, measured

- **On Randomness in Agentic Evals** — Bjarnason, Silva, Monperrus (KTH). arXiv **2602.07150**,
  2026 (preprint). **60,000 agentic trajectories** on SWE-bench-Verified, 3 models × 2 scaffolds.
  Single-run pass@1 varies by **2.2–6.0 percentage points** depending on which run is reported.
  **Standard deviation > 1.5pp even at temperature 0.** Trajectories diverge within the
  **first few percent of tokens**, then cascade. Direct warning: **"reported improvements of
  2–3pp may reflect evaluation noise rather than genuine algorithmic progress."**
- **Snyk VulnBench JS 1.0** — snyk.io blog, **29 Jun 2026** [P, vendor, but unusually well
  designed]. 10 fixtures × 6 configurations × **5 repetitions** = 300 runs; Snyk Code SAST as
  the deterministic reference.
  - True positives are fairly stable: **134/158 (84.8%)** reference-matched findings appeared
    in **all five** repetitions.
  - **The extra, LLM-only findings are not**: of 161 unique unmatched signatures,
    **80 (49.7%) appeared in just 1 of 5 identical scans**; only **22 (13.7%) appeared in all 5**.
  - Deterministic SAST: **100.0% F1, 0.0pp sd**. Best LLM config: **75.4% F1**
    (Claude Opus 4.6 Medium, 68.0% recall / 91.5% precision). Highest-recall LLM reached
    **80.9% recall at 62.6% precision**, with 41% of its reports outside the reference set.
  - Cost inversion worth noting: Claude Opus 4.7 Max cost **5.7×** more per session
    ($0.3559 vs $0.0628), used 1.9× more tokens, and **scored lower**.
- **How Reliable Are AI Attackers Against a Fixed Vulnerable Target? A 400-Run Empirical Study
  of LLM Penetration Testing Consistency** — Galip Tolga Erdem, arXiv **2605.30096**,
  28 May 2026 (preprint). 400 runs, 4 models × 100, identical honeypot, prompt/orchestrator/
  target held constant. Full exploitation: Gemini 2.5 Flash-Lite 85/100, Claude Sonnet 4
  61/100, GPT-4o-mini 56/100, qwen2.5-coder:14b 25/100. Cross-model differences p < 0.001.
  **Caveat: the abstract reports per-model success counts, not a within-model variance/sd
  statistic** — the honest reading is "identical setup, same model, succeeds 25–85% of the
  time depending on model," i.e. a single run is a poor estimator. [?] on within-model sd.

**Note how 4.1 and 4.2 interact, and why "advisory, not a gate" does not rescue the design.**
The Snyk data says the *non-reference* findings — exactly the "genuine missing protection the
change did not cause" class the proposal wants to permit — are the *least reproducible*
(~50% appear once in five identical runs). Loosening the output contract to "advisory" moves
the system toward its noisiest, least reproducible output class. Combined with Cursor's
own inversion to "investigate every suspicious pattern," the proposal is a precision-spending
design, and our product position is precision-first.

### 4.3 Cost blowup

**Building Effective AI Agents / How we built our multi-agent research system** — Anthropic
Engineering, **13 Jun 2025** [P]. This is the most-cited pro-multi-agent vendor source, and
read carefully it argues *against* the proposal:

- The headline: a "multi-agent system with Claude Opus 4 as the lead agent and Claude Sonnet 4
  subagents outperformed single-agent Claude Opus 4 by **90.2%** on our internal research
  eval." **Internal, non-public eval; example task is breadth-first fact aggregation
  ("identifying all board members of Information Technology S&P 500 companies").**
- The deflating part: "three factors explained **95% of the performance variance** in the
  BrowseComp evaluation… **token usage by itself explains 80% of the variance**"
  (three factors: token usage, number of tool calls, model choice).
  **That is close to an admission that the architecture is a mechanism for spending more
  tokens, not an independent source of quality.**
- Cost: "agents typically use about **4× more tokens** than chat interactions, and multi-agent
  systems use about **15× more tokens** than chats."
- **Anthropic's own scope exclusion:** "most coding tasks involve fewer truly parallelizable
  tasks than research, and LLM agents are not yet great at coordinating and delegating to other
  agents in real time… some domains that require all agents to share the same context or
  involve many dependencies between agents are not a good fit."
- Observed subagent failure mode: "subagents misinterpreted the task or performed the exact
  same searches as other agents… one subagent explored the 2021 automotive chip crisis while
  2 others duplicated work investigating current 2025 supply chains."

A security review of one change is precisely a *shared-context, high-dependency* task.

---

## 5. Cost and determinism at review scale

Published or observable figures, normalized to "per review / per issue" where possible:

| system | figure | source class |
|---|---|---|
| **our reviewer** | **~$1.41 / review**, 64.4% recall in-diff, ~87% adjusted precision | internal, measured |
| Cursor Bugbot | sample `cost_cents: 42.5` (≈$0.43) in the docs analytics example; ~$1.00–1.50/review per secondary reporting | [P] docs / [S] |
| Agentless | **$0.70 / issue** (32.00% SWE-bench Lite) | [V] |
| SWE-agent | **$1.62 / issue** (23.00%) | [V] via Agentless comparison table |
| AutoCodeRover | $0.45 / issue (19.00%) | [V] via same table |
| Refute-or-Promote | ~$250 for 31 days / 7 targets → **≈$62 per CVE** | [P] preprint |
| Snyk VulnBench (per audit session) | $0.0628 (Opus 4.6 Med) … $0.3559 (Opus 4.7 Max) | [P] vendor |
| Agent-as-a-Judge (Zhuge et al., KAUST/Meta, arXiv 2410.10934, **ICML 2025**) | $30.58 / 118.43 min vs LLM-as-Judge $29.63 / 10.99 min vs human ~$1,297.50 (55 DevAI tasks) | [V] |
| Anthropic multi-agent | ~**15× chat tokens** | [P] |
| Claude Code Review (product) | reported **$15–25 per PR** | [S] — **could not confirm from an Anthropic primary page; treat as unverified** |
| Greptile | $30/seat incl. 50 reviews, then $1/extra review (Mar 2026) | [S] |

Two internal numbers that belong in this table because they price the proposal:

- Our own **k-sampling** costs **+40–50%** without caching; caching now recovers ~30%, so an
  extra discovery call is cheaper than it was — but the measured **union ceiling over 13
  archived runs is 69% overall / 66.7% on 3 seeds**, so more sampling buys little.
- Our measured **run-to-run sd is 2.4pp** (3 seeds, 42 findings; earlier 4.8pp).
  That is *in line with, slightly above*, the published 1.5pp-at-temperature-0 /
  2.2–6.0pp single-run band from arXiv 2602.07150. **This independently validates that the
  extra-pass rejections here were methodologically correct, not overcautious.**

The Agent-as-a-Judge row is worth an extra beat: agentic judging cost **no less than a plain
LLM judge and ran ~10× slower**. Our own probe found judge spend is 14% of review cost at
corpus scale but 41–61% on a single case. Any per-sub-agent verification layer lands in that
same cost bucket.

---

## 6. Verification flags — what I could not confirm

- **Martian Code Review Bench leaderboard**: the site `codereview.withmartian.com` returned no
  extractable content. All per-tool F1/precision/recall figures in §0 come from **cubic.dev's
  vendor blog (14 Jul 2026)**, which ranks itself #1. Treat as **[S]/[?]**. Reported scope
  varies across secondary sources (17 tools / 300,000 PRs vs 13 tools / 50 curated PRs +
  200,000 online) — I could not reconcile this. The claim that Martian open-sourced dataset,
  judge prompts and pipeline is also unverified.
- **"Anthropic wants $25 per pull request"** — secondary/opinion source only; no primary
  Anthropic pricing page confirmed.
- **arXiv 2605.30096** within-model run-to-run sd: abstract gives per-model counts only.
- **SecLLMHolmes** run-to-run (same-prompt-repeated) non-determinism figures: the paper reports
  them, but only the perturbation-robustness numbers (26% / 17%) were extracted here.
- **SWE-agent's own** per-instance cost table was not verified; $1.62 comes from Agentless.
- **arXiv 2512.08296** internal inconsistencies: β = −0.408 (abstract) vs −0.404 (body);
  "six agentic benchmarks" (abstract) vs four enumerated (body). Verify against the final PDF.
- **arXiv 2604.19049** is a single-author, non-peer-reviewed preprint. The "80+ agents"
  anecdote is *self-reported* and I found no independent corroboration. It is directionally
  consistent with 2605.00914 and 2602.09341, which are the citations to lean on.
- Peer-review status: **confirmed peer-reviewed** — PrimeVul (ICSE 2025), SecLLMHolmes
  (IEEE S&P 2024), More Agents (TMLR 2024), Agent-as-a-Judge (ICML 2025). **Preprints** —
  2512.08296, 2503.13657, 2602.07150, 2605.00914, 2509.05396, 2604.19049, 2605.30096,
  2602.09341, 2509.23537, 2503.17332, 2407.01489.
- *Rethinking Code Review in the Age of AI: A Vision for Agentic Code Review* — Kamalı, Tuna,
  Haratian, Tüzün, arXiv 2605.17548 (May/Jun 2026) proposes exactly this five-stage agentic
  workflow and contains **no empirical measurement or ablation whatsoever**. It is a vision
  paper. Do not let it be cited as evidence.
- *The End of Code Review: Coding Agents Supersede Human Inspection* — Monperrus,
  arXiv 2606.13175, 11 Jun 2026, is likewise a **position paper**. Notably it lists
  "security blind-spot correlation" among its own acknowledged limitations.
- **OpenAI:** no independent evaluation of Aardvark/Codex Security exists at all; the 92%
  "golden repos" claim has no methodology, no repo list, no precision counterpart, and was
  never repeated after Oct 2025; no FP-reduction number is ever attributed to the sandbox step;
  beta scale never quantified; per-review cost never published; the code-review
  inference-budget curve is figure-only. GPT-5.4/5.5 CTF and CVE-Bench point values were
  chart-image sourced and **two reads conflicted irreconcilably (86.27% vs 23.5%)** — unusable.
  "Cybench" appears in **no** OpenAI system card.
- **XBOW:** xbow.com returned HTTP 429 to every fetch; all XBOW architecture quotes are **[S]**
  from secondary reporting and an interview. XBOW's own score on its 104-challenge benchmark
  could not be retrieved. The "we are effectively being DDoSed" Stenberg quote circulates
  widely but its date/venue was not pinned down — verify before citing.
- **Semgrep, ZeroPath, Snyk, GitHub, Corgea, Pixee:** every percentage is vendor-reported and
  unaudited. GitHub's 3×/7×/12× and "two-thirds" figures have **no published sample size**,
  come from self-selected telemetry cohorts, and measure **time-to-commit, not correctness**;
  an arXiv search for an independent evaluation of Copilot Autofix returned nothing.
  Corgea's "2x more true positives / 3x fewer false positives" has no baseline, comparator,
  sample size, methodology or date — unfalsifiable as written. Pixee's own numbers are
  internally inconsistent (95% vs 98% FP reduction).
- **Naming:** the brief listed "Amplify/Pixee" as one entity. **Amplify Security and Pixee are
  separate companies**; no relationship was found. Rogers' independent test rated *Amplify
  Security* "extremely poor"; **Pixee was not in that test.**
- **Trail of Bits' "one outcome per agent" post** is a vendor blog by an **OpenAI-funded**
  Daybreak partner, with no ablation table and no effect size.
- Both the OpenAI-corpus and the vendor research passes hit the **200-call WebSearch cap**
  mid-way. Read "no independent verification found" as well-supported but not exhaustively
  proven.

---

## 7. Our own prior art — five measured rejections of this family

This is the most decision-relevant evidence available, because it is on our corpus, our
model, our metric.

| intervention | shape | measured result |
|---|---|---|
| **cross-file retrieval** (spec 16) | tools on the reviewer, agentic loop | n=4 flat; **n=9: 66.7% → 44.4%**; **n=16: 68.8% → 56.3%**; cost +71–78%, input tokens +239% |
| **context scout** (spec 18) | separate cheap call chooses context, reviewer stays tool-free | recall **flat 62.5% → 62.5%**, cost +27%; scout engaged on only **3 of 18 tasks** |
| **enumeration sweep** | extra discovery pass, "what did you miss?" | **54.8% → 54.8%**, cost **+40%** |
| **diverse-lens pass** | extra pass with different lenses | **54.8% → 54.0%**, cost **+47%** |
| **in-prompt security lens** | OWASP/CWE checklist in the main prompt | ssrf 0→50%, xss 0→33%, **but authz 41% → 27%**; overall **32% → 28%** — net negative |
| **dedicated security pass** | additive second discovery task | overall recall +4.5pp and +22 unlisted-real, but labeled security 14 → 12; **+61% cost**; security-specific lift unproven at n=1 |

Recorded diagnosis, verbatim from the cross-file work: *"tool-use mode itself changes how the
model reviews — attention goes to retrieval instead of the diff"*, and *"a truncated 24KB
excerpt of an unfamiliar file is actively misleading."* The in-prompt lens showed the same
shape from a different angle: adding a checklist shifted attention to checklist classes and
**cost the dominant class (authorization) 3 catches**.

**And the counter-example that carries the whole argument.** The single largest measured win
in this project was **one prompt line** — an injection guard telling the reviewer that text in
the reviewed code claiming a problem is safe or intentional is untrusted data. Effect:
**+18.8pp on the 16-case corpus (62.5% → 81.3% mean, sd 4.4pp)**, later corrected to
**+3.8pp on the 59-case / 133-finding corpus** (32.3% → 36.1%, with every metric moving the
same way and genuine FPs unchanged at 4). **At identical cost.**

The cases that prompt line recovered included
`nats-server-msgtrace-dest-uses-client-publish-permissions-for-leaf` (authorization,
contextDepth **cross-file**) and `ws-close-frame-leaks-uninitialised-buffer-bytes`
(secret-flow, **caller**) — *exactly the classes cross-file retrieval and the context scout
were built for and both failed to fix.* The recorded conclusion: **"a large part of the
cross-file recall gap was never a CONTEXT problem"**; the reviewer already had what it needed
and was being talked out of the finding. **Prompt framing beat retrieval, at zero cost.**

Also relevant to the proposal's premise: our biggest *remaining* recall lever is not context
and not decomposition. It is that **the engine reports roughly one defect per file**:
a case's first-listed expectation is found **71.1% (64/90)**, every later expectation
**13.9% (5/36)**. Two separate extra-pass designs failed to move it, and instrumentation
showed `finding_count=1, candidate_count=1, dropped_count=0` — it is generation-side, not a
filtering or context problem. **Sub-agents per property is a plausible attack on exactly this
lever** — that is the one genuinely open question the proposal raises (see §9).

---

## 8. Answering the five questions directly

**1. What the strong systems do.** They are tool-using loops with execution-grounded
verification. Naptime and Big Sleep are explicitly a *single* agent with a debugger, and
Naptime's authors **explicitly rejected** multi-hypothesis decomposition in favour of
independent resampling ("in practice this is highly inefficient"). Big Sleep's answer to
"scope a review from a change" was to put the **commit message and diff in the prompt** — not a
planner. Cursor collapsed an 8-pass ensemble into *one* agent with tools. OSS-Fuzz AI uses the
LLM only to write harnesses; the **fuzzer** finds the bugs. The one system that genuinely
matches the proposal — CodeMender, with explicit special-purpose sub-agents plus validators —
publishes **72 patches, no denominator, no ablation, and no paper**. Where multi-stage
pipelines exist (Aardvark, Refute-or-Promote), the stage vendors themselves credit is the
**validation/sandbox stage**, not the decomposition. Nothing here is independently verified in
the strong sense: the only third-party-observable signals are HackerOne leaderboard placement,
accepted CVEs, and upstreamed patches — all of which measure *output*, not *architecture*.

**2. Ablations.** Almost none exist for planning or sub-agents on security review. Where a
controlled comparison *does* exist, it credits the **deterministic scoping stage**, not the
agents: Snyk's `CodeReduce` slicing moves the same model **28.9% → 82.75%**, and Semgrep's
static-enumeration-then-focused-slices beats a tuned single prompt **43.5% vs 12.6% recall at
identical precision (~69–71%)**. The one
controlled architecture ablation (2512.08296) finds decomposition returns go **negative above
a ~45% single-agent baseline** (β = −0.404) and **negative for tool-heavy tasks** (β = −0.267).
The one clean SE comparison (Agentless) finds a fixed three-phase pipeline beats an agentic
scaffold by **+9pp at 43% of the cost**. Debate/consensus ablations are negative
(85.5% modal adoption, 32.3pp oracle gap, harmful in *every* CommonSenseQA configuration).
By contrast the **tools/execution** ablation is enormous and replicated: CyberSecEval 2
buffer-overflow **0.05 → 1.00** for GPT-4 Turbo under Naptime; **68% of CVE-Bench zero-day
successes attributable to one tool (`sqlmap`)**.

**3. Failure modes.** Correlated error is real and measured, not anecdotal: ten agents
unanimously wrong on a Bleichenbacher oracle inside an 80+-agent campaign, killed by one
compile-and-run; 85.5% modal adoption; a 32.3pp oracle gap where voting discards the correct
answer that was in the pool; **five different frontier model families missing the same 19 of
27 IDORs, for a union recall of 29.6% against 21% for the best single model**; and five
commercial AI SASTs all missing the same infinite-loop bug in a 14.5M-download npm package.
Cost blowup is 15× tokens (Anthropic), +40–78% in our own measured attempts. Non-determinism is
>1.5pp sd at temperature 0 and 2.2–6.0pp single-run swing; ~50% of LLM-only findings appear in
only 1 of 5 identical scans; ZeroPath independently reports *"findings shifted meaningfully
between runs on the same code."* Coordination failure modes account for 36.94% of annotated MAS
failures. And the one third-party-observable precision record in the space — XBOW's HackerOne
history — is **13% resolved, ~24% not-a-valid-finding, measured *after* a 100% human filter**.

**4. Verification by execution.** It is the load-bearing component everywhere it exists, and
it is the component the proposal cannot build — **no build step, no whole-repo index**.
Naptime's own authors attribute their gain to hypothesis-test cycles, and their ASan column
shows the *oracle* outperforming the *agent* at k=1 (0.16→0.32 vs 0.32→0.36); Big Sleep's
`report_success` is gated on an actual `SIGABRT`; Refute-or-Promote added Stage C *because*
consensus failed; Agentless keeps a test-running validation phase; OpenAI's only positive
code-review ablation bundles repo access with **code execution**. Two independent signals that
this is not optional: OpenAI **downgraded** Aardvark's sandbox from "will confirm exploitability"
to "where possible… when configured with an environment tailored to your project" — and the
one system in this survey that fully matches the proposed shape (CodeMender: sub-agents plus
validators) publishes **72 patches and no denominator**. Meanwhile Semgrep found *all five*
frontier models blind to the same 19 of 27 IDORs. **An agentic system without execution
verification is the configuration in which every documented failure mode fires and the
compensating mechanism is absent.** That is the single most important finding in this memo.

**5. Cost and determinism.** Agentic scaffolds cost 2–15× more. Our own measured attempts
cost +27% to +78% for flat-to-negative recall. Our current $1.41 is *already competitive with
or cheaper than* every published comparable ($1.62 SWE-agent, ~$1.00–1.50 Bugbot per
secondary reporting), and our ~87% adjusted precision is well above the 24.7–56.3% precision
band reported for commercial reviewers on Martian's benchmark (with the comparability caveat
that adjusted precision and F1-on-acted-upon-comments are different metrics). On runtime, note
what the fully agentic reference points actually cost in wall-clock: Codex Security scans take
*"several hours"* to *"multiple days"*; agentic autofix is 2–4 minutes per single fix. Neither
OpenAI nor Google has ever published a per-review cost.

---

## 9. What the evidence supports building instead

Ranked by evidence strength per unit of cost.

**Tier 1 — supported by direct, replicated evidence.**

1. **Keep the deterministic scoping — it is the one part of the proposal the evidence
   actively supports — and drop the plan and the sub-agents.** Three independent sources
   converge on it: Semgrep's design rule *"use static analysis to decide where a model should
   look, then give it focused slices of code"*, with the entire measured gap over tuned single
   prompts being **recall (43.5% vs 12.6%) at equal precision (~69–71%)**; Snyk's `CodeReduce`
   ablation (**28.9% → 82.75%** with deterministic slicing, 40–57× token reduction); and
   Agentless (deterministic localization + one focused generation step + a validation phase =
   **+9pp at 43% of the agentic scaffold's cost**). Feed the deterministic blast radius
   **into the existing single call as focused context**, not into an orchestrator. Note the
   direction of the expected gain: **recall, not precision** — which matches our profile
   (64.4% recall, ~87% adjusted precision).
2. **Spend the next effort on prompt framing, not architecture.** Our own +18.8pp/+3.8pp
   injection guard at zero cost is the highest ROI intervention ever measured here, and it
   solved the exact cross-file class that two agentic capabilities failed to solve. The
   security analogue is untried: a framing clause about *trust boundaries* and *invariants
   the change relies on*, not a checklist (the checklist was measured net-negative).
3. **Attack the one-defect-per-file ceiling with output structure, not with agents.** It is
   generation-side (`finding_count=1, dropped_count=0`). The untested hypothesis in our own
   notes — that the prompt frames the task as finding *the* problem — is a prompt/schema
   experiment costing one run, not a sub-agent fleet costing +40–61%.

**Tier 2 — the one part of the proposal worth keeping, in reduced form.**

4. **If sub-agents are tried at all, try exactly one axis: one additional pass per
   *property*, additive, merged through the existing refutation gate — and measure it against
   the enumeration-sweep and diverse-lens results, which are the correct baselines and both
   failed.** The honest case for it is not the vendor narrative; it is our own
   one-defect-per-file finding, which is a plausible target for parallel narrow prompts in a
   way that "ask again differently" was not. Pre-register the decision rule: on the 42-finding
   corpus a change must clear ~**5pp (2 sd at 2.4pp)** across ≥3 seeds, at ≤+25% cost.
   Two prior attempts at this shape produced 0.0pp and −0.8pp at +40%/+47%. Prior probability
   is low; the experiment is cheap; do not build the orchestrator before the experiment.

   **The best argument for doing this experiment is not the vendor narrative — it is Trail of
   Bits' "one outcome per agent" finding** (*"putting two competing outcomes in one `/goal`
   prompt results in uneven optimization"*; splitting them *"worked drastically better"*),
   which describes our one-defect-per-file pathology exactly. That is a *prompt-scoping*
   claim, not an orchestration claim, and it can be tested as one.

   **Know the ceiling before spending.** Semgrep's self-audit puts a hard empirical bound on
   this: five *different frontier model families* on 27 real IDORs reached **union recall
   29.6% versus 21% for the single best** — 19 of 27 missed by every one. Our own union over
   13 archived runs is **69% vs 54.8% single-run**. Diversity of agents buys far less than
   the architecture implies, because the blind spots are shared. If narrow per-property
   prompts help, they will help by *changing what gets enumerated*, not by adding opinions.

**Tier 3 — the thing that would actually change the ceiling, and its blocker.**

5. **Any form of execution grounding beats any amount of decomposition — and improving the
   *oracle* may beat improving the *agent*.** The sharpest single number in this memo is
   Naptime's GPT-4 Turbo advanced-memory-corruption result at k=1: **0.16 → 0.32 from swapping
   in a better crash oracle (ASan) with no agent at all**, then only **0.32 → 0.36 from the
   entire agent loop**. Our analogue of "the oracle" is the **refuter**, and our own notes
   already record it as the binding constraint: the engine *identifies* ~93.8% of expected
   defects but only ~87.5% survive refutation, and the static-type rule inside the refuter is
   **load-bearing for precision** (loosening it cost 100% → 86.7% adjusted precision for zero
   net recall). **Sharpening the refuter is the in-repo move most analogous to the
   highest-leverage change Google measured.** We cannot run the target. The reachable
   substitutes, in order of cost:
   - **Property-level determinism instead of agent-level reasoning**: a language-neutral
     check that a changed symbol's *reference sites* were updated consistently is a
     deterministic diff-of-references operation, not an LLM task, and it is zero-variance.
   - **Differential reasoning against the pre-change code** (we have both sides of the diff
     for free) — the closest thing to differential execution available without a build.
   - Explicitly **do not** promise sandbox validation. Without it, per Refute-or-Promote's own
     Stage C rationale, the multi-agent design has the failure mode and not the cure.
   - **Beware the self-validation trap.** ZeroPath's verification agents, GitHub's CodeQL
     re-run and Snyk's analyzer re-run all validate a finding with the same engine that
     produced it — a candidate can pass by *evading detection* rather than by being right.
     Pixee's CI/CD test verification is the only production validation in this survey with an
     oracle external to the security tool, and it needs a build and a test suite. Our refuter
     has the same structural weakness; that is an argument for making it *adversarial and
     asymmetric* (Semgrep split TP and FP classification into separate chains for exactly this
     reason: *"a model that tries to perfectly classify every issue… ends up mediocre at
     both"*), not for adding more agents on the discovery side.

**What to refuse outright:**
- The **"investigate every suspicious pattern"** prompting inversion. It is Cursor's
  correction for an agent that had become *too cautious* after they removed their
  8-pass/majority-vote/validator precision machinery. We have not removed ours, we are
  precision-first at ~87%, and the Snyk repeatability data shows the extra findings that
  inversion produces are the least reproducible class (~50% appear in 1 of 5 identical scans).
- The framing that **"advisory, not a gate" makes precision cheap.** It makes precision
  *unmeasured*, not free. Every failure mode above gets worse, and the noisiest output class
  is the one being licensed.

---

## 9b. The proposal, component by component

| component | verdict | best evidence |
|---|---|---|
| **(1) deterministic blast radius** | **KEEP — the one well-supported piece** | Snyk CodeReduce 28.9% → 82.75%; Semgrep 43.5% vs 12.6% recall at equal precision; Agentless |
| **(2) plan from that result** | **DROP — zero controlled evidence either way** | no plan-vs-no-plan ablation exists for code tasks; **no OpenAI primary source describes a planning stage for Aardvark either**; Big Sleep's answer to the same problem was a better prompt seed (commit message + diff) |
| **(3) sub-agents with tools, one property each** | **DROP as architecture; at most one cheap pre-registered experiment** | 2512.08296 (β=−0.404 above ~45% baseline, β=−0.267 tool-heavy); Naptime explicitly rejected it; union recall 29.6% vs 21%; our own 5 rejected interventions |
| **(3b) tools on the reviewer** | **DROP — measured harmful here twice** | our spec 16: 66.7%→44.4% (n=9), 68.8%→56.3% (n=16), +71–78% cost |
| **(4) advisory, not a gate** | **REJECT the inference it licenses** | Snyk: ~50% of LLM-only findings appear in 1 of 5 identical scans — "advisory" moves output toward its least reproducible class |
| **(missing) execution verification** | **the component that carries every real gain — and we cannot build it** | Naptime ASan 0.16→0.32 vs agent 0.32→0.36; Refute-or-Promote Stage C; Big Sleep's debugger gate |

## 10. One-paragraph answer

The belief that **planning plus sub-agents** beats a single well-scoped call for security review
of a change is **mostly narrative**. No ablation anywhere in the security literature supports
it; the one controlled architecture study predicts it is *harmful* in our exact regime
(single-agent baseline above ~45%, tool-heavy, β = −0.404 and −0.267, p < 0.001); the cleanest
software-engineering comparison has a plan-free, agent-free three-phase pipeline beating an
agentic scaffold by 9pp at 43% of the cost; Google's strongest system explicitly *rejected*
in-trajectory decomposition in favour of independent resampling; multi-agent consensus is
measured to produce correlated, confident, wrong answers — ten agents unanimous on a
non-existent Bleichenbacher oracle, and five *different* frontier model families blind to the
same 19 of 27 IDORs for a union recall of 29.6% against 21% for the best single model; and the
flagship case cited in support (Cursor) moved from *more* decomposition to *less*, reports a
self-defined LLM-judged metric, and publishes no ablation. What **is** well supported is the
other two components: **deterministic scoping** (Snyk's CodeReduce 28.9% → 82.75%; Semgrep's
43.5% vs 12.6% recall at identical precision — *"use static analysis to decide where a model
should look"*) and **verification by execution** (Naptime 0.02 → 0.71 at k=1; and, tellingly,
its ASan column showing a better *oracle* outperforming the whole *agent* at k=1). The honest
counter-evidence is real and belongs in the record: OpenAI's Codex team measured that repo
access **plus code execution** makes a reviewer better on both recall and precision, and Trail
of Bits reports that one outcome per agent fixed exactly our one-defect-per-file pathology —
but neither credits planning, neither runs property-specialised sub-agents over shared context,
and the first depends on execution we cannot perform. Five interventions of this family have
already been measured and removed here, two net-negative, while the single largest win in the
project's history was one prompt line at zero marginal cost. **Build step (1); skip step (2);
reduce step (3) to one cheap pre-registered experiment against the enumeration-sweep baseline
that already failed twice; and refuse the "advisory, so precision is cheap" framing, because
the findings it licenses are the ones that appear in 1 of 5 identical runs.**
