# 23: Intent-Fulfilment Review

Status: Approved
Date: 2026-07-27
Amended: 2026-07-30 — a citation may name a removed line (see *Amendment* below)
Second Amendment: 2026-07-31 — two demoting designs rejected; **annotates, never demotes**
**Second Amendment WITHDRAWN: 2026-08-01 — all three aptness designs rejected; the
stage is REMOVED. `intent check` has no citation-aptness call.**
Vocabulary: 2026-08-01 — the report says `evidenced` / `not-evidenced`, never
`addressed` / `unaddressed` (see *Output Vocabulary* below)
Fourth status: 2026-08-06 — an obligation satisfied by ABSENCE gets `not-contradicted`,
its own verdict, and leaves the headline count (see *Obligations Kept By Changing
Nothing*). **UNMEASURED: no accuracy figure in this spec postdates it.**
Provider-cut intent: 2026-08-03 — a source the ingestion provider had already cut is
**disclosed, never refused** (see *Limits Refuse; They Never Truncate*)

## Output Vocabulary (2026-08-01): `evidenced`, not `addressed`

The report emits **`evidenced`**, **`not-evidenced`**, **`not-contradicted`** and
**`undetermined`**. It no longer emits `addressed` or `unaddressed`, and there is no
alias for either. (`not-contradicted` joined the set on 2026-08-06; the section
*Obligations Kept By Changing Nothing* below is its record, and the rest of this
section is as written on 2026-08-01.)

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

- The report MUST emit `evidenced`, `not-evidenced`, `not-contradicted` and
  `undetermined` and nothing else. No alias, no back-compatible spelling, no
  dual-accepting schema on the engine side.
- The headline count is **`notEvidencedCount`**. It counts `not-evidenced` plus
  `undetermined`, and neither an `evidenced` nor a `not-contradicted` obligation is
  ever on it.
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

## Obligations Kept By Changing Nothing (2026-08-06)

`not-contradicted` is a fourth verdict, for the obligation shape that produced the
**largest single share of this lane's false positives and could never have produced
anything else**.

### The defect, and why no wording could fix it

The 2026-08-01 classification of 83 false positives attributes **33 of them (39.8%)**
to obligations satisfied by ABSENCE — a prohibition, a "leave this alone", a "do not
log that". The diagnosis is explicit that the judgement answered correctly: *nothing
among the changed lines did what the obligation asked*. The engine's only available
answer for that was `not-evidenced`, which is on the headline outstanding list.

So an obligation honoured by touching nothing appeared as outstanding **on every run,
forever, however completely it was kept**. That is a false alarm by construction, not
a judgement error, and it is unreachable by prompt wording: there is no line to cite,
so no instruction can produce one. The 2026-08-01 rename could not touch it either —
it changed the words on the answer, and this is a missing answer.

### The verdict, and what makes each word honest

**`not-contradicted`: the obligation asks that something not be done, and nothing
among the changed lines does it.** Every part of that is a property of material the
judgement was actually shown, which is what makes it sayable at this scope:

- it is **not** a claim that the obligation holds at head. Unchanged code this run
  never saw can break a prohibition, and the verdict is named for the search rather
  than for a state of the world so that it cannot be read as one;
- it is **not** a claim that the change UPHELD the obligation. A change that puts the
  restriction in place is `evidenced` and cites the line that does it. A change that
  merely never went near the subject is this. **The two are different claims and the
  vocabulary must not blur them** — that is the whole reason for a separate word
  rather than an `evidenced` with no citation;
- it carries **no evidence field at all**, at the schema level. There is nothing to
  cite, and a slot would invite a line to be invented for it.

### What this requires

- The verdict MUST be decided by the **existing judgement call**, as a fourth
  permitted answer. No classification stage, no second call, no per-obligation
  agentic loop: the whole cost of this capability remains one extraction, one
  judgement per obligation, and one explanation.
- The judgement prompt MUST state three boundaries, because the 2026-08-02
  repeatability probe measured that what this prompt leaves open the model re-decides
  per call (two runs agreed on 87.0% of shared verdicts, and the flips concentrated
  on the cases the prompt did not settle):
  1. an obligation asking for work to be **carried out** is never
     `not-contradicted`, however far the change stays from it;
  2. a changed line that **puts the restriction in place** is `evidenced`, with that
     line cited;
  3. a changed line that **does the very thing the obligation rules out** is
     `not-evidenced` — it reaches the list a human reads.
- `not-contradicted` MUST be counted separately (`notContradictedCount`) and MUST NOT
  be part of `notEvidencedCount`. Removing it from the headline is the entire
  behavioural effect of the status; everything else is vocabulary.
- **A `not-contradicted` verdict MUST be downgraded to `undetermined` when any
  changed file was left out of the lines the judgement saw**, and the downgrade MUST
  be disclosed. The claim is a search that came back empty, so it is worth exactly
  what the searched surface was worth; over a change part of which was never read it
  is a reassurance drawn from lines nobody looked at, which is this project's
  recorded silent-optimism defect shape. It downgrades to `undetermined` and never to
  `not-evidenced`: failing to see the whole change is not evidence that the change
  goes against the obligation either.
- The rendered report MUST state, beside the section, that the verdict is a search
  over the changed lines and neither a check that the obligation holds elsewhere nor
  a claim that this change established it.

### Satisfied outside the diff (25.3%): the scope stays where it is

The second bucket — **21 of 83 false positives** — is obligations that genuinely hold
at head because an earlier commit or pre-existing code made them hold. Two routes
were available: widen what the judgement may consult, or keep the scope and make the
report say precisely *"this change does not evidence it"*.

**The scope stays where it is, and the work went into the reporting.** The reasons,
in the order they bind:

1. **This spec's Purpose is the change-scoped question** — *"report what a change has
   not been shown to cover"*. Widening the judgement to head would make the
   capability answer *"does this hold at head?"*, which is precisely the conflation
   that produced 65.1% of the false positives in the first place. The fix for a
   question mismatch is not to start answering the other question badly.
2. **The judgement call is the one call that must not argue with itself.** Consulting
   more of the repository means tools and more than one step on exactly the call
   whose freedom from a free-text field is this spec's binding constraint, with
   measured over-rejection of 26–36% rising to 73–88% behind it.
3. **A citation must remain checkable.** Evidence is verified against the changed
   lines; an obligation satisfied by unchanged code has no citation this report is
   allowed to make. Widening what may be consulted without widening what may be cited
   moves those obligations from `not-evidenced` to `undetermined` — both on the
   headline — and buys nothing.
4. It costs nothing to keep the scope. This route adds **no model call and no token**.

What was built instead is at the surface where the distinction is still throwable
away: the **explanation call**, which writes free prose over the frozen mapping and is
the part of the report a skimming reader takes as the whole account. It is now
required to write only about what the change SHOWS, and forbidden to describe an
obligation as missing, undone, unimplemented, incomplete, forgotten or still needed —
because the mapping cannot tell an obligation nobody has done from one an earlier
commit finished, and a summary that picks one is making a claim the mapping refused
to make.

This route is a reporting fix and is **not claimed to raise recall or to recover the
21**. Scored against an answer key that asks whether the state holds at head, an
obligation satisfied by an earlier commit will still count against this lane. That is
a property of the question the two artefacts ask, and the honest response is to keep
the words exact rather than to change the answer.

### What was deliberately NOT built

- **No `contradicted` verdict.** A changed line that does the very thing an
  obligation rules out is reported `not-evidenced`, which is literally true — nothing
  among the changed lines does what the obligation asks — and puts it on the list a
  human reads. A verdict of its own would be a new claim class in a lane whose only
  measurement predates this change, aimed at a bucket the diagnosis does not report
  as a problem. The safe destination already exists; a new label would need its own
  evidence.
- **No prohibition classification in the extraction call.** Shape is a property of the
  obligation text, so extraction could label it — but the verdict still needs the
  judgement to confirm no changed line violates it, and splitting one decision across
  two calls creates a way for them to disagree with nothing to arbitrate.
- **No fourth aptness attempt**, in any form. See the rejected-design record below,
  which is unchanged.
- **No widening of the judgement's scope**, per the route decision above.

### Pre-registered success statement (written 2026-08-06, before any measurement)

This change is **unmeasured**. The statement below is registered before the first run
so the result cannot be read into it afterwards. It is scored on a corpus fixed
before the result is read, against one pinned engine, n ≥ 2 per case, with the
existing hand labels untouched.

**It worked if all four hold:**

1. **Outstanding precision rises to ≥ 60%** from the 51.5% (88/171) base. The
   prediction under the classification's own arithmetic is ~64% — 88/(171 − 33) if
   every absence-satisfied false positive leaves the list and no true positive leaves
   with it. That arithmetic is a prediction, not a measurement, and the threshold is
   set below it deliberately.
2. **Unaddressed detection does not fall by more than the noise band** (sd ≈ 4.8pp on
   this corpus). Obligations genuinely outstanding at head must keep reaching the
   list. A precision rise bought by emptying the list is a failure, not a result.
3. **The false-satisfied rate does not rise** — and for this purpose, **a wrong
   `not-contradicted` counts as a false-satisfied claim**, on the same footing as a
   wrong `evidenced`. It is the new risk this change creates: an obligation the change
   really violates, or one genuinely outstanding at head, reported as not contradicted.
4. **Spend does not rise beyond token noise.** No new call was added, so a material
   rise means something other than this change happened.

**It failed if** precision rises while (2) or (3) fails. Under this spec's own
ordering that is the worse outcome, not a mixed one: a capability that misses
outstanding obligations is incomplete, while one that wrongly clears them is harmful.

A re-measurement of this lane is **owed** before any figure recorded in this spec or
in the results ledger is compared across 2026-08-06. Every accuracy number in this
document predates the fourth status, and none of them may be quoted as if it
described the current engine.

### How the measurement scores `not-contradicted` (2026-08-06)

The pre-registration above is only unambiguous if the instrument agrees with it, and
until this was written the instrument had not been told the verdict exists. Its
scorer classified an obligation as outstanding on `not-evidenced`, `undetermined` or
the pre-rename `unaddressed`; `not-contradicted` matched none of those and would have
fallen through to "satisfied" **by accident rather than by decision** — a figure whose
meaning nobody had chosen, which is the defect shape this project records as silent
optimism. The classification is now explicit, and the reasoning is in the scorer
beside it.

**The decision: `not-contradicted` is OFF the outstanding list, and that is not the
same as correct.** The scorer's one question is *"did the run leave this obligation on
the list a human reads?"*, and this spec requires the engine's answer to be no. A
scorer that put the row back on a list the engine took it off would be grading a
report nobody receives. What follows from the decision is the part that matters, and
both halves fall where this spec put them:

- an obligation the answer key calls `outstanding` that comes back `not-contradicted`
  is **a recall loss** — it is absent from reported outstanding recall, and from
  end-to-end recall too when a fixed human item names it. Verified on the stored
  round: flipping one such row moves reported recall 84.6% → 83.7% and end-to-end
  81.2% → 79.7%;
- **and the same row is a false-satisfied claim**, counted in that rate's numerator on
  the same footing as a wrong `evidenced` — which is what point 3 of the
  pre-registration demands. Verified on the same flip: 6.0% → 6.4%. The scorer does do
  what the pre-registration says it must.

**The volume is now printed** (`not-contradicted verdicts N of M reported`, with the
subcount the answer key calls outstanding), because the verdict's whole behavioural
effect is to remove rows from a count — without a line of its own that effect is
invisible and every rate moves for no stated reason. A degenerate result is called out
in both directions: zero says the verdict is unreachable rather than that nothing
needed it, and a share past half says it is being handed to obligations that ask for
work, which the first prompt boundary forbids.

**An unrecognised status now throws** rather than being scored as anything. A fifth
verdict must not be able to enter a published number the way the fourth nearly did.

#### What the answer key can and cannot say, checked rather than assumed

`ground-truth.mjs` has **no label for obligation shape**, and none was added: shape is
a property of the statement text, and inventing a hand label mid-measurement would be
changing the answer key. It does not need one. Its truth rule already binds the case
that decides this classification — *"a clause describing a COMPONENT THAT DOES NOT
EXIST is `outstanding`, whether it is phrased as a capability or as a prohibition"* —
and **ten labelled rows are prohibition-shaped and labelled `outstanding`**, among
them *"Never emit detected secret values"*, *"In event mode, the platform provider
must not use network access"*, and *"The model call must not ask whether code is
vulnerable, exploitable, or insecure"*.

**Three of those ten are named by the FIXED human enumeration**, one of them in the
human's own words: `pw17-spec24-req/obl_16` — *"the prohibition on asking the model
whether the code is vulnerable is likewise undischarged"*. So the corpus does contain
the case where the new verdict would be wrong, and it can lose recall on it. Nothing
was added to `humanOutstanding`; it remains the fixed enumeration this spec's harness
never extends because a run surfaced something new.

That is also the standing answer to *"what would make this classification wrong?"*:
it holds only while the answer key treats a prohibition as capable of being
outstanding. If a later key ever made prohibitions `unclassifiable`, the scorer would
be agreeing by luck and the decision has to be re-taken.

#### Both scorers, one definition

`score.mjs` joins the answer key by positional obligation id, so it can only ever
score the ONE round the labels were written against. A re-run — which the
pre-registration requires, at n ≥ 2 per case — is scored by `score-carried.mjs`, which
matches statements instead. **That second scorer is the one a pre-registered result
actually lands on**, and it held its own private copy of the mapping: three `===`
comparisons and no final else. The fourth verdict would have been absorbed there by
fallthrough while the sibling scorer had been told about it.

The classification is therefore not written twice. It lives once, in
`.codereviewer/eval/reported-status.mjs`, and both scorers read it, so the two cannot
drift about what a verdict means. Both now throw on an unrecognised status and both
print the count. `score-carried.mjs` places **every** reported status before scoring
anything, including rows its statement matcher will drop — an unknown verdict hiding
in an unmatched row is precisely how one would reach a published number unnoticed,
since unmatched rows are silently unscored by design.

The false-satisfied property was verified in `score-carried.mjs` directly rather than
inferred from the sibling: flipping one carried-`outstanding` row in a stored round
from `not-evidenced` to `not-contradicted` moves outstanding recall 100% → 91.7% and
false-satisfied 0/18 → 1/19, with the new count reading `1 … of those, truth
OUTSTANDING 1`.

**Still outside the shared module**, and stated so it is not mistaken for done:
`intent-corpus/score.mjs` — the commit-message corpus, a different corpus with its own
scoring shape and not in scope on 2026-08-06 — keeps its own status clauses. It is
owed the same treatment before another verdict is added.

One further hazard the same pass made visible rather than fixed silently:
`score-carried.mjs` totals whatever case ids it is handed, and this corpus **never
pools its two arms**. It now names the arms in the total and says loudly when both are
present. Run it once per arm.

#### One corpus case sits exactly on the obligation cap, and flips between rounds

`pw09-spec15-measure` is configured at `maxObligations: 40`, and its extraction
produces **about forty obligations**. When it produces forty, the run refuses with
`intent_too_many_obligations` and exits 4 — correctly, per *Limits Refuse; They Never
Truncate*: reporting the first forty would under-report what is left, which is the one
direction this command must not err in. When extraction lands one short, the same case
scores normally.

Extraction is not deterministic, so **the same case refuses in one round and scores in
the next**. It did exactly that on 2026-08-06: scored in round A, refused in round B.
Anyone re-running this corpus needs to know that before reading a between-round delta
as an effect of anything, because the case carries roughly forty obligations and its
presence or absence moves several rates on its own.

**The cap is not raised to make it pass.** Changing a cap mid-measurement is a
confound, and this corpus has the receipt: the capped-to-uncapped move is recorded as
worth **27.6 points of end-to-end recall**. A cap change would swamp anything the
fourth verdict does. The refusal is correct behaviour and stays.

What changed is the instrument, which previously died on it with a raw
`SyntaxError: Unexpected end of JSON input` — a legitimate engine outcome surfacing as
noise instead of as data, the same defect shape as the verdict that fell through. A
case with no report is now **classified** by `.codereviewer/eval/run-outcome.mjs`:
`refused` (exit 4, with the structured code) is reported separately from `failed`
(a crash, a truncated write, a missing file), because "the engine declined to answer"
and "the run broke" are different facts. Either way the case is **excluded from every
rate with its id and reason printed** — never counted as a case with zero obligations,
which would drag every rate down while looking like a result.

And because a case that scores in one round and refuses in another silently changes
the denominator between them, `score-carried.mjs` now scores **only the cases every
requested round scored**, prints that denominator, and names what differs. A figure
quoted from the scoring round alone includes the case and is therefore not the figure
the comparison prints.

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

The false-satisfied route documented below is **open and unmitigated for `evidenced`
verdicts**, and no design tried so far mitigates it at a price worth paying. The
lane therefore ships with a measured, named failure mode rather than a mitigation
— a better state than one that costs five good verdicts per bad one caught, or one
that spends a call per obligation to add 18.1% of the lane's false positives.

**The default changed on 2026-08-11 and the measurement did not.** The lane is now
on by default, so this failure mode reaches every reader instead of only the ones
who opted in. That is a product decision about which questions a review answers,
made with the route above known and unfixed; what contains it is unchanged and is
what makes the decision defensible — the lane cannot gate under any configuration,
its output is advisory, an `evidenced` verdict whose cited lines are not lines the
change touched is downgraded and counted, and the judgement call returns no free
text. Nothing here reduces the obligation to fix the route, and nothing about the
flip is evidence that it is smaller than measured.

**What changed on 2026-08-06, and what did not.** The largest bucket of false
positives — 33 of 83, obligations satisfied by absence — is addressed at the
vocabulary rather than by a check: `not-contradicted` gives that shape a verdict it
can honestly hold, and takes it off the headline count. That is not a mitigation of
the false-satisfied route; it **widens the surface that route applies to**, because a
prohibition the change really violates, or one genuinely outstanding at head,
reported as not contradicted is a satisfaction-shaped claim of the same family. Two
things stand against it, and neither is a model call: the three prompt boundaries
that keep the verdict to prohibitions, and the requirement that an incomplete change
surface downgrades it to `undetermined`. The pre-registration above scores a wrong
`not-contradicted` as a false-satisfied claim for exactly this reason. **No
measurement exists on either side of that yet.**

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
plus `undetermined`**, and neither an `evidenced` nor a `not-contradicted` obligation
is ever on it.

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
- **An obligation asking that something NOT be done MUST have a verdict of its own.**
  It is kept by changing nothing, so it can never produce a citation, and reporting it
  as unevidenced raises the same false alarm on every run. The verdict is
  `not-contradicted`, it is decided by the same judgement call, it carries no
  evidence, it is off the headline count, and it downgrades to `undetermined` when
  part of the change was not visible. See *Obligations Kept By Changing Nothing*.
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
- **False-satisfied rate** — of obligations reported as `evidenced` **or
  `not-contradicted`**, how many are not addressed at head? Per the failure mode
  above, this is the metric that decides whether the capability is safe to show
  anyone. Both statuses belong in its numerator from 2026-08-06: they make different
  claims, but a wrong one of either kind is a reason a reviewer stops looking, which
  is what this metric exists to count.

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
| The report emits `evidenced` / `not-evidenced` / `not-contradicted` / `undetermined` and no retired label | prompt test asserting the judgement instruction names the accepted answers and no retired one, plus normalizer unit tests |
| `notEvidencedCount` counts `not-evidenced` and `undetermined` only, never an `evidenced` or `not-contradicted` obligation | unit test |
| A prohibition kept by changing nothing gets `not-contradicted`, carries no evidence, and leaves the headline count | run integration test |
| The three boundaries that keep `not-contradicted` to prohibitions are stated to the judgement | prompt test, one per boundary |
| A `not-contradicted` verdict over a change not seen whole becomes `undetermined`, and says so | unit test on the verifier plus a run integration test asserting the warning |
| The rendered prohibition section claims neither completion nor that the obligation holds at head | markdown test |
| The explanation call may not write an absence of evidence as work left undone | prompt test |
| Disabled by default | config schema test |
| Instructions stay generic and language-neutral | prompt genericity guard |

## How The Lane Is Invoked

The lane runs in **one of two places**, and the guarantees above hold identically
in both.

`review` runs it in-process after the review when `intentFulfilment.enabled` is true,
over the same run context — so one push issues one set of git subprocesses and
reads each changed file once, instead of once per stage, and the lane's report is
written into the REVIEW's own run directory rather than an unlinked directory of
its own. A reader holding a run id can find every stage's answer for that push.

`intent check` still runs it alone, for anyone who wants this question answered
without a review.

Running beside a stage that CAN fail the command is exactly where the
non-blocking guarantee would be lost by accident, so it is enforced structurally
in `src/cli/advisory-lanes.ts`: a throw from this lane becomes a warning on the
review report and an absent stage report, never a non-zero exit and never a lost
review. A disabled lane still runs nothing at all — being invoked from `review`
does not turn a stage on.
