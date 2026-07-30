# Intent-fulfilment review (spec 23) on intent that was written BEFORE the change

Date: 2026-08-01
Capability: `intent check` at `f40a366` — off by default, cannot gate, reports
`outstandingCount` and never certifies completion.
Corpus: `.codereviewer/eval/intent-corpus-realistic/` (new; the commit-message
corpus at `.codereviewer/eval/intent-corpus/` is untouched).

The question: **does intent written before the work behaves differently from a
commit message written after it?** Every existing measurement of this capability
draws its intent from a commit message authored after the change was complete, so
every obligation is addressed by construction and every unaddressed obligation in
the corpus was planted by a curator to be findable. Spec 23's Evaluation section
predicted exactly that weakness.

---

## The decision rule, fixed before the corpus was built and before any result was read

Everything in this section was written before a single case was run, and before the
first report was opened.

### What is being measured

The capability was reframed on 2026-07-30 (`f40a366`) to answer *"what is left?"*
and never *"is this done?"*. False-satisfied is therefore **no longer the deciding
metric**. The three metrics are:

1. **Outstanding recall** — of the obligations a human judges genuinely NOT done,
   how many appear on the run's outstanding list (`unaddressed` + `undetermined` +
   `evidenceConcern`)?
2. **Outstanding precision** — of the obligations the run lists as outstanding, how
   many were genuinely not done? Reported **separately from recall, never blended**,
   because the two costs are asymmetric: a false entry costs a reviewer ten seconds,
   a missed one costs the capability its purpose.
3. **Obligation extraction fidelity** — of the obligations the run reports, how many
   are faithful readings of a line the stated intent actually contains
   (`faithful`)? And, separately, of the obligations a human reads in the intent
   excerpt, how many did the extractor cover (`coverage`)?

`false-satisfied` (an obligation reported `addressed` that is genuinely not
addressed) is still counted and reported, because it is the complement of
outstanding recall and spec 23 still names it the expensive direction. It no longer
carries a ship gate of its own.

### Pre-registered clauses

1. **Arms are never pooled.** The pre-written arm (intent authored before the change
   existed) and any post-hoc arm (the commit's own message) are reported separately,
   with their own denominators. No figure blends them.

2. **Ground truth is established by hand**, by reading the intent excerpt and the
   diff. It is never read off, checked against, or reconciled with the tool's own
   answer. Each obligation is labelled before its case's report is opened wherever
   the schedule allows, and in every case without consulting the tool's verdict for
   that obligation.

3. **`unclassifiable` is a real label.** An obligation whose truth a human cannot
   settle from the intent and the diff — one that is about a process, a future
   measurement, or a fact outside the diff — is recorded `unclassifiable` and
   **excluded from every rate**, in both numerator and denominator. The count is
   reported. Rates are never repaired by guessing.

4. **Minimum n, stated before looking.**
   - An outstanding-recall figure is quoted only when the arm has **≥ 20 genuinely
     outstanding obligations**. Below that the raw counts are reported and the
     verdict is explicitly "n too small".
   - An outstanding-precision figure is quoted only when the arm has **≥ 20 reported
     outstanding obligations**.
   - A **difference between arms** is called a difference only if it exceeds the
     demonstrated run-to-run extraction noise of this capability, which the
     2026-07-31 round measured at roughly **±10% on any count** (identical inputs
     yielded 14/16/23/20/14 obligations against 14/16/20/20/15). One run per case;
     there is no variance band, and none is manufactured.

5. **The headline comparison.** Against the commit-message corpus's **real arm**
   (12 cases, 80 obligations, `reports/2026-07-31-intent-fulfilment-aptness-measurement.md`),
   which recorded **zero opportunities to be wrong about an unaddressed obligation
   for three rounds running**. The pre-written corpus is judged to have answered the
   question it was built for if and only if it produces a **non-zero number of
   genuinely outstanding obligations in the real arm** — that is the thing the
   commit-message corpus structurally cannot contain. If it produces zero, the
   corpus has failed, whatever the tool scored.

6. **No obligation is planted.** Nothing is removed from, added to, or reworded in
   any intent excerpt to create a leftover. An excerpt is a verbatim, contiguous
   slice of a document that existed at a commit strictly earlier than the change
   under test. A case with no genuine leftover is a valid case and measures
   precision.

7. **Synthetic material, if any, is marked and reported separately**, per spec 23.
   Hand-written tickets are not pooled with real ones under any circumstance.

8. **Budget $6.00** of provider spend, accumulated from each run's `usage.costUsd`.
   Cases run cheapest-first. If the running total reaches **$5.20** the remaining
   cases are abandoned and the report says which were not run. No figure is
   extrapolated to cover them.

9. **Truncation invalidates a case.** A run whose `changedLinesTruncated` is true, or
   whose `obligationsTruncated` is true, is reported but its obligations are
   excluded from the recall denominator, because the tool was not shown the evidence
   the human used. `obligationsTruncated` alone excludes only the recall figure, not
   precision.

10. **A bug is reported, not patched around.** `src/` is not modified.

This round decides **whether the corpus is worth keeping and what it says about
pre-written intent**. It does not decide whether to ship `intent check`; spec 23
keeps it off by default regardless.

---

*(Results below this line were written after the runs completed.)*

## The corpus

`.codereviewer/eval/intent-corpus-realistic/` — **28 cases over 15 commits**, in two
arms that are never pooled.

| arm | cases | commits | intent source | reported obligations |
| --- | ---: | ---: | --- | ---: |
| **pre-written** | **21** | 13 | a verbatim, contiguous slice of a `specs/*.md` section as it existed at a commit that is a **strict ancestor** of the change under test | 192 |
| post-hoc (control) | 7 | 7 | the commit's own message, on the **same diffs** | 60 |

The ancestry is not asserted in prose: `build.mjs` runs
`git merge-base --is-ancestor <intentCommit> <head>^` for every pre-written case and
refuses to materialise one that fails, so a case whose intent could have been
written after the change cannot enter this corpus. The gap ranges from the same day
(the spec was approved, then implemented) to two days.

Sources are specs 05, 11, 13, 15, 19, 20, 21, 22, 23, 24 and 25, plus the 2026-07-30
amendment to spec 24, against the commits that implemented them. Several were split
into two cases over disjoint sections of the same document (requirements against
evaluation/verification matrix), which is why 21 cases come from 13 commits.

**No synthetic cases.** Nothing was removed from, added to, or reworded in any
excerpt. Every leftover this corpus contains is one the project actually left. Spec
23 permits marked synthetic fixtures and none were used, so clause 7 has nothing to
report.

### What the leftovers actually are

A sample, each established by reading the diff:

- **spec 25's second trigger shape** — *"a call whose position is terminal for the
  declaration"* — is not implemented, and `guarded-region.ts`'s header says why.
- **spec 15's Mechanism 2** (deterministic security-signal evidence) does not exist
  at all: `security.signals.enabled` is a reserved key carrying no behaviour, and
  `ruleId` / `cwe` / `helpUri` / `dataFlow` / `securitySeverity` remain unused
  contract fields.
- **spec 11's `platform` provider**, with its `event` and `api` transports, does not
  exist; the config schema says in a comment that it is a later phase.
- **spec 22's contract delta and impact adjudication** are absent from the wave that
  implements spec 22: it reports which symbols changed and where they are
  referenced, never how the contract differs or what breaks. Its blocking key,
  which the spec requires to be configurable, was never added.
- **spec 24's conformance adjudication** — one model call per divergence, able to
  answer undetermined — is absent from the wave that implements spec 24.
- **spec 15's held-out set** and the whole anti-contamination policy were never
  built; per-mechanism *adjusted precision* is explicitly absent while per-mechanism
  recall ships.
- **spec 05's defence-in-depth rule** ("a missing defence-in-depth measure is
  *silently wrong*, not *control defeated*") is in the rubric and not in the prompt
  that implements the rubric.

## Results

Ground truth was established by hand for all 252 reported obligations, from the
intent excerpt and the diff. `show-statements.mjs` prints an obligation's statement
and its intent citation and **never its status or its evidence**, so the labels were
set without the tool's verdict visible. `score.mjs` is the only thing that reads a
status.

### Pre-written arm — 21 cases, 192 obligations

| metric | value |
| --- | --- |
| **3. extraction fidelity** — reported obligations that are faithful readings of the cited intent line | **100.0% (192/192)** |
| — breadth: reported obligations against the 306 a human reads in the same excerpts | 62.7% *(a count ratio, not a matching)* |
| — unclassifiable, excluded from every rate | 22 |
| **1. outstanding recall**, over reported obligations | **83.3% (40/48)** |
| **1b. outstanding recall**, end-to-end over everything a human found left undone | **52.9% (37/70)** |
| **2. outstanding precision** | **69.0% (40/58)** |
| false-satisfied (the complement of recall) | 7.1% (8/112) |
| **opportunities to be wrong about an unaddressed obligation** | **48** |
| runs truncated by `maxChangeLines` or `maxObligations` | **0** |

### Post-hoc control arm — 7 cases, 60 obligations, same diffs

| metric | value |
| --- | --- |
| **3. extraction fidelity** | 100.0% (60/60) |
| — breadth against 68 human obligations | 88.2% |
| **1. outstanding recall** | **not measurable — denominator 0** |
| **2. outstanding precision** | 0.0% (0/6) |
| false-satisfied | 0.0% (0/54) |
| **opportunities to be wrong about an unaddressed obligation** | **0** |

## The answer to the question, in one table

| | commit-message corpus, real arm (2026-07-31) | this corpus, post-hoc arm | this corpus, **pre-written arm** |
| --- | ---: | ---: | ---: |
| cases | 12 | 7 | **21** |
| reported obligations | 80 | 60 | **192** |
| **genuinely outstanding obligations** | **0** | **0** | **48** |
| unaddressed detection | not measurable | not measurable | **83.3%** |
| false-satisfied | 0.0% (0/75) — of nothing | 0.0% (0/54) — of nothing | 7.1% (8/112) |

**Yes. Intent written before the work behaves completely differently from a commit
message written after it, and the difference is not a matter of degree.** A commit
message is a report of what was done, so obligations extracted from it are addressed
by construction: three rounds of measurement on the commit-message corpus produced
**zero** opportunities to be wrong about an unaddressed obligation, and this round's
control arm reproduces that exactly — 60 obligations over 7 commits, **0 genuinely
outstanding**. The same 7 diffs judged against intent written beforehand produce
leftovers immediately.

The mechanism is visible in a single pair on one diff. Spec 25 requires two trigger
shapes and commit `4c1e9dd` implements one. Judged against the **spec**
(`pw05`/`obl_3`), that clause is outstanding and the run correctly reports it.
Judged against the **commit message** (`ph06`/`obl_10`), the extractor reads the
message's own sentence — *"Spec 25's trigger names a second shape … which is NOT
implemented"* — and produces the obligation *"Do not implement spec 25's second
trigger shape"*, which the change satisfies. **The same gap is an unmet requirement
under one intent and a satisfied one under the other.** That is not an extraction
error; it is what a post-hoc corpus is.

## The two readings of the decision clauses, reported side by side

Twenty-two obligations are conditional decision rules — *"adopt only if recall
rises"*, *"retain as configuration if the result is a genuine trade"*, *"deleted
outright if they fail"*. The governing measurement had not been run in any of these
changes, so the rule is neither discharged nor breached. The primary scoring above
records them **unclassifiable** and excludes them, which is the conservative choice.
The permissive reading counts them outstanding:

| | conservative (primary) | permissive |
| --- | ---: | ---: |
| opportunities | **48** | 69 |
| outstanding recall, reported | **83.3% (40/48)** | 85.5% (59/69) |
| outstanding recall, end-to-end | **52.9% (37/70)** | 60.2% (53/88) |
| outstanding precision | **69.0% (40/58)** | 76.6% (59/77) |
| false-satisfied | **7.1% (8/112)** | 8.8% (10/114) |

Both readings support the same verdict. The reading is stated because the choice
moved every figure, and a reader who disagrees with it can see what their reading
would give.

## Where the capability is right and where it is wrong

**Extraction is not the weak link.** Every one of the 252 obligations, in both arms,
is a faithful reading of the line it cites — 100.0%, against 96.3% on the
commit-message corpus. The extractor never invented an obligation the intent does
not state, and `uncitedObligationCount` was 0 in all 28 runs.

**What it misses is breadth, not accuracy.** End-to-end recall (52.9%) is far below
reported-level recall (83.3%), and the whole gap is obligations the extractor never
proposed. `pw09` is the clearest: the excerpt's anti-contamination policy has seven
distinct undone items — temporal cutoff, chronological split, dedup, famous-CVE
exclusion, answer-key withholding, seed rotation, provenance recording — and the run
proposed obligations for none of them, scoring 2/10 end-to-end while getting 2 of the
3 obligations it *did* propose right. Once an obligation is on the list, the
judgement is good; the list is short.

**The eight false-satisfied verdicts** are concentrated and diagnosable:

| case / obligation | obligation | what it was credited to |
| --- | --- | --- |
| `pw19`/`obl_6` | *"a missing defence-in-depth measure is silently wrong, not control defeated"* | the rewritten severity prompt line, which does not contain the rule |
| `pw19`/`obl_1` | *"every producer assigns severity by this rubric"* | the same prompt line — one producer of three |
| `pw16`/`obl_1`,`obl_2`,`obl_5`,`obl_6` | four requirements on an **evaluation** of the capability | lines of the capability's own implementation and its CLI docs |
| `pw09`/`obl_7` | *"labels applied to a held-out set assembled under the anti-contamination policy"* | the fixture test that labels the **dev** set |
| `pw17`/`obl_9` | *"the model must be given a divergence to judge, not a repository to search"* | deterministic code, in a wave with no model call at all |

The shape is one thing, six times over: **an obligation about a thing that does not
exist is credited to the nearest thing that does.** A requirement on the evaluation
is credited to the implementation; a requirement on a held-out set is credited to the
dev set; a constraint on an unbuilt model call is credited to the deterministic code
around where it would go.

**Eighteen false-outstanding entries** (precision 69.0%) are the mirror image and are
much cheaper. Most are obligations an *earlier* change already satisfied, which this
diff therefore cannot evidence — `pw07` reports four such, `pw10` four, `pw11` three.
Under spec 23's economics this is the correct direction to err: a reviewer dismisses
each in seconds. It is also a real property of the tool, and a user should expect
roughly three in ten outstanding entries to be things already done elsewhere.

**The control arm's 6 outstanding entries are all wrong** (0/6). They are the same
shape — `ph03` flags *"run the summarizer before discovery when a provider is
configured"* as unaddressed on a diff whose `selectSummarizer` does exactly that.
With no genuine leftovers to find, everything the tool flags on a post-hoc corpus is
a false alarm, and its precision there is 0 by construction.

## Verdict

1. **The corpus does what it was built for.** Clause 5's bar was a non-zero number of
   genuinely outstanding obligations in the real arm. It produced **48** under the
   conservative reading, against **0** for the commit-message corpus across three
   rounds and **0** for this round's control. The pre-written corpus is worth keeping
   and every future measurement of `intent check`'s recall should use it.
2. **`intent check`'s judgement, on the obligations it produces, is sound** — 83.3%
   outstanding recall over 48 real opportunities, at n well above the pre-registered
   floor of 20. This is the first evidence that number has ever had; on the
   commit-message corpus it was structurally unmeasurable.
3. **Its extraction is too narrow to be trusted as a checklist.** 52.9% end-to-end
   means roughly half of what a human finds left undone never reaches the list. The
   report must not be read as an inventory of remaining work.
4. **The false-satisfied route is open and has a named shape.** 7.1%, with six of
   eight instances being an obligation about a non-existent artefact credited to the
   nearest existing one. Spec 23's reframing means this is a *missed* outstanding
   item rather than a certification of completion — the report never says the change
   is done — but it is the direction the spec calls expensive, and it is now
   measurable for the first time.
5. **Nothing here changes the ship decision.** Spec 23 keeps the capability off by
   default and this round does not argue with that.

## Spend

| item | cost |
| --- | --- |
| 25 runs, first pass | $2.6918 |
| 7 runs, second pass (3 restored cases + 4 re-run at a higher obligation cap) | $1.2483 |
| **total** | **$3.9401** of the $6.00 ceiling |

The 4 re-runs replaced earlier runs of the same cases whose obligation cap had been
set low to fit a cost estimate that turned out to be pessimistic; the superseded
$0.8496 is included in the total above and their reports are not scored. Per-case
range $0.0142–$0.2512. The pre-registered $5.20 abandon threshold was never
approached and no case was skipped.

## What this measurement does NOT establish

1. **Any figure's stability.** One run per case, no variance band. Extraction on this
   capability is demonstrably non-deterministic (the 2026-07-31 round saw identical
   inputs yield 14/16/23/20/14 obligations). Every count here carries noise of that
   order and no difference smaller than ~10% should be read as real.
2. **That `intent check` behaves this way on real tickets.** A spec section is
   unusually well-formed intent: numbered requirements, MUST language, one obligation
   per bullet. 100% extraction fidelity on this corpus is an upper bound, not a
   forecast for a Jira ticket or a three-line pull-request description.
3. **That the pre-written and post-hoc arms differ in anything but intent
   provenance.** They share seven diffs, which is the point — but the pre-written arm
   also covers six further commits the control does not, and the two arms have
   different obligation counts. The comparison is directional and structural, not a
   controlled n-of-7 paired test.
4. **Any rate to the precision implied.** 8 false-satisfied events and 18
   false-outstanding events. What is established is the **direction** and the
   **mechanism**, not the second digit.
5. **That the end-to-end recall denominator is complete.** The 70 human-outstanding
   items are one reader's enumeration of one set of excerpts. A different reader would
   enumerate differently and the 52.9% would move.
6. **Anything about the obligations the extractor did not propose.** They were never
   judged, so nothing is known about whether the judgement would have been right on
   them; end-to-end recall charges every one as a miss, which is the correct
   accounting for a reviewer but says nothing about the judgement stage.
7. **Anything outside this repository, TypeScript, one provider (`gpt-5.3-codex`),
   and 28 runs.**

## What invalidates this entry

- Any re-run that changes an obligation set. The corpus is fixed; the extraction is
  not.
- The decision-clause rule. 22 obligations move between readings and every headline
  figure moves with them; both readings are published above precisely so this cannot
  be settled silently.
- `pw02` contributes nothing to any rate under the primary reading — all eight of its
  obligations are decision clauses. Its case row is retained for extraction fidelity
  only.
- `pw16`'s four false-satisfied verdicts all concern requirements on an *evaluation*
  of the very capability under test, judged against the capability's own
  implementation diff. That is an unusually confusable pairing and may not generalise.
- The truth rule — *"addressed" means the demanded state holds at head, whoever made
  it hold* — is what makes 18 entries false-outstanding rather than correct. A reader
  who thinks `intent check` should only credit work in the diff under review would
  score precision far higher and should say so.

## Reproducing

```
node .codereviewer/eval/intent-corpus-realistic/build.mjs          # materialise, asserting ancestry
.codereviewer/eval/intent-corpus-realistic/rerun-all.sh caselist.txt
node .codereviewer/eval/intent-corpus-realistic/show-statements.mjs <case>   # statements only, no verdicts
node .codereviewer/eval/intent-corpus-realistic/score.mjs
```

Scored output: `.codereviewer/eval/intent-corpus-realistic/score-2026-08-01.txt`.
Ground truth is hand-written in `ground-truth.mjs` and derived from no engine output.
