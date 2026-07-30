# Intent-fulfilment review (spec 23): does the citation-aptness check work, and what does it cost?

Date: 2026-07-31
Capability: `intent check`, off by default, cannot gate.
Change under test: commit `1ae0db3`, spec 23's **Second Amendment** — a fourth model
call, in its own session, over an already-frozen judgement, asking whether the cited
lines are *evidence for that obligation* rather than merely lines the change touched.
A positively-`inapt` answer downgrades `addressed` → `undetermined` and increments
`inaptCitationCount`; `apt` and `undetermined` leave the verdict alone.
Baseline: `reports/2026-07-31-intent-fulfilment-remeasurement.md` (same 34 cases,
same corpus, pre-aptness build).

---

## The decision rule, fixed before any result of this round was read

Everything in this section was written before the first re-run was started, and
before any new report was opened. Clauses 1–6 are carried forward **unchanged** from
`reports/2026-07-31-intent-fulfilment-remeasurement.md`. Clauses 7–12 are new and
exist because a check that removes false-satisfied verdicts by suppressing correct
ones is a net loss, and that is the specific way this fix can fail.

### Carried forward unchanged

1. **False-satisfied rate ≤ 5%** of obligations reported `addressed`, measured **on
   the real arm and on the synthetic arm separately, never pooled.**
2. Because a rate of zero over a small denominator is not evidence of a small rate,
   the **95% upper confidence bound must also be ≤ 10%**; with zero observed events
   that is the rule of three, so it needs **n ≥ 30** reported-addressed obligations
   in the arm being judged.
3. **The binding denominator is opportunities to false-satisfy** — obligations that
   are genuinely NOT addressed — not obligations reported addressed. The same
   `n ≥ 30` / rule-of-three bound applies to that denominator.
4. **The deletion-heavy behavioural (DHB) sub-arm.** To conclude "the
   deletion-citation route does not produce false-satisfied claims" requires **≥ 30
   DHB opportunities taken zero times**. Below 30, the raw count is reported and no
   verdict is issued on the route.
5. **Citation aptness is a separate axis and does not gate.** Every `addressed`
   verdict is classed `apt` / `inapt` / `false-satisfied` by reading the cited lines
   against the diff. An inapt citation is never counted as a false-satisfied. An
   inapt rate above **20% of addressed verdicts** in the DHB sub-arm is recorded as
   a named risk but does not by itself withhold the capability.
6. **Unaddressed detection and obligation extraction are reported but do not gate.**
   A shortfall in either is a reason to improve the capability, never a reason to
   withhold it, and a strength in either never offsets (1)–(4).

### New for this round — the cost side of the fix

7. **False downgrades are the cost metric, and the one that decides whether the
   check is kept.** A *false downgrade* is an obligation that ground truth says is
   genuinely `addressed`, whose citations a human judges **apt**, that the aptness
   check moved to `undetermined`. It is established by reading the intent and the
   diff, never from the tool's own answer.

8. **The exchange rate, pre-registered.** Spec 23 fixes the asymmetry: a false
   *satisfied* claim is more costly than a false *unaddressed* one, because it stops
   a human looking. A false downgrade is the mild direction (it asks a reviewer to
   re-check work that was in fact done); a false-satisfied is the costly one. The
   check is therefore **kept only if**

   > `2 × (false-satisfied verdicts removed) ≥ (false downgrades produced)`

   — at most two false downgrades bought per false-satisfied removed. If the check
   removes no false-satisfied verdict at all, **any** false downgrade fails this
   clause: a check that costs something and buys nothing is withdrawn.

9. **Hard floors that no trade can buy through.** Regardless of clause 8:
   - synthetic-arm **unaddressed detection ≥ 85%** (baseline 90.0%; a 5pp fall is
     the most that is attributable to noise at this n);
   - **extraction faithful ≥ 95%** in each arm (baseline 96.1% real / 98.7%
     synthetic) — extraction is upstream of the new call and must not move at all;
   - correct-`addressed` retention: of obligations that are genuinely addressed with
     apt evidence, **≥ 90%** must still be reported `addressed`.
   A breach of any floor withdraws the stage whatever clause 8 says.

10. **Missed downgrades are reported and do not gate.** Of the inapt citations
    ground truth identifies in this round's runs, how many did the check leave
    standing as `addressed`? This measures the check's *power*, not its harm. A
    powerless check that costs nothing is a different verdict ("no effect") from a
    harmful one, and both must be distinguishable from the numbers.

11. **Minimum n, stated before looking.**
    - A **rate** of false downgrade is only quoted at **≥ 10 observed downgrades**.
      Below that, raw counts are reported and the verdict is explicitly "n too small
      to estimate a rate", while clause 8 is still applied to the raw counts because
      it is a count comparison, not a rate comparison.
    - A verdict on the DHB route being *closed* still needs ≥ 30 DHB opportunities
      taken zero times (clause 4).
    - Any figure moving by less than the demonstrated extraction non-determinism of
      this corpus (the same commit message yielded 14, 12, 13, 13 and 15
      obligations across five cases, i.e. roughly ±10% on any count) is reported as
      **not distinguishable from run-to-run variance**, never as an improvement.

12. **Attribution rule for downgrades, pre-registered because it could otherwise
    drift.** A downgraded obligation is reported as plain `undetermined` with its
    evidence removed, so the report does not say which `undetermined` rows the
    aptness check produced. `undetermined` rows have three possible causes: a
    model-`undetermined` judgement, a failed judgement call (which emits a warning
    naming the count), and an aptness downgrade (counted in `inaptCitationCount`).
    Where a case's `undetermined` row count equals `inaptCitationCount` plus failed
    judgements, attribution is exact. Where it does not, **the false-downgrade
    figure is reported as an interval** `[max(0, k − (|U| − a)), min(a, k)]` over the
    `k` downgrades and the `a` genuinely-addressed rows among the `|U|` undetermined
    ones — never as a point estimate chosen for convenience.

13. **`inaptCitationCount` accuracy is checked, not assumed.** The reported counter
    is compared with the downgrades attributable by clause 12. A counter that cannot
    be reconciled is reported as a **bug**, not worked around.

14. **Ground truth is established by reading the intent and the diff by hand.**
    Carry-forward is permitted only for an obligation whose **statement text and
    source line are identical** to the pre-aptness run of the same case, because
    then the hand-established truth is a property of an unchanged pair. Every
    changed statement, every status change against the pre-aptness run, and **every
    citation set of every `addressed` verdict** is re-read — aptness is a property
    of the citations, and the baseline round demonstrated that citations vary
    run-to-run on the same obligation. Genuinely ambiguous obligations are recorded
    `unclassifiable` and excluded from every rate.

Ship = "safe to show a human as advisory output". Spec 23 forbids gating on this
capability regardless of any number below. This round additionally decides **keep or
withdraw the aptness stage**, by clauses 8–9.

Budget: **$5.00** of provider spend, accumulated from each run's `usage.costUsd`.

---

*(Results below this line were written after the runs completed.)*

## What was measured

All **34 cases re-run** against `1ae0db3` with the aptness stage active and proven to
execute (`inaptCitationCount` is present in every report and non-zero in six of
them). The pre-aptness reports, and the ground truth that scored them, are preserved
under `.codereviewer/eval/intent-corpus/runs-2026-07-31-pre-aptness/`; the
2026-07-30 reports remain under `runs-2026-07-30/`. Ground truth was re-derived by
hand for all **303 reported obligations** (80 real, 223 synthetic) under clause 14.

Two things had to be worked around, and both are recorded rather than smoothed over:

1. **A downgraded obligation's citation is not in the report.** The row becomes plain
   `undetermined` and its `evidence` array is dropped, so the report cannot say which
   lines the stage rejected. Attribution of *which* rows are downgrades is
   nevertheless **exact in all 34 runs**: `inaptCitationCount` sums to 8, exactly 8
   `undetermined` rows sit in cases reporting a non-zero counter, the remaining 3
   sit in cases reporting 0, and no run emitted a failed-judgement warning. The
   interval machinery of clause 12 was therefore never needed.
2. **Whether the rejected citation was apt** had to be established from the diff plus
   the citation the pre-aptness run produced for the same statement. To remove that
   dependency, the stage was additionally probed **directly**, one call at a time,
   over 68 (obligation, citations) pairs whose aptness a human had already labelled
   (`aptness-probe.mjs`, results in `aptness-probe-results.json`). That probe is
   reported separately below and is the cleanest evidence in this report.

---

## Results — the three spec 23 metrics, real and synthetic never pooled

### Real arm — 12 commits, 80 reported obligations

| metric | before (pre-aptness) | after (aptness) |
| --- | --- | --- |
| **1. Extraction** — faithful obligations | 96.1% (73/76) | **96.3% (77/80)** |
| — human obligations covered | 92.6% (63/68) | **95.6% (65/68)** |
| **2. Unaddressed detection** | not measurable (denominator 0) | **not measurable (denominator 0)** |
| **3. False-satisfied** | 0.0% (0/73) | **0.0% (0/75)** |
| — opportunities to false-satisfy | **0** | **0** |
| 4. Citation aptness — correct verdict, inapt evidence | 4.1% (3/73) | **2.7% (2/75)** |
| (context) false `unaddressed` | 2 | 2 |
| (context) `undetermined` rows | 0 | 2 (1 aptness downgrade, 1 judgement) |
| (context) unclassifiable | 1 | 1 |

### Synthetic arm — 22 marked cases, 223 reported obligations

| metric | before (pre-aptness) | after (aptness) |
| --- | --- | --- |
| **1. Extraction** — faithful obligations | 98.7% (222/225) | **99.6% (222/223)** |
| — human obligations covered | 93.8% (180/192) | **94.8% (182/192)** |
| **2. Unaddressed detection** | 90.0% (72/80) | **92.5% (74/80)** |
| **3. False-satisfied** | 2.8% (4/142) | **2.2% (3/135)** |
| — opportunities to false-satisfy | 80 | 80 |
| — **opportunities TAKEN** | **4** | **3** |
| — one-sided 95% upper bound, per opportunity | 11.1% | **9.4%** |
| 4. Citation aptness — correct verdict, inapt evidence | 8.0% (11/138) | **6.1% (8/132)** |
| (context) false `unaddressed` | 3 | 1 |
| (context) `undetermined` rows | 4 | 9 (6 aptness downgrades, 3 judgement) |
| (context) unclassifiable | 4 | 4 |

### The deletion-heavy behavioural sub-arm

| | before | after |
| --- | --- | --- |
| DHB opportunities to false-satisfy | 52 | **52** |
| **TAKEN** | **3** | **2** |
| correctly reported `unaddressed` | 46 | 48 |
| reported `undetermined` (safe miss) | 3 | 2 |
| point estimate | 5.8% | **3.8%** |
| one-sided 95% upper bound | 14.2% | **11.6%** |
| aptness on the same shape | **33.3% inapt (4/12)** | **0.0% inapt (0/15)** |

**The aptness improvement on this shape is NOT the stage's doing and must not be
credited to it.** The stage can only downgrade a verdict; it cannot improve a
citation. The 0% is because the *judgement* happened to cite the apt docs line
("`{ "signal": false }` — now fails validation with **exit code 2**") for the
exit-code-2 obligation in every deletion-heavy case this round, having cited removed
schema keys in three of four last round. That is the same coin flip the previous
report documented, landing the other way. It is the single largest movement in this
table and it is noise.

---

## The aptness stage's own ledger — 8 downgrades, itemised

Every one was read against the diff by hand.

| # | case / obligation | obligation | truth | verdict on the downgrade |
| --- | --- | --- | --- | --- |
| 1 | `r4-4731580`/`obl_4` | *"Keep the underlying field name unchanged rather than renaming it."* | addressed | **FALSE** |
| 2 | `s5-4731580-added`/`obl_4` | the same obligation on the same commit | addressed | **FALSE** |
| 3 | `s12-cb72424-added2`/`obl_4` | *"Update the test invariant to assert the brief is absent from refutation's structured context."* | addressed | **FALSE** |
| 4 | `s24-52ff75d-behaviour2`/`obl_13` | *"Keep the Spec 25 numbers in the ledger entry."* | addressed | correct — no apt citation exists (the ledger is not in this diff) |
| 5 | `s24-52ff75d-behaviour2`/`obl_14` | *"Keep the Spec 25 numbers in the docs."* | addressed | **FALSE** — the docs result table is added on lines 58-67 and was cited for this exact statement before |
| 6 | `s28-ee0589e-drop-config-validation`/`obl_5` | *"Keep Arm A retained but disabled by default."* | addressed | **FALSE** — the added spec line says exactly this |
| 7 | `s32-52ff75d-behaviour3`/`obl_13` | *"Keep the result numbers in the ledger entry and docs."* | addressed | **undecidable** — docs half apt, ledger half not; excluded |
| 8 | `s32-52ff75d-behaviour3`/`obl_20` | *"Make the declaration-analysis barrel refuse a stage-3 consumer at runtime."* | **unaddressed** | **CORRECT — a false-satisfied verdict removed** |

**Benefit: 1. Cost: 5. Plus 1 correct-by-necessity and 1 undecidable.**

`inaptCitationCount` **reconciles exactly**: 8 reported, 8 attributable. Clause 13
is satisfied and no counter bug was found.

### Two of the five false downgrades are reproducible, not flukes

`r4`/`obl_4` and `s5`/`obl_4` are the **same obligation on the same commit in two
different cases**, downgraded in both. The direct probe re-ran that citation set
three times: `inapt`, `inapt`, `inapt` for `r4` and `inapt`, `inapt`,
`undetermined` for `s5`. The stage rejects *"keep the field name unchanged"*
evidenced by an added line that carries the new label beside the retained field name
— which is the only evidence such an obligation can ever have.

`s12`/`obl_4` is the most damaging one to read as a reviewer: it was downgraded while
its **two siblings survived**. `obl_5` and `obl_6` are the adjacent assertions of the
same test, cited the same way, and both kept their `addressed` verdict. A reviewer
sees one of three test invariants inexplicably demoted.

### Missed downgrades — what the stage left standing

| | count | ids |
| --- | ---: | --- |
| inapt citations left `addressed` | **10** | `r9`/`obl_12`, `r13`/`obl_7`, `s17`/`obl_10`, `s24`/`obl_11`, `s32`/`obl_11`, `s25`/`obl_10`, `s25`/`obl_11`, `s28`/`obl_4`, `s21`/`obl_7`, `s33`/`obl_7` |
| **false-satisfied verdicts left `addressed`** | **3** | `s17`/`obl_13`, `s28`/`obl_7`, `s33`/`obl_14` |

**The flagship case survived.** `s17-52ff75d-behaviour`/`obl_13` — *"Make runs that
request the withdrawn `guarded-region` context kind fail intake with exit code 2
instead of assembling an empty section"* — is reported `addressed` again, on the same
two REMOVED lines (`agent-contracts.ts:49 'guarded-region'` and `context.ts:316
inputContext.kind === 'guarded-region'`) with their adjacent added `'change-intent'`
lines. That single verdict is the reason the Second Amendment was written, and
`inaptCitationCount` for that case is **0**: the aptness call looked at exactly this
citation and did not judge it inapt.

`s33`/`obl_14` (*"builds carrying a stale removed kind fail loudly"*, credited to docs
prose about **config** validation) and `s28`/`obl_7` (*"update the DOCS"*, cited to
the SPEC, on a byte-identical citation set) also survived unchanged.

---

### The structural guards, for the third round running, never fired

`unevidencedAddressedCount` and `uncitedObligationCount` are **0 across all 34 runs**,
no run was truncated by `maxChangeLines`, and not one run emitted a warning. Every
citation in every false-satisfied verdict above is a real line the change really
touched. That was the whole premise of the Second Amendment and it still holds — the
amendment's answer to it is what failed, not the diagnosis.

---

## The direct probe — the cleanest number in this report

68 (obligation, citations) pairs taken from the pre-aptness reports, each carrying a
hand-established label, fed to the aptness call alone. Cost **$0.1162**.

| ground-truth label | n | → `apt` | → `undetermined` | → `inapt` |
| --- | ---: | ---: | ---: | ---: |
| **apt** (a correct verdict on real evidence) | 50 | 46 | 3 | **1** |
| **inapt** (correct verdict, evidence not on point) | 14 | 4 | 8 | **2** |
| **false-satisfied** (the verdict itself is wrong) | 4 | 1 | 2 | **1** |

Only the `inapt` column acts; `apt` and `undetermined` leave the verdict standing.
So, per call:

- **false-downgrade rate on genuinely apt evidence: 1/50 = 2.0%** (95% upper bound
  9.1%). The stage is conservative exactly as designed.
- **power against inapt citations: 2/14 = 14.3%.**
- **power against outright false-satisfied verdicts: 1/4.**

And this is the arithmetic that decides the question:

> The population of `addressed` verdicts is **overwhelmingly apt** — 197 apt against
> 18 not-evidence in the pre-aptness runs. A 2% false-inapt rate on 197 apt citations
> yields ≈ 4 wrong downgrades; a 14% catch rate on 18 bad ones yields ≈ 2.5 right
> ones. **Expected precision of the downgrade decision ≈ 38%** — which is what the
> live runs produced (2 defensible against 5 false, plus 1 undecidable).

The stage is not badly calibrated. It is **correctly calibrated and pointed at a rare
event**, and at this base rate a conservative check still does more harm than good.
The one apt→inapt pair the probe found is `s28`/`obl_5` — the same false downgrade
the live run produced, independently reproduced.

*(Caveat, stated because it would otherwise inflate the cost figure: four extra pairs
were probed because the live runs had downgraded them. That is a biased sample and is
NOT pooled with the 1/50. Their verdicts are in the reproducibility note above.)*

---

## Verdict against the pre-registered rule

| clause | result |
| --- | --- |
| 1. false-satisfied ≤ 5% of reported-addressed, per arm | real 0.0%, synthetic 2.2% — **pass** |
| 2. 95% upper bound ≤ 10% at n ≥ 30 reported-addressed | real n=75 → 3.9%; synthetic n=135 → 5.6% — **pass** |
| 3. same bound on **opportunities**, n ≥ 30 | real n=**0** → cannot be judged; synthetic n=80, 3 taken → 3.8%, bound **9.4%** — **pass** (it was 11.1% FAIL before) |
| 4. DHB route: ≥ 30 opportunities taken **zero** times | 52 opportunities, **2 taken** — **FAIL, the route is still demonstrated** |
| 5. aptness > 20% inapt on the DHB shape → named risk | 0.0% (0/15) — no risk recorded, **and the movement is noise, not the stage** |
| 6. extraction / detection reported, do not gate | 96.3% / 99.6% faithful; detection 92.5% — reported |
| **7–8. false downgrades and the exchange rate** | **5 false downgrades against 1 false-satisfied removed. 2 × 1 = 2 < 5 → FAIL** |
| 9. hard floors | detection 92.5% ≥ 85% **pass**; extraction 96.3%/99.6% ≥ 95% **pass**; correct-`addressed` retention 94.9% real / 95.0% synthetic ≥ 90% **pass** |
| 10. missed downgrades reported, do not gate | 10 inapt + 3 false-satisfied left standing — reported |
| 11. minimum n | 8 downgrades is **below the 10 needed to quote a rate**, so no false-downgrade *rate* is claimed. Clause 8 is a count comparison and does apply. |
| 12. attribution | exact in all 34 runs; no interval needed |
| 13. `inaptCitationCount` accuracy | **8 reported, 8 attributable — reconciles** |

### The answer to the question, in one paragraph

**The check works, in the sense that it fires on real inaptness and its per-call
false-rejection rate is low (2%). It does not work, in the sense that matters: over 34
cases it removed ONE wrongly-certified obligation, left THREE standing including the
exact verdict it was built for, and suppressed FIVE correct ones. It fails its
pre-registered exchange rate by more than a factor of two.**

Nothing in the arm-level movement rescues it. False-satisfied went 4 → 3, and the one
removal is attributable to the stage; but unaddressed detection, extraction and
aptness all moved by amounts inside this corpus's demonstrated run-to-run variance,
and the largest single movement in the tables (DHB inapt 33.3% → 0.0%) is a citation
coin flip the stage cannot influence.

### Recommendation

**Withdraw the citation-aptness stage as it stands** — it is off-by-default code that
costs one extra model call per addressed obligation and, measured, makes the report
worse for a reviewer more often than better. Two directions survive the measurement
and are worth a spec decision rather than an edit:

1. **Narrow it to the shape it was built for.** Run the check *only* on obligations
   that are behavioural AND cited exclusively to removed lines. Four of the five false
   downgrades were preservation obligations (*"keep the field name"*, *"keep the
   numbers"*, *"keep Arm A off by default"*) whose evidence can only ever be an added
   line that mentions the thing — precisely the class this filter excludes. On the
   probe's numbers a filter like that keeps the one true catch and drops most of the
   cost, but that is a prediction, not a measurement.
2. **Stop suppressing and start disclosing.** The stage's answer could annotate the
   citation instead of demoting the verdict: `addressed` with *"the cited lines may
   not evidence this"*. That preserves the 95% correct-`addressed` retention while
   still telling the reviewer where to look twice, and it cannot suppress anything.

Neither is implemented, and neither should be until a spec says so.

**The capability itself stays off by default.** Spec 23's ship rule is unchanged and
still unmet: the DHB route remains demonstrated at 2 of 52.

---

## Spend

| item | cost |
| --- | --- |
| 34 live runs with the aptness stage | **$2.5174** |
| direct probe, 68 pairs | $0.1162 |
| targeted re-probe of 5 downgraded pairs, ×3 | $0.0203 |
| **total this round** | **$2.6539** of the $5.00 ceiling |

The 34 runs cost **+8.1%** against the pre-aptness round's $2.3277 for the same
cases. That is the price of one extra call per addressed obligation, and it is small
because the aptness call sees only the obligation and its citations, not the change
surface. Per-case range $0.0215–$0.1682.

---

## What this measurement does NOT establish

1. **That the false-downgrade RATE is 2.0%, or anything else.** 8 downgrades and one
   50-pair probe sample. Clause 11 forbids quoting a rate below 10 events and it is
   not quoted; the **counts** are what the verdict rests on.
2. **That the aptness stage is why false-satisfied fell 4 → 3.** One of the four
   removals is attributable to it. The other three verdicts were reproduced
   unchanged, and the denominators moved (142 → 135 reported-addressed) through
   extraction non-determinism.
3. **That the DHB inapt rate improved.** It did not improve *because of the stage*;
   the judgement happened to pick the apt citation this round. Read as a variance
   demonstration, not a gain.
4. **That the real arm says anything about false-satisfied.** Zero real
   opportunities, for the third round running.
5. **That the narrowing proposals above would work.** They are predictions from a
   68-pair probe on one corpus.
6. **Run-to-run stability of any live figure.** One run per case. The five cases
   sharing `52ff75d`'s message reported **14, 16, 23, 20 and 14** obligation rows
   this round against **14, 16, 20, 20, 15** in the pre-aptness round (`r9`, `s17`,
   `s24`, `s32`, `s25`) — on identical inputs. Every count in the tables carries
   extraction noise of that order.
7. **Anything about a downgraded row's actual citation.** The report drops the
   evidence when it downgrades, so five of eight classifications lean on the
   pre-aptness citation for the same statement plus what the diff contains. The
   probe was built to compensate and does so only for the pairs it was given.
8. **Anything outside this repository, this language, one provider, and 34 cases with
   engineered synthetic mismatches.**

## What invalidates this entry

- Any rerun that changes an obligation set — extraction is demonstrably
  non-deterministic and there is no variance band.
- The 8 downgrades are 8 events. A rerun could produce 4 or 12; what is established
  is the **direction** (most downgrades on this corpus are wrong) and the
  **mechanism** (a 2%-error check pointed at a 9%-prevalence event).
- The false-downgrade classification for `s12`/`obl_4` and `s24`/`obl_14` rests on
  the citation the *pre-aptness* run gave the same statement; the probe on those exact
  citation sets answered `undetermined`, so the live run's citation may have differed.
  Both remain classified false because apt evidence for both is in scope and their
  siblings kept it.
- `s21`/`obl_9`, `s21`/`obl_11`, `s24`/`obl_23`, `s28`/`obl_2` and `r9`/`obl_1` are
  `unclassifiable` and excluded from every rate.

## Reproducing

```
.codereviewer/eval/intent-corpus/rerun-all.sh caselist.txt          # all 34
node .codereviewer/eval/intent-corpus/score.mjs                     # every axis
node .codereviewer/eval/intent-corpus/compare-aptness.mjs --compact  # against the pre-aptness runs
node --env-file=.env --import tsx \
  .codereviewer/eval/intent-corpus/aptness-probe.mjs --apt-sample 60 # the direct probe
```

Scored output of this round: `.codereviewer/eval/intent-corpus/score-2026-07-31-aptness.txt`.
Ground truth is hand-written in `ground-truth.mjs` and derived from no engine output.
