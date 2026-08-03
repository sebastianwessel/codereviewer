# 23: Intent-Fulfilment Review

Status: Approved
Date: 2026-07-27
Amended: 2026-07-30 — a citation may name a removed line (see *Amendment* below)
Second Amendment: 2026-07-31 — two demoting designs rejected; **annotates, never demotes**
**Second Amendment WITHDRAWN: 2026-08-01 — all three aptness designs rejected; the
stage is REMOVED. `intent check` has no citation-aptness call.**
Vocabulary: 2026-08-01 — the report says `evidenced` / `not-evidenced`, never
`addressed` / `unaddressed` (see *Output Vocabulary* below)
Provider-cut intent: 2026-08-03 — a source the ingestion provider had already cut is
**disclosed, never refused** (see *Limits Refuse; They Never Truncate*)

## Output Vocabulary (2026-08-01): `evidenced`, not `addressed`

The report emits **`evidenced`**, **`not-evidenced`** and **`undetermined`**. It no
longer emits `addressed` or `unaddressed`, and there is no alias for either.

**Why the words changed, and it is not a matter of taste.** The judgement is shown
ONLY the changed lines, so the question it can answer is *"do these lines evidence
this obligation?"*. It cannot answer *"does this obligation hold at head?"*, because
it never sees the rest of the repository. `unaddressed` answered the second question
in the reader's head while the engine had only asked the first.

That was measured rather than supposed. The 2026-08-01 offline diagnosis classified
this lane's 83 false positives, and **54 of them (65.1%) were not errors at all**: 33
obligations satisfied by ABSENCE — a prohibition, where nothing changed and there is
therefore no line to cite — and 21 satisfied OUTSIDE the diff, by an earlier commit or
by code that already existed. In every one of those the judgement reported correctly
that nothing among the changed lines did what the obligation asked, and a reader — and
the eval's answer key — read the output as a claim that the work was undone.

The collision was exact. The ENGINE emitted `unaddressed` meaning *no evidence in this
diff*; the eval ANSWER KEY used the same word to mean *the state does not hold at
head*. One word, two different questions. This spec's own Purpose is *"report what a
change has not been shown to cover"*, which is the first question — so the engine was
answering correctly and the words on the answer were what misled.

### What this requires

- The report MUST emit `evidenced`, `not-evidenced` and `undetermined` and nothing
  else. No alias, no back-compatible spelling, no dual-accepting schema on the engine
  side.
- The headline count is **`notEvidencedCount`**. It counts `not-evidenced` plus
  `undetermined`, and an `evidenced` obligation is never on it.
- **The eval answer keys keep `addressed` / `unaddressed`.** They label TRUTH — whether
  the state holds at head — and those are the right words for that question. The
  scorers are where the two vocabularies meet, and they are the only place entitled to
  know both.
- Nothing this capability emits — status, count or prose — may be phrased so that *"this
  change does not show it"* reads as *"this was not done"*.

This is a renaming and nothing else. No verdict, count or decision rule moved with it:
the same obligations receive the same statuses under the new words, and no accuracy
number changes.

**Records written before this date are NOT restated.** The measurement records below
quote the labels the engine emitted when they were taken, and stored `report.json`
artefacts genuinely carry the old values. The scorers read both spellings for exactly
that reason — rescoring history under new labels would be silently wrong — while a new
run can only ever produce the new ones.

## Aptness check — REJECTED DESIGN, REMOVED 2026-08-01

**No citation-aptness stage exists.** Three designs were tried for the same signal
and **all three are rejected**. The third was built and shipped for one day; this
section is the record of why it is gone, and of what any fourth attempt has to
clear.

**Design 1 — demote on every `addressed` verdict.** Built and measured over 34
cases. It suppressed **five correct verdicts to remove one wrong one**, failing its
pre-registered exchange rate by more than double, and it **missed the case it was
written for**. Withdrawn.

**Design 2 — demote, gated to verdicts citing only removed lines.** Refuted
**offline, before any provider spend**, from the 34 stored runs. The gate engages on
31.5% of `addressed` verdicts and **skips all four known false-satisfied ones**:
three of the four cite added lines by their nature (a test line, documentation
prose, a spec file) and can therefore never be all-removed. It would catch zero and
still cost roughly 1.3 false downgrades. Not shipped.

**Design 3 — annotate, and change no verdict.** Built, shipped, measured, and now
**removed**. See below.

### Why design 3 was removed

Design 3 was reached by removing the cost side of designs 1 and 2 rather than by
fixing their signal: it changed no verdict, so a false downgrade was impossible by
construction. **The signal was unchanged, and so was its ~38% precision** — the
argument for shipping it was that a wrong flag now cost only a longer outstanding
list rather than a suppressed verdict.

That cost turned out to be the headline number.

- The results ledger's own verdict on the measured run: *"it works as designed and
  still costs more than it saves. WITHDRAW THE STAGE."* Its 8 downgrades attributed
  exactly: **1 benefit, 1 correct-by-necessity, 5 FALSE DOWNGRADES, 1 undecidable**.
  **The pre-registered exchange rate `2 × removed ≥ produced` FAILS: 2 × 1 = 2 < 5.**
- **It missed the case it was written for.** `s17/obl_13` — *"make runs that request
  the withdrawn context kind by name fail intake with exit code 2"* — came back
  `addressed` on the same removed lines with `inaptCitationCount: 0`. The aptness
  call read that citation and declined to call it inapt.
- The later false-positive diagnosis of the realistic corpus attributes **15 of 83
  false positives (18.1%)** to this stage: obligations whose judgement was **already
  correct**, pushed onto the outstanding list by an inapt flag. It is the third
  largest failure mode in the lane and the only one that is purely self-inflicted.
- Removing it is measured to raise outstanding precision by about **+4.1pp** and
  costs **no new model calls** — it removes one call per `addressed` obligation.

Annotating is not free. It was argued to be, on the grounds that a doubtful item
costs a reviewer ten seconds; measured, it cost a fifth of the lane's false
positives on the number the capability is read by.

### What is REQUIRED now

- `intent check` MUST make **no citation-aptness call**. One judgement call per
  obligation, plus one extraction and one explanation per run, is the whole cost.
- The report MUST carry **no evidence-concern field and no evidence-concern count**.
  There is no flag, no configuration switch, and no disabled code path — a dead
  switch for a rejected design is worse than its absence, because it reads as a
  decision still open.
- `notEvidencedCount` MUST count **`not-evidenced` plus `undetermined`, and nothing
  else**. An `evidenced` obligation is never on that list.

### The bar for a fourth attempt

Not "make the check stricter" — that makes it worse, for the base-rate reason below.
A fourth design MUST come with a pre-registered exchange rate and MUST clear it on a
corpus fixed before the result is read. Designs 1 and 3 both failed the same rate;
design 2 was refuted before it ran. **The signal has been measured three times and
has never paid for itself.**

### Why this is the honest ceiling for this signal

The check is **well calibrated and aimed at a rare event**: 2.0% false-inapt over
68 hand-verified pairs, against ~92% of `addressed` verdicts already being aptly
cited. Expected precision is ~38%. That is far too low to suppress a verdict and
perfectly adequate to raise a flag a human can dismiss in a second.

**What it did not do, stated plainly: a wrongly-certified obligation was still
reported as addressed.** Design 3 never closed the false-satisfied route. It made the
doubt visible beside the claim, which was argued to be the most 38% precision can
honestly buy.

**The claim that it "cannot make the capability worse" is the one that was wrong**,
and it is the specific mistake this record exists to preserve. A flag that changes no
verdict still changes the headline number, and 15 of 83 false positives (18.1%) were
that flag firing on a correct verdict. "Costs nothing because it demotes nothing" is
not a property a design gets for free; measure it.

### What the demoting designs measured (retained — the reason they were rejected)


| | before | after |
|---|---:|---:|
| false-satisfied (synthetic) | 4 | 3 — **only 1 attributable to the check** |
| **false downgrades** | 0 | **5 of 8 downgrades** |
| unaddressed detection | 90.0% | 92.5% (no regression) |
| deletion-heavy behavioural taken | 3 / 52 | 2 / 52 |

It **failed its own pre-registered exchange rate** (`2 × removed ≥ produced`) by
more than double: it suppressed **five correct verdicts to remove one wrong one**.

**And it missed the case it was written for.** `s17/obl_13` — *"make runs that
request the withdrawn context kind by name fail intake with exit code 2"*, the
exact verdict this amendment existed to catch — came back `addressed` on the same
removed lines, with `inaptCitationCount: 0`. The aptness call read that citation
and declined to call it inapt.

### Why, and this generalises

A 68-pair direct probe found the check is **correctly calibrated** — 2.0%
false-inapt on hand-verified apt evidence — and **pointed at a rare event**.
Roughly **92% of `addressed` verdicts are already aptly cited**, so:

- 2% of ~200 apt citations ≈ **4 wrong downgrades**
- 14% of ~18 inapt citations ≈ **2.5 right ones**
- expected downgrade precision ≈ **38%**, which is what the live runs produced

**Making the check stricter makes it worse**, because the false-positive term grows
with the large population and the true-positive term with the small one. This is
the base-rate collapse this project has already recorded once, in the
vulnerability-introducing-commit literature: a well-calibrated classifier aimed at
a rare event produces mostly false alarms. It was not recognised as the same shape
before building.

Two directions remain untried and neither is implemented: **narrow the scope** (run
only on behavioural obligations cited exclusively to removed lines, where the base
rate is far higher), or **annotate rather than demote** (flag the citation as weak
and leave the verdict alone).

*(Written before design 3. The second direction was then built as design 3 and
rejected on measurement; the first remains untried. Retained as written.)*

One thing that must **not** be claimed as its benefit: the deletion-heavy inapt
rate falling 33.3% → 0.0%. The check cannot improve a citation, only reject it.

### Consequence for the capability

The false-satisfied route documented below is **open and unmitigated**, and no design
tried so far mitigates it at a price worth paying. `intent check` remains **off by
default** with a measured, named failure mode — which is a better state than a
mitigation that costs five good verdicts per bad one caught, or one that spends a
call per obligation to add 18.1% of the lane's false positives.

---

## Second Amendment as proposed (retained for the record)

The 2026-07-30 amendment closed the deletion blind spot and, as predicted, opened a
new route to the one error this spec calls the costly one. Measured over 34 cases:

- **4 false-satisfied verdicts**, against 0 before;
- **52 deletion-heavy behavioural opportunities, 3 taken (5.8%)**;
- **33.3% of behavioural citations in deletion-heavy changes were inapt**.

The decisive case, a planted behavioural obligation:

> *"Make runs that request the withdrawn guarded-region context kind by name fail
> intake with exit code 2."*

Reported **addressed**, citing two **removed** lines — an enum member and a
comparison against it — from a commit that removes the kind and adds no intake
check and no exit path.

**Every structural guard passed.** `unevidencedAddressedCount` and
`uncitedObligationCount` were zero in all 34 runs. Both citations were real lines
the change really touched. The existing check asks *"is this a line the change
touched?"* and cannot ask *"is this line evidence for THIS claim?"* — and the
failure lives entirely in the gap between those two questions.

The measurement also shows the fix is reachable rather than speculative: on the one
obligation judged four times, three runs cited deleted schema keys and one cited
the added sentence *"now fails validation with exit code 2"*. **The apt citation
was in scope every time.** The model can find it; nothing asked it to prefer it.

### What this amendment requires

- An `addressed` verdict MUST additionally survive an **aptness check**: given the
  obligation and the already-verified citations, does the cited material *evidence
  that obligation*, or is it merely a line the change happened to touch?
- The aptness check MUST be a **separate model call over an already-frozen
  judgement**, exactly as explanation is. It MUST NOT be folded into the judgement
  call, because the measured over-rejection (26–36% rising to 73–88%) comes from a
  model justifying a verdict in the same breath as reaching it.
- Its output schema MUST carry **no free-text field** — enum and identifiers only,
  for the same reason the judgement schema does.
- An obligation whose citations are judged inapt MUST be **downgraded to
  `undetermined`**, never to `unaddressed`: inaptness of the evidence is not
  evidence that nothing addresses the obligation. It MUST be counted, so the rate
  is visible rather than absorbed.
- The check MUST be able to answer *undetermined* itself, and an undetermined
  aptness answer MUST leave the `addressed` verdict standing. The check exists to
  catch a specific, demonstrated failure, not to become a second gate that
  suppresses correct verdicts — which is how a capability with 90% unaddressed
  detection would be turned into one that reports nothing.

The safety direction is unchanged and is the whole point: this can only make an
`addressed` verdict weaker, never stronger, and can never turn `unaddressed` into
`addressed`.

## Amendment (2026-07-30): a removed line is evidence

The original requirement said an addressed obligation must cite "path and line".
Implemented literally against the added side, **that made deletions unprovable**:
a deletion creates no line to point at, so *"remove the old caching layer"* could
never be judged addressed no matter how completely it was done.

Measured on this repository's own revert commit `52ff75d`, using its commit
message as the stated intent:

| obligation shape | count | result |
|---|---:|---|
| *"Remove X"* | 9 | **7 unaddressed, 2 undetermined — all wrong** |
| *"Keep X"* / *"Make X"* | 6 | **6 addressed — all correct** |

Every removal failed; every addition succeeded. On a revert, refactor or cleanup
change — a large share of real work — the command told a reviewer that most of the
change had not been made.

The requirement's purpose is *"never claim something is done without showing me
where"*. A removed line satisfies that purpose exactly: it is an exact address a
reader can confirm in the diff. The rule was written with additions in mind, not
with a judgement that deletions should not count.

The amendment therefore widens what a citation may name and adds an obligation to
disclose the side, so the safety property is unchanged: an `evidenced` obligation
still cannot survive without a verified, human-checkable address.

Recorded date: 2026-07-30. This is the first amendment to an approved spec in this
project made after implementation; the measurement that forced it is in
`reports/eval-results-ledger.md`.

## Purpose

Report **what a change has not been shown to cover**, against its stated intent —
the pull-request description, a linked ticket, a commit body — so a human can see
at a glance what the change does not evidence. What it does not evidence is not the
same as what is undone, and the vocabulary above exists to keep the two apart.

## Limits Refuse; They Never Truncate

Every input limit this capability has — the stated intent, the changed lines, the
obligation count — MUST **refuse the run** when it binds. None may truncate.

This is a correctness requirement, not a preference. A truncating limit answers a
question it was not able to answer, and the caller cannot tell that from a real
result:

- bounding the changed lines makes a judgement report an obligation `not-evidenced`
  because its evidence was not shown — a wrong answer on the only question asked;
- bounding the obligation list under-reports what is left, which is the single
  direction this capability must not err in;
- bounding the intent extracts a checklist from part of a ticket.

All three shipped as silent truncation, and all three were measured to bind on
ordinary input: 43% of this repository's last 60 commits exceed the old 400-line
default, and 24 of 28 corpus runs returned exactly the obligation cap.

The pattern to follow already existed in `packet-budget.ts`, which refuses an
oversized packet with *"the packet was NOT TRUNCATED; split the review scope
further or increase the budget"*. A limit whose binding produces a plausible answer
instead of an error is a defect regardless of its value, and raising the value
fixes only the symptom.

Each refusal MUST name its own error code, the value that bound, and the input that
exceeded it: `intent_text_too_large`, `intent_too_many_obligations`,
`intent_change_too_large`. Refusal exits **4** — distinct from configuration/usage
(2) and repository failure (3), and distinct from the fulfilment result, which never
changes the exit code at all.

The three limits are **runaway guards, not rations**, and their defaults are set so
that ordinary input does not reach them: at most **100** obligations, **100 000**
bytes of stated intent, **5 000** citable changed lines. Two of the three were
originally set as rations (20 obligations, 400 changed lines) and both were measured
to bind routinely. A value at which real input refuses the run is not a safe limit; it
is the same defect wearing an error message.

`maxObligations` also bounds spend — one judgement call per obligation, measured at
about $0.008 each over 37 runs — but the cost is set by the intent, not by the limit:
raising it cannot make a small ticket expensive.

**This does not conflict with the advisory rule below.** Refusing to run on input it
cannot fully see is not failing a pipeline on FULFILMENT grounds; it is the same
class as the configuration and repository errors this command already exits on.

Context that is genuinely optional enrichment — the reviewer's referenced
definitions — is the documented exception: dropping some of it degrades a result
rather than invalidating one, so it MUST be reported but need not be fatal.

### A Cut This Capability Did Not Make (2026-08-03)

Spec 11's `contextSources` providers bound each source at their own `maxFileBytes`
before this command is handed it — default **64 000** bytes, ceiling 1 000 000. That
cut is not one of the three limits above. It **MUST NOT refuse the run**, and it
**MUST be disclosed**.

Two reasons, and the first is decisive:

- that cap defaults **below** `maxIntentBytes` (64 000 against 100 000), so refusing
  on it would stop runs this spec deliberately sized the capability to complete. This
  section's own test applies: *a value at which real input refuses the run is not a
  safe limit; it is the same defect wearing an error message* — and this one is not
  even a value this spec chose;
- the remedy lives in a different configuration block, so `intent_text_too_large`
  would name a knob that was never reached and send a reader to raise it for nothing.

Disclosure MUST reach a human rather than only a JSON field. `scope.intentTruncated`
is true; a warning names the cut origins and `maxFileBytes`; and the rendered report
states, above the obligation lists, that every list is a floor rather than a total.

The loss is invisible to measurement downstream — a body cut to fit is a body that
fits — so the fact MUST travel on the fragment from the only place both sizes were
ever known. For the same reason `intent_text_too_large` MUST say that its reported
intent size is a **lower bound** whenever any gathered body arrived already cut.

## The Output Is A Search Result, Not A Certificate

This capability answers *"what is left?"*, never *"is this done?"*, and the
distinction is a safety property rather than a turn of phrase.

**It MUST NOT certify completion.** A report that says nothing is outstanding means
*this run found nothing outstanding* — it does not mean the change is complete, and
no part of the output may be phrased so a reader could take it that way.

The reason is the failure mode named below: the expensive error is a confident
*"that's handled"* on something that is not, because it stops a human looking. A
report that never asserts completion **cannot make that error**. What remains is
missing an item from the outstanding list, which costs a reviewer nothing they were
not already going to do — and which this spec's Evaluation section already ranks as
the cheap direction.

`notEvidencedCount` is therefore the headline number. It counts **`not-evidenced`
plus `undetermined`**, and an `evidenced` obligation is never on it.

That framing inverts the economics of every uncertain signal in the pipeline: an
obligation the run could not settle belongs **on** the list rather than suppressed
from it, because a doubtful item costs ten seconds to dismiss while omitting it costs
the thing this capability exists to prevent.

**That argument has a limit, and it was found by measurement.** It justifies keeping
an unsettled obligation on the list; it does not justify manufacturing doubt about a
settled one. The withdrawn aptness stage did the latter — it put `evidenced`
obligations on this list at ~38% precision, and 18.1% of the lane's false positives
were that term firing on verdicts that were already correct. A cheap-to-dismiss item
is still a false positive on the number the capability is read by.

This framing is also why the capability is comfortable being advisory. If it finds
something, that is useful; if it finds nothing, it has cost a little money and
asserted nothing false. There is no state in which it misleads.

## Why This Is Advisory By Design, Not By Preference

Two independent reasons, and the second is the stronger one.

**Product.** A pull request need not fully implement a ticket. Partial work,
follow-ups, and deliberately deferred scope are normal. A hard gate on
ticket completeness would block correct work routinely.

**Technical, and this is the binding constraint.** Published measurement of models
judging requirement conformance reports **systematic over-rejection**: spurious
rejection rates of 26–36% rising to **73–88%** when the same call is also asked to
explain its judgement or propose a fix. A hard-blocking fulfilment check built on
a single model call would therefore be wrong most of the time it fired.

The mitigation in the literature is validating a proposed change against tests
rather than arguing about conformance in prose. Until this capability has
something equivalent, its output is **advisory only**.

Google's operational definition applies here too: a finding a developer takes no
action on is an *effective false positive*, whatever its technical merit. A
fulfilment check that blocks merges would generate those at scale and train
reviewers to dismiss the tool.

## Command Surface

A **separate command**, for the same reason as spec 22: three capabilities behind
one report blend three different jobs into one score, which is the measurement
error this project already made once.

The change-intent input already exists. Spec 11 ingests external context from
bounded providers, redacts it, and injects it as a context-only `change-intent`
document. **That ingestion MUST be reused, not reimplemented.**

## Design

1. **Extract obligations.** From the stated intent, derive discrete, checkable
   obligations. Prose becomes a list.
2. **Map each obligation to evidence in the change** — or to nothing.
3. **Report the mapping**, not a verdict.

## Requirements

- The command MUST reuse spec 11's change-intent ingestion, plus intake, provider
  resolution, configuration, and reporting.
- Output MUST be **advisory**. The command MUST NOT be able to fail a pipeline on
  fulfilment grounds. This is not configurable, and the reason is recorded above:
  the underlying judgement is not accurate enough to gate on.
- Every reported obligation MUST cite **where in the stated intent it came from**.
  An obligation the reviewer inferred rather than read is not an obligation.
- An obligation judged `evidenced` MUST cite the change that evidences it — path and
  line. Unevidenced satisfaction claims are worse than silence, because they
  invite a reviewer to stop checking.
- **A cited line MAY be one the change REMOVED, identified by its line number on
  the pre-change side.** A removed line is evidence of the same kind as an added
  one: it names an exact address a reader can confirm in the diff. The report MUST
  state which side a citation is on, so *"done — this deleted line 42"* can never
  be misread as *"done — this added line 42"*.
- **Extra scope is reported neutrally.** A change doing more than the ticket asked
  is a normal and often desirable event, not a defect.
- The command MUST handle **absent or unusable intent** by reporting that plainly
  and exiting successfully. Most changes will have thin descriptions.
- Judgement, explanation, and any suggested follow-up MUST NOT share one model
  call. The measured over-rejection above is specifically what happens when they
  do.
- The judgement call's output schema MUST carry **no free-text field**. Two calls
  where the first still returns a rationale string satisfy the letter of the rule
  and reproduce the mechanism it exists to prevent: the over-rejection is caused
  by a model justifying a verdict in the same breath as reaching it, not by the
  call count. Explanation reads an already-frozen judgement.
- Obligations MUST be extracted from the redacted change-intent **fragments**, not
  from the summarised brief. The brief is a paraphrase, and a citation into a
  paraphrase does not identify where in the stated intent an obligation came
  from.
- Instructions MUST remain generic and language-neutral, per spec 15's
  Non-Negotiable.
- The capability is **disabled by default** until measured.

## The Failure Mode To Watch

The dangerous output is not "missed an obligation". It is **confidently asserting
an obligation is satisfied when it is not**, because that stops a human looking.

Evaluation MUST therefore treat a false *satisfied* claim as more costly than a
false *not-evidenced* claim, and report the two separately rather than in one
accuracy figure.

## Evaluation

This capability cannot be measured by any existing corpus. The spec 17 corpus is
built from upstream fix commits, which carry no pull-request description and no
ticket. Its `reviewIntent` field states the *correct* intent, so it can measure
nothing about mismatch.

A separate corpus is required, and it is **harder to build than the change-impact
one**: a pull request whose description genuinely disagrees with its change is
rare and is almost never labelled as such. Candidate sources:

- Pull requests whose review discussion identifies missing scope.
- Changes later amended with "also needed X" where X was in the original ticket.
- Reverts citing unimplemented requirements.

**Synthetic mismatches are permitted here, unlike elsewhere, but MUST be marked.**
A truthful description with one obligation removed is a valid negative fixture and
is far cheaper to produce than mining real mismatches. Synthetic and real cases
MUST be reported separately, because a synthetic mismatch is likely easier than a
real one and pooling them would overstate the capability.

Metrics, reported separately and never blended:

- **Obligation extraction** — do the obligations match what a human reads in the
  intent?
- **Unaddressed detection** — of obligations genuinely not addressed at head, how
  many does the run report as `not-evidenced`? The metric keeps the answer key's
  word because its denominator is a truth, not a reported status.
- **False-satisfied rate** — of obligations reported as `evidenced`, how many are
  not addressed? Per the failure mode above, this is the metric that decides whether
  the capability is safe to show anyone.

Decision rule, fixed before the first measurement: **ship only if the
false-satisfied rate is low.** A capability that misses unaddressed obligations is
merely incomplete; one that wrongly certifies them is harmful, and no amount of
recall compensates.

## Verification Matrix

| Requirement | Test |
| --- | --- |
| Reuses spec 11 change-intent ingestion | integration test asserting no second ingestion path |
| Cannot fail a pipeline on fulfilment grounds | exit-code test |
| Every obligation cites its source in the stated intent | unit test |
| Every `evidenced` obligation cites path and line | unit test |
| Absent intent reports plainly and exits successfully | integration test |
| Judgement and explanation do not share a model call, and the judgement schema carries no free text | harness test asserting distinct agents and distinct output schemas, plus a schema-shape assertion that the mapping output has no string field other than identifiers and enums |
| Extra scope is reported without a defect severity | unit test |
| No citation-aptness call: one judgement per obligation and nothing more | end-to-end provider-request count in the CLI test |
| The report emits `evidenced` / `not-evidenced` / `undetermined` and no retired label | prompt test asserting the judgement instruction names the accepted answers and no retired one, plus normalizer unit tests |
| `notEvidencedCount` counts `not-evidenced` and `undetermined` only, never an `evidenced` obligation | unit test |
| Disabled by default | config schema test |
| Instructions stay generic and language-neutral | prompt genericity guard |
