# Protection removal: four research streams, and what they decide

Date: 2026-07-29
Status: synthesis. Decides what to build and what to abandon.

---

## The question

Detect when a change **weakens a security, privacy or robustness property** while
breaking no API, passing every type check and passing every test. Removing a
redaction line from a logger. Adding a log statement that happens to carry a
bearer token.

Four independent research passes. The answer splits cleanly, and unusually for
this project, one half is a **build** rather than a **don't**.

---

## VERDICT 1 — The removal direction is a real, structural gap

**No mainstream diff-aware analyser can see it, and the reason is verifiable in
source code.**

Every tool computes one of exactly two set differences over *findings*:
`head ∖ base` (a new defect appeared) or `base ∖ head` (an old defect
disappeared — the good-news report). **Neither is "a property held before and
does not now"**, because no tool represents "there was an authorization check
here" as a first-class diffable fact.

The sharpest demonstration, read directly from
`github/codeql-action/src/diff-informed-analysis-utils.ts`:

```js
if (diffLine.startsWith("-")) {
  // Ignore deletions completely -- we do not even want to consider them when
  // calculating consecutive ranges of added lines.
  continue;
}
```

A pull request that **only deletes** a guard contributes an **empty diff range**.
Even when a rule fires on the now-unprotected sink, the mandatory CI-side filter
discards it because the sink line is unchanged. **The rule fires and the diff
layer throws the result on the floor.** SonarQube reaches the same outcome by a
different route. Semgrep's own docs: diff-aware scans consider only changes within
modified files, and cross-file analysis does not run on them at all.

Corroborating from the vendor side: Semgrep documents that removed findings *"do
not count toward the fix rate... [and] do not appear in Semgrep AppSec Platform."*
This is a deliberate product decision across the industry, not an oversight.

**Demand evidence.** Braz et al. (ESEM 2022, arXiv:2207.01942), 78 regression
vulnerabilities and 72 bug reports at Mozilla plus 5 developer interviews:
*"Software security is not discussed during bug fixes"*, *"developers do not worry
about regression vulnerabilities and assume tools will detect them"*, and dynamic
analysis found **~30%** of them.

Developers assume this is covered. It is not.

## VERDICT 2 — The formal machinery exists and does not scale

**Differential Assertion Checking** (Lahiri, McMillan, Sharma, Hawblitzel,
ESEC/FSE 2013, DOI 10.1145/2491411.2491452) states our problem exactly in its
Definition 1: a differential error exists when an input produces a **non-failing**
state in the old program and a **failing** state in the new one.

It has **never been applied to security properties**. And the line never scaled:
PASDA (JSS 2024, arXiv:2311.08071) re-evaluated the field on **141 Java pairs of
8–201 lines**, single-class, integers and doubles only — best accuracy **74%** at
**one hour per pair**. Two of the three tools it compares have no public
implementation at all.

Sixteen years of work, still on fifty-line programs. Do not claim this scales, and
do not build on it.

## VERDICT 3 — Flow-dependent taint is not tractable at our scope

**SCRBench** — 144 pre-commit changes, 107 CVEs, the one corpus matching our
setting:

| tool | score |
|---|---:|
| CodeQL | **0.6%** |
| Snyk | 0.9% |
| Semgrep | 3.7% |
| best agentic system | 17.5% |

YASA (Ant Group, production, whole-program, 4 languages): **29.3% precision**.
**Nobody computes change-scoped taint semantics.** The gap is real but it has
resisted well-funded teams, because a reachability delta honestly requires two
whole-program analyses.

The "token three frames up" case is genuine and we cannot solve it. Recorded so
nobody re-proposes it.

## VERDICT 4 — Statistical prediction of risky changes is dead

The closest published analogue is vulnerability-introducing-commit detection.

**Riom et al. (EMSE 2021, DOI 10.1007/s10664-021-09944-w)** replicated VCCFinder:
same model, same features, same recall — precision **0.92 → 0.02** purely by
swapping curated negatives for realistic ones. A **46× swing**.

Nguyen et al. (arXiv:2507.10729), 8 models: PR-AUC on Linux drops **98%**
(0.805 → 0.016). Lomio et al. (JSS 2022): AUC 0.95–1.0 while **F-measure ≈ 0**,
concluding verbatim *"the answer is: 'No'."*

Standard imbalance fixes are measured to fail — SMOTE, ROS, RUS and One-Sided
Selection all move PR-AUC by ≤0.02 and several *reduce* MCC.

**Every number above F1 0.4 in that field comes from a test set with a 30–44%
positive rate.** Reality is 0.3–1%.

**The rule to carry forward: demand the class ratio of the test set before
believing any number in this space.**

## VERDICT 5 — Agentic decomposition is not supported

**The reference point was being read backwards.** Cursor's documented rewrite went
*from* an eight-pass ensemble with majority voting and a validator *to* one agent
with tools. They **removed** decomposition. No planning stage, no sub-agents, and
their own post reports **no ablations** — *"many changes, surprisingly, regressed
our metrics."*

| component | verdict | evidence |
|---|---|---|
| deterministic scoping | **KEEP** | Snyk `CodeReduce`: **28.9% → 82.75% with the same model**. Semgrep: 43.5% vs 12.6% recall at equal precision. Agentless: +9pp at 43% of cost |
| planning stage | **DROP** | no plan-vs-no-plan ablation exists for code tasks |
| sub-agents per property | **DROP** | coordination returns go **negative** above ~45% baseline (β=−0.404) and for tool-heavy tasks (β=−0.267), p<0.001. Naptime *explicitly rejected* decomposition |
| execution verification | **carries the gain, unavailable to us** | Naptime: **0.16 → 0.32 from the sanitizer oracle alone**; only 0.32 → 0.36 from the entire agent |

**A correction to an argument made in this project:** it was claimed that advisory
output makes precision cheap. Snyk's VulnBench refutes it — **~50% of LLM-only
findings appear in only 1 of 5 identical scans**. Output that changes half its
content run to run is unreliable whether or not it gates.

---

## What to build

A **guard/egress delta detector**, triggered on lexically observable facts rather
than on a probability estimate — which is what lets it escape the base-rate
collapse that killed Verdict 4.

- **Trigger A** — the diff *adds* a call to a catalogued egress sink (log,
  telemetry, HTTP body, exception, serializer) with a non-literal argument.
- **Trigger B** — the diff *removes* a catalogued redaction, sanitisation or
  validation call, a guarding conditional, or an allow-list entry.
- **Bounded backward binding resolution**, deterministic, not agentic.
- **One narrow model question**: *"name any value here carrying a secret or
  personal datum and cite the line where it acquires that property, or answer
  NONE"* — never *"is this a vulnerability"*.

**The reframe that makes it shippable: output a substantiated fact plus a
question, not a verdict.** We can prove *"this adds an egress where there was none
and removes the call that redacted it"*. We cannot prove *"this leaks
credentials"*.

### Why the narrow question matters

Mitropoulos et al. (arXiv:2603.18740), **14,910 queries**: under neutral framing,
frontier models correctly clear already-patched clean files only **3.2–11.8%** of
the time, and **58–71%** of their "correct" detections cite an unrelated issue.
A naive *"did this weaken security?"* prompt is a false-positive machine.

### Expected precision

Guard removal **50–70%**; added egress with binding resolved **35–50%**. Bias both
down: independent re-runs cut published figures by 20–40 points, and LLM secret
detection loses **44 points** of precision from benchmark to real repositories.

### The measurement order is inverted, deliberately

**Measure the firing rate before recall.** A reversed-fix corpus is 100% positives
and structurally cannot measure false alarms. Run the detector over ordinary
**deletion-heavy refactor** pull requests and count how often it fires.

**Kill criterion: more than roughly one report per two refactor pull requests and
it is unviable at any cost**, because the true-positive base rate cannot support
it. Measuring recall first would produce an encouraging number that means nothing.

### Precedent for the corpus

IPPO (Liu et al., CCS 2021, DOI 10.1145/3460120.3485373) built our fixture
construction by hand: 40 functions, 10 deleted release calls, 10 deleted
return-value checks, 10 deleted refcount decrements, 10 deleted unlocks →
**77.5% recall on injected removals**. Reversing an upstream fix commit is sounder
here than for general defect detection, because **the reversal is the
phenomenon**.

The constraint is not supply. It is **curating negatives** — deletion-heavy
refactors — because positives alone cannot measure the number that decides
viability.

---

## CORRECTION — the design above is too narrow

Written after probing the corpus rather than reasoning from the two examples that
started this.

The examples given were *"a removed PII filter"* and *"an added bearer-token
log"*. I treated them as the specification and built a removal-shaped design
around them, partly because that is where the research found a publishable gap.
**That is letting what is researchable drive what is the product**, and it is the
error to name here.

Probing the 87 committed expectations by the *shape of the consequence* rather
than by defect category (keyword-indicative, not a classification):

| consequence shape | expectations |
|---|---:|
| widened scope — wildcard, broader catch, weaker role | **41** |
| changed shared or default state that unchanged code reads | **26** |
| weakened in place — value, operator or regex loosened | **24** |
| new code missing a check its peers uphold | **17** |
| made reachable or newly exposed | 2 |

**Removal is not the dominant shape.** Weakening *in place* — an anchor dropped
from a regex, `===` becoming `==`, a timeout raised, a role check loosened from
`isAdmin` to `isAuthenticated` — deletes nothing a deletion-trigger would catch.

### The three ways a change can hurt, of which the design covered one

1. **It weakens an invariant's enforcement** — by removal *or* by loosening in
   place. The design covered only removal.
2. **It adds code that does not uphold an invariant its peers uphold.** A new
   handler where fourteen siblings call `requireAuth` first and this one does not.
3. **It changes something unchanged code depends on** — spec 22.

Shape 2 was dismissed earlier because the missing-check literature (Chucky, Crix,
IPPO) compares peers *within one version* rather than across two, and so was filed
as "not differential". **For a pull-request reviewer that is a feature, not a
disqualification**: the codebase's own peers are the specification, the peer set
is deterministically derivable, and the output is evidence by construction —
*"fourteen sibling handlers call this first; yours does not."*

### What this means for the unit of analysis

Not "the diff". **The codebase invariant the change interacts with.** The diff is
how we find which invariants are in play; it is not the thing being judged. A
detector keyed on deletion hunks answers a question narrower than the one asked.

## Also recorded

**Spec 11 is an attack surface with a measured exploit.** An LLM-assisted
iterative refinement attack on pull-request metadata reached **100% success**; the
defence that restored detection was redacting that metadata before review. Our
redaction removes secrets and personal data — **not injected instructions**. Needs
checking properly rather than assuming the untrusted-data prompt line covers it.

**Spec 23 gained external support.** In the same study, **12 of 16** successful
rejections cited semantic contradiction between the pull request's stated purpose
and the actual code. Comparing intent against code is a measured defence.

**The field name is taken.** "Security regression testing" (Felderer & Fourneret,
STTT 2015) means deciding *which existing tests to re-run*, not detecting property
regression. Two papers exist with that title in DBLP, eleven years apart. Use
different words.
