# Evaluation results ledger

Append-only record of every measurement, with what invalidates it. Newest first.

Corpus `real-repo-cross-file`: **37 cases, 87 expectations** as of 2026-07-27.
Entries above the clean-corpus baseline use earlier keys (36/80, then 31/74) and
do not pool across them; the tooling refuses cross-key deltas by digest.
Raw artifacts under `.codereviewer/eval/runs/<timestamp>/eval-report.json`.

---

## 2026-08-01 — Spec 23's "extraction is the bottleneck" diagnosis was 60% a BINDING CAP. Re-measured uncapped: end-to-end recall 53.6% → 81.2%

Detail: `reports/2026-08-01-intent-uncapped-remeasurement.md`. Capped runs preserved
run-for-run under `.codereviewer/eval/intent-corpus-realistic/runs-2026-08-01-capped/`,
which still reproduces its published figures exactly.

The entry below reported **52.9% end-to-end outstanding recall** and concluded the
extractor was too narrow to trust as a checklist. **24 of its 28 runs returned
exactly their configured `maxObligations` cap** (8–12, against a product default of
20), and `obligationsTruncated` reported `false` in all 28 and hid it. `76cfe3b`
fixed the flag; this round re-runs all 28 cases at a cap of 40, changing nothing
else. One case returned exactly 40 and was re-run at 60, where it returned 39. No
scored run is truncated.

### Single variable, and the movement is far outside the noise band

| pre-written arm, 21 cases | capped (8–12) | **uncapped (40)** |
|---|---:|---:|
| reported obligations | 192 | **469** |
| extraction fidelity | 100.0% (192/192) | **100.0% (469/469)** |
| outstanding recall, of what it proposed | 83.3% (40/48) | **84.6% (88/104)** |
| **outstanding recall, end-to-end** | **53.6% (37/69)** | **81.2% (56/69)** |
| **outstanding precision** | **69.0% (40/58)** | **51.5% (88/171)** |
| false-satisfied | 7.1% (8/112) | 6.0% (16/265) |

Permissive reading of the decision clauses moves every figure and changes no
conclusion: end-to-end 60.2% → **81.6%**, precision 76.6% → **57.4%**, false-satisfied
8.8% → 8.5%.

Denominator note: one item of the fixed human enumeration was **removed** as
factually wrong (`pw05`'s genericity-guard item — the guard *is* applied to the new
section text, from a new test file). Both rounds are restated on 69, which is why
the capped figure reads 53.6% here and 52.9% in the entry below.

### The answer, decomposed — extraction is NO LONGER the bottleneck

| how a leftover was missed | capped | **uncapped** |
|---|---:|---:|
| extractor **never proposed** an obligation for it | **24** | **4** |
| proposed and **wrongly judged addressed** | 8 | **9** |

**The cap accounts for 27.6 of the 46.4-point shortfall (≈60%), and for 20 of the 24
extraction misses.** Judgement misses are unchanged — exactly what a cap change
should do to a stage the cap does not touch, and corroborating evidence that this is
the cap rather than run-to-run drift. After the fix extraction is **4/69 (5.8%)** of
misses and judgement is **9/69 (13.0%)**. The binding constraint is now **precision,
51.5%**: roughly half the outstanding list is something an *earlier* change already
did, which the reviewed diff cannot evidence. `pw11` alone contributes 18 such
entries (33 obligations, 18 flagged, 0 genuinely outstanding).

The false-satisfied shape is unchanged and unaffected by the cap: *an obligation
about a thing that does not exist is credited to the nearest thing that does*, six of
sixteen instances.

### Post-hoc control reproduces exactly

7 cases, 60 → 89 obligations on the same diffs, **0 genuinely outstanding** in both
rounds, precision 0/6 → 0/7. A 1.5× larger sample does not make a commit message
contain leftovers.

### Recommendation: the default that landed mid-run (20 → 100) is SUPPORTED

`8993ab7` raised `maxObligations` 20 → 100 while this measurement was running, and
`70cde9b` then made the limit refuse (exit 4) instead of truncating. **This round
supports both and proposes no further change.** Eleven of 28 cases returned ≥ 20, so
20 reproduces this defect on 39% of this corpus; the case re-run at a cap of 60
returned 39, so the extractor stops well below 40 unaided; seventeen cases returned
fewer than 20 and cost the same at any cap. Cost per obligation is flat across the two
rounds ($0.0123 → $0.0108 — one judgement call plus one aptness call each), so **the
cap does not set the bill, the intent does**, and a generous default cannot make a
thin ticket expensive. Refusal rather than truncation argues for a *higher* cap, not a
lower one: a low cap is no longer a silent money-saver, it is a run that does not
answer, and the refusal happens before any judgement call so nothing is spent on work
that would be discarded. Unmeasured: anything between 40 and 100 — nothing here
produced more than 39 obligations.

Spend: **$6.3431** of a $9.00 ceiling — $6.0231 for the 28 scored runs plus $0.3200
for the superseded cap-40 run of `pw12`. 1.95× the capped round's cost for 2.21× the
obligations.

### Also found, recorded not patched

The context redactor mangles a backticked configuration constant: spec 11's
`` `task-context-change-intent` `` reached the extractor as `` `ta[REDACTED]` ``. A
secret-pattern rule is firing on a hyphenated identifier in backticks. Harmless here;
`src/` was not modified.

### What invalidates this entry

- **The engine was not pinned.** `run-case.sh` executes `src/cli/main.ts` from the
  working tree, and five commits landed on the branch during the sweep, so the runs
  span `76cfe3b`..`a374d09`. Assessed and inert on three checks: every case config
  sets all three limits explicitly so the default changes cannot reach them; the
  refusal `70cde9b` introduced fires only at the cap and **no scored run reached its
  cap** (max 39 at cap 60, 35 at cap 40), asserted from obligation counts rather than
  from `obligationsTruncated`, which `70cde9b` pins to false; and
  `intent-fulfilment` imports neither `context-retrieval` nor `review-workflow`. The
  extraction packet, judgement call, aptness call and all three prompts are identical
  across the run window. The clean form of this experiment pins the engine and this
  one did not — fix `run-case.sh` before re-running.
- One run per case, no variance band. The +27.6-point end-to-end move is far outside
  the demonstrated ±10% extraction noise; the sub-figures are not.
- The 4 remaining extraction misses are at the instrument's resolution limit, and one
  of them was proposed in the capped run and missed here.
- Precision 51.5% depends on the truth rule *"addressed means the demanded state
  holds at head, whoever made it hold"*. A reader who thinks only work in the
  reviewed diff should count would score it far higher.
- The 69-item denominator is the capped round's, deliberately, so the comparison is
  clean — but this round surfaced **39 obligations judged genuinely outstanding that
  no item of that list names**. Neither round's end-to-end figure is an absolute
  coverage rate; the difference between them is what is established.
- Spec sections are unusually well-formed intent. 22 obligations per case is not a
  forecast for a Jira ticket.

---

## 2026-08-01 — Stage 1's context budgets are sized for a previous generation of models

Raised as a question about whether the caps are anachronistic. They are, and the
consequence is bigger than the earlier per-file check suggested — that check
measured single files, but a task packs SEVERAL changed files up to the budget, so
the figure that matters is total changed bytes per change.

Measured over this repository's last 60 commits:

| | total changed-file bytes |
|---|---:|
| median | 72,089 |
| p75 | 176,808 |
| p90 | 329,660 |
| max | 680,900 |

| budget | exceeded by |
|---|---:|
| fast, 60 KB | **52% of commits** |
| **balanced, 120 KB (the default)** | **37%** |
| thorough, 240 KB | 12% |
| packet ceiling, 360 KB | 7% |

**On 37% of real changes the default budget splits the change across several
tasks** — and this project measured whole-file holistic review as OUT-RECALLING the
chunked alternative. So on more than a third of changes the reviewer performs a
measurably worse variant of itself, decided by a limit rather than by a model
constraint: 240 KB is roughly 60k tokens, against context windows of 200k to over
1M.

**This is a different severity from the truncation defects.** Chunking reviews every
line, just not in one piece, so it degrades a result rather than producing a wrong
one. It is a silent QUALITY change, not a silent wrong answer — which is why the fix
here is visibility plus a measurement, not a refusal.

`chunkedFileCount` is now reported. Nothing previously said when the substitution
happened.

**Deliberately NOT raised.** Stage 1 is the one capability that demonstrably works
(46.0% recall, 95.2% adjusted precision), raising its budget changes the recorded
baseline, and long-context attention degradation is real enough that bigger is not
automatically better. That makes it an A/B, and the corpus and harness for it
already exist. Raising it on reasoning alone would repeat the mistake that produced
these values.

---

## 2026-08-01 — CAVEAT on cross-file retrieval's withdrawal: reads were silently truncated

Prompted by the question of whether any withdrawn approach was rejected because a
cap bound rather than because the idea failed. Audit of every pre-existing stage-1
limit; the intent limits are excluded by date, having been introduced the same day
in `411c438`.

**Cleared:** the per-task context budget never bound on the corpus every A/B used —
0 of 57 changed files exceed even the default-depth 120KB (median 11.8KB, max
113.8KB). No withdrawn intervention was measured against a chunked baseline. The
packet budget above it refuses rather than truncates, by design.

**Not cleared — spec 16, cross-file retrieval.** `maxBytesPerRead` (20–24KB) cuts a
file mid-content with `subarray`, and the model-facing `RepoToolOutputSchema` is
`{ summary, content }` with **no truncation field**. The summary said only *"Read
&lt;path&gt; for investigation context."* A model receiving a file cut at an arbitrary
line, with no indication it continued, can conclude a guard is absent when the guard
was below the cut.

That mechanism produces **exactly the signature the withdrawal recorded**: recall
66.7% → 44.4% at nine cases and 68.8% → 56.3% at sixteen, with **precision holding
at 100%** — the loss was purely recall, which is what silently missing content
causes. It was never ruled out.

**This does not overturn the verdict.** No re-measurement has been run, the cap was
itself a response to a real observed harm (a 162KB single read losing a finding the
same task found without retrieval), and dilution and truncation both cost recall. It
means the verdict was reached against an implementation with a defect that plausibly
contributed to it, which is a different claim from "the idea does not work".

Fixed: a truncated read now appends an explicit marker to the content the model
reads — including *"absence of something below this point is NOT evidence it is
missing"* — and marks the summary. The ledger entry already carried
`bytesConsidered`/`bytesIncluded`; only the model-facing output omitted them.

**Spec 16 should be re-measured before its "net negative" verdict is treated as
settled.** Two prior withdrawals in this project have already been voided by
implementation defects found afterwards (spec 24's firing rate, spec 18's void A/B).

Also caveated, separately and already recorded: spec 25 Arm B re-ranked the
referenced-definition budget, which holds about three files, so ranking had little
room to express a difference.

---

## 2026-08-01 — Spec 23 measured on intent WRITTEN BEFORE THE CHANGE: the commit-message corpus was measuring nothing

New corpus `.codereviewer/eval/intent-corpus-realistic/`: **28 cases over 15
commits**, 21 of them carrying intent that is a verbatim slice of a `specs/*.md`
section as it existed at a **strict git ancestor** of the change under test
(`build.mjs` asserts the ancestry and refuses a case that fails it). 7 control cases
judge the **same diffs** against the commit's own message. **No synthetic cases and
no planted obligations.** Spend **$3.9401** of a $6.00 ceiling. Full analysis:
`reports/2026-08-01-intent-realistic-corpus-measurement.md`. Decision rule written
down before the corpus was built.

| | commit-message corpus, real arm | this corpus, post-hoc control | this corpus, **pre-written** |
|---|---:|---:|---:|
| cases / obligations | 12 / 80 | 7 / 60 | **21 / 192** |
| **genuinely outstanding obligations** | **0** | **0** | **48** |
| extraction faithful | 96.3% | 100.0% | **100.0% (192/192)** |
| outstanding recall, reported | not measurable | not measurable | **83.3% (40/48)** |
| outstanding recall, end-to-end | not measurable | not measurable | **52.9% (37/70)** |
| outstanding precision | — | 0.0% (0/6) | **69.0% (40/58)** |
| false-satisfied | 0.0% of nothing | 0.0% of nothing | 7.1% (8/112) |

### The answer, and it is structural rather than a matter of degree

A commit message is a report of work done, so its obligations are addressed by
construction. Three prior rounds recorded **zero** opportunities to be wrong about an
unaddressed obligation; the control arm here reproduces that exactly. **Caught in the
act on one diff:** spec 25 names two trigger shapes and `4c1e9dd` implements one.
Against the spec (`pw05`/`obl_3`) that clause is outstanding and the run reports it.
Against the commit message (`ph06`/`obl_10`) the extractor reads *"…which is NOT
implemented"* and produces *"do not implement the second trigger shape"* — which the
change satisfies. The same gap is an unmet requirement under one intent and a
satisfied one under the other.

### Real, unplanted leftovers this corpus contains

Spec 25's exit-path trigger clause; spec 15's whole Mechanism 2 and its held-out set
and per-mechanism precision; spec 11's `platform` provider and both its transports;
spec 22's contract delta, impact adjudication and missing blocking key; spec 24's
conformance adjudication; spec 23's own evaluation corpus; spec 05's defence-in-depth
severity rule; spec 13's observability step.

### Where the capability is right and wrong

- **Extraction accuracy is not the weak link**: 252/252 obligations across both arms
  are faithful readings of the line they cite, `uncitedObligationCount` 0 in all 28
  runs, no run truncated.
- **Breadth is**: end-to-end recall 52.9% against reported-level 83.3% — the entire
  gap is obligations the extractor never proposed. `pw09` proposed none of the seven
  undone anti-contamination items.
- **The false-satisfied shape, six of eight instances**: an obligation about an
  artefact that does not exist is credited to the nearest artefact that does — a
  requirement on the *evaluation* credited to the *implementation*, a held-out set
  credited to the dev set, a constraint on an unbuilt model call credited to the
  deterministic code around it.
- **18 false-outstanding entries** are mostly obligations an EARLIER change already
  satisfied, which this diff cannot evidence. Under spec 23's economics that is the
  cheap direction, and it is ~3 in 10 outstanding entries.

### What invalidates this entry

- One run per case, no variance band; extraction non-determinism is ±10% on any count.
- 22 obligations are conditional decision rules (*"adopt only if"*, *"retain as
  configuration if"*). The primary scoring calls them **unclassifiable**; the
  permissive reading gives 69 opportunities, recall 85.5%, precision 76.6%,
  false-satisfied 8.8%. Both readings support the same verdict; neither is hidden.
- A spec section is unusually well-formed intent. 100% extraction fidelity is an
  upper bound, not a forecast for a real ticket.
- The truth rule is *"addressed means the demanded state holds at head, whoever made
  it hold"*. A reader who thinks only in-diff work should count would score precision
  much higher.
- 8 false-satisfied and 18 false-outstanding events establish direction and
  mechanism, not a second digit. One repository, TypeScript, `gpt-5.3-codex`.
- The capability remains **off by default**. Nothing here argues with that.

---

## 2026-07-31 — Spec 23 citation-aptness check MEASURED: it works as designed and still costs more than it saves. WITHDRAW THE STAGE

Same 34 cases, same corpus, `1ae0db3` with the aptness stage active. Spend
**$2.5174** live + **$0.1365** probe = **$2.6539** of a $5.00 ceiling. Full analysis:
`reports/2026-07-31-intent-fulfilment-aptness-measurement.md`. Baseline:
`reports/2026-07-31-intent-fulfilment-remeasurement.md`, preserved run-for-run under
`.codereviewer/eval/intent-corpus/runs-2026-07-31-pre-aptness/`. Decision rule written
down before any result was read: the previous six clauses unchanged, plus a
**false-downgrade** definition, a pre-registered **exchange rate**, three hard floors,
and an attribution rule for a downgrade the report does not label.

| arm | extraction faithful | unaddressed detection | false-satisfied | opportunities | inapt citations |
|---|---:|---:|---:|---:|---:|
| **real** (80 obligations) | 96.3% | not measurable | 0.0% (0/75) | **0** | 2.7% (2/75) |
| **synthetic** (223 obligations) | 99.6% | **92.5% (74/80)** | **2.2% (3/135)** | **80**, 3 taken | 6.1% (8/132) |

**DHB sub-arm: 52 opportunities, 2 TAKEN** (was 3). Bound 11.6%. The pre-registered
bar for clearing the route is still ≥30 opportunities taken **zero** times, so the
route remains demonstrated and the capability stays **off by default**.

### What the stage did, itemised — 8 downgrades, attribution EXACT

`inaptCitationCount` sums to **8** and reconciles exactly with 8 hand-attributed rows
(every case with other `undetermined` rows reports 0, and no run had a failed
judgement). No counter bug.

- **1 BENEFIT**: `s32`/`obl_20` — *"the declaration-analysis barrel refuses a stage-3
  consumer at runtime"*, previously certified on an added line of a TEST, downgraded.
  A false-satisfied verdict genuinely removed. **Not the deleted-line route.**
- **1 correct-by-necessity**: `s24`/`obl_13` *"keep the numbers in the LEDGER"* — the
  ledger is not in the diff, so no apt citation could exist.
- **5 FALSE DOWNGRADES**: `r4`/`obl_4` and `s5`/`obl_4` (*"keep the field name
  unchanged"*, same obligation on the same commit, both suppressed — the direct probe
  reproduces this 3/3 and 2/3), `s12`/`obl_4` (*"update the test invariant"* —
  suppressed while its two SIBLING assertions in the same test survived),
  `s24`/`obl_14` (*"keep the numbers in the DOCS"*, where the docs table is added on
  lines 58-67), `s28`/`obl_5` (*"keep Arm A off by default"*, where the added spec line
  says exactly that).
- **1 undecidable**, excluded.

**Exchange rate FAILS: 2 × 1 = 2 < 5.**

### The verdict it was built for SURVIVED

`s17`/`obl_13` — *"make runs that request the withdrawn `guarded-region` context kind
fail intake with exit code 2"* — is reported `addressed` again on the same two REMOVED
lines, and `inaptCitationCount` for that case is **0**. The aptness call read exactly
that citation and did not call it inapt. `s33`/`obl_14` and `s28`/`obl_7` also survived
unchanged. **10 inapt citations and 3 false-satisfied verdicts were left standing.**

### The mechanism, from a direct probe of the stage alone (68 hand-labelled pairs, $0.1162)

| label | n | → apt | → undetermined | → **inapt** |
|---|---:|---:|---:|---:|
| apt | 50 | 46 | 3 | **1 (2.0%)** |
| inapt | 14 | 4 | 8 | **2 (14.3%)** |
| false-satisfied | 4 | 1 | 2 | **1** |

The stage is **correctly calibrated and pointed at a rare event**. `addressed`
verdicts are ~92% aptly cited, so a 2% false-inapt rate over ~200 apt citations
produces ≈4 wrong downgrades while a 14% catch rate over ~18 bad ones produces ≈2.5
right ones — expected downgrade precision ≈38%, which is what the live runs produced.
Making the check stricter raises the cost faster than the benefit; the fix has to be
**narrowing what it is asked about**, or **disclosing instead of suppressing**.

### Recommendation

**Withdraw the stage as it stands.** Two directions, both needing a spec decision, not
an edit: (1) run it only on behavioural obligations cited exclusively to removed
lines — four of the five false downgrades were preservation obligations whose evidence
can only ever be an added line that mentions the thing; (2) annotate the citation
instead of demoting the verdict, which cannot suppress anything.

### What invalidates this entry

- One run per case, no variance band. The five cases sharing `52ff75d`'s message
  reported 14 / 16 / 23 / 20 / 14 obligation rows against 14 / 16 / 20 / 20 / 15 last
  round on identical inputs.
- 8 downgrade events. The **direction** and the **mechanism** are established; no rate
  is claimed (the pre-registered floor for quoting one was 10 events).
- **The DHB inapt rate moving 33.3% → 0.0% is NOT the stage's doing** and must never be
  quoted as its benefit: the stage cannot improve a citation, and the judgement simply
  happened to cite the apt docs line every time this round.
- False-satisfied 4 → 3 is one attributable removal plus denominator movement
  (142 → 135 reported-addressed) from extraction non-determinism.
- A downgraded row's citation is dropped from the report, so two of the five
  false-downgrade classifications lean on the pre-aptness citation for the same
  statement plus what the diff contains; the probe on those exact citation sets
  answered `undetermined`.
- Real arm had **zero** opportunities to false-satisfy for the third round running.
- Twelve commits of one TypeScript repository, one provider, engineered synthetic
  mismatches.

---

## 2026-07-31 — Spec 23 re-measured after the amendment: the new false-satisfied route is REAL. NO SHIP, on evidence this time

34 cases (12 real, 22 synthetic) over 12 commits, spend **$2.3277** of a $4.00
ceiling. Full analysis: `reports/2026-07-31-intent-fulfilment-remeasurement.md`.
Decision rule written down before any result was read, carrying forward
2026-07-30's rule unchanged plus two new clauses (a deletion-heavy-behavioural
sub-arm, and citation aptness as a separate non-gating axis).

All 21 existing cases were re-run and re-scored; 13 new cases were added on four
deletion-heavy commits (`52ff75d`, `ee0589e`, `2882f4c`, `a6e6c5c`), every synthetic
plant a **behavioural** obligation.

| arm | extraction faithful | unaddressed detection | false-satisfied | opportunities | inapt citations |
|---|---:|---:|---:|---:|---:|
| **real** (76 obligations) | 96.1% | **not measurable** | 0.0% (0/73) | **0** | 4.1% (3/73) |
| **synthetic** (225 obligations) | 98.7% | 90.0% (72/80) | **2.8% (4/142)** | **80**, 4 taken | 8.0% (11/138) |

**The deciding sub-arm: 52 deletion-heavy behavioural opportunities, 3 TAKEN
(5.8%, 95% upper bound 14.2%).** The pre-registered bar for clearing the route was
≥30 opportunities taken **zero** times. It was not cleared.

### The answer to the question the amendment forced

**Yes — the tool can be made to say "done" for a behavioural obligation the change
did not satisfy, by citing deleted lines.** `s17-52ff75d-behaviour`/`obl_13`:

> *"Make runs that request the withdrawn guarded-region context kind by name fail
> intake with exit code 2 instead of assembling an empty section."*

Reported **`addressed`** on exactly two citations, **both removed lines**
(`agent-contracts.ts:49 'guarded-region'` and `context.ts:316 inputContext.kind ===
'guarded-region'`). The commit adds no intake check and no exit path, and the kind
is an internal enum with no user-facing way to name it. Two more false-satisfied
verdicts came from added lines (`s32`/`obl_20` credited a *test* for a claim about
runtime behaviour; `s33`/`obl_14` credited docs prose about **config** validation
for a claim about **builds**), plus one non-behavioural (`s28`/`obl_7`).

**`unevidencedAddressedCount` and `uncitedObligationCount` were 0 in all 34 runs and
no run was truncated.** Every citation was a real line the change really touched.
The structural guard cannot catch this: the failure is a valid address attached to
the wrong claim.

### What the amendment demonstrably fixed, stated beside the cost

`r9-52ff75d` went from 5 addressed / 9 wrongly-unaddressed to **14 addressed / 0
unaddressed**, all correct. `r7`/`obl_2` moved from a code-comment citation to the
29 removed export lines. `s7`/`obl_1` and `s10`/`obl_6` (last round's near-miss)
both became correct. The deletion blind spot is genuinely closed.

The same change produced the three behavioural false-satisfied verdicts above and a
**33.3% inapt-citation rate (4/12) on behavioural obligations in deletion-heavy
changes**. Neither half of this trade should be quoted without the other.

### Aptness on one obligation shape is a coin flip

*"A config still setting the removed block fails validation with exit code 2"* was
judged on `52ff75d` four times. Three runs cited removed schema keys, which show the
key deleted and say nothing about exit code 2 (**inapt**). One cited the added docs
line *"now fails validation with exit code 2"* (**apt**). The apt citation was in
scope all four times. Same split on `ee0589e`: apt in `r13` and `s33`, inapt in
`s21`.

### Also reproduced, and still unfixed

`r4-4731580`'s two explicit *"Not changed, and deliberately"* paragraphs became
obligations again and were again answered `unaddressed` — both of the real arm's two
false `unaddressed` verdicts. And extraction can collapse on a message that is
mostly measurement narrative: `r10-a6e6c5c` extracted 3 obligations from a message
stating 5; `s18` on the same commit extracted 1 of 5.

### What invalidates this entry

- One run per case, and extraction is visibly non-deterministic: the same
  `52ff75d` message yielded 14, 12, 13, 13 and 15 real obligations across five
  cases. No variance band for any figure.
- The real arm again had **zero** opportunities to false-satisfy, so its 0.0% is
  uninformative and says nothing about pre-written tickets or PR descriptions.
- 4 events. The route's **existence** is established; its rate is bounded only
  below 11.1% (per opportunity, synthetic).
- The 52 DHB opportunities are 52 report rows from about 31 planted statements, and
  they were engineered to be tempting. That is how to find a failure mode, not how
  to estimate its frequency in the wild.
- Two of ~31 plants turned out ambiguous once extracted (`s21`/`obl_8`,
  `s21`/`obl_10`) and are recorded `unclassifiable`, not scored.
- Three larger deletion-heavy commits with the same obligation shape (`a75e429`,
  `4656955`, `fd31dc9`) were dropped for budget and remain unmeasured.
- Twelve commits of one TypeScript repository, one provider, one day.

The capability stays **off by default**. The difference from 2026-07-30 matters:
that entry said no false-satisfied claim had been observed. This one says four have,
and names the shape that produces them.

---

## 2026-07-30 — Spec 23 amended: a removed line is evidence. Deletion blind spot closed, and a new risk opened

Spec 23 was amended (its first post-implementation amendment) so an addressed
obligation may cite a line the change **removed**, identified on the pre-change
side, with the report required to disclose which side a citation is on.

Same revert commit, same intent, before and after:

| | before | after |
|---|---:|---:|
| addressed | 6 | **14** |
| unaddressed | 7 | **0** |
| undetermined | 2 | **0** |

Ground truth for this commit, established by hand in the first measurement, is
that **all of its obligations were genuinely done**. The verdicts are now correct
where they were previously wrong on every removal.

### The new risk, stated because it is real

**Removed lines are abundant in a deletion-heavy change, so a citation is now easy
to satisfy.** Inspecting the run above, one obligation — *"make configs that still
set the removed block fail validation with exit 2"* — was credited against
*removed* lines of a generated schema file. That obligation is about **behaviour**,
and deleted schema lines are weak evidence for it. The verdict happens to be
correct; the evidence is not apt.

So the amendment trades a systematic false-*unaddressed* on deletions for a
plausible new route to false-*satisfied* on behavioural obligations in
deletion-heavy changes. Spec 23 is explicit that false-satisfied is the costlier
error, which makes this worth watching rather than shrugging at.

**The measured false-satisfied rate (0/56, 21 opportunities) predates this change
and no longer describes the current behaviour.** It must be re-measured, and the
corpus needs deletion-heavy cases with behavioural obligations, which the current
21 cases do not emphasise.

### What did not change

The safety property. A cited line still has to be one the change actually touched:
`verifyJudgement` resolves every citation against the change surface, drops what
does not match, and downgrades an `addressed` verdict left with no valid citation
to `undetermined`. A test asserts a line the change never touched is still
rejected, and another asserts the **side is taken from the change, not from the
answer** — a model claiming a line was added when it was removed is corrected, so
the required disclosure cannot be self-reported.

---

## 2026-07-30 — Spec 23 first measurement: NO SHIP VERDICT, sample cannot support one

21 cases over 9 commits of this repository, spend **$0.7663** of a $3.00 ceiling.
Full analysis: `reports/2026-07-30-intent-fulfilment-measurement.md`. Decision rule
written down before any result was read.

| arm | extraction faithful | unaddressed detection | false-satisfied | opportunities |
|---|---:|---:|---:|---:|
| **real** (commit message as intent, 58 obligations) | 94.8% | **not measurable** | 0.0% (0/47) | **0** |
| **synthetic** (12 marked cases, 79 obligations) | 98.7% | **95.2%** (20/21) | 0.0% (0/56) | 21 |

**No ship verdict, and that is the correct outcome rather than a disappointing
one.** The real arm never exercised the deciding metric: all 58 real obligations
were genuinely addressed, so `addressed` was always the right answer and a tool
that returned it unconditionally would have scored identically. The synthetic arm
passes on rate but has **21 opportunities to false-satisfy, not the 30** needed to
bound the rate below 10% — it bounds it below ~14%.

Nothing argues against the capability. Every signal is favourable. It stays off by
default because favourable is not the same as demonstrated.

**Why more of this repository's commits cannot fix it:** a commit message
describes what the commit did, so an obligation drawn from one is almost always
addressed by construction. Spec 23 predicted exactly this. Measuring
false-satisfied needs intent written *before* the work — tickets and pull-request
descriptions — which is also a harder input than a retrospective message.

### Deletions are invisible — verified independently

Re-run directly against the revert `52ff75d`, using its own commit message as
intent, and the split is total:

| obligation shape | result |
|---|---|
| *"Remove the guarded-region trigger…"* ×7 | **unaddressed** |
| *"Remove the packet section…"*, *"Remove the config block"* | **undetermined** |
| *"Keep declaration-analysis"*, *"Mark spec 25 Withdrawn"*, *"Make configs fail with exit 2"* ×6 | **addressed** |

**Every removal obligation failed; every retention or addition obligation
succeeded.** On a revert or cleanup change the tool tells a reviewer most of the
work was not done.

The cause is structural and spec-mandated: spec 23 requires an addressed
obligation to cite a path and line, and `verifyJudgement` requires that line to be
one the change touched. **A deletion has no such line.** Fixing it means amending
spec 23, which is a human decision, not an implementation choice.

Note the direction is the safe one — false *unaddressed*, never false *satisfied*,
which is the trade spec 23 explicitly asks for. This is a usefulness problem on a
common change shape, not a safety problem.

### Two more findings, recorded not patched

- **Non-scope disclaimers become obligations.** A commit message's *"Not changed,
  and deliberately: …"* section became three obligations, answered inconsistently.
- **Prose can satisfy an obligation.** In 5 of 103 addressed obligations the only
  cited evidence was *text asserting the work was done* — a spec paragraph or a
  code comment. All were truthful here. **A change that documents more than it
  implements is untested and is the exact shape that produces a false satisfied.**

### What invalidates this entry

One run per case; extraction is visibly non-deterministic (the same commit gave 5
and 4 obligations on two runs). Every case draws intent from a commit message
written after the work.

---

## 2026-07-30 — 37 real repositories: a JS blind spot, and spec 24 does fire

Deterministic, offline, **zero provider spend**. 37 hydrated slices, 4,974 source
files, 10 languages. Full analysis:
`reports/2026-07-30-signal-coverage-and-conformance-yield.md`.

### The JavaScript extractor sees ESM exports and nothing else

`fastify`'s `lib/route.js` — **701 lines of real JavaScript — produces zero
facts.** Isolated: `export const`/`export function` yield a fact; a `function`
declaration, `module.exports`, `exports.x`, and a `class` all yield **nothing**.
Across four real JavaScript repositories (1,046 `.js` files) the extractor
produced **6 declarations in total**.

This is not confined to an optional capability. Deterministic facts feed three
consumers, and each degrades *silently* — reporting "nothing to say" rather than
"cannot see":

- **stage 1**, where `deterministicSignalMode: 'support'` is the mode this project
  has measured as materially better for recall;
- **`impact check`**, whose changed symbols come from these facts;
- **`conformance check`**, hence the zeros.

The documentation asserted the opposite (*"Deep support signals exist for
TypeScript/JavaScript"*) and has been corrected. A likely route to the error:
`INV-ESM-001` requires **our own source** to be ESM-only, which is an invariant
about what we write, not about what we can review.

Correct and not a defect: C#, PHP, Elixir, C and Kotlin yield nothing because they
are not supported languages.

### Spec 24 is not gated into silence

The question left open this morning. Every declaration marked changed, so this is
the total divergence *population*, not a firing rate:

| | |
|---|---:|
| declarations | 21,498 |
| peer sets | 21,339 |
| **divergences** | **849 (3.9%)** |
| repositories yielding ≥1 | **18 / 37** |

**But yield is strongly language-dependent, and that is a problem for a capability
whose selling point is language-neutrality:** rust **17.0%**, typescript 14.2%,
python 3.2%, ruby 2.8%, go **0.7%**. A 24× spread between Rust and Go is either a
real property of those ecosystems or an artefact of how indentation and lexical
traits behave per language, and **this measurement cannot separate them**. Settle
it before recommending the capability anywhere.

Naively scaling 3.9% by ~4 changed declarations per commit suggests ~0.16 per
commit, inside the ≈0.5 criterion — recorded as an **estimate from a population
rate, not a measurement**. It assumes changed declarations diverge at the same rate
as all declarations, which is precisely what a real firing-rate run would test.

### The honest firing-rate test could not be run — CORRECTED DIAGNOSIS

**The first diagnosis published here was wrong and is retracted.** It said the
`baseSha` commit was *"absent from the shallow object store (verified on all 37)"*.
It is present on all 37 — `git cat-file -t <baseSha>` returns `commit` — and the
original check was a faulty shell loop, not a property of the corpus. The
depth-2 fetch in `real-repo-corpus-hydration.ts` pulls the fix commit and its
parent exactly as intended.

The real obstacle is a **semantic** mismatch, and it is more interesting:

- the corpus checks out the **parent** (pre-fix, defective) tree as `HEAD`, and
  defines the reviewed change as *the upstream fix reversed* — `baseSha` is the
  fix commit, `headSha` the parent;
- `conformance check` resolves its diff through **`git merge-base`**, and the
  parent is an **ancestor** of the fix, so `merge-base(fix, parent) = parent =
  HEAD`. The command therefore diffs `HEAD..HEAD` and correctly sees **nothing**.

Re-run with the correct refs across all 37: 37 completed, **0 changed files**,
0 declarations, 0 divergences — the empty diff, not a detector result. Nothing
about spec 24 can be read from it.

Reversing the refs does not help either, because the working tree is checked out
at the parent: a `head-ref` the filesystem does not match would compare a diff
against the wrong content.

**The reviewed change simply cannot be expressed as a ref pair under merge-base
semantics.** Two ways out, both real work rather than a one-command fix:

1. let `conformance check` accept a diff directly, as the eval runner already does
   with `slice.json.diff`; or
2. hydrate the corpus forward — check out the fix and review `parent → fix`.

The earlier claim that this was "a one-command measurement away" was wrong on both
the cause and the cost.

### What invalidates this entry

The divergence counts come from treating every declaration as changed; they are an
upper bound on what any real change could surface, not a prediction of one. No
divergence here was adjudicated, so none is claimed to be worth showing a human.

---

## 2026-07-30 — Spec 24 firing rate re-measured post-span-fix: 0.000/commit

20 consecutive commits of this repository, `conformance check` with adjudication
enabled, immediately after the `declarationSpanAt` fix. Total spend **$0.0509**.

| | before the span fix | after |
|---|---:|---:|
| changed declarations seen | — | **79 (3.95/commit)** |
| change-attributed divergences | 0.0125/commit | **0.000/commit** |
| pre-existing divergences | ~0.74/commit | **0.000/commit** |
| **combined** | **0.70/commit** | **0.000/commit** |

Gate is ≈0.5 per commit. **It is no longer blown; it is not approached.**

The reversal is the point. The detector now sees **four times as many
declarations** — 79 where the truncated span surfaced almost none — and reports
**nothing at all**. That is consistent with the void notice below: the old noise
came from the narrow set of shapes a truncated span could still see, single-line
schema-builder chains that formed large peer sets of near-identical members. Give
every declaration its real body and those bogus majorities dissolve.

**Do not read this as the capability working.** Two readings fit equally well and
this measurement cannot separate them:

1. The gates (majority pattern, three-cited-peer floor, membership precondition)
   are now correctly rejecting resemblance that was never a convention.
2. The gates are too strict for real trait sets, and the capability will report
   nothing on any codebase.

Twenty commits of one repository producing zero reports is compatible with both.
What it does settle is that the **noise objection is gone**: spec 24 was suspended
because it fired 0.70 per commit against its own 0.5 kill criterion, and that
number described a bug, not the design.

**Still true and unchanged: no positive on real code, ever.** The only case it has
ever caught is synthetic. The open question is now recall, not noise — the exact
inverse of where this capability stood this morning.

### What invalidates this entry

One repository, one 20-commit window, and this repository's style is unusually
uniform (heavy Zod schema builders, consistent arrow-function exports). A codebase
with more varied conventions could produce a very different rate. Re-measure
elsewhere before treating 0.000 as a property of the design.

---

## 2026-07-30 — VOID: every spec 24 firing-rate measurement predates a span bug

`declarationSpanAt` bounded a declaration by indentation alone, so a **multi-line
signature** ended the span at the line closing its parameter list. The body was
excluded, the declaration extracted no traits, and `peer-sets.ts` drops a
trait-less declaration — so it never reached the capability at all.

Measured on this repository's own `src/cli/args.ts`: **nine of ten exported
declarations extracted ZERO traits**, and `conformance check` reported no changed
declarations for a commit that plainly added two. After the fix the same file
yields nine declarations carrying 4–14 traits each, and a range that previously
produced 0 changed declarations now produces 3 with 3 peer sets.

**Consequence: the recorded spec 24 firing rates are not measurements of spec 24.**
They are measurements of a detector that could only see declarations whose
signature fitted on one line. That includes:

- the **0.70 / 0.75 per commit** combined rates, and the kill-criterion comparison
  drawn from them
- the earlier **0.075/commit** figure already recorded as unreproducible
- the conclusion that noise originates from schema-heavy modules — which is now
  *expected* rather than informative, because a single-line `z.strictObject({...})`
  chain was one of the few shapes the broken span could see at all

Nothing about spec 24 should be decided on those numbers. The firing rate has to
be re-measured before its kill criterion means anything, and the capability's
"no positive on real code" record is likewise not evidence about the design: the
design was never actually run on most declarations.

This does **not** rehabilitate spec 24. It says the case against it was never
properly made either, and both directions are now open.

Found by smoke-testing `conformance check` on this repository while verifying that
the stage-3 commands were runnable — not by reading the code.

---

## 2026-07-30 — "Unlisted real findings" measures FRAGMENTATION, not key gaps

Offline diagnosis of the 29 unlisted-real rows the three spec-25 arms produced.
Full analysis: `reports/2026-07-30-unlisted-real-diagnosis.md`. No provider spend,
no fixture touched.

**16 distinct findings: 0 genuine-unlisted defects, 13 restatements, 2
judge-errors, 1 deliberate exclusion.**

**Recall is NOT understated. The denominator stays 87 and 46.0% is accurate.**
This retracts the working hypothesis — repeated three times in this session — that
the engine "finds more than the answer key knows" and that recall is a floor of
unknown tightness. On this corpus it is not.

### Independently verified before acceptance

The load-bearing claim was re-checked directly against the run artifacts rather
than taken from the analysis:

| finding | arm0 | armA | armB |
|---|---|---|---|
| traefik `kubernetes_http.go:593` (+5 siblings) | **duplicate** | **unlisted-real** | **unlisted-real** |
| fastify `lib/route.js:617` | matched | **unlisted-real** | **unlisted-real** |

The same defect text lands in a different bucket in different arms. That is a
matcher artifact and cannot be a property of the key.

### Consequence for how arms are ranked

armB leads on unlisted-real (14 against arm0's 4) while **trailing on recall**
(44.8% against 46.0%). It did not discover more; it split defects into more
findings and absorbed fewer as duplicates. **A metric that rewards fragmentation
was being read as a discovery signal.**

### A proposed fix that was checked and rejected

The analysis recommended seeding the plausibility judge with the case's
already-matched findings so it can recognise a restatement. **That is already
implemented** — `judgeUnmatchedFindingsPlausibility` takes `matchedFindings` and
seeds `creditedByPath` from them before judging anything. The judge sees them and
answers "not the same defect" anyway, which is *defensible*: `*p.Name` at line 592
and `*p.Port` at 593 are two distinct nil dereferences, and the judge is
explicitly instructed that two real defects sitting near each other are not one
defect.

Widening `isDuplicateOfMatchedFinding`'s zero line tolerance was also rejected,
for the reason already recorded in that function: it is a purely textual check
with no view of what either finding says, so it would merge two genuinely
different defects as readily as a restatement, silently discarding a true
positive.

**The real cause is neither.** The key folds several defect sites into one
expectation — traefik expectation 0 names both `Name` and `Port` across lines
591-596 — while precision is counted per finding. One-to-one matching consumes the
expectation with the first finding, and the second is then literally an unlisted
real defect. Every layer behaves correctly and the aggregate is still misleading.

### What actually needs to change

Not the matcher's semantics and not the key. The **name and the breakdown**: the
counter asserts key incompleteness and measures something else. It needs to
separate findings that fall inside an already-matched expectation's own declared
`lineRange` (accounted territory) from those outside it (genuinely uncovered) —
additive, reversible, and destroying no signal.

### Also found

- `eval-report.json` persists only finding titles — no body, no judge rationale —
  which made this diagnosis interpretive rather than mechanical. Two verdicts
  stayed at medium confidence for that reason alone.
- `slim` expectation 0's `lineRange [25,36]` does not reach the title sink at line
  57 that its own summary claims.
- armB's credited pydantic finding states its mechanism **backwards** and the
  plausibility judge accepted it.

### What invalidates this entry

A second classifier disagreeing on the two medium-confidence items (ws, pydantic).
Even promoting both to genuine-unlisted moves the denominator to 89 and arm0 to
44.9% — still not an understatement, so the headline is robust to that.

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

### Spec 26 measurability precheck (2026-08-01, $0)

Before paying for the spec 26 A/B, a free static check of how many corpus cases the
OLD engine would actually have split. Both corpora run at `thorough` depth, so the
proactive chunk threshold was 108,000 B (`floor(min(240000, 360000) * 0.45)`).

| corpus | cases | a file over the chunk budget | files summing over it (upper bound) | over the old 360 KB packet ceiling | **unaffected** |
|---|---|---|---|---|---|
| real-repo | 37 | 1 | 2 | 0 | **34 (92%)** |
| crb benchmark | 59 | 9 | 12 | 7 | **38 (64%)** |

The "summing" column is an upper bound: task planning already caps a task at 8 paths,
so some of those cases never formed one oversized task.

**The spec's measurement plan names the wrong corpus.** On the 37-case real-repo
corpus the two arms are byte-identical on 34 of 37 cases; an effect confined to 3
cases cannot be resolved against a measured ±4.8pp band, so that A/B would cost real
money to produce a number that means nothing.

The crb benchmark is the corpus where the change actually bites — 21 of 59 cases,
which matches the 37% figure measured over this repository's own commits.

**Cheaper and stronger still: run only the 21 affected cases**, in both arms. The
38 unaffected cases are identical between arms by construction, so they can only
dilute a paired comparison while costing full price.


### Spec 26 reactive splitting — A/B, 21 affected crb cases (2026-08-01, $13.81)

Pinned engines: arm 0 `5902de3` (proactive), arm 1 `c11579c` (reactive). Paired at
expectation level, 71 expectations, 0 provider errors either arm.

| | proactive | reactive |
|---|---|---|
| recall (paired) | 43.7% | **35.2%** |
| adjusted precision | 83.8% | **96.2%** |
| candidates refuted | 106 | 75 |
| findings emitted | 113 | 84 |
| cost | $7.41 | $6.40 (**−14%**) |

Paired delta **−8.5pp**, 95% CI [−16.9, 0.0], discordant 10 (gained 2, lost 8),
McNemar z −1.90, **p = 0.058**.

**The provider refused ZERO packets** — no `context_length_exceeded`, no splits, on
any of 21 cases including one carrying 1.2 MB of changed source. Spec 26's premise
is therefore **confirmed and now measured, not assumed**: the old byte budget was
splitting for no provider-side reason whatsoever.

**But the recall loss is real and it is not about splitting.** Since reactive
splitting never engaged, the only difference between the arms is TASK COUNT: the old
budget's batching made several tasks per case, the new assembly makes one. Candidates
fell 106 → 75 and findings 113 → 84 in step with it. Discovery yield is **per task**,
not per defect present — the long-standing "one finding per file" behaviour, here
measured as the binding constraint on recall.

So the change trades recall for precision and cost by shrinking the number of looks
the reviewer takes. **Do not ship it as the default until discovery yield stops being
per-task**; the yield fix is the prerequisite, not a follow-up.

### Spec 16 cross-file retrieval — REVERSES the earlier net-negative verdict (2026-08-01, $3.94)

Same pinned engine `c11579c` both arms, 37-case real-repo corpus, 87 expectations,
`maxToolCallsPerTask: 8`, `maxBytesPerRead: 24000` — the same cap as the original
run. The only difference is that a truncated cross-file read now **discloses the cut
to the model**.

| | off | on |
|---|---|---|
| recall (paired) | 42.5% | **48.3%** |
| adjusted precision | 97.4% | **100%** |
| cost | $2.05 | $1.89 (**−7%**) |

Paired delta **+5.7pp**, 95% CI [−1.1, 12.6], discordant 9 (gained 7, lost 2),
McNemar z 1.67, **p = 0.096**.

The earlier verdict (66.7% → 44.4% at 9 cases, 68.8% → 56.3% at 16) was recorded as
net negative and the feature was left off by default. That verdict **does not
survive**: the direction flips on a corpus four times larger, with precision rising
to 100% and cost falling. Every `repo_read` had been cut at 24,000 bytes with the
model told nothing — the exact mechanism that produces "recall falls, precision
holds" — and the earlier measurement could not distinguish the feature from that bug.

**Not yet conclusive**: +5.7pp is barely outside the measured ±4.8pp band at p = 0.096,
on a single run. It refutes the negative verdict; it does not yet establish the
positive one. Replicate before making it the default.


## Standing caveats for reading anything here

- **Variance.** sd ≈ 4.8pp on this corpus. An effect below roughly 10pp cannot be
  resolved at n=3. Several arms above are smaller than the instrument.
- **The blended recall figure is not interpretable on its own.** 42.5% of
  expectations lie in unchanged code; the blended number depends on that ratio
  rather than on reviewer quality. Read the in-diff and out-of-diff rows.
- **Adjusted precision is an estimate, permanently.** Under an incomplete answer
  key, precision is not identifiable — raw precision is the lower bound and
  adjusted the upper. Report the pair.
- **Every run recorded above was produced by an UNPINNED engine.** The harnesses
  pinned the repository under test but invoked the engine from the live working
  tree, so a commit landing mid-sweep changed the instrument mid-measurement —
  which happened, five times, during the 2026-08-01 uncapped re-measurement.
  Those particular runs were argued inert afterwards and by hand; nothing in any
  scored artefact recorded which engine produced it, so no other entry here can
  be checked at all. Fixed 2026-08-01 for all stages (`.codereviewer/eval/`:
  `engine-pin.sh` pins a detached worktree at a SHA resolved once per sweep,
  `pinned-run.sh` wraps every stage's CLI, and both scorers now refuse to pool
  cases whose `engine.json` sidecars disagree). **Runs predating the fix carry no
  sidecar and are reported as unknown-engine, not as agreeing.** Treat small
  deltas above as correspondingly weaker.
