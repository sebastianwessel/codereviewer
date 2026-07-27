# What Limits Recall

This engine's recall is not limited by what it can understand. It is limited by
**how many defects it will enumerate in one file**, and the investigation that
established that is the most consequential measurement this project has run.

This page is the high-level account: what the engine is reliably good at, what
the enumeration limit is and how it was proved, what ceiling it puts on any
single review, what has been tried against it, and how those verdicts are
decided. Numbers here name their source; the raw runs are in
[Current results](current-results.md).

> **Every number on this page predates a harness change that has not been
> re-measured.** See [A caveat that applies to every number
> here](#a-caveat-that-applies-to-every-number-here) at the end. It is not a
> footnote — read it before quoting anything.

---

## What the engine is good at, and what it is not

Three things are consistently true across every corpus and every seed measured
so far. The first two are strengths, and the third is the whole problem.

**It is precise, and it does not invent problems.** Adjusted precision measures
97.3–100% on the real-repository corpus, and across every run of that corpus the
engine has raised **zero** false alarms on the ten curated zones that contain no
planted defect (2026-07-26, [Current results](current-results.md#headline)).
Precision is bought at refutation and admission, so discovery can afford to lead
with recall — see [Why precision first](../01-overview/why-precision-first.md).

**It reliably finds the primary defect in a changed region.** Pooled over nine
runs of the 36-case / 80-expectation real-repository corpus, the *first*
expected finding in a file is matched **72.8% of the time** (308 of 423).

**It does not enumerate.** Any *later* expected finding in the **same file**
is matched **4.7% of the time** (14 of 297). The gap is not fatigue or file
size: a later expected finding in a **different** file of the same case is
matched **79.8% of the time** (79 of 99) — *higher* than a first one.

| Slice, pooled over nine runs | Recall |
| --- | ---: |
| First expectation in its file | **72.8%** (308 / 423) |
| Any later expectation in the **same** file | **4.7%** (14 / 297) |
| Later expectation, but first in a **new** file | **79.8%** (79 / 99) |

Source: `reports/2026-07-27-enumeration-gap-and-improvement-plan.md`, nine runs,
36 cases, 80 expectations, 720 expectation-instances, independently reproduced.
That corpus is now 37 cases and 87 expectations: five cases were removed on
2026-07-27 because their reviewed diff deleted a comment naming the defect, and
six convergence cases were added the same day, so every recall figure on this
page predates the current answer key and none of them is comparable to a run
against it.

Two consequences follow, and both correct earlier readings of this engine.

- **The defect-type axis collapses once file rank is controlled for.** Six
  defect types score 69–100% on the first expectation in a file and **exactly
  zero** on any later one: boundary/off-by-one, branch asymmetry, concurrency,
  missing validation, resource release, and caller/callee contract. A "we are
  weak at type X" reading was measuring how often type X happened to appear
  second in a file.
- **It is not severity-ranked either.** Found-then-missed pairs exist in the
  same file and the same defect type where the *missed* one is equal or higher
  severity — a medium-severity missing `try/finally` was found in all nine runs
  while a high-severity release that never happens at all, in the same file, was
  found in none. In one case a **low**-severity expectation was found nine times
  out of nine while two mediums in the same file were never found.

So the engine is not choosing the most important defect and stopping. It is
answering once and stopping. Had the first-in-file rate held throughout, pooled
recall over those nine runs would be roughly **72.8% rather than the 44.7% they
actually scored** — which makes enumeration worth more than every capability gap
combined.

---

## The central finding: attention follows the diff

The obvious explanation for "one defect per file" is that the reviewer reads the
start of a file and loses attention later. A controlled experiment on
2026-07-27 tested that and found something different and more actionable.

**Design.** Production model and production prompt, temperature 0. Each file was
cut into review units by a rule fixed in advance — 60-line windows from line 1,
stride 40 — that reads nothing but the file's line count, so no answer key could
have influenced where the boundaries fell. Two arms:

- **Arm A** — the production packet with the file section replaced by a single
  window. **The whole-file diff was still present, exactly as production sends
  it.**
- **Arm B** — the window alone, with the diff withheld.

**The decisive number.** Only **16 of 76 Arm A candidates (21%)** pointed at a
line inside the window they were shown. In Arm B, **50 of 50 (100%)** did.

The individual cases are starker than the aggregate. One 1251-line file was cut
into 31 windows; every one of the 31 returned exactly one finding, all of them
at **line 820** — including the window covering lines 1201–1251, where line 820
is four hundred lines away and **not present in the packet at all**. Another
file did the same thing across all 14 of its windows.

The reviewer is not reading a file and stopping early. **It is answering the
diff and never reading the rest.** On this corpus, "one defect per file" is
really *one defect per diff hunk*, and most of these diffs are one or two lines.

The cleanest demonstration is a single 84-line file, same model, same prompt,
same temperature, where the only variable is what the packet contained:

| Presentation | First expectation | Second expectation |
| --- | --- | --- |
| Production (whole file + diff) | 7 / 9 | **0 / 9** |
| Arm A (60-line window + diff) | 2 / 2 | **0 / 2** |
| Arm B (60-line window, no diff) | **0 / 2** | **2 / 2** |

The model can detect the second defect, and never exercises that capability
while the first is anchored by the diff. That is attention, demonstrated by
construction rather than inferred.

**What the experiment does not establish.** It was one run at n=1 per window
against a measured variance band. Arm B moved two variables at once (unit size
*and* the diff) and lost six of seven controls, so it is a weak instrument whose
negatives prove nothing — only its positives count. The seven files were chosen
for language spread rather than at random, five of the six diffs are one- or
two-line hunks, and match judgements were made by hand rather than by the
scoring judge. And some of the gap is not addressable by decomposition at all:
in one file two missed expectations sit inside the same 25-line function, where
no window scheme of any size separates them.

Source: `reports/2026-07-27-enumeration-gap-and-improvement-plan.md` §5.2.

---

## The structural ceiling, and why it changes how you should use the tool

If a reviewer surfaces one defect per file per round, then the answer key itself
sets a hard ceiling on what any single review can score.

The real-repository corpus holds **87 expected findings across 49 distinct
(case, file) pairs** — 21 files carry one expectation, 20 carry two, 6 carry
three and 2 carry four (recomputed from the committed corpus manifest,
`eval/corpora/real-repo-cross-file/manifest.json`, on 2026-07-27; it is a
deterministic count of committed data, not a measurement).

| Rounds of review, one defect per file per round | Expectations reachable | Ceiling |
| --- | ---: | ---: |
| One | 49 / 87 | **56.3%** |
| Two | 77 / 87 | **88.5%** |
| Three | 85 / 87 | **97.7%** |

Measured single-pass recall was **46–47%** on the 36-case corpus this table no
longer describes — about **80% of the one-pass ceiling**, not 47% of some
notional perfect score. The ceiling barely moved across two key changes on
2026-07-27, five cases removed for answer-key disclosure and six convergence
cases added ([datasets](datasets.md#real-repository-cross-file-corpus)); the
recall figure has not been re-measured against either key. That reframes the
headline considerably: the distance between the engine and its own structural
limit is much smaller than the distance between the headline and 100%.

**This makes the iterative pull-request loop the dominant strategy.** Review,
fix what came back, push, review again. Each round starts from a changed diff,
so the anchor moves and the next defect in that file becomes the one the
reviewer is pointed at. A CI setup that keeps the merge gate closed until the
review comes back clean therefore extracts substantially more than a single
advisory pass does — the ceiling table above is the argument for it, and it is
why the exit-code contract in [Running in CI/CD](../04-guides/ci-cd.md) is worth
wiring into a required check rather than a comment.

**Be careful with the second and third rows.** They assume that fixing one
defect in a file causes the next one to surface on the following round. That
assumption is consistent with the attention finding — a new diff is a new
anchor — but **it has not been measured**. What is measured is the one-pass
ceiling and the current position against it. Treat 88.5% and 97.7% as the shape
of an argument for iteration, not as a forecast. The corpus can now carry that
measurement where it could not before: **10 of its 37 cases hold two or more
in-diff expectations in one file**, against two before the 2026-07-27 capture.

---

## What has been tried against it

Seven structural interventions have been built. **Six were measured and failed**;
the seventh, the context scout, was never validly measured at all. Five were
removed outright, and the two that remain switched-on-able ship off by default with
a recorded verdict. What has actually moved the number has been prompt-level and
scoring-level, at a fraction of the cost.

### Structural interventions

| Approach | What it changed | Measured result | Status |
| --- | --- | --- | --- |
| **Enumeration sweep** | Re-asked the same question, minus what was already reported, within one conversation carrying the prior findings | 30-case / 42-finding corpus, 3 seeds: **54.8%** against a **54.8%** baseline, at **+40% cost** | **Removed** — code and config keys deleted |
| **Diverse-lens pass** | Asked a *different* question over the same packet: concurrency, asynchrony, error paths, resource lifetime, contracts, edge cases | Same corpus, 3 seeds: **54.0%** against **54.8%**, at **+47% cost** | **Removed** |
| **Cross-file retrieval** | Gave discovery mediated repository read/list/grep tools so it could fetch other files on demand | Three measurements on the corpus built to favour it: flat at 4 cases (2.5× cost), **66.7% → 44.4%** at 9 cases, **68.8% → 56.3%** at 16. Precision stayed 100%, so the loss is recall | **Net negative.** Retained, off by default, documented as *do not enable* |
| **Context scout** | Separated retrieval from reasoning: a cheap call chooses which out-of-change symbol bodies to pre-fetch, deterministic code fetches them, the reviewer stays single-shot and tool-free | **None. Its only A/B is void** — run against a build that did not implement its own spec, and predating the suppression of conversation history. It has no result in either direction | **[Removed](../03-concepts/optional-capabilities/context-scout.md)** on mechanism, not on a failed measurement |
| **Dedicated security pass** | A second, security-only discovery call per task, merged additively | 2026-07-24, full benchmark, n=1, **+61% cost**: overall recall **24.8% → 29.3%** with 22 additional confirmed-real findings, but labeled security recall **14 → 12** and authorization **8 → 6** | **Mixed.** Retained, off by default; the security-specific lift it was built for is **unproven** |
| **Un-anchored discovery pass** | The same question at bounded units **with the diff withheld** — built directly on the attention finding above | 36-case / 80-expectation corpus, base n=6 against enabled n=3: **+0.83pp** (46.25% → 47.08%), 95% CI **[−3.13, +4.79]**, **10 expectations gained and 9 lost**, **p = 0.82**, for **+136% cost** | **Removed** |
| **Independent sampling** | Ran discovery *k* times per task, blind to each other, and kept the union — no vote, no agreement threshold | Same corpus, 3 seeds per arm at *k* = 3: **+2.08pp** (46.25% → 48.33%), 95% CI **[−1.67, +6.25]**, **p = 0.56**, while adjusted precision fell **0.819 → 0.628** and genuine false positives nearly tripled, for **+67% cost**. It also measured the union ceiling it was built to harvest at **~4pp, not the assumed ~20pp** | **[Removed](../03-concepts/optional-capabilities/independent-sampling.md)** |

The last row is the important one, because the diagnosis behind it was correct
and the intervention still failed. Taking the diff away demonstrably makes the
reviewer read the code it is handed. At corpus scale, what it then finds is
mostly **not** what the answer key lists: 42 extra candidates per run yielded
approximately zero net expectations. Ten gained against nine lost is a coin
flip, and the corpus had been recorded *in advance* as close to the best case
for the change — median 7 changed lines per case, median 2 hunks, 17 of 36 cases
single-hunk — which is precisely where removing the anchor has the most to add.
A pass that does not help there is not expected to help elsewhere.

Detail on the three measured removals, including what a future attempt should
avoid rebuilding, is kept in
[Extra discovery passes (removed)](../03-concepts/optional-capabilities/extra-discovery-passes.md).
The fourth removal, the context scout, is the one without a valid measurement
behind it and has
[its own record](../03-concepts/optional-capabilities/context-scout.md).
The retained switches are in the
[optional capabilities decision table](../03-concepts/optional-capabilities/README.md#decision-table).

### What worked instead

| Change | What it changed | Measured result | Status |
| --- | --- | --- | --- |
| **Untrusted-input guard** | A single added instruction in the discovery prompt | Recall **62.5% → 81.3–87.5%** on the 16-case corpus at identical cost with no precision loss, replicated | **Kept, always on** |
| **Semantic finding merge** | A separate model call groups candidates that describe one defect; the representative is chosen deterministically in code, never by the model | Validated under the only load that tests it: collapses rose **1.7 → 19.3 per run** under a 56% candidate increase, with no one-sided loss | **Kept** |
| **Restatement collapse in scoring** | The plausibility judge now sees every finding already credited real in the same file and rules out restatements of them | Across nine archived runs, **89 of 164 (54.3%)** confirmed-real unmatched findings sat within three lines of a finding already matched in the same file, and 63 repeated a `path:line` already credited in the same run | **Kept.** Scoring only; the metrics version was bumped so new reports do not pool with old ones |

**A contradiction worth stating rather than smoothing over.** The untrusted-input
guard is recorded twice at very different corpus sizes. The 62.5% → 81.3%
movement is +18.8pp on a 16-finding corpus; this documentation's own variance
section records that a prompt change reported as worth +18.8pp on a 16-finding
corpus measured about **+3.8pp** when re-measured on 133 findings
([Current results](current-results.md#variance-why-single-runs-prove-little)).
The two figures describe the same movement at two resolutions. **The
larger-corpus figure is the one to trust**; the smaller one is largely that
corpus's own noise. The guard is worth keeping either way — it costs nothing —
but "+18.8pp from one prompt line" overstates it.

The pattern across both tables is consistent and is the main thing to carry
away: **framing has outperformed structure in this engine, at a fraction of the
cost.** Every structural intervention added calls, tokens, or context and bought
between nothing and noise. The changes that moved the number changed what the
reviewer was asked, or what the scoring counted.

### Framing is cheap, not automatic

| Change | What it changed | Measured result | Status |
| --- | --- | --- | --- |
| **Discovery posture** | One appended paragraph lowering the evidence bar the reviewer applied to *itself*, at unchanged call count and packet | 36-case / 80-expectation corpus, 4 seeds per arm: **45.94% → 44.69%**, 95% CI **[−4.38, +1.25]**, 5 gained and 5 lost, **p = 1.0**. Candidates per run **fell**, 74.8 → 70.8 | **[Removed](../03-concepts/optional-capabilities/discovery-posture.md)** |

The posture is the counterexample that keeps the sentence above honest: a prompt
change costs almost nothing, and it can still fail. It failed in an instructive
way — it was built to *widen* discovery and the candidate count went **down**, so
the arm never tested the mechanism it was written for.

It also came from a source we implemented only half of: that source paired
aggressive prompting with an agent that **calls tools and chooses its own
investigation depth**, and this engine's discovery lane is single-shot and
tools-off. The reviewer was told to investigate with no way to investigate.
**What failed here is a prompt, not the idea.**

### Two results that outlived the interventions that produced them

Neither of these is a feature. Both are measurements that any future attempt at
this problem should start from rather than repeat.

- **The refutation gate has large unused capacity.** Under a 56% increase in
  candidate volume its kill rate rose from **1.3% to 16.0%** while adjusted
  precision held (0.804 → 0.792). The corollary is uncomfortable and worth
  stating: **this engine's precision does not come from refutation, it comes
  from discovery being conservative.** That couples precision and recall to one
  dial, and it explains why every "find more" attempt so far has cost precision.
- **The semantic merge is load-bearing the moment discovery is widened.** At
  19.3 collapses per run, roughly nineteen restatements of already-reported
  defects would otherwise have reached the reader.

---

## How claims are decided here

The verdicts above are cheap to accept now because the rule was written down
before each run rather than after it.

**Decision rules are fixed in advance.** Each measured change is specified with
a three-way outcome before any provider spend: *ship enabled* requires recall to
rise with the paired test clearing significance, adjusted precision and genuine
false positives not to degrade, and a defensible cost per additional matched
expectation; *retain as configuration* requires at minimum a genuine recall
rise; anything else is *removed*. Five interventions have now failed that rule.
That is the rule working.

**A change that fails its pre-committed rule is removed, not kept "just in
case".** An option nobody can justify enabling is permanent configuration
surface, documentation, and test burden with no counterpart. Three of the six
interventions above no longer exist in the codebase, and their configuration
keys were deleted from a strict schema, so a config file that still sets one
fails validation rather than being silently ignored.

**Significance is paired at the level of the individual expected finding**, not
compared between run means. Each expectation is keyed by case and index and
tracked across every seed of both arms, so the test asks how many expectations
*changed side* — the un-anchored A/B's "10 gained, 9 lost, p = 0.82" is that
test, and it is far more informative than the +0.83pp difference of means it
accompanies. See [Comparing runs](comparing-runs.md#deciding-whether-a-change-ships).

**The variance band is measured, and it is larger than most of the effects
worth chasing.** Identical configurations differ by roughly 5 percentage points
of recall seed to seed, which puts the resolution of a three-seed comparison at
about ±5.5pp. An effect below roughly 10 points is **unmeasured** at n=3, not
absent — and saying so is different from reporting the direction of the noise.
Two of the removals above are explicitly *unproven, not disproven*.

---

## A caveat that applies to every number here

Until 2026-07-27, the review harness forwarded the accumulated session
conversation into every agent call. Each stage received the JSON output of every
call that had finished before it — across tasks and across stages — **attributed
to the model itself**. A refutation call therefore opened appearing to have
already asserted the very candidates it was about to adjudicate, and, from the
second task onward, holding its own earlier verdicts. That is incompatible with
the refuter's own instruction to judge each candidate strictly on its own
merits, and with discovery's requirement to be uninfluenced by what another
discovery call answered.

Forwarding is now suppressed **harness-wide**: no review agent call carries
prior conversation, as a default rather than a per-call option, so a stage added
later inherits it and a stage that genuinely needs history must opt in where the
reason is visible.

The consequence is unavoidable and must not be glossed:

> **Every recall and precision figure this project has ever published was
> produced with history-carrying stages. None of them is comparable to a current
> run.** That includes every number on this page and in
> [Current results](current-results.md).

**It is not an accuracy improvement.** The behaviour was removed because it
contradicted what those stages are specified to do, **not** because it was shown
to be harmful. A paired re-baseline against the six history-carrying runs
afterwards measured **−0.00pp** recall (95% CI [−3.13, +2.71], 7 gained and 5
lost, p = 0.56) and a **26% cost reduction** ($1.92 → $1.43 per run). The cost
saving is the real benefit; the accuracy claim is that nothing moved. Any A/B on
this engine still has to re-baseline rather than reuse a prior arm.

A hypothesis this refutes, stated because it was argued at length: that refutation
was rubber-stamping because it opened each call holding discovery's findings
attributed to itself. If that were the dominant effect, removing the history should
have raised the kill rate. It did not — 1.3% → 0.9%. **The ~1% kill rate is a
genuine property of the pipeline**, not an artefact of contaminated context.
Refutation rarely finds anything to kill because discovery rarely proposes anything
speculative.

Source: `specs/05-review-workflow-and-runtime.md`, *Harness Runtime →
Conversation History*.

---

## See also

- [Current results](current-results.md) — the measured numbers, with their dates and corpora
- [Comparing runs](comparing-runs.md) — the variance band and the decision procedure
- [Extra discovery passes (removed)](../03-concepts/optional-capabilities/extra-discovery-passes.md) — the record of the three removals
- [Discovery posture (removed)](../03-concepts/optional-capabilities/discovery-posture.md) — the framing change that failed, and why that is not a verdict on the idea
- [Independent sampling (removed)](../03-concepts/optional-capabilities/independent-sampling.md) — the union ceiling measured, and what that ceiling does and does not bound
- [Optional capabilities](../03-concepts/optional-capabilities/README.md) — the three retained switches and their verdicts
- [Holistic discovery](../03-concepts/pipeline/04-holistic-discovery.md) — what discovery does today
- [Running in CI/CD](../04-guides/ci-cd.md) — wiring the iterative loop into a gate
