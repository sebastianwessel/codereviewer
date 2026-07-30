# Evaluation results ledger

Append-only record of every measurement, with what invalidates it. Newest first.

Corpus `real-repo-cross-file`: **37 cases, 87 expectations** as of 2026-07-27.
Entries above the clean-corpus baseline use earlier keys (36/80, then 31/74) and
do not pool across them; the tooling refuses cross-key deltas by digest.
Raw artifacts under `.codereviewer/eval/runs/<timestamp>/eval-report.json`.

---

## 2026-07-30 — Spec 25 guarded-region context: BOTH ARMS FAIL. Delete both.

Three arms, one session, same corpus state, `real-repo-cross-file` (37 cases,
**87 expectations**). Decision rule fixed in spec 25 **before** the run.
Total spend **$5.33**.

| arm | matched | product recall | adj. precision | genuine FP | unlisted real | cost |
|---|---:|---:|---:|---:|---:|---:|
| **0** baseline | 40/87 | **46.0%** | **95.2%** | 2 | 4 | $2.23 |
| **A** signal | 42/87 | **48.3%** | 93.3% | 3 | 11 | $1.52 |
| **B** signal + callee ranking | 39/87 | **44.8%** | 90.7% | 4 | 14 | $1.57 |

Provider error rate 0.0% in all three arms.

**Every pre-registered test fails.**

- **Inside the noise band.** A is **+2.3pp**, B is **−1.2pp**; the band is
  **±4.8pp**. On 87 expectations the whole effect is **two findings** for A and
  **one** for B. That is not a result, it is the corpus breathing.
- **Adjusted precision fell, in both arms, monotonically with added context**:
  95.2% → 93.3% → 90.7%. Spec 25 makes "precision MUST NOT fall" a standalone
  disqualifier, and this is a precision-first reviewer.
- **B did not beat A** (44.8% against 48.3%), which was Arm B's own separate bar.

Per spec 25 — *"Neither arm ships on a point estimate. Both are deleted outright
if they fail"* — both arms are removed. No "off by default, revisit later".

### The cost clause was inert, and cost at n=1 is not trustworthy

No arm added packet bytes by design, and none raised cost — the **baseline was the
most expensive arm** ($2.23 against $1.52 and $1.57). Cost here tracks
nondeterministic refutation volume, not packet size. Do not read a cost ordering
off single runs; the +25% referral clause never engaged and could not have.

### Recorded as a HYPOTHESIS, explicitly NOT as a result

**Unlisted real findings rose 4 → 11 → 14** while genuine false positives moved
only 2 → 3 → 4. Both arms surfaced substantially more findings the plausibility
judge accepted as real defects but which the answer key does not list.

This is stated as a hypothesis for a **pre-registered** test and nothing more. The
primary endpoint failed; reading a secondary movement as a win afterwards is the
post-hoc rescue this ledger exists to prevent, and the same discipline was applied
to the investigative arm's precision movement on 2026-07-27. It would need its own
decision rule, fixed in advance, on a corpus whose key is complete enough to
credit the findings.

### What does NOT follow

**Spec 24 is unaffected.** Spec 25 made retirement conditional on an arm winning;
none did. The conformance capability stands or falls on its own firing-rate work.

**This is not evidence that guard-shaped changes do not matter.** It is evidence
that pointing the reviewer at them, and re-ranking retrieval toward them, do not
move recall on this corpus. Four context interventions have now failed here
(spec 16 cross-file, spec 18 scout, spec 19 un-anchored pass, spec 25 both arms)
against one framing change that worked. The pattern is worth more than any of the
individual results.

### What invalidates this entry

A corpus key change, or a fix to the answer key that credits the unlisted-real
findings — the 87-expectation key is the denominator for every number above.
Baselines measured on the earlier 30-case/42-expectation corpus (recall 54.8%) are
**not comparable** and must not be differenced against arm 0.

---

## 2026-07-30 — Conformance adjudication: both live controls pass. NOT a measurement.

First live run of spec 24's adjudication layer, real provider, real model.
**Total spend $0.007.**

| arm | divergences | requested | convention | incidental | reported |
|---|---:|---:|---:|---:|---:|
| **Negative** — this repository | 2 | 2 | **0** | **2** | **0** |
| **Positive** — synthetic handler package | 1 | 1 | **1** | 0 | **1** |

The negative arm's two divergences are the genuine ones the deterministic core
produces here — *"4 of 7 sibling declarations call `string`"* and *"…call `min`"*.
Both were rejected as incidental and the report is empty, which is the correct
output for this repository.

The positive arm survived with a reason that draws exactly the distinction the
prompt asks for:

> All cited siblings are HTTP handlers in the same file that follow the same
> request-processing pattern (auth check gate, then response). That shared
> role-level structure indicates a file-local handler convention rather than a
> coincidental similarity.

"Because of what they are" rather than "most of them do it" — the sentence the
prompt was built around.

### Why this is not a measurement, and must not be quoted as one

- **n = 3 divergences.** Two negative, one positive, one run each. This is a
  smoke test with real models, not an effect size.
- **The positive control is synthetic** — written for this purpose. No case yet
  exists where a *real* change removed a *real* convention in a *real* repository.
- **Non-determinism is untested.** Single run per arm. Comparable systems show
  ~50% of LLM-only findings appearing in only 1 of 5 identical scans, so a single
  pass says nothing about stability.
- Firing rate on benign refactors was measured for the deterministic arm only
  (0.075 per commit); the adjudicated firing rate is unmeasured.

**What is established:** the wiring is correct, the packet carries enough evidence
for a real model to draw the distinction, and both directions work end to end.
**What is not:** whether it holds on real fixtures, across seeds, or on codebases
other than a synthetic control and one schema-heavy TypeScript repository.

---

## 2026-07-27 — Convergence measured at scale: the loop does NOT raise the catch rate

10 same-file multi-defect cases on the 37-case corpus. Three arms, 12 runs each,
round one **re-measured on the current build**. $5.21 of a $12 ceiling.

**Answer: no. The catch rate does not rise materially across rounds, and what rise
there is comes from the diff shrinking, not from the repair.**

| population | round 1 | round 2 | **control** |
|---|---:|---:|---:|
| per-defect (7 unrepaired targets) | 17.9% | 21.4% | **29.8%** |
| per-case (≥1 target found) | 29.2% | 37.5% | **52.1%** |

Run-level permutation test, 200k resamples:

| comparison | Δ targets/run | p |
|---|---:|---:|
| round 1 → round 2 | +0.25 | **0.60** |
| round 1 → control | +0.83 | 0.09 |
| round 2 → control | +0.58 | 0.25 |

**Zero percent of the round-2 lift is attributable to repair.** The control —
first defect **left in the code**, merely removed from the reviewed scope — beats
round 2 on three of four cases and ties the fourth. This is stronger than the
pilot's "indistinguishable": the control is at least as good as repair everywhere.

There is a hint repair may even *cost* a little: in `netty-kqueue`, the sibling
expression being fixed appears to make the surviving buggy one less salient
(10/12 → 8/12).

### The control construction, which is what makes this trustworthy

Base = parent tree **plus the complement of the fix slice**; head = the pristine
parent tree with the first defect still present. That makes the control's diff
**hunk-identical to round 2's** — only the head tree the reviewer reads differs.
Every fix byte is the upstream maintainer's; no engine output was used.

### Rounds to clean

| outcome | cases |
|---|---:|
| clean after round 1 | **3 / 10** |
| clean after round 2 | **0 / 10** |
| clean after round 3 | **0 / 10** |
| testable but not clean | 4 / 10 |
| **structurally not convergeable** | **3 / 10** |

Those last three are the important row: repairing the found defect **removes the
target from every later diff**, because the fix hunk spans the sibling defect's
lines or empties the reviewed diff entirely. No number of rounds reaches them.

### What this settles

**The single-pass figure is the honest headline. There is no iterative figure that
beats it.** The mechanism already in this ledger is confirmed at scale: the
reviewer reports roughly one defect per reviewed diff and re-aims when the diff
changes. Two of the four arm cases produced *zero findings of any kind* once the
diff shrank.

Round 1 here is 54.9% per-defect, **not** comparable to the 64.4% headline: this
population is the in-diff expectations of multi-defect cases only, which are the
harder tail by construction.

### Limits

n=12 per arm, so what is established is that round 2 **does not beat** the
control; "the control beats round 2" is not established (p=0.25). Six of ten cases
were dropped — three because round one already found everything, three because the
target can never re-enter a diff — so the tested four are the hard tail. Single
model, single config.

---

## 2026-07-27 — BASELINE ON THE CLEAN CORPUS (37 cases / 87 expectations)

**Status: CURRENT.** First measurement against the post-contamination answer key.
Supersedes every earlier entry for comparison purposes; the key moved twice today.

| metric | value | per seed |
|---|---:|---|
| **Recall, in-diff** | **64.4%** (116/180) | |
| **Recall, out-of-diff** | **0.0%** (0/81) | |
| Blended | 44.4% | 42.5 / 48.3 / 42.5 |
| Adjusted precision | 0.872 | 0.881 / 0.913 / 0.822 |
| Genuine false positives / run | 5.7 | 5 / 4 / 8 |
| **No-finding-zone false positives** | **0** | 0 / 0 / 0 |
| Refutation kill rate | 3.2% | 4.1 / 2.9 / 2.6 |
| Cost / run | $1.41 | 2.08 / 1.10 / 1.04 |

Expectation mix: 60 in-diff, 27 out-of-diff (31% out, down from 42.5%).

### In-diff recall FELL, and that is the cleanup working

69.8% on the old key against **64.4%** here. The five cases removed for answer-key
disclosure were scoring 83.3%, so their removal was always going to lower the
headline — that is what removing a leak looks like. The six added cases are
multi-defect by construction and therefore harder. **A number that went down here
is more trustworthy than the one that went up.**

### Out-of-diff recall is 0.0% again, on a different key

0 of 81, replicating 0 of 81 on the previous corpus. Two independent answer keys,
same result: **the engine finds nothing outside a hunk.** This is now the
best-replicated finding in the ledger and should be treated as an architectural
property rather than a measurement.

### Precision improved

Adjusted precision 0.831 → 0.872 and genuine false positives 7.7 → 5.7. Some of
that is the corpus change rather than the engine. Zone false positives remain
**zero across every run ever recorded** — the engine does not invent defects in
code verified to be clean.

---

## 2026-07-27 — Independent sampling k=3 vs k=1 — FAILS, and falsifies its own premise

n=3 per arm, paired finding-level test over 80 expectations.

| metric | k=1 | k=3 |
|---|---:|---:|
| Recall | 46.25% | **48.33%** |
| Adjusted precision | **0.819** | **0.628** |
| Genuine false positives / run | **8.3** | **23.3** |
| Candidates / run | 74.8 | 127.0 |
| Semantic merge collapses / run | ~1.7 | **78.0** |
| Refutation kill rate | 1.7% | 5.2% |
| Cost / run | $1.43 | $2.38 (**+67%**) |

Recall delta **+2.08pp**, 95% CI **[−1.67, +6.25]**, 7 gained / 5 lost,
**p = 0.56**. Cost per additional matched expectation: **$0.57**.

**Verdict: remove.** Recall did not rise significantly, adjusted precision fell by
0.19, and genuine false positives nearly tripled.

### The premise was wrong, and this run measured it

Spec 21 rested on a union ceiling of "~67% against ~46% single-run" — roughly 20pp
of run-to-run variance supposedly waiting to be harvested. That figure came from a
different corpus and configuration. Measured here:

| | recall |
|---|---:|
| Single run, mean of 3 | 46.3% |
| **Post-hoc union of the same 3 runs** | **50.0%** |
| k=3 sampling inside one run | 48.3% |

**The harvestable variance on this corpus is about 4pp, not 20pp.** And k=3
captures most of it — 48.3% against a 50.0% ceiling.

### Scope of that claim — CORRECTION

The ceiling above was measured with **byte-identical packets** on every sample, so
the only diversity available was sampling randomness. It therefore bounds
**identical-input resampling**, which is narrower than the claim first written
here ("no value of k fixes that").

The published sources this spec drew on did something we did not: Cursor's v1 ran
eight parallel passes with the **diff order randomised** specifically to force
different reasoning paths, and the self-aggregation result used n=10 with a plateau
at n=5. **Input-perturbed sampling has a higher potential ceiling and is untested
here.**

The honest prediction — and it is a prediction, not a measurement — is that it
still would not pay: precision collapsed hard at k=3, the extra candidates were
distinct wrong findings rather than near-misses, and more induced diversity should
produce more of them. But nothing measured here establishes that.

### Why precision collapsed

The semantic merge fired **78 times per run**, up from ~1.7, and adjusted
precision still fell hard. So the extra candidates from independent samples are
not mainly restatements of one defect — they are **distinct wrong findings**. The
samples disagree about what is wrong, rather than agreeing about a defect one of
them happened to miss.

That is the mechanism behind the small union ceiling: run-to-run variance here is
mostly noise, not near-misses.

### On the literal decision rule

Spec 21's rule says "retain as configuration if recall rises without significance
at n=3", which would literally permit keeping this disabled-by-default. It is
removed anyway, and the deviation is deliberate: the rule was written on the
assumption that ~20pp was available. The measurement falsified that assumption, so
retaining an option nobody should ever enable would be keeping configuration
surface for a strictly worse setting.

**What survives:** the semantic finding merge was exercised hard here — 78
collapses per run — and did its job without one-sided loss. It stays.

---

## 2026-07-27 — Convergence pilot: the mechanism exists, but it is not repair

3 cases testable of 36. **A pilot, not a measurement.** $1.87.

**The reviewer reports roughly one defect per reviewed diff and re-aims when the
diff changes.** It is not blocked by the first defect and unblocked by its repair.

The control arm is what establishes this. On `pydantic-dataclass-field-flags-lost-in-translation`:

| arm | second defect found |
|---|---:|
| Round 1 — full diff, first defect present | **0 / 9** |
| Round 2 — first defect **repaired**, so out of diff | **6 / 6** |
| Control — first defect **still present**, merely out of diff | **5 / 6** |

Round 2 and the control are indistinguishable. **The cause is the diff shrinking,
not the repair.** Round 1 produced exactly one finding per run with zero false
positives.

Operationally the iterative loop still works, because in a real pull request
fixing a defect *is* what removes it from the diff. But the honest description is
scope redirection, not unblocking — and that distinction determines what fixtures
must control for.

### The other two cases

- `rack-static-header-rules-match-encoded-path` — **negative.** The found defect
  was repaired; the two remaining in-diff expectations stayed at 0/6. Notable:
  in 5 of 6 round-2 runs the engine relocated to the exact added line of
  expectation 1 but made a different claim, scored unlisted-real. Attention moved;
  semantics did not match. A more permissive matcher would call this partial
  convergence — the result is sensitive to that boundary.
- `laravel-eloquent-dictionary-key-not-normalized` — **uninformative, then
  negative.** Round 2 found the next defect 2/3, but fresh round-1 replications
  also found it 2/3 despite the archive showing 0/3. Round 3 stalled at 0/3.

### The methodological finding, which matters more than the result

**Fresh round-1 replications, not the archive, are what kept this honest.** Three
archived runs said 0/3 for an expectation six fresh runs found twice. Trusting the
archive alone would have produced a false positive for laravel.

**Any future convergence fixture MUST carry a diff-narrowing control arm** — the
defect left in place, merely removed from the reviewed scope. Without it, a
convergence measurement measures scope, not repair, and will overstate the loop.

### Why the tested set is biased

Three of six candidate cases were skipped because the engine *already* found every
in-diff expectation, or because repairing the found defect pushed the target out
of the diff entirely. Skips correlate with cases the engine handles well, so the
tested set is biased toward hard cases.

---

## 2026-07-27 — Discovery posture: `investigative` vs `precise` — FAILS ITS RULE

n=4 per arm, paired finding-level test over 80 expectations.

| metric | `precise` | `investigative` |
|---|---:|---:|
| Recall | **45.94%** | **44.69%** |
| Adjusted precision | 0.819 | **0.873** |
| Raw precision | 0.669 | **0.748** |
| Genuine false positives / run | 8.3 | **5.3** |
| Candidates / run | 74.8 | **70.8** |
| Refutation kill rate | 1.7% | 3.5% |
| Cost | $1.32 | $1.36 |

Recall delta **−1.25pp**, 95% CI **[−4.38, +1.25]**, 5 gained / 5 lost,
**p = 1.0000**.

**Verdict under spec 20's pre-committed rule: remove.** The rule reads "remove if
recall does not rise". Recall did not rise.

### The intervention did not do what it was designed to do

The posture was meant to *lower* the reviewer's self-evidence bar and therefore
raise candidate volume. **Candidate count fell**, 74.8 → 70.8. So this did not
test "widen discovery and see whether the gate absorbs it" — discovery never
widened. The added paragraph appears to have made the reviewer more careful, not
less, plausibly because it repeats that severity must reflect impact rather than
confidence and asks the reviewer to state what it could not determine.

A future attempt at this idea should first demonstrate, on a handful of cases,
that the prompt actually raises candidate count, before spending on an arm.

### This was not a faithful test of the source — CORRECTION

The idea came from Cursor's documented v1 → agentic rewrite, which changed **two**
things: it replaced a fixed pipeline with an agent that **calls tools and decides
its own investigation depth**, and it made prompting aggressive.

**We implemented only the prompt.** This engine's discovery lane is single-shot
and tools-off by design, so the reviewer was instructed to "investigate every
suspicious pattern" **with no mechanism to investigate anything**. That is a
plausible reason candidate count fell rather than rose: words were added, not
capability.

So what failed here is a prompt. **The source's actual approach — aggressive
prompting paired with an agent that can act on the instruction — remains untested
in this engine**, and this entry must not be cited as evidence against it.

### The precision movement is NOT a reason to keep it

Adjusted precision rose 0.819 → 0.873 and genuine false positives fell 36%, at
equal cost. That is a post-hoc reading of an experiment that failed its primary
endpoint, on the arm whose candidate count happened to fall — the classic shape of
a finding that does not replicate. Keeping a feature on this basis is exactly how
measurement discipline erodes, and five interventions have already been removed
under this rule.

Recorded as a hypothesis worth its own pre-registered test — *does an instruction
that makes the reviewer more explicit about uncertainty improve precision at no
recall cost?* — not as a result.

---

## 2026-07-27 — Baseline after harness-wide conversation-history suppression

**Status: CURRENT.** This is the reference baseline for all subsequent arms.

| metric | value | per seed |
|---|---:|---|
| Recall (blended) | **46.3%** | 48.8 / 43.8 / 46.3 |
| **Recall, in-diff** | **73.9%** (102/138) | |
| **Recall, out-of-diff** | **8.8%** (9/102) | |
| Adjusted precision | 0.831 | 0.813 / 0.875 / 0.804 |
| Raw precision | 0.666 | 0.639 / 0.673 / 0.685 |
| Genuine false positives | 7.7 / run | 9 / 5 / 9 |
| Refutation kill rate | **0.9%** | 0.0 / 1.4 / 1.4 |
| Cost | **$1.43** / run | 2.20 / 1.05 / 1.03 |

n=3 seeds. Config: defaults — posture `precise`, `discoverySampleCount` 1,
security pass off, cross-file retrieval off.

### What changed since the previous baseline, and what it did

Paired finding-level comparison against the six history-carrying runs
(same corpus, same answer key):

| | value |
|---|---|
| before / after recall | 46.25% / 46.25% |
| delta | **−0.00pp** |
| 95% CI | [−3.13, +2.71] |
| gained / lost | 7 / 5 |
| p | **0.56** |

**Conversation-history suppression changed nothing measurable in accuracy, and
cut cost by 26%** ($1.92 → $1.43).

**A hypothesis this refutes.** It was argued — by me, at some length — that
refutation was rubber-stamping because it opened each call holding discovery's
findings *attributed to itself*, and that self-consistency pressure would bias it
toward `proved`. If that were the dominant effect, removing the history should
have raised the kill rate. It did not: 1.3% → 0.9%, and adjusted precision moved
within noise. **The ~1% kill rate is a genuine property of the pipeline, not an
artefact of contaminated context.** Refutation rarely finds anything to kill
because discovery rarely proposes anything speculative.

The change is still correct — the stages are specified to judge independently and
now do — and the 26% cost reduction is real. But it must not be described as an
accuracy improvement.

---

## Pre-2026-07-27 measurements: VOID for accuracy comparison

Every earlier figure was produced with conversation history forwarded into every
agent call. The paired test above shows the effect on recall was nil, so those
numbers are not *wrong* — but they were measured on a different pipeline and are
superseded by the baseline above. Cost figures from that period are inflated by
roughly 26%.

Additionally, every adjusted-precision figure recorded before the restatement
collapse landed (`EVAL_METRICS_VERSION 2026-07-27.plausibility-restatement-collapse`)
counted a reviewer's restatements of one defect as separate real findings, and
therefore overstated adjusted precision. Reports across that boundary do not pool.

### Un-anchored discovery pass A/B — REMOVED

+0.83pp recall (CI [−3.13, +4.79], 10 gained / 9 lost, p=0.82) for +136% cost.
Failed its pre-committed rule; the pass was removed. Detail:
`2026-07-27-unanchored-pass-ab-result.md`.

What survives it: refutation absorbed a 56% candidate increase, kill rate rising
1.3% → 16.0%, with adjusted precision holding — so the gate has headroom. And the
semantic finding merge collapsed 19.3 restatements per run with no one-sided loss.

### Untrusted-input guard — re-priced

First reported as +18.8pp (62.5% → 81.3–87.5%) on a 16-finding corpus. On the
133-finding benchmark the archived paired arms `crbA-guard-on.json` /
`crbB-guard-off.json` give 48 matched against 43 — 36.1% vs 32.3%, **+3.8pp**.
The larger figure was mostly small-corpus noise. Plan against +3.8pp.

---

## Standing caveats for reading anything here

- **Variance.** sd ≈ 4.8pp on this corpus. An effect below roughly 10pp cannot be
  resolved at n=3. Several arms above are smaller than the instrument.
- **The blended recall figure is not interpretable on its own.** 42.5% of
  expectations lie in unchanged code; the blended number depends on that ratio
  rather than on reviewer quality. Read the in-diff and out-of-diff rows.
- **Adjusted precision is an estimate, permanently.** Under an incomplete answer
  key, precision is not identifiable — raw precision is the lower bound and
  adjusted the upper. Report the pair.
