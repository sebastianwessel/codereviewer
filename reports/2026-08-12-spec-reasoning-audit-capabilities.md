# Spec reasoning audit — capability specs (12, 13, 15, 16, 17, 22–31)

Date: 2026-08-12
Scope: `specs/12`, `13`, `15`, `16`, `17`, `22`, `23`, `24`, `25`, `26`, `27`, `28`,
`29`, `30`, `31`. Foundations specs (00–11, 14) were audited separately.

**This is not an alignment audit.** The question is not "does the spec match the
code" — that was answered earlier today. The question is whether the specs are
*right*: is the reasoning valid, does the cited evidence support the claim, and is
anything simply missing. Every finding names a concrete consequence — something the
engine does or does not do, or a decision a person would make wrongly by trusting
the spec.

Method: spec claims were checked against `reports/eval-results-ledger.md` and the
`reports/` corpus, not against plausibility. Where a spec cites a number, the ledger
was read **forward** to the latest entry on the same subject, because several of its
verdicts were later reversed or superseded. Read-only; no provider call, no eval run,
no spend. **No spec was edited.**

---

## F1 — Spec 23: the containment list for the false-satisfied route contains the wrong things

**Spec 23, lines 508–520** (*Consequence for the capability*).

**The claim.** The lane ships a measured, named failure mode rather than a
mitigation; the default flipped on 2026-08-11 so the failure now reaches every
reader; and this is defensible because *"what contains it is unchanged"* — four items
are listed: (a) the lane cannot gate under any configuration, (b) its output is
advisory, (c) an `evidenced` verdict whose cited lines are not lines the change
touched is downgraded and counted, (d) the judgement call returns no free text.

**Why the reasoning fails.** Spec 23 itself defines the failure mode, at lines
837–844: *"The dangerous output is not 'missed an obligation'. It is **confidently
asserting an obligation is satisfied when it is not**, because that stops a human
looking."* The damage is located in a human's head. Test each containment item
against that damage:

- **(a) and (b) contain pipeline damage, not this damage.** "Cannot gate" and
  "advisory" mean the run does not fail a build. A reviewer who reads `evidenced`
  and stops checking is harmed identically whether or not the pipeline is red. These
  two items answer a question the failure mode does not ask.
- **(c) is the item spec 23 measured to be blind to this exact route.** Forty lines
  earlier, at lines 555–563: *"**Every structural guard passed.** `unevidencedAddressedCount`
  and `uncitedObligationCount` were zero in all 34 runs. Both citations were real
  lines the change really touched. The existing check asks 'is this a line the change
  touched?' and cannot ask 'is this line evidence for THIS claim?' — and the failure
  lives entirely in the gap between those two questions."* The containment paragraph
  cites as a container the one check the spec has already recorded as unable to see
  the failure. This is not a weak argument; it is a self-contradiction inside one
  document.
- **(d) contains the opposite error.** "No free text on the judgement call" exists to
  suppress the measured over-rejection mechanism (26–36% rising to 73–88%, lines
  750–754). Over-rejection produces false *not-evidenced* — the cheap direction this
  spec explicitly ranks as harmless. It does nothing about false *evidenced*.

So of four items offered as containing the false-satisfied route, two contain a
different damage, one was measured blind to it, and one contains its inverse. **The
containment argument rules out nothing a reader will take it to rule out.**

**Concrete consequence.** A product owner reading this paragraph concludes the
2026-08-11 default flip was cheap because the risk is fenced. It is not fenced. The
lane is now on for every review, and the last measurement of the route — 4 false
satisfied verdicts over 34 cases (ledger, 2026-07-31) — predates two changes the spec
itself says *widen* the route (`not-contradicted`, lines 526–533, "**it widens the
surface that route applies to**"). Nothing in the containment list narrows what a
reader takes from a wrong `evidenced`.

**What I believe is correct.** The things that genuinely act on the reader's head
already exist in this spec and are simply not in this list:

- *The Output Is A Search Result, Not A Certificate* (lines 706–740) — the report MUST
  NOT certify completion, and `notEvidencedCount` (not a satisfied count) is the
  headline;
- the *Output Vocabulary* change (lines 20–71) — `evidenced` names what the run saw,
  where `addressed` answered a question the engine never asked;
- the explanation-call prohibition (lines 167–174) — the free-prose surface may not
  write absence of evidence as work undone.

Those are reader-facing and they are the real containment. The paragraph should list
those, drop (c) as measured-blind, and say plainly that **none of them reduces the
RATE of a wrong `evidenced` — they change only what a reader is licensed to conclude
from one.** (a), (b) and (d) belong in the paragraph as what they are: containment of
pipeline damage and of the over-rejection mechanism, which are different failures.

---

## F2 — Spec 23: the ship gate is stated on a quantity the spec's own instrument declares permanently unmeasurable

**Spec 23, line 881** against **lines 941–949**.

**The claim.** Line 881: *"Decision rule, fixed before the first measurement: **ship
only if the false-satisfied rate is low.**"* Lines 867–879 define that rate: *of
obligations reported as `evidenced` or `not-contradicted`, how many are not addressed
at head.*

Lines 941–949, written 2026-08-12: *"This section defines the false-satisfied RATE
over every obligation reported `evidenced` or `not-contradicted`. That denominator is
**permanently not measurable on this corpus**… The field is present and carries
`status: "not-measured"` with that reason. The share the report does print names its
own denominator — the outstanding obligations the run reached — and **is not this
rate**."*

**Why the reasoning fails.** The new instrument section is scrupulously honest about
what it cannot compute — and then the spec leaves the ship gate pointing at exactly
that quantity. The lane **already shipped on by default** (2026-08-11), one day before
the instrument that says its gate cannot be evaluated. The spec never restates the
gate on something computable, never says the gate is suspended, and never says the
default flip was taken without it. Verified in the renderer: the summary prints
`| ...as spec 23 defines the rate | not measured (…) |`
(`src/domains/evaluation/intent-eval/intent-eval-rendering.ts:69`).

**Concrete consequence.** Someone running `codereviewer eval intent` to decide whether
this lane is safe to keep on by default gets a report on which the deciding number is
literally rendered as "not measured", with no stated substitute. There is no
executable path from the measurement to the decision. The gate cannot fail, which
means it cannot pass either.

**What I believe is correct.** State the gate on what the instrument produces and what
the spec ranks first: **the false-satisfied CLAIM COUNT over the fixed human
enumeration**, with a numeric bar pre-registered before the run (e.g. *≤ N of 67
enumerated outstanding obligations may be cleared by an `evidenced` or
`not-contradicted` verdict*). Keep the rate as the ideal and record that it is not
obtainable without one hand judgement per reported obligation per run. Then say
explicitly that the 2026-08-11 default flip was made without either number, which the
spec is otherwise careful to say everywhere else.

---

## F3 — Spec 23: the post-hoc "control" arm cannot register the endpoint the spec ranks first

**Spec 23, lines 908–911**: *"The post-hoc arm judges the same diffs against each
change's own commit message and is a control, reported separately and never pooled."*

**Why the reasoning fails.** The answer key is defined at lines 913–918 as the fixed
human enumeration of obligations *"a human read in the excerpt and found genuinely not
done at head"*. A commit message is written after the work, so — as the renderer itself
says — *"obligations read out of one are addressed by construction"*. The corpus bears
this out exactly: verified against `eval/corpora/intent-fulfilment/manifest.json`,
**all 7 post-hoc cases carry ZERO `outstandingExpectations`**; all 67 rows sit in the
21 pre-written cases (and 6 of those 21 also carry zero, so 15 cases hold the whole
key).

A control arm with an empty answer key cannot produce a false-satisfied claim and
cannot produce an outstanding-recall figure. It cannot differ from a vacuous pass on
either endpoint. The spec never states what this control controls *for*, and no metric
in the report can express the contrast it is presumably meant to demonstrate.

**Concrete consequence, and it is a live rendering.** The arm guard fires only on
`scoredCaseCount === 0` (`intent-eval-rendering.ts:51`), not on
`expectationCount === 0`. The rates are correctly `not measured` (the scorer returns
`not-measured` when `total === 0`, `intent-eval-scoring.ts:145`), but
`falseSatisfied.claimCount` is a plain integer and prints **`false-satisfied claims:
0`** — bolded, first row, in the arm whose key has no rows. The document's own preamble
says *"the claim count leads every table below… the metric the decision rule is stated
on."* A reader skimming two tables sees a bold zero on the deciding metric, produced by
an empty denominator. That is precisely the silent-optimism shape this project has a
standing rule against, and spec 23 requires the callout for the sibling case — lines
263–266, on `not-contradicted`: *"A degenerate result is called out in both directions:
zero says the verdict is unreachable rather than that nothing needed it."* The rule
exists; it was written for one count and not the other.

The instrument makes this visible. `armWarnings`
(`intent-eval-scoring.ts:473`) is headed *"The degenerate results worth calling out,
in both directions, because each is the cheapest signal that a figure above should not
be read at all"* and implements three: no anchored obligation, `not-contradicted` as
the modal answer, and `not-contradicted` at zero. **There is no warning for
`expectationCount === 0`** — the one degenerate case that lands on the metric the
decision rule is stated on, in the arm that has it by construction.

**What I believe is correct.** Either (i) state what the post-hoc arm measures — if it
is "obligations extracted from a commit message are satisfied by construction, so the
run should report near-zero outstanding", then that is an assertion about
`obligationCount` and `notEvidencedCount`, not about the answer key, and the spec should
say so; or (ii) drop the arm. And require the same degenerate-result callout on
`falseSatisfied.claimCount` that the spec already requires on `notContradictedCount`:
a count over an empty expectation set must say so beside the number, not one row above
it.

---

## F4 — Spec 26: the central justification was tested and came back the other way, and one word covers two different mechanisms

**Spec 26, lines 23–26** (*Why*): *"And splitting is not free. This project measured
whole-file holistic review as **out-recalling** the chunked alternative, and every
split costs an extra task — a full discovery call plus its refutation. So the budget
routinely bought a worse review at a higher price."*

**Why the reasoning fails — two separate defects.**

**(i) The claim is unsourced and was then refuted by the experiment run to test it.**
The "whole-file out-recalls chunked" assertion traces to a single unsourced sentence
in the ledger at line 561, inside a *cost* analysis, with no measurement behind it. The
A/B that directly compared the two arms (ledger, 2026-08-01, $13.81, 21 affected crb
cases, pinned engines both arms) measured **proactive/chunked 43.7% recall against
reactive/whole 35.2%** — a paired **−8.5pp**, discordant 10 (gained 2, lost 8),
p = 0.058. Candidates fell 106 → 75 and findings 113 → 84 in step. The ledger's own
reading: *"the only difference between the arms is TASK COUNT… **Do not ship it as the
default until discovery yield stops being per-task**; the yield fix is the
prerequisite, not a follow-up."*

Spec 26 still states the refuted premise as established fact, and carries **no results
section at all**. Its *Cost* section (lines 87–92) still reads *"Reactive splitting is
therefore expected to be cheaper… **Expected, not measured**"* — when cost was measured
(−14%, and the direction was right).

**(ii) "Splitting" is one word for two mechanisms with opposite measured signs.** The
sentence uses a within-file chunking result to justify removing an across-file task
budget. The record separates them cleanly:

| mechanism | measured effect on recall |
|---|---|
| splitting a **file** into pieces (sub-file partitioning) | **−2.9pp**, 11/23, p = 0.058, code removed (2026-08-07, 10 seeds) |
| spreading a task's **files** over more discovery calls | **+11.3pp** at `maxFilesPerDiscoveryCall: 2`, CI [1.4, 21.1], **p = 0.033** — the only conventionally significant result in the whole investigation |

The byte budget was an instance of the *second* mechanism, and the spec argued against
it with evidence about the *first*. The ledger's standing conclusion is the direct
contradiction: *"Discovery yield is **per task**… here measured as the binding
constraint on recall."*

**Concrete consequence.** The current shipped default is only defensible **in
combination with spec 27's `maxFilesPerDiscoveryCall: 2`** (verified:
`src/shared/contracts/config/config.schema.ts:525`), which restores the task
multiplication spec 26 removed — reaching 46.5% against the old proactive default's
43.7%. A person reading spec 26 alone and raising `maxFilesPerDiscoveryCall` back to
unlimited to "save the extra tasks" would be re-applying spec 26's own stated
reasoning and would lose 11.3pp of recall, with no warning anywhere in spec 26.

**Credit where it is due, and it makes the gap one-sided rather than mutual.** Spec 27
records this correction in full, and records it better than I could state it — line 88:
*"The old byte budget was therefore doing two jobs while claiming one. It said it was
fitting packets into a context window (false — the provider accepts 1.2 MB without
complaint), and it was in fact partitioning the reviewer's attention (real, and worth
+8.5pp recall). **Spec 26 correctly removed the false justification and, with it,
accidentally removed the real benefit**"* — plus a dedicated *Why This Does Not
Contradict Spec 26* section. So the analysis exists; it is simply not in the spec
whose reasoning it corrects. Spec 26 still reads as though the byte budget's only
property was cost, and still carries no result section. The repair is to spec 26 —
transcribe the outcome and cross-reference spec 27 — not to spec 27.

**What I believe is correct.** Spec 26 needs a *Measured Outcome* section stating: the
premise was confirmed (zero provider refusals), cost fell 14% as predicted, **recall
fell 8.5pp and the mechanism was task count, not splitting**, and the default is
shipped only because spec 27's partitioning at 2 restores the looks. The *Why*
paragraph should be corrected to distinguish sub-file chunking (harmful, confirmed)
from across-file task multiplication (helpful, confirmed) and should stop asserting
the refuted claim.

---

## F5 — Spec 26: a capability that has never fired, specified as though it had

**Spec 26, lines 28–37 (*Design*), 54–84 (*Requirements*), 87–92 (*Cost*).**

**The claim.** The design is *"Send the task whole, and split only when the provider
says it was too large"*, with requirements on recursive halving, a depth bound, hunk
clipping to chunk bounds, preservation of absolute line origins, and an 8 MB runaway
ceiling that *"MUST fail loudly"*.

**Why the reasoning fails.** The premise was measured and it holds *completely*:
**"The provider refused ZERO packets — no `context_length_exceeded`, no splits, on any
of 21 cases including one carrying 1.2 MB of changed source"** (ledger, 2026-08-01).
The cases were selected as the *largest* in the benchmark (137 KB – 1.2 MB). So the
entire splitting apparatus — every requirement in lines 56–82 — has never executed
against a real provider in any recorded measurement. Its correctness rests on unit
tests alone (`src/domains/review-workflow/pipeline/discovery/reactive-split.ts` and
its test file exist and are exercised; the live path is not).

This is not an argument that the design is wrong. Removing the guessed byte budget was
right, and the measurement is the strongest possible evidence for that half. The defect
is that **the spec does not state the consequence**: 100% of the observed effect came
from *deleting* the budget and 0% from the splitting mechanism that replaced it. A
reader weighing the cost of the hunk-clipping requirement, or deciding whether the
depth-bounded recursion is worth maintaining, is given no signal that the branch has
never been taken.

**Concrete consequence.** The requirement at lines 63–74 — *a half MUST be shown only
the diff hunks that fall inside its own chunk, and the prose fallback MUST be clipped
by the same bounds* — describes a defect that was found and fixed in code the provider
has never asked to run. If that code regresses, no eval will catch it, because no eval
has ever reached it. The spec should say so, so that the unit tests are understood as
the *only* line of defence rather than as a backstop behind a measurement.

**What I believe is correct.** Record the zero-refusal result in the spec, state that
the split path is unexercised in every measurement to date, and mark its unit tests as
load-bearing rather than confirmatory. Optionally, state a trigger: if a future model
or corpus ever produces a `context_length_exceeded`, that run is the first evidence
about this half of the spec and should be captured.

---

## F6 — Spec 15: the Measured Baseline is superseded, and its headline diagnosis is now reversed

**Spec 15, lines 728–777** (*Measured Baseline*), and line 688 against lines 700–707.

**The claim.** *"Provider `openai/gpt-5.3-codex`, engine pinned `49f0c669`, three
seeds, 2026-08-07, on the 50-case corpus… recall **60.8%** (sd 3.92pp)"*, with
per-mechanism rows leading to line 760: *"**`authorization` at 39% is the result that
got worse with better data**, and it matters more than any other row here… On 18
observations it is the worst substantial mechanism."*

**Why the reasoning fails.** Every figure in that section was superseded the same day,
by a ten-seed measurement on a larger corpus, and spec 15 records none of it. From the
ledger (2026-08-07, *Sub-file partitioning REJECTED, and the 70-case baseline*,
$42.41, control arm `359161b`, 10 seeds, alternating order, 5/5 position balance):

| | spec 15 as written | superseding measurement |
|---|---|---|
| recall | 60.8% (sd 3.92pp), 3 seeds, 50 cases | **64.0% (sd 2.22pp), 10 seeds, 70 cases** |
| adjusted precision | 100% | **95.0%** |
| authorization | **7/18 = 39%, "worst substantial mechanism"** | **63.3%, essentially at the mean** |
| worst mechanism | authorization | **`xss` 40.0%**, then `ssrf` 54.0%, `injection` 55.0% |
| cross-file | 20/42 = 48% | 49.3% (still the worst depth row) |

The ledger is explicit: *"This **SUPERSEDES** the ~61% figure, which described the old
51-case corpus and was never comparable to this one."* The spec's most emphatic
sentence — that authorization is the row that matters more than any other — does not
survive the better measurement. Note also the ledger's own correction to the sd claim
spec 15 partly absorbed at lines 743–750: four three-seed estimates of the *same*
quantity span 2.22–8.38pp, pooled 5.71pp, so three seeds resolve about 11pp. The
60.8% row was a three-seed estimate and the spec's per-mechanism denominators there
were 15–24 observations.

**Concrete consequence, already paid once.** The authorization diagnosis is exactly the
kind of statement a person acts on, and someone did: a pre-registered
authorization-scope prompt clause was built against it and **rejected as null** (7
gained / 8 lost, p = 1.0; `reports/2026-08-07-authorization-scope-result.md`). A
reader coming to spec 15 today reads the same superseded diagnosis, sees no result
recorded against it, and is set up to aim the next intervention at a mechanism that is
at the corpus mean while `xss` at 40% goes unmentioned. The spec's *own* warning at
lines 774–777 — *"A perfect row on a small denominator is an artifact, which is what
the 'directions, not numbers' rule exists to prevent"* — applies to its own
authorization row and is not applied to it.

**Secondary, same section.** Line 688 says the corpus is **72 cases**; the table 12
lines below tops out at **51**. Spec 17's *One Machinery, More Than One Manifest* has
the current figure (72). Within one section of spec 15 the corpus has two sizes.

**Secondary, elsewhere in spec 15.** Line 306 states *"the dedicated security pass's
own A/B result is not recorded in this spec"* — thirty lines below the section titled
*Measured Outcome Of The Dedicated Security Pass* that records it, and contradicting
the 2026-08-01 amendment note in the header (*"its own A/B result is transcribed
here"*) and the retired row in *Known Divergences*. A reader who reaches line 306
first concludes Mechanism 1 is unmeasured, when it is measured at n = 1 and correctly
described as uninterpretable. A stale sentence, but it inverts a measurement status.

**What I believe is correct.** Replace *Measured Baseline* with the 70-case control-arm
figures (recall 64.0%, sd 2.22pp, adjusted precision 95.0%, 10 seeds, engine `359161b`,
`openai/gpt-5.3-codex`), note the 71/72-case corpus amendments and that the baseline is
not restated against them, name `xss`/`ssrf`/`injection` as the below-mean mechanisms,
and record that the authorization intervention derived from the old figure was run and
was null. Reconcile the case count with spec 17.

---

## F7 — Spec 16: "additive to recall only" is contradicted by the spec's own measurement table

**Spec 16, lines 90–95** against **lines 262–272**.

**The claim.** *"**Additive to recall only.** … Enabling it can only let the model see
more; **it never removes a finding the single-shot pass would make.**"*

**Why the reasoning fails.** The spec's own re-measurement, 170 lines later, reports
per-arm discordance: run 1 **gained 7, lost 2**; run 2 **gained 6, lost 4**. Enabling
the mode removed six expectations across two paired runs that the single-shot pass had
found. The claim is a statement about the *prompt* (a strict suffix, so the disabled
configuration is byte-identical) generalised into a statement about *outcomes*, which
does not follow: the model spends steps on reads, its output distribution moves, and
the lane is explicitly *"non-deterministic"* by the spec's own *Deterministic
mediation, non-deterministic use* bullet three lines below. The spec even concedes the
possibility at line 288 — *"If a regression appears, this is the first switch to
flip"* — which is incoherent beside "it never removes a finding".

**Concrete consequence.** This lane is **on by default**. An operator debugging a
finding that appeared last week and is gone this week reads "additive to recall only"
and rules out `crossFileRetrieval` without testing it — when the measured loss rate is
2–4 expectations per paired run on a 87-expectation corpus. The claim actively
misdirects the one diagnostic the spec itself recommends.

**What I believe is correct.** The additive property is real and worth stating, but it
is a property of the **prompt and the packet**, not of the findings: with the mode
disabled the discovery packet is byte-for-byte unchanged and no tool is registered.
Say that, and state separately what was measured — recall up in direction twice, at
net +5.7pp and +2.3pp, with 2 and 4 expectations *lost* in the respective runs. The
existing "if a regression appears, flip this first" line then reads as the honest
consequence of a measured trade rather than as a contradiction.

---

## F8 — Spec 16: the acceptance criterion cites a baseline the spec itself voids, and claims a metric exists nowhere when it now exists

**Spec 16, line 315** (*Acceptance*) against **lines 297–302** (*caveats*), and against
spec 15 lines 766–772.

**The claim.** Acceptance: *"Any cross-file recall improvement is demonstrated by
measurement (**cross-file recall vs the 0% baseline**) without a regression to overall
recall or adjusted precision."* Caveat, same spec: *"The **0% cross-file recall** quoted
in *Purpose* is a property of the slices it was measured on, not of the engine… The
consequence is that the final acceptance criterion below **cannot be evaluated against
that baseline**; it needs a general cross-file recall metric, **which does not exist
yet**."*

**Why the reasoning fails — two ways.**

1. **The acceptance criterion is unachievable as written**, because its comparator is
   declared void by the same document. A criterion whose only defined baseline is a
   measurement artefact cannot be met, ever, by any measurement. The spec correctly
   diagnoses this and then leaves the criterion standing.
2. **The metric it says does not exist has existed since 2026-08-07.** The security
   corpus reports recall by context depth, including a `cross-file` row over a real
   denominator, and spec 15 line 770 states it was *"measured with cross-file
   retrieval already enabled by default"*: **48% on the 51-case corpus, 49.3% on the
   70-case, 10-seed control arm** (ledger). Spec 15 further records it as *"the worst
   row with a real denominator and the largest bucket in the corpus"*. So the general
   cross-file recall metric exists, is published, and says this capability's target
   class is the weakest one the engine has.

**Concrete consequence.** Two specs each assume the other settles cross-file
measurement. Spec 16 says the metric does not exist and therefore its acceptance
cannot be checked; spec 15 publishes the metric under a different heading without
connecting it to spec 16's acceptance. The result is that the capability enabled by
default to close the cross-file gap has an acceptance criterion nobody can evaluate
while the number that would evaluate it is printed in every security-corpus run. A
reader of spec 16 also carries away *"cross-file recall is 0%"* from the Purpose
(line 17) — the sentence a reader actually reads — with the retraction 280 lines later.

**What I believe is correct.** Restate the criterion against the metric that exists:
*cross-file recall on `security-advisory-2026`, reported per context depth, measured
with the lane on and off at ≥ 3 seeds per arm and a pinned judge.* Move the 0%
retraction into the Purpose paragraph where the claim is made. And record the current
value — cross-file 49.3%, the worst depth row — as this capability's standing baseline,
which is a far more useful statement than "0% on slices that contain no other file".

---

## F9 — Spec 12: the measurement plan's endpoints are computable, but they cannot answer the question the spec asks

**Spec 12, lines 379–404** (*Measurement Plan*), against the spec's own hypothesis at
lines 23–26.

**The hypothesis the plan must test.** *"because this agent reads the actual files
instead of relying on the single-shot review packet, its false-positive judgment
should be better grounded than the deterministic review can be, so the flow should
raise precision as well as producing apply-ready fixes."*

**The plan.** *"an arm with `fix.enabled` true against a corpus whose findings have
known real/false-positive ground truth. The endpoints already exist as metrics —
`fixJudgmentAccuracy`, `fixFalsePositiveDetectionRate`, `fixProduceRate`,
`fixApplyFailureRate` — and the pre-registration must fix a bar for **the first of
those** before the run."*

**Why the reasoning fails.** Three defects, in increasing severity.

**(i) There is no corpus with the stated ground truth, and the substitute is another
model.** No eval corpus labels the *engine's own admitted findings* real or false —
the keys label *expected defects*. The code closes the gap with the plausibility
judge: *"Ground truth is corrected by the plausibility judge: a matched finding OR an
unmatched-but-plausible (unlisted-real) finding is 'real'; only a genuine false
positive is 'false-positive'"* (`src/domains/evaluation/scoring/metrics.ts:381–384`).
This is the right handling of the unlisted-real hazard and it deserves credit — but it
means `fixJudgmentAccuracy` measures **agreement between the fix lane and the
plausibility judge**. And the plausibility judge is a single model call over the
finding plus the new-side file content
(`src/domains/evaluation/judging/eval-plausibility-judge.ts`) — that is, precisely the
single-shot, packet-based judgement the fix lane's hypothesis claims to beat. **A fix
lane that outperformed the judge would score as inaccurate.** The endpoint is
circular with respect to the claim.

**(ii) The named endpoint is base-rate degenerate.** The plan requires the bar on
`fixJudgmentAccuracy` specifically. Its population is eligible admitted findings, and
genuine false positives are rare in every recent run:

| run (ledger) | genuine FPs | raw findings | FP share |
|---|---:|---:|---:|
| sub-file control, 10 seeds, 70 cases | 25 | 886 | 2.8% |
| impact-framing control, 10 seeds, 71 cases | 11 | 893 | 1.2% |
| model comparison, codex, 3 seeds, 72 cases | 3 | 260 | 1.2% |

**A lane that answers "real" to everything scores `fixJudgmentAccuracy` at 97–99% and
`fixFalsePositiveDetectionRate` at 0%.** Any bar set on the first metric that a real
lane could plausibly clear is also cleared by a lane that never forms a judgement at
all. The informative endpoint is the second one — and its denominator is **1–3 findings
per run**, which no realistic seed count resolves.

**(iii) The plan tests none of the hypothesis's actual terms.** The hypothesis is about
**precision** — the review's precision. Adjusted precision is already 95.0–97.9% in
every recent run, so the available headroom is 2–5pp against a control spread of
2.04–3.10pp. None of the four named endpoints is the review's precision, and the plan
names no precision endpoint, no corpus, no seed count, no cost estimate, and no arm
ordering — despite this project's standing rules that three seeds resolve ~11pp, that
arm order must be randomised (the recorded arm-order artifact), and that a free
measurability precheck comes before spend, a rule which the ledger notes has changed
the design **every time it has been run**.

**Concrete consequence.** As written, the plan is executable and will produce a number
in the high nineties, which will be read as confirmation that the fix lane's judgement
is well grounded — while being fully explained by a base rate the plan never states.
That is the same shape as the recorded `fixJudgmentAccuracy: 0` defect the metrics
module already fixed once (an empty denominator producing a confident answer), moved
from the empty case to the near-degenerate one.

**What I believe is correct.** Run the free precheck first, on data already on disk:
count eligible admitted findings and genuine false positives per case over the ten
stored control runs, and state the resolvable effect size before committing spend. Then
pre-register on `fixFalsePositiveDetectionRate` (the only endpoint whose value is not
fixed by the base rate) with a denominator large enough to resolve it — which probably
means a corpus deliberately seeded with known non-defects, not the security corpus.
And state explicitly that `fixJudgmentAccuracy` measures agreement with the
plausibility judge, so it is a **consistency** metric and cannot, even in principle,
show the fix lane beating a single-shot judgement.

---

## F10 — Spec 23: the refusal guarantee does not hold identically in both invocations, and the default flip moved the traffic to the weaker one

**Spec 23, lines 1006–1009**: *"The lane runs in **one of two places**, and the
guarantees above hold identically in both."*

**Why the reasoning fails.** *Limits Refuse; They Never Truncate* (lines 630–659)
spends thirty lines establishing that a bound which binds MUST refuse the run, with a
named code and **exit 4** — because *"bounding the obligation list under-reports what
is left, which is the single direction this capability must not err in."* That is the
`intent check` path. On the `review` path, the same refusal is caught: *"a throw from
this lane becomes a warning on the review report and an absent stage report, never a
non-zero exit"* (lines 1020–1024), which the implementation confirms
(`src/cli/advisory-lanes.ts`, guarantee 1).

The *safety* half survives — nothing is truncated either way. The *visibility* half
does not: a hard exit 4 with a named code stops a human; a warning line on a review
report next to findings does not. And since the 2026-08-11 default flip, `review` is
where essentially all traffic is. The section whose whole argument is that a binding
limit must be impossible to miss now governs the minority path.

**Concrete consequence.** A pull request whose intent yields more than 100 obligations
produces a review report with no intent section and a warning; the reader most likely
concludes there was nothing to report. The spec's stated hazard — *under-reporting what
is left* — is realised as total silence in exactly the invocation the spec made the
default. This is not hypothetical at the margin: spec 23 already records a corpus case
(`pw09-spec15-measure`, lines 331–342) that refuses in one round and scores in the next
purely on extraction non-determinism.

**What I believe is correct.** Drop "identically" and state the two shapes explicitly:
`intent check` refuses with exit 4 and a named code; `review` records a warning naming
the same code and the value that bound, and the review report MUST say that the intent
section is absent *because a limit bound*, distinguishably from "the lane is disabled"
and from "the lane found nothing". Then decide, in writing, whether a warning is
sufficient visibility for a hazard the spec calls *"the single direction this
capability must not err in"*.

---

## Read and found sound

Recorded so this audit can be calibrated. These are places I looked hard for a defect
and did not find one.

**Spec 15, Mechanism 2 (lines 350–685).** The specific worry — that the spec still
reads as a live route after the 3.0% analyzer firing rate bounded it below its own
promotion bar — **does not hold**. Spec 15 states the consequence in full at lines
653–670: *"At a 3.0% admission rate, the ceiling on its recall lift is 3.0 percentage
points even if every admitted alert converted a miss into a find… The rule's promotion
bar is ≥3 points of mean lift. **The bar sits at or above the ceiling**"*, followed by
*"No A/B is run, and none should be… The bound is the measurement."* The rule is
applied, not edited; the distinction between "the gate failed" and "the gate was never
supplied with anything to pass" is drawn twice and drawn correctly; the "bound is a
property of the analyzer, not of the mechanism" section is the right reason to keep the
lane available; and the record of the wrong first pass (0/132 under one ruleset, with
the control that caught it) is exemplary. This is the strongest reasoning in my scope.

**Spec 17, out-of-diff (lines 168–275).** The worry that some spec still states
out-of-diff recall as an achievable requirement **does not hold** for spec 17. It
requires the two populations be reported separately and never blended, gives the
measured reason (a blended figure's value depends on the fixture mix, not on reviewer
quality), and explicitly declines to decide the product question: *"Whether out-of-diff
defects are in scope is a product decision, and this spec's job is to make that decision
visible rather than to make it."* The hunk-span-versus-added-lines correction is
carefully argued, the superseded figures are marked superseded while the argument they
support is retained, and the `undetermined` third value exists precisely so unplaceable
expectations cannot depress the population the engine scores worst on. I could find no
overreach here.

**Spec 17, convergence (lines 283–390).** *"None of this is implemented"* is stated
plainly; the reason the manifest field was deliberately *not* added — *"adding the
field on its own would record a contract nothing produces and nothing reads, and would
let this row be ticked while the metric still does not exist"* — is exactly right. The
required diff-narrowing control, and the finding that round two and the control were
indistinguishable (+3.5pp vs +11.9pp), is a genuine falsification the spec carries
against its own feature. So is *Round-One Rates Must Be Re-Measured, Not Read From
Archives*.

**Spec 12, lines 28–40.** *"That hypothesis is UNTESTED, and this section previously
asserted it as fact"* — and the separation of *"off by default for containment"* from
*"off by default because it failed"* — is the honest version of the thing F1 finds
missing in spec 23. Worth using as the template.

**Spec 13.** Both amendments hold up. The 2026-08-03 proof amendment is grounded in a
deterministic rendering property rather than a measurement claim (*"a finding that
survived a full refutation and a finding that was never adjudicated produced
byte-identical comment bodies"*) and says so. *What the body must NOT carry* is a
correct and non-obvious argument: an aggregate printed beside one finding reads as that
finding's probability, and the rates are mostly about what silence means. *Findings An
Earlier Push Carried* refuses to say "resolved" for the right measured reason (in-diff
recall ~two-thirds, two runs over one commit disagree). The eligibility/apply-check
split — shape answerable from the report, fit answerable only from the file — is
precisely drawn, and the three-state rule (never suggested / checked and stale / not
checked) is correct where a two-state rule would collapse "unchecked" into "passed".

**Spec 16, *Refusals Must Be Disclosed*.** The argument that a refusal a model can
mistake for an observation is worse than no tool, the closed typed set, the insistence
that a containment violation is a fault distinguished by error *type* rather than by
message text, and the note that the word CLOSED does no work unless the set actually
enumerates its members — all sound.

**Spec 23, `not-contradicted` (lines 73–363).** The verdict's justification is strong:
the shape produced 33 of 83 false positives and *could never have produced anything
else*; it is unreachable by prompt wording because there is no line to cite; the
verdict carries no evidence field *at the schema level* so a line cannot be invented
for it; and it downgrades to `undetermined` rather than to `not-evidenced` when part of
the change was unseen, with the reason given (failing to see the whole change is not
evidence in either direction). *What was deliberately NOT built* is a model of how to
record a bounded change. The pre-registration counting a wrong `not-contradicted` as a
false-satisfied claim, and the verification of that property directly in
`score-carried.mjs` rather than inferred from its sibling, are both right. My findings
F1–F3 are about the containment paragraph, the ship gate, and the control arm — not
about this.

**Spec 23, aptness-check rejection (lines 365–506).** Three designs, three rejections,
with the base-rate collapse arithmetic shown (2% of ~200 apt ≈ 4 wrong downgrades
against 14% of ~18 inapt ≈ 2.5 right ones ⇒ ~38% precision) and the generalisation
stated: *"Making the check stricter makes it worse."* The self-criticism at lines
447–451 — *"The claim that it 'cannot make the capability worse' is the one that was
wrong… 'Costs nothing because it demotes nothing' is not a property a design gets for
free; measure it"* — is the most valuable paragraph in the file.

**Spec 27, lines 40–120** (read while grounding F4; specs 27–31 were audited in
depth separately). *Why This Does Not Contradict Spec 26* correctly distinguishes
"splitting justified by a context limit that does not exist" from "splitting justified
by an attention limit that is measured", and the yield model (`0.46 · files^0.70`,
per-file ceiling ~1.2 invariant across a 19x range and two corpora) explains *why* 1
and 2 tie on recall rather than asserting the knee. The requirement that raw per-call
findings be recorded — *"A debug log line does not satisfy this: debug logging was off
for every paid run, so the figure existed and was discarded every time"* — is the right
lesson drawn from the right failure.

**Spec 15, Mechanism 1 (lines 220–310).** *"Overall recall rose while labeled security
recall fell"*, followed by *"That does not rescue the claim either: **an
uninterpretable number is not a positive one**… unproven at n = 1, at +61% cost"*, and
the pass therefore stays off. Refusing to bank a favourable-looking overall number when
the mechanism-specific one is uninterpretable is the discipline this project's ledger
is built on.

**Spec 26, *Detection Is The Harness's Normalised Reason*.** Requiring
`context_length_exceeded` from the harness contract and forbidding detection by
provider message text or status code is right, and the consequence — an adapter that
fails to map its overflow has a defect that must be fixed there — is the correct place
to put the burden.

---

## Part II — specs 22, 24, 25, 27–31

Audited in two parallel passes and then independently verified. Every claim below was
re-checked with a command against the repository before being adopted; the checks are
named. Two agent claims were **corrected on verification** and are marked.

---

### F11 — Spec 27: the sweep that set the shipped default ran on an engine whose partitioning was broken, and the fix landed the next day without a re-run

**Spec 27, lines 183–197**, against its own line 126 (*"Every partition MUST receive
the same shared context the undivided task would have"*) and line 137 (*"The default
MUST leave behaviour unchanged until the value is measured. Shipping a chosen-by-feel
default is the failure this project has now corrected five times"*).

**Verified by command.** `git log`:

```
4751277  2026-07-30  feat(discovery): partition a task's files across discovery calls (spec 27, off)
47156e9  2026-07-30  feat(discovery): ship discovery partitioning on by default, at 2 files per call
4a4118d  2026-07-31  fix(discovery): partitions were silently losing every referenced definition
```

`git merge-base --is-ancestor 4751277 4a4118d` → **true**. The sweep engine strictly
predates the fix. Per the ledger (line 1908) the control arm was **unpartitioned**
(`partitionTaskForDiscovery(task, undefined)` returns the task unchanged), so **the
control kept its referenced definitions and every treatment arm lost them.** The runs
that chose the default violated spec 27's own Requirement 3.

**The direction of the confound matters, and it is not what one might assume.** Losing
referenced definitions handicaps the treatment, and it handicaps it *in proportion to
partition count* — arm `1` (most partitions) lost the most context, arm `4` the least.
So:

- **"Partitioning helps" SURVIVES.** The treatment won +11.3pp while carrying the
  defect; a clean re-run can only improve it. This conclusion is safe.
- **The operating point does NOT survive.** The 27%-cheaper-at-equal-recall argument
  for `2` over `1`, and the claim at line 193 that *"below 2 there is nothing left to
  buy"*, both rest on `1` and `2` returning *identical* figures (46.5% / 97.1%) from
  independent single runs — while `1` was the arm most penalised by the defect. Remove
  the handicap and the knee may well sit below 2.

Compounding, and each independently checkable: the sweep is **one seed per arm**
($36.78 = $8.18 + $12.09 + $16.51) against a variance the ledger later fixes at sd
4.8pp on this corpus and pooled 5.71pp, concluding *"three seeds resolve ~11pp"* — the
claimed effect is +11.3pp at n = 1. `p = 0.033` is the **best of four** comparisons
(≈0.13 Bonferroni-corrected), where lines 157–167 pre-registered two arms and said *"A
default MUST NOT be set from this run alone."* And the ledger's own engine caveat —
*"Re-running the control on `4751277` (~$6.40) would remove the caveat"* — was never
acted on and is not in the spec.

**Concrete consequence.** `maxFilesPerDiscoveryCall: 2` is the always-on default
(`config.schema.ts:525`) and costs **+89%** ($6.40 → $12.09) on the corpus where it was
measured. Every cost figure this project publishes carries that multiplier. `unlimited`
has never been measured since the partition-context fix, and the current 64.0% security
baseline was itself measured *at* 2 — so there is no post-fix control to compare
against. This is the same evidence class as the exploratory +5.13pp (14/6, p = 0.115)
that vanished at ten seeds (12/12, p = 0.58), which this project correctly refused to
bank.

**Correct position.** Mark the sweep provisional and confounded by `4a4118d` in the
spec. Re-run `unlimited` vs `2` vs `1` at the current engine on the 70-case corpus at
the seed count the ledger requires — this is now the cheapest available recall question,
because the answer may be *lower* cost as easily as higher.

---

### F12 — Spec 22: the default-on argument contains pipeline damage, and the pre-registered rule it needed to clear was about reader damage

**Spec 22, lines 160–167**, against its own lines 254–261.

**The claim.** On by default since 2026-08-11, defensible because with `adjudication`
off the lane makes no provider call, feeds nothing into discovery, *"can neither help
nor hurt review recall"*, and a run with it off is byte-identical.

**Why it fails.** Every clause answers a pipeline question — cost, recall,
reversibility. The pre-registered rule at lines 254–261 asks a reader question: *"Ship
enabled by default only if… **false-positive rate is low enough that a human is not
trained to ignore it**. — Ship disabled if it finds real dependents but too noisily to
default on."* The evidence on reader cost is in the same spec and is not favourable:
line 621, *"Without step 3 the report is roughly 90% noise by construction"*; line 1343,
*"published rates for this task put such a list near 90% irrelevant. **With adjudication
off, nothing at all is triaged**"*; and the measured deterministic-arm precision lower
bound is **5.2%** (154 predicted files, 8 proven dependents; ledger 2026-08-09). The
shipped default is the second bullet's case, promoted to the first bullet's outcome by
re-labelling the decision *"a product decision… not a measurement result"*.

The refutation is already in this repository, paid for with a killed capability —
**spec 24, lines 36–39**: *"'it fires rarely' was never a defence. Reader precision here
is 0%, not 100% of a small number. A capability that fires rarely and is wrong every
time **costs a reviewer strictly more than one that does not exist**."* This is the same
error shape as F1 (spec 23) and the same shape spec 24 learned. Three specs, one lesson,
learned once.

**Concrete consequence, verified.** `changeImpact.enabled` defaults `true`
(`config.schema.ts:1070`), and `scripts/github/summary-comment.ts:494–498` renders an
`### Impact` section into the **top level of the pull-request comment** — a surface
spec 22 does not govern at all (it specifies `impact-report.md`/`.json` and stdout,
lines 98–112). The silence has already produced a second defect there: the table header
reads `| Symbol | Defined in | Callers | Test callers |` (verified, line 498), while
spec 22's own known-not-reported entry 7 (line 1319) records that *"references are
matched as text, not resolved as bindings… an aliased import lists the import line and
**NOT** the `loadUser(...)` call sites."* A text-match count is rendered under a word
that names a resolved binding — precisely the failure spec 22 forbids at line 212
(*"Neither warning may assert a cause it did not check"*), in the one place the spec
forgot to govern.

**Correct position.** Either score the flip against the rule it belongs to, or retire
that rule explicitly with a stated reason — not route around it. Add a requirement
governing the human-facing surface, and rename the column to *reference sites*.

---

### F13 — Spec 22: adjudication is recorded "rejected" on a denominator this spec explicitly forbids, while the one run on the right denominator cleared the bar

**Spec 22, lines 164–165**: *"`changeImpact.adjudication` remains disabled, measured and
rejected on 2026-08-09 (**0/7** against a pre-registered 40% bar)."*

**Why it fails.** Spec 22 binds the denominator twice — line 828 (*"of the dependents
the reference list itself contains"*) and lines 362–365, under *"Five bindings, each of
which is a way this measurement could otherwise lie"*: *"**The decision rule's
denominator is the reference list**, not the whole answer key… scoring it against files
discovery missed would charge it for discovery's misses."* The `0/7` is the answer-key
denominator: the deterministic arm found 5 of 10 directly-reachable dependents, and the
7 charges adjudication for the 5 it was never handed.

**Verified by command.** The one run that used the pre-registered denominator is ledger
2026-08-06, and I read it directly: *"**Decision-rule denominator — of the proven
dependents the reference list itself contains, how many survive adjudication: 50.0%
(2/4).** Adjudication cannot report what discovery never found, so this is the
denominator spec 22 pre-registered."* **50% clears the 40% bar.** That run was correctly
not promoted — but on the *precision* clause, which the spec elsewhere proves
unfalsifiable on this corpus, not on recall. Spec 22 records neither the figure nor the
fact that the recall clause has never been failed on its own denominator. The ledger
also records (2026-08-08) that at 11 proven dependents *"one expectation moves a rate
~20 points, **so the bar can be neither reached nor failed**"*, with ~50 needed — a
number spec 22 carries nowhere.

**Concrete consequence.** "Measured and rejected" is near-permanent in this project —
`reports/2026-08-11-default-review-experience-plan.md:34` states the governing rule as
*"a capability measured and rejected stays off, whatever the product would prefer"*, and
cites this `0/7`. So the one layer that could take the now-default-on reference list
from ~5% precision to something worth reading (ledger 2026-08-06: 7.5% → 22.2%,
*"roughly threefold"*, and *"Not removable: the model tier does beat the deterministic
tier, visibly"*) is locked off by a figure the spec's own anti-lying binding forbids.
The two runs are additionally on record as 50% and 0% — incomparable denominators
presented as a trend.

**Correct position.** The rejection may survive re-computation (a zero numerator is 0%
on any denominator), but the recorded *status* does not. Record: measured once on the
pre-registered denominator at 50% (clearing), once on a non-pre-registered denominator
at 0%, on a corpus that cannot resolve either bar. **Undecided, not rejected** — the two
license different future work.

---

### F14 — Spec 24: the measurement that killed the capability exists nowhere but in the spec it killed

**Spec 24, lines 7–46** (the Outcome: 7.0 reports/range against a ≈0.5 gate, *"zero true
positives across roughly 300 hand-judged divergences from five codebases"*, 97.5%
adjudication rejection). Four source trees, a CLI command, a config block and a GitHub
stage were deleted on it.

**Verified by command.** The ledger declares itself *"Append-only record of every
measurement, with what invalidates it"*, and this project's own operating rule is to
search it before pre-registering. `grep -niE "spec 24|conformance"` returns **no entry
after 2026-07-30**. The kill measurement carries none of the provenance every other
entry carries: no engine commit, no clean-tree flag, no provider or model, no spend, no
named codebases, no "what invalidates this entry". Its headline rates are
**model-dependent** — a 97.5% rejection rate is a property of the adjudicator call, and
spec 24 itself warns at lines 261–266 that *"whether a real model answers this way is a
model property and is not measured here"*. Under the standing rule *publish numbers with
the model*, an unattributed 97.5% is not a citable rate. It can never be re-derived: the
implementation went in the same commit.

**Correction to the delegated report.** It characterised the ledger's last word as *"the
rehabilitation"*. That overstates. The 2026-07-30 entry says explicitly: *"This does not
rehabilitate the capability. It means the case against it was never properly made
either: the design was never run on most declarations. **Both directions are open.**"*
The correct statement is that the ledger's last word leaves the question **open in both
directions**, and the kill that closed it is unrecorded. That is still the finding.

**A second, verified defect in the same file.** Line 571 states the withdrawal: *"The
conclusion below that 'the gate is nonetheless blown' is withdrawn along with the
numbers that produced it."* Line 610 still prints, in bold and unmarked at that
location: *"**The gate is nonetheless blown, and was blown before this change.**"* The
contamination has already spread — spec 25, lines 250–252, cites *"a firing rate of 0.70
per commit against its own ≈0.5 kill criterion"* as live fact about spec 24.

**Concrete consequence.** This kill is load-bearing in at least three planning documents
(`2026-08-05-pr-review-parity-analysis.md:143`, `2026-08-08-human-parity-plan.md:29,113`,
`2026-08-08-test-adequacy-prereg.md:18`), all tracing to the spec and none to a ledger
entry. A future engineer following the project's own "search the ledger first" rule
finds the question open and re-proposes the lane; one reading only the spec finds it
closed with evidence and never asks whether the adjudicator model was the variable.

**Correct position.** Write the 2026-08-02 measurement into the ledger with full
provenance — model, engine SHA, the five codebases, the spend, and the population the
~300 divergences were drawn from (if they came from the same known-benign PRs the
firing-rate criterion used, then "zero true positives" is tautological and is not
independent corroboration of the firing rate it is printed beside). Until then, spec 24
should say the capability was **withdrawn on an unpinned, unreproducible measurement** —
still a legitimate reason to remove it, and a materially weaker claim than "killed with
evidence". Delete or mark the stale line 610.

---

### F15 — Spec 25: the prior-art table that sets the project's prior on retrieval contains a row the ledger reversed

**Spec 25, lines 110–126.** Verified verbatim: the table row reads
`| spec 16 cross-file retrieval | agentic — model searches the repo | off by default; no measured win |`,
and from it the spec draws *"Deterministic beats agentic"*, *"Framing has outperformed
retrieval here"*, and the outcome *"close retrieval permanently"* (line 291).

**Why it fails.** Ledger 2026-08-01, line 1841: *"**Spec 16 cross-file retrieval —
REVERSES the earlier net-negative verdict**"* — recall 42.5% → 48.3%, adjusted precision
97.4% → 100%, cost −7%, *"the earlier measurement could not distinguish the feature from
that bug [a silent 24 KB read truncation]"*. The project's live position is that this is
a measured benefit (ledger 2026-08-07: *"+5.7pp recall with 100% adjusted precision when
it works"*), and the feature is **on by default**. Both halves of the row are false.
Spec 25 carries a *"Superseded 2026-08-02"* block, so it was edited after the reversal
and the row was not corrected.

**Concrete consequence.** Spec 25's surviving function — its own Purpose, echoed
verbatim in spec 24 — is to be the record *"the next attempt starts from"*, i.e. to set
a prior. As written it tells the next engineer that agentic retrieval is one of three
failures and that retrieval should be closed permanently, pointing them away from the
one intervention in the table that measured a gain at *lower* cost with precision rising
to 100%. The stale framing has already propagated into the ledger itself: the
2026-08-11 entry lists *"cross-file retrieval"* among *"six structural interventions
[that] have now failed"*, contradicting the 2026-08-01 entry 1,584 lines above it.

**Also worth confirming:** the 2026-08-01 entry closes *"Replicate before making it the
default"*, and I find no record of that replication anywhere in the ledger — yet the
feature is on by default. Spec 16's *Measured Outcome* is honest about this (*"Two runs,
one model, one corpus… is not evidence of a recall benefit"*), so the default rests on
"nothing measured argues against it", which the spec states plainly. The gap is that the
requested replication is neither run nor recorded as outstanding.

---

### F16 — Spec 29: "there is no state in which it misleads" was measured false, and the mandated disclosure names the minority failure mode

**Spec 29, lines 50–51** (verified verbatim): *"There is no state in which it misleads —
provided the disclosure below travels with it."*

**Why it fails.** The disclosure was enumerated from an armchair; the measurement found
a different dominant mode. Spec 29's own result section, and
`reports/2026-08-08-test-adequacy-result.md`: **95 of 113 firings (84.1%) are on commits
that changed a test file.** The change *was* tested; pairing failed because both
relations require a shared normalised filename stem, so `intake-service.ts` does not
pair with `repository-intake.test.ts` sitting beside it. The mandated disclosure (lines
132–135) covers the *untouched pre-existing test* mode, which is the minority case.
Lines 50–51 and 132–135 were not amended when the number arrived; a new section was
appended beneath them.

**Correction to the delegated report.** It stated the rendered sentence is *"false in
84% of firings"*. That is too strong: *"no test moved with these files"* is literally
true at the pairing level even when the commit touched a test. The precise defect is
narrower and still real — verified at `src/domains/reporting/markdown-reporter.ts:609`,
the renderer *explains* non-pairing as *"a change that keeps its tests in a tree of their
own pairs nothing here"*, a **location** story, when the measured cause is a **stem
mismatch for a test sitting in the same directory**. So the report states the wrong
cause, and the reader's natural inference ("this team keeps tests elsewhere, fine") is
unavailable to the 84% whose test is right there under another name.

**Concrete consequence.** The result report names three commits from this repository's
own work (`7385b673`, `250ae986`, `10f08d4e`) that shipped tests and were flagged
anyway. A reviewer trusting `report.md` asks an author for a test already in the diff.

**Correct position.** Delete the "no state in which it misleads" claim — it is measured
false. Rewrite the disclosure to name the measured dominant mode first, and make the
`changedTestFileCount > 0` case qualify the reading explicitly; the contract already
carries that field.

**Secondary, same spec.** The pre-registration defined *usefulness* as *"would a reviewer
plausibly ask for a test here? Judged by reading the change, by me, recorded case by
case."* The result substituted *"did the commit touch any test file"* — a different
quantity — and reports ≤16% against the ≥50% bar. The prereg also named **two**
populations; population 2 (the advisory corpus, *"the population where firing is most
defensible"*) was never measured, and neither the result nor spec 29 says so. The
decision to keep the signal off the summary is probably right; the evidence recorded for
it is not the evidence that was registered.

---

### F17 — Spec 30: the boundary holds in mechanism and fails in effect, because the reply buys a re-roll

**Spec 30, lines 22–24, 44–50, 93–98**: *"It is not a negotiation. Nothing an author
writes can promote, demote, withdraw or suppress a finding… Requirement 2 is satisfied by
construction rather than by discipline."*

**The transport boundary genuinely holds** — verified: `ReviewCommentReplyEventSchema`
declares only `action` and `comment.in_reply_to_id`; `body` and `user` are never parsed,
so no reply text can reach a packet. That part is sound and I would defend it.

**Why the conclusion still fails.** "The reply is not an input" is not "the verdict is a
function of the evidence". The mis-scoping correction replaced targeted re-refutation
with a **full stateless re-review**, which re-discovers from scratch and is stochastic.
From the ledger: across ten identical control runs the finding set varied in **22 of 23**
cases with findings in ≥2 runs; curated defects with proven findability reproduce **13 of
15** case-runs, one of five at 0/0/1. So a real finding fails to reappear at a
substantial per-run rate, and `resolveReviewConversationOutcomes` then returns
`no-longer-reported`. At ~87% per-reply reproduction, P(at least one non-reproduction in
k replies) ≈ 34% at k = 3 and ≈50% at k = 5 — **for the easiest class of defect**. A
commenter who dislikes a finding does not argue; they reply until the dice land. That is
demotion by reply volume with no persuasive word written.

**The code already knows.** Requirement 3 mandates the vocabulary *"the finding was
withdrawn"*; the implementation refuses it — *"This status is deliberately never
'withdrawn': this comparison cannot tell a genuine withdrawal from a finding this run
simply did not reproduce"* (`review-conversation.ts:113–116`). **The implementation
contradicts the spec because the spec's requirement is unsatisfiable.**

**Correct position.** Amend requirement 3 to the three statuses the code emits
(`held` / `not reported again` / `undecided`), and add a bound of **one re-adjudication
per finding fingerprint per pull request** — justified by resampling, not by spend. Note
also that requirement 1's fingerprint (`v3-category-path-anchor`) has never had its
cross-run stability measured; the 2026-08-08 study measured `(category, path, title)` and
removed `title`, and the stability of the surviving tuple was on disk and not computed.

---

### F18 — Spec 30: it requires a bound and forbids the only place to put one

**Spec 30, requirement 5** (*"Re-adjudication MUST be bounded per pull request, and the
bound MUST be disclosed when reached. Reply volume is attacker-controlled; model spend is
not allowed to be"*) against **Configuration** (*"One key, top-level, and no others —
which is a requirement, not an omission… the schema test asserts that both
`{blocking: true}` and `{maxReplies: 10}` are rejected"*).

**Why it fails.** The spec demands a bound, names no value, and forbids the natural knob
by name. The justification for banning `maxReplies` argues from requirement 2 (no softer
threshold) and requirement 6 (no blocking) — neither of which concerns a call budget. So
the implementer had nowhere to put one. What shipped as the stand-in is the workflow
`concurrency: cancel-in-progress` group, whose comment claims it *is* requirement 5's
bound. It is not: it bounds runs **in flight**, not runs **total**. Replies paced apart
each start a full review. Nothing discloses a bound being reached, which requirement 5
also demands. The cost premise is stale besides: when written, re-adjudication meant one
refutation pass; after the mis-scoping correction the unit of spend is an entire review
run, and requirement 5 was never revisited.

**Concrete consequence.** Enabling this lane on a public repository lets anyone with
comment access — weaker than commit access, as the spec itself notes — drive one full
paid review per reply, indefinitely.

**Related silence.** `specs/02-capabilities/capability-inventory.md` (CAP-CONV-001)
records that the key *"is consumed by the GitHub pipeline in `scripts/github/`, not by
the engine, so `eval run` cannot exercise it"*, while spec 30's Measurement Plan is
written entirely in terms of the advisory corpus and the eval harness. **The capability
has no measurement path**, so "ships disabled until measured" means "ships disabled".
And the plan's target is internally contradictory: line 134 demands a hold rate
*"indistinguishable from 100%, since any movement at all means the boundary leaks"*
while line 142 demands only *"indistinguishable from the no-reply baseline"*. Given the
reproduction figures in F17, the 100% form can never pass, and failing it would be
attributed to a leak that provably does not exist.

---

### F19 — Spec 31: the study measured recovery and the spec concluded constructibility

**Spec 31, lines 55–56, 88–91.** The gate asked *"can two curators independently agree on
what the right design was?"* as a proxy for *"a capability whose ground truth is a matter
of taste cannot be measured, only asserted"*. Result 41.7% curator-vs-maintainer → *"the
lane is not built, now or later, without new evidence"*.

**Why the inference fails — the conduct of the study is not in question, only what was
concluded from the number.**

1. **The curators were model agents** (ledger: *"Curator B reported it unprompted, as a
   threat to the study it was participating in"*). So 41.7% is the blind **recovery
   rate of the very system the lane would be** — a capability measurement, not a
   statement about whether ground truth exists.
2. **The spec's own data shows ground truth WAS constructed**: 1,371 hits → 322 read in
   full → 41 qualified → 30 harvested, with the key judge marking **0 of 24**
   `not-a-design-objection`. Every case had a recorded, verbatim, authoritative
   objection. That is a corpus. What failed was recovery against it.
3. **The failure mode is this project's normal condition elsewhere.** "Curator found a
   different real problem in the same diff" is the *unlisted-real* phenomenon, measured
   at ~52% real and worth ~10.3pp of recall on the security corpus — where it was never
   read as evidence that security ground truth is unconstructible.
4. **"Indistinguishable from chance" (line 91) is wrong.** Chance on free-text objection
   recovery is ~0%, not 50%. The 50% floor is a preference dressed as a statistical
   baseline.
5. **n was 24, not the pre-registered 30.** 10/24 carries a 95% CI of roughly [22%, 63%],
   spanning the entire 50–70% *"record and stop"* band — so the **strongest** form of the
   rule (never build, not even behind a flag) rests on a point estimate that cannot
   exclude the adjacent, materially weaker verdict.

**Concrete consequence.** A corpus that exists today is permanently frozen by a rule
whose escape clause (*"without new evidence"*) is never defined — while the same report
records that design ground truth **decays** (3 of 30 pre-review commits already
garbage-collected, one within a single session). The follow-up the evidence actually
licenses — score a design lane's *recall* against the maintainer key exactly as the
security lane is scored against advisories — is foreclosed by wording written for a
different finding.

**Correct position.** Keep "do not ship a design lane"; the caution about advisory output
wrong at this rate is sound. But restate the finding as *"a competent blind reader
recovers the maintainer's specific objection about two times in five, so any design
lane's recall ceiling is ~40% and its precision is unfalsifiable against a
single-authority key"* — not as *"ground truth cannot be constructed"*. And define "new
evidence", since the corpus is decaying under the prohibition.

---

### F20 — Spec 28: the last shipped default with no measurement at all, and it pulls against spec 27 with no cross-reference

**Spec 28, lines 38–40, 60–64, 66–84.** *"On a real overflow, shrink and retry… The limit
that binds is then the provider's, discovered by hitting it"*; *"Raising 24,000 to some
larger number repeats the mistake at a different value… The provider knows; we do not."*

**Verified by command.** `grep -niE "spec 28|targeted read|maxBytesPerRead"` over the
3,450-line ledger returns **two hits, both inside other specs' entries**. Spec 28's
Measurement Plan has never been run and is not recorded as outstanding. The spec shipped
2026-07-31 with `maxBytesPerRead` unset by default; cross-file retrieval was defaulted on
the same day.

**Why the containment argument fails.** It is aimed at the one failure mode this project
has measured to be **absent**: spec 26's A/B established the provider refused *zero*
packets at up to 1.2 MB. So the overflow-retry safety net has never fired, and "the
provider knows" is an authority that never says no. What is therefore uncontained is not
a context error (loud) but **token spend and attention dilution** (silent). And spec 27's
own model has per-file attention decaying as `shown^-0.30`: **spec 27 partitions to
reduce what one call sees while spec 28 removes the ceiling on what that same call can
pull into itself, and neither spec cites the other.**

**Concrete consequence.** With retrieval on by default and no per-read cap, a single
`repo_read` of a large generated, vendored or bundled file enters the discovery packet
whole. Nothing errors and nothing is disclosed as harmful. Worse under the current
default: `2026-08-07-subfile-partitioning-result.md` records that *"in any partitioned
mode the token cost is dominated by shared-context duplication, not by the reviewed file
body"* — so an oversized read is paid for **once per partition**, multiplied by spec 27's
own default of 2.

**Correct position.** Run the A/B, or mark the change unmeasured in the spec header. And
add the missing cross-reference stating what a read costs under partitioning — the two
specs currently optimise in opposite directions with no arbiter.

---

### F21 — Spec 27: the falsified yield model is left standing 200 lines above its own falsification, and "attention" means two things

**Spec 27, lines 42–61 and 113–120**, against **lines 244–250**.

Lines 42–50 state as law: *"The ceiling is ~1.2 findings per FILE — the hard limit in
this system"* and *"per-call yield is sub-linear in scope… roughly `0.46 · files^0.70`"*.
Lines 113–120 — the only argument reconciling spec 27 with spec 26 — rest on *"an
attention limit that is measured"*. Lines 244–250 then record the premise as
**falsified**: *"narrowing what a call is shown does not buy recall even on defects
wholly contained in the narrowed region… That is a statement about ranking, not about
attention."*

The falsified model is unmarked at its own location. Line 58 still reads *"The untested
lever is sub-file partitioning… where the curve points next"* — and the curve is exactly
what pointed there, and has now been measured through and found not to extrapolate.
Meanwhile "attention" is used for two incompatible things in one document: a **capacity**
partitioning buys more of (lines 27, 116), and an **allocation** partitioning misdirects
(line 250).

**Concrete consequence.** An operator tuning `maxFilesPerDiscoveryCall` for a monorepo
reads lines 42–50 as established law and extrapolates from a fit the project has since
falsified. And line 260's gate — *"Any future proposal in this family MUST first explain
why it is not one of these four"* — is undercut by surviving text that invites a fifth.
Note this compounds F11: the yield law was fitted on the same defective sweep.

**Correct position.** Annotate lines 42–61 in place: the *empirical file-level effect*
stands, the *yield law* does not. Pick one meaning for "attention", or split the term.

---

## Part II — read and found sound

**Spec 22.** *"The Precision Bar Is Unfalsifiable On This Corpus"* (169–190) is correct
and correctly reasoned — the key enumerates the dependents an upstream fix *repaired*, so
an unlisted prediction is not thereby wrong and only a lower bound is computable, *"a
property of the answer key rather than of its size"* — and it names its own prior error
(the confidence-interval argument in the 2026-08-09 prereg) rather than dropping it.
*"Zero References Has Two Causes And They Must Be Told Apart"* (192–215) matches the
ledger's 2026-08-08 correction fact-for-fact. The VOID of the first adjudication
measurement (848–976) is genuinely disconfirmatory — 12 packets replayed, the cited-line
rule checked and found never to have fired in 18 calls. *"The Cap Selects, It Does Not
Truncate"* (1078–1214) reports its own precision lower bound *falling* rather than
explaining it away, and refuses to move `maxReferencesPerSymbol` to 400 even though that
reaches 8 of 11 dependents (*"a default moved to make corpus cases score is
fixture-fitting"*). The removal-pairing `inconclusive` third outcome — *"'we searched and
found no replacement' and 'we could not search' are different statements"* — is the
silent-optimism class anticipated rather than discovered. And the **JavaScript
blind-spot retraction** is a limitation retracted against the author's own interest, with
the superseded ledger entry left standing as a dated record.

**Spec 24.** *"Structural Grouping Is Not Membership"* (268–326), and specifically the
note that *"the measurement did not discriminate between the candidate quantifiers"* —
all of `any peer`, `three peers` and `majority of peers` produced identical counts, so
the choice is recorded as argued rather than measured, *"so a future measurement that
does discriminate is recognised as new information rather than as a contradiction"*.
*"Fixture Minability — Measured, And Worse Than Predicted"* and *"The Case It Was Written
For: Necessary, Not Sufficient"* (527–551) — built the feature for one case, measured that
the case still reports nothing, refused to relax the three-cited-peer MUST to reach it.
*"The Work Bounds Amputated the Change"* (648–700): correct diagnosis (a sorted list
sliced at the front is not a sample) with correctly scoped invalidation. And the
reader-precision paragraph at 36–39 is the single best paragraph across all the specs in
this audit — it is the argument F1 and F12 both say is missing elsewhere.

**Spec 25.** The Outcome (6–50) matches ledger 2026-07-30 line for line, deletes both
arms per its own pre-registered rule with no "off by default and revisit", and records
the unlisted-real rise (4 → 11 → 14) as an explicit **hypothesis, not a result** — which
the fragmentation diagnosis then vindicated (16 distinct findings: 0 genuine-unlisted,
13 restatements). Refusing the post-hoc rescue was right on evidence that arrived later.
The *"Superseded 2026-08-02"* note on `declaration-analysis` is verified accurate
(`src/domains/declaration-analysis/` is absent from the tree).

**Spec 27.** The sub-file rejection section (199–263) is faithful to its result report in
every figure, correctly reports p = 0.0576 *against* the treatment, correctly refuses the
one favourable cell (`callee` +6.2pp on n = 8) as post-hoc subgroup mining, and honours
the pre-registered refusal to add seeds near the bar. The ledger's claim that *"spec 27
now records the finding in place of the design"* is **true** — the withdrawn requirements
really are withdrawn.

**Spec 29.** The structural reasoning is right throughout: never a finding, never
gate-affecting, never SARIF, never an inline comment; the no-configuration-key argument;
`unknown` representable and distinct from zero; `consideredFileCount = pairedFileCount +
|unpairedPaths|` enforced by schema; absent ≠ computed-zero; and the explicit refusal to
let this spec authorise a model-judged test-quality lane. **The refusal to loosen pairing
to "any test in the directory" after seeing the failing number** — because it would
convert a failed pre-registered bar into a pass — is this spec at its best, and it is the
same integrity F16 asks it to extend to its own prose.

**Spec 30.** The transport boundary (F17) and requirement 6's non-blocking guarantee are
both genuinely airtight; I looked specifically for a hole in the latter across gate
failure, missing provider and no-PR-access and did not find one. Reusing
`extractFindingMarkers` rather than writing a second parser is correct.

**Spec 31.** *"What This Spec Refuses"* (119–129) and the blinding discipline are the
strongest methodological writing in this audit: refusing advisory-only shipping in
advance, refusing to measure against the engine's own output, refusing maintainer
approval as evidence of good design, discarding the leak-contaminated first run rather
than adjusting it, and **disclosing the looser definitions that would have cleared the
bar while declining to use them**. F19 attacks the inference from the number, not the
conduct of the study.

**Spec 28.** The diagnosis of the 24,000-byte cap (18–25) is accurate and independently
corroborated by the spec 16 verdict reversal. F20 is about what shipped afterwards.

---

## Minor, recorded not escalated

**Spec 17, lines 245–247.** *"the current baseline on the clean 37-case /
87-expectation corpus (results ledger, marked CURRENT) reads **in-diff 64.4%
(116/180), out-of-diff 0.0% (0/81), blended 44.4%**"*. The ledger's CURRENT entry is
now 2026-08-05: **in-diff 68.3% (sd 2.89pp), out-of-diff 0 of 27, blended 47.1%**,
engine `db78900`, three seeds. The transcribed number is 3.9pp stale. I am not
escalating it because the spec does the right thing structurally — it points the reader
at the ledger's CURRENT marker rather than claiming authority, marks its own figures
*"Superseded for quoting purposes"*, and says outright *"Every figure in this
subsection was derived by hand, which is why each has had to be dated and superseded by
hand."* The fix is to drop the transcribed numbers and keep only the pointer; the
argument the section exists to make does not use them.

**A cross-cutting observation on out-of-diff.** No spec in this scope states
out-of-diff recall as an achievable requirement — spec 17 explicitly refuses to decide
whether it is in scope. But out-of-diff expectations remain **31% of the
real-repository key** while measured at **0 of 27 across every seed of every run**, and
the ledger records the lever family as exhausted (6 structural + 5 prompt attempts, all
null). The consequence is that the blended figure this corpus can ever report is capped
near 69% by a population now known unreachable. That is a product decision spec 17
correctly leaves open — but it has been open long enough that "leave it visible" is
itself starting to function as a decision, and nothing records that the option to
retire the population has been considered and declined.

## Summary table

| # | Spec | Lines | Shape | Consequence |
|---|---|---|---|---|
| F1 | 23 | 508–520 | Containment argument contains the wrong thing; contradicts lines 555–563 | Default flip reads as low-risk; the listed guards do not touch a human believing a wrong `evidenced` |
| F2 | 23 | 881 vs 941–949 | Requirement now known unreachable | The ship gate renders as "not measured"; the lane already shipped on |
| F3 | 23 | 908–911 | A control that cannot register the endpoint | Bold `false-satisfied claims: 0` over an empty answer key, on the deciding metric |
| F4 | 26 | 23–26 | Evidence refuted by the experiment; one word, two mechanisms (spec 27 records the correction, spec 26 does not) | Re-applying spec 26's reasoning to `maxFilesPerDiscoveryCall` costs 11.3pp recall, unwarned |
| F5 | 26 | 28–92 | Silence: a capability that has never fired | Split-path requirements defended only by unit tests, with no signal that this is so |
| F6 | 15 | 728–777, 688 | Superseded measurement, reversed diagnosis, two corpus sizes in one section | Already cost one null intervention; sets up the next one at the wrong mechanism |
| F7 | 16 | 90–95 vs 262–272 | Claim contradicted by the spec's own table | Operators rule out the default-on lane when debugging a lost finding |
| F8 | 16 | 315 vs 297–302 | Unachievable criterion; metric declared absent that exists | Cross-file acceptance unevaluable while spec 15 prints the number |
| F9 | 12 | 379–404 | Endpoints circular and base-rate degenerate; hypothesis untested by its own plan | A 97–99% number will be read as confirmation of a claim it cannot address |
| F10 | 23 | 1006–1009 | "Identical in both" is not identical; default moved traffic to the weaker path | A bound limit produces silence on the path that is now the default |
| **F11** | **27** | **183–197** | **Default chosen on an engine whose partitioning was broken; fix landed next day, never re-run** | **Always-on default costing +89%; operating point unvalidated, true knee may be below 2** |
| F12 | 22 | 160–167 | Containment argument contains pipeline damage; pre-registered rule was about reader cost | ~5% precision list in the PR comment by default, under a "Callers" header the lane cannot justify |
| F13 | 22 | 164–165 | "Rejected" computed on the denominator the spec forbids; the pre-registered one cleared the bar | The only triage layer is locked off as "rejected" when it is undecided |
| F14 | 24 | 7–46 | Kill measurement absent from the ledger, unpinned, unreproducible; stale bolded line 610 | Three planning docs close a lane on an unrecorded citation chain |
| F15 | 25 | 110–126 | Prior-art row reversed by the ledger, not corrected after a later edit | The next attempt is steered away from the one intervention that measured a gain |
| F16 | 29 | 50–51, 132–135 | "Cannot mislead" measured false; disclosure names the minority mode | Reviewer asks for a test already in the diff (84.1% of firings) |
| F17 | 30 | 44–50, 93–98 | Boundary holds in mechanism, fails in effect: reply buys a stochastic re-roll | Demotion by reply volume; the code already refuses the spec's mandated vocabulary |
| F18 | 30 | req 5 vs Configuration | Requires a bound, forbids the only place to put one | One full paid review per reply, unbounded, on comment access |
| F19 | 31 | 55–56, 88–91 | Measured recovery, concluded constructibility; n=24, CI spans the adjacent verdict | A built corpus permanently frozen while it decays |
| F20 | 28 | 38–40, 66–84 | Only shipped default with no measurement; containment aimed at a mode measured absent | Unbounded read enters the packet, paid once per partition |
| F21 | 27 | 42–61 vs 244–250 | Falsified yield law left standing unmarked; "attention" used for two things | Operators extrapolate from a curve the project measured through |
