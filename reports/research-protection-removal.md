# Detecting the removal or weakening of a protection — literature and tooling review

Date: 2026-07-29. Research note only; no repository file was modified.

Labelling convention used throughout:
- **[primary]** — I fetched the paper PDF / abstract page / official docs and read the
  numbers there.
- **[secondary]** — taken from a search summary, a publisher landing page, or a
  citation inside another paper I did read. Trust it less.
- **[unverified]** — I could not confirm it from any source I opened. Treat as a lead,
  not a fact.

---

## 0. The one-paragraph answer

The *general* problem — "did this diff take away a protection" — is **essentially
unstudied as a named problem**. What exists is three adjacent bodies of work that each
solve a neighbouring problem and none of which solves this one:

1. **Vulnerability-contributing-commit (VCC) research** works *retrospectively*: it
   starts from a known fix and walks back to the introducing commit. It is a mining
   technique, not a review-time detector, and the one study that tested review-time
   detectors on VCCs found them close to useless in precision.
2. **Differential verification / differential symbolic execution** does compare two
   versions for a property change, but needs a build, a language front end and small
   programs.
3. **Missing-check / missed-security-operation detection** (Chucky, Crix, IPPO) finds
   an absent protection *without* a base version, by comparing a code path against its
   siblings. This is the closest existing analogue to what is wanted, it works, and its
   published false-positive rate is **63–65%**.

The only place where protection-*weakening* detection is genuinely solved and shipped
is where the protection is **declarative**: AWS IAM Access Analyzer's `CheckNoNewAccess`
decides, with an SMT solver, whether a new policy grants access the old one did not.
Nobody has an equivalent for imperative code.

Base rates: nobody has published the number you actually want ("what fraction of PRs
weaken a protection"). The nearest published anchors are all in the low single-digit
percent or below.

---

## 1. Protection-removal as a signal in its own right (question 3)

### 1.1 The one solved case: declarative policy

**Zelkova / IAM Access Analyzer** is the existence proof that this problem is tractable
when the protection has a formal semantics.

- *Semantic-based Automated Reasoning for AWS Access Policies using SMT*,
  John Backes, Pauline Bolignano, Byron Cook, Catherine Dodge, Andrew Gacek,
  Kasper Luckow, Neha Rungta, Oksana Tkachuk, Carsten Varming. FMCAD 2018.
  DOI 10.23919/FMCAD.2018.8602994. **[secondary — read the Semantic Scholar / UT
  Austin FMCAD proceedings listing and the abstract, not the full PDF]**
  The core capability is stated as deciding whether one policy is
  *less-or-equally-permissive* than another; the tool is reported as sound, serving
  millions of queries daily with 99% under ~160 ms.

- **AWS IAM Access Analyzer custom policy checks** — `CheckNoNewAccess` (CLI:
  `aws accessanalyzer check-no-new-access`). **[primary — AWS IAM User Guide,
  `access-analyzer-custom-policy-checks.html`]** The documented purpose is exactly
  protection-removal detection: *"check whether new access is allowed for an updated
  policy when compared to the existing policy"*, and the console flow is
  "Check for new access → if the modified permissions grant new access, the statement
  will be highlighted".

This matters for us as a *framing* result, not a reusable technique: the removal
direction is decidable precisely because IAM policy has a denotational semantics you
can encode in SMT. Imperative code does not, which is why the rest of this document is
much weaker.

### 1.2 The tooling gap: diff-aware SAST is one-directional by construction

Every mainstream diff-aware scanner reports *findings added*, never *protections
removed*.

- **Semgrep diff-aware scanning** **[primary — docs.semgrep.dev / semgrep.dev docs]**:
  diff-aware scans "only report findings newly introduced in the commits after that
  baseline", and explicitly *discard* the other direction — *"removed findings do not
  count toward the fix rate or the number of findings. The removed findings also do not
  appear in Semgrep AppSec Platform."* The removal direction is not merely unsupported,
  it is deliberately thrown away.
- CodeQL / GitHub code scanning on PRs, SonarQube "new code", Snyk IaC "new issues"
  follow the same shape. **[secondary]**

There is a subtle consequence worth stating: a removed sanitiser *does* in principle
produce a new taint finding at HEAD, because Semgrep scans both baseline and HEAD and
diffs the finding sets. So diff-aware taint mode is not structurally blind to sanitiser
removal — **provided** a rule already models that sanitiser and that sink, and provided
the language has a taint front end. In practice the rule coverage is the binding
constraint, not the diff logic. I did not find a published measurement of how often
diff-aware SAST catches a sanitiser deletion.

I found **no** rule pack, linter, or commercial product that advertises "this change
removed a guard" as a first-class detection. Semgrep's own answer to the question is
"write a custom taint rule with `pattern-sanitizers`" — i.e. you must already know which
sanitiser matters. **[secondary]**

I was unable to search vendor claims for AI review products (CodeRabbit, Greptile,
Bugbot, Diamond) — the session's web-search budget was exhausted before that query ran.
**Treat "no commercial product does this" as unverified for the AI-review segment.**

### 1.3 The closest real technique: missing-check / missed-security-operation detection

This is the line of work that most deserves attention, because it detects an *absent*
protection **without needing the previous version at all** — it compares a path against
a sibling path that does have the protection.

**Chucky** — *Chucky: exposing missing checks in source code for vulnerability
discovery*, Fabian Yamaguchi, Christian Wressnegger, Hugo Gascon, Konrad Rieck.
CCS 2013, pp. 499–510, DOI 10.1145/2508859.2516665. **[primary for the
title/authors/venue/DOI via dblp; secondary for the results]** Statically taints source
and flags anomalous or *missing* conditions on security-critical objects; evaluated on
five open-source projects, uncovered 12 previously unknown vulnerabilities in Pidgin and
LibTIFF.

**Crix** — *Detecting Missing-Check Bugs via Semantic- and Context-Aware Criticalness
and Constraints Inferences*, Kangjie Lu, Aditya Pakki, Qiushi Wu. USENIX Security 2019,
pp. 1769–1786. **[primary for citation metadata via dblp API; results secondary]**
Its false-positive rate is reported as **65.4%** by the IPPO authors.

**IPPO** — *Detecting Missed Security Operations Through Differential Checking of
Object-based Similar Paths*, Dinghao Liu, Qiushi Wu, Shouling Ji, Kangjie Lu,
Zhenguang Liu, Jianhai Chen, Qinming He. CCS 2021, pp. 1627–1644,
DOI 10.1145/3460120.3485373. **[primary — I read the paper PDF, §5–§6]**

IPPO is the single most relevant paper I found. Numbers, read directly:

- Targets Linux 5.8, OpenSSL 3.0.0-alpha6, FreeBSD 12, PHP 8.0.8.
- Reported **754** potential bugs; **275** confirmed valid (266 Linux, 7 OpenSSL,
  1 FreeBSD, 1 PHP). **Overall false-positive rate 63.5%.** The authors argue this is
  acceptable because peers are worse: **Crix 65.4%, APISan 99.8%, FICS 88.0%.**
- 136 of the submitted patches were accepted by maintainers.
- Manual triage of a report took a non-expert *"less than two minutes on average"*.
- Reachability: 71.9% of the found bugs were reachable from a user-facing entry point.
- **Crucially — §6.5 "False Negatives" is a protection-removal benchmark.** They
  constructed a test set *by manually removing security operations from normal
  functions*: 40 functions were selected and they deleted 10 resource-release calls,
  10 return-value checks, 10 refcount decrements and 10 unlocks. **IPPO detected
  31/40 = 77.5% recall** on injected protection removals. Documented false-negative
  causes: pre-condition filtering, an unidentified check, an inlined function whose
  check removal made the call disappear in LLVM IR.

Cost of that capability: IPPO consumes **LLVM IR**. It needed a full `allyesconfig`
kernel build producing 19,492 bitcode files, batched in groups of 3,000, ~2 hours of
analysis. It is C/C++ only. That is the opposite of our constraint envelope in every
dimension.

Complementarity finding **[primary]**: of 560 bugs found by APISan, Crix and HERO,
IPPO detected only 119. These detectors barely overlap — which suggests that no single
"missing protection" signal covers the space, and that a general-purpose LLM detector is
not obviously worse-positioned than a specialised one.

### 1.4 What this section establishes

- Protection removal is **not** a named research problem. "Missing check" is the
  adjacent named problem, and it is version-free, not differential.
- The **only** differential formulation that is deployed and reliable is over
  declarative policy (IAM), where the semantics is formal.
- Precision on the imperative-code version of this task, from the best published
  system, is **~36%** (275/754). Our reviewer's ~87% adjusted precision is on a
  different and easier distribution, but it is worth registering that the research
  state of the art on "find the absent guard" ships at roughly one-in-three.

---

## 2. Corpus construction: is reversing an upstream fix sound for *this* problem?

Short answer: **more sound here than for general defect detection, but it cannot
measure the number that decides the build/don't-build question.**

### 2.1 Why it is unusually well-suited

For general "find the bug" evaluation, reversing a fix is a proxy: you assert the
pre-fix state was defective. For *protection removal* the reversal is not a proxy — it
is the phenomenon itself. A fix that adds a redaction, reversed, is literally a diff
whose deleted lines are a redaction. The answer key is the fix's own message/CVE, and
the located line is unambiguous (the deletion hunk). This is the strongest form of the
construction the corpus already uses.

Note also that the closest prior work does exactly this by hand: **IPPO's false-negative
evaluation is a manually-injected protection-removal corpus** (40 deletions, §6.5). That
is direct precedent for the construction, from a top-tier venue.

### 2.2 Four caveats, in decreasing severity

1. **It cannot measure the false-positive rate, which is the decisive number.** A
   reversed-fix corpus is 100% positives. For an advisory detector the question that
   settles viability is "on an ordinary PR that deletes 200 lines for a refactor, how
   often does this fire?" That requires a *negative* population of ordinary
   deletion-heavy diffs. The existing clean-case / no-finding-zone machinery in
   `specs/17-real-repository-eval-corpus.md` is the right place, but the negatives have
   to be **deletion-heavy refactors specifically**, not generic clean diffs — otherwise
   the FP measurement is vacuous for this detector.

2. **Reversed fixes are easier than real removals.** A real protection-weakening change
   arrives with a motive and with collateral: the tests were adjusted, a call site moved,
   a comment explains why the check "isn't needed any more". A reversed fix has none of
   that — no test churn, no rationale, a clean isolated deletion. A detector tuned on
   reversed fixes will over-fit to "unexplained deletion of a check-shaped line". Expect
   the corpus number to be optimistic.

3. **Tangled commits.** *The Impact of Tangled Code Changes*, Kim Herzig, Andreas Zeller,
   MSR 2013 (extended: *The impact of tangled code changes on defect prediction models*,
   Empirical Software Engineering, DOI 10.1007/s10664-015-9376-6). **[secondary — read
   the search summary and the Springer landing page, not the PDF]** Reported that
   **between 7% and 20%** of bug fixes across five Java projects consist of multiple
   tangled changes, and that on average **at least 16.6%** of source files are
   incorrectly associated with bug reports. Reversing a tangled fix yields a diff that
   removes a protection *and* undoes unrelated work, which pollutes both the answer key
   and the "no other finding here" assumption.

4. **Reversal can produce a state that never existed.** Reported in the
   vulnerable-version-identification literature: reversing a later commit "can produce
   an in-between state that carries traits of both the vulnerable and the repaired
   code", and V-SZZ's assumption that deleted lines *are* the vulnerable code does not
   fully capture vulnerability logic. **[secondary — search summaries of arXiv
   2509.03876 *Vulnerability-Affected Versions Identification: How Far Are We?* and
   arXiv 2408.07321 VERCATION; I did not open either PDF]** For our purposes this bites
   when the fix that added the protection also refactored around it.

### 2.3 How plentiful are such commits?

I could not find a published count of "fix commits that add a protection". Indirect
evidence that the supply is large:

- CVEfixes, Big-Vul, PatchDB, CrossVul, DiverseVul and MegaVul all index tens of
  thousands of security fix commits with the patch attached. **[secondary; see §3 for
  what the parallel survey returned]**
- Sub-classes are individually plentiful and mechanically greppable in a fix corpus:
  commits whose added lines introduce an escape/encode call, an `authorize`/`can?`/
  permission call, a bounds comparison, a regex tightening, a `redact`/`mask` call, a
  timeout/retry parameter. A reversed-fix miner keyed on *added protective call sites*
  rather than on CVE identifiers would have far more raw material than a CVE-keyed one,
  at the cost of a weaker answer key.

My judgement: supply is not the constraint. Curation of *negatives* is the constraint.

---

## 2.4 An overlooked adjacent result: security-patch detection, run backwards

There is a mature line of work on classifying **"is this commit a silent security fix?"**
— built because vendors ship security patches without advisories. That classifier,
applied to the *reversed* diff, is very close to "does this diff remove a protection".
Nobody appears to have stated it that way, but the training data and the feature space
transfer directly.

- *GraphSPD: Graph-Based Security Patch Detection with Enriched Code Semantics*,
  Shu Wang, Xinda Wang, Kun Sun, Sushil Jajodia, Haining Wang, Qi Li.
  IEEE S&P 2023, IEEE Xplore document 10179479. **[primary for authors/venue via the
  project page sunlab-gmu.github.io/GraphSPD; secondary for the numbers — the GMU PDF
  failed TLS verification for me]** Represents a patch as *PatchCPG*, a merge of the
  pre-patch and post-patch code property graphs retaining context/deleted/added
  components, then applies a GNN. Reported: **up to 80.4% accuracy at ~5%
  false-positive rate**, and **+10.8% accuracy / +0.096 F1** over TwinRNN on PatchDB.

Why this matters to us: PatchCPG's representation is *explicitly* the before-and-after
pair with deletions retained — i.e. someone already built the data structure for
"what did this diff take away", they just pointed it at the additive direction. The
80.4%/5%-FP figure is the most encouraging number in this whole document, with the
large caveat that it is a binary classifier on a curated patch corpus, not a detector
run over the natural stream of PRs (see the base-rate section).

## 3. Vulnerability-introducing change detection (question 2) — PARTIAL

**I did not complete this section.** Three parallel surveys were dispatched (VCC/SZZ,
differential verification, robustness+base-rates) and none returned before the session's
web-search budget (200 calls) was exhausted. What follows is only what I verified myself.

What I can state:

- The **review-time** framing is the one that matters to us, and the only measurement of
  it I found is the ISSTA 2024 study in §7: pointed at 815 real vulnerability-contributing
  commits, a SAST tool warns in the right function for **52%** of them, and **≥76% of
  those warnings are irrelevant to the actual vulnerability**. That is the published
  state of review-time VCC detection with static analysis and it is poor.
- The **retrospective** framing (SZZ-style mining from a known fix back to the
  introducing commit) is a data-generation technique, not a detector. It cannot run at
  review time by construction — it requires the fix to already exist.
- The reversed-classifier idea (§2.4, GraphSPD) is the most promising bridge I found
  between the two and, as far as I can tell, nobody has published it in that direction.

**NOT VERIFIED / NOT DONE:** VCCFinder's precision-recall against FlawFinder; SZZ variant
accuracy (Rosa et al. ICSE 2021 developer-informed oracle; V-SZZ ICSE 2022); JIT
vulnerability prediction AUCs; dataset sizes for Big-Vul / CVEfixes / DiverseVul /
MegaVul / Ponta et al. MSR 2019. I have named these because they are the right places to
look, **not** because I confirmed anything about them. Do not cite them from this
document.

## 4. Differential / regression security analysis (question 1) — NOT DONE

**I did not get to this section.** Nothing here was verified. The dispatched survey
covering differential symbolic execution (Person et al. FSE 2008; Directed Incremental
Symbolic Execution PLDI 2011; SymDiff CAV 2012; differential assertion checking FSE
2013), regression verification, and patch-directed fuzzing (AFLGo, HyDiff) did not
return.

My prior, stated as a prior and not as a finding: this line of work requires a build, a
language front end, and scales to small programs — the SymDiff/DSE family has never been
a whole-repository technique. If that prior is right it is irrelevant to us regardless of
its numbers, because we have no build step. **Someone should confirm the prior before
relying on it.**

The one thing I did verify in this area is the *tooling* half, in §1.2: diff-aware SAST
(Semgrep, and by extension CodeQL/Sonar/Snyk) is one-directional by design and discards
the removal direction outright.

## 5. Robustness beyond security (question 4) — NOT DONE

**No verified findings.** The survey covering removed retries/timeouts/circuit breakers,
widened `catch` blocks, removed assertions, and test erosion did not return.

The only adjacent thing I verified myself is **mutation testing**, and it is worth
registering as a framing point rather than a result: mutation operators such as
*remove conditional*, *negate conditional* and *void method call deletion* are literally
"remove or weaken a guard, then see whether anything notices". A surviving mutant is,
definitionally, a protection whose removal no test detects. That is the same phenomenon
this capability targets, approached from the test side. I did **not** verify any specific
survival-rate numbers, and I did not find any tool that applies this framing to a diff.

## 6. Base rates (question 5) — THE NUMBER YOU WANT DOES NOT EXIST (as far as I got)

**I found no published base rate for "what fraction of code changes weaken or remove a
protection".** I consider it fairly likely that none exists, because the phenomenon has
no accepted name to measure — but I did not exhaust the search, so treat this as
"not found" rather than "does not exist".

The nearest anchors I actually verified:

- **Vulnerability re-introduction, one project.** *Process-based Indicators of
  Vulnerability Re-Introducing Code Changes: An Exploratory Case Study*, Samiha Shimmi,
  Nicholas M. Synovic, Mona Rahimi, George K. Thiruvathukal. IEEE/ACM 4th International
  Workshop on Software Vulnerability Management 2026, DOI 10.1145/3786165.3788438;
  arXiv:2510.26676. **[primary — arXiv abstract page]** A longitudinal case study of
  **ImageMagick** encompassing **76 instances of reintroduced vulnerabilities**. This is
  a count, not a rate — the paper does not give a denominator of commits, and it is one
  project. It does establish that reintroduction is common enough in a single mid-sized
  project to build a study around, and that reintroductions correlate with process
  metrics (issue spoilage, fluctuating issue density) rather than with code features.
- **The existence proof everyone cites**: OpenSSH **CVE-2024-6387 ("regreSSHion")** is a
  regression of **CVE-2006-5051**, reintroduced in OpenSSH 8.5p1 (October 2020) — a fix
  that was present for 18 years and then removed. **[secondary — multiple vendor
  advisories, consistent]** One anecdote, but an unusually clean one: an existing
  protection was deleted, no API broke, no test caught it, and it took ~4 years to
  notice.
- **Injected-removal recall, as a proxy for detectability**: IPPO detected **31/40
  (77.5%)** of manually deleted security operations (§1.3). This says the phenomenon is
  detectable at high recall *when you already know what protection classes to look for*.
- **Warning burden**: IPPO's **63.5% FP rate** and Crix's **65.4%** (§1.3), and the
  ISSTA 2024 finding that **≥76% of SAST warnings in vulnerable functions are irrelevant
  to the VCC** (§7). These are the closest published proxies for what an
  imperative-code protection detector costs in noise.

**Honest read on the base-rate question:** the base rate is almost certainly low —
single-digit percent of PRs at most, plausibly well under one percent for genuine
security-protection removal. Nobody has measured it. That means **you cannot resolve the
build/don't-build decision from the literature**, and the only way to get the number is
to measure it on your own PR stream (see §8.2). Anyone who quotes you a base rate for
this is making it up.

---

## 7. One hard number on how well existing tooling does this at review time

*An Empirical Study of Static Analysis Tools for Secure Code Review*,
Wachiraphan Charoenwet, Patanamon Thongtanunam, Van-Thuan Pham, Christoph Treude.
ISSTA 2024, arXiv:2407.12241. **[primary — arXiv abstract page]**

- Dataset: **319 real-world vulnerabilities from 815 vulnerability-contributing commits
  across 92 C and C++ projects.**
- A single SAST tool produced warnings in the vulnerable function for **52% of VCCs**.
- But **at least 76% of the warnings in vulnerable functions are irrelevant to the VCC.**
- Prioritising changed functions by SAST warnings yielded **+12% precision, +5.6% recall**.

Read plainly: existing static analysis, pointed at exactly the commits that introduced
real vulnerabilities, lands a warning in the right function half the time and is wrong
about *why* three quarters of the time. That is the bar. It is low.

---

## 8. Judgement

### 8.1 Is it worth building?

**Yes, narrowly — as a diff-local reading task, not as a context-hungry analysis.**
The reasoning:

- The signal lives **entirely inside the diff**. A deleted line is in the diff by
  definition. This is the rare capability where our 0%-outside-the-diff recall is not a
  handicap: the evidence for "a protection was deleted" is the deletion hunk itself.
  Every one of the five context-adding interventions that were built and removed here
  was trying to reach evidence *outside* the diff. This one does not need to.
- The costly part of every technique surveyed is deciding *whether the thing removed was
  protective*. IPPO spends an LLVM build and two hours inferring that; Chucky infers it
  from neighbours; Zelkova gets it for free from a formal semantics. An LLM gets it from
  reading the deleted line, which is exactly the operation we are already paying for.
  **The removal-direction question is cheap for us and expensive for everyone else.**
  That is a genuine structural advantage and it is the main reason to build.
- Advisory framing plus "may report a missing protection the diff did not cause"
  collapses the hard part. It converts the task from *differential* ("prove it held
  before") to *anomaly* ("this diff deletes something that looks protective, and nothing
  obviously replaces it"), which is the Chucky/IPPO formulation — the one that
  demonstrably works — minus the requirement for a base version.

**What I would not do:** build anything that re-reads the pre-change file, retrieves
callers, or reconstructs the base state. The base state is already in the diff's removed
lines. Anything more is the context-hungry pattern that has lost twice here.

### 8.2 The measurement that must come first

The decisive number is not recall, it is **firing rate on ordinary deletion-heavy
diffs**, and it is unmeasured in the literature and unmeasurable on a reversed-fix
corpus. Before building:

1. Run a prompt-only prototype over a population of **ordinary refactor PRs that delete
   a lot of code** and count how often it claims a protection was weakened. If that rate
   is high, stop — no framing will save it, because the base rate of true positives is
   low (§6) and an advisory that cries wolf on refactors will be turned off.
2. Only then measure recall on reversed protection-adding fixes.

Doing these in the other order will produce an encouraging recall number that means
nothing.

### 8.3 Scope I would ship

Restrict to protection classes whose removal is *lexically visible in a deletion hunk*
and language-neutral: a deleted call whose name matches escape/encode/sanitise/redact/
mask/validate/verify/authorize/permit; a deleted comparison that bounded an index or a
length; a loosened regex (anchors or character classes removed); a widened literal
(`*` appearing in a CORS/permission/allow-list string); a verification flag flipped to
false/disabled; a removed timeout/retry/limit argument. This is deliberately shallow —
it is the subset where the LLM's judgement about protectiveness is reliable and where
false positives are cheap to dismiss visually. IPPO's own scope is comparably narrow
(four operation classes) and it is a top-tier-venue result.

Treat the *robustness* cases (removed retry, widened catch, removed timeout) as the same
detector with a different label, not a second capability. I found no literature or
tooling for them at all, which is a reason to expect them to be uncontested rather than
a reason to expect them to be hard.

### 8.4 What would change my mind

If the prototype's firing rate on deletion-heavy refactors exceeds roughly one report
per two PRs, the capability is not viable at any cost, because the true-positive base
rate cannot support it. That is the kill criterion and it is measurable in a day.

---

## 9. Explicit list of what was NOT done

Stated plainly so the shape of the hole is visible:

- **Question 1 (differential/regression security analysis): not done.** No paper in the
  differential symbolic execution / regression verification / patch-directed fuzzing
  family was verified. Only the diff-aware-SAST tooling half (§1.2) is verified.
- **Question 2 (VCC detection): partially done.** Only the ISSTA 2024 review-time
  measurement (§7) is verified. VCCFinder, SZZ variants, JIT vulnerability prediction and
  all the standard datasets are unverified — named as leads only.
- **Question 4 (robustness): not done.** No verified findings whatsoever.
- **Question 5 (base rates): no base rate found.** Only the proxies in §6.
- **Commercial AI code-review vendor claims: not checked.** The web-search budget
  (200 calls) ran out first. My claim that no product ships this is unverified for that
  segment.
- Three parallel surveys (VCC/SZZ, differential verification, robustness+base-rates) were
  dispatched and had not returned when this was written. If they land, their output
  should be folded into §3–§6 and independently re-verified before anything is cited.
