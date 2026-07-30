# Intent-fulfilment review (spec 23) re-measured with an obligation cap that cannot bind

Date: 2026-08-01
Capability: `intent check` at `76cfe3b` — off by default, cannot gate, reports
`outstandingCount` and never certifies completion.
Corpus: `.codereviewer/eval/intent-corpus-realistic/` — identical to the
2026-08-01 round in every respect except one field.
Baseline: `reports/2026-08-01-intent-realistic-corpus-measurement.md`, preserved
run-for-run under `.codereviewer/eval/intent-corpus-realistic/runs-2026-08-01-capped/`.

## Why this round exists

The baseline reported **52.9% end-to-end outstanding recall** and diagnosed
extraction breadth as the bottleneck. Inspecting its run artefacts then showed that
**24 of its 28 runs returned exactly their configured `maxObligations` cap**. The
per-case caps were 8–12, set when the corpus was built, against a product default
of 20. `obligationsTruncated` reported `false` in all 28 runs and hid it; `76cfe3b`
fixed that flag.

An unknown part of 52.9% was therefore **a binding cap, not an extraction
weakness**. This round separates the two.

## The single variable

`maxObligations` 8–12 → **40**, for all 28 cases, via `case-manifest.mjs` and
`build.mjs`. Nothing else moved: same intent slices, same base/head pairs, same
`src/` at `76cfe3b`, same truth rule, same metric definitions, same `score.mjs`
logic for the primary reading. One case (`pw12`) returned exactly 40 and was
re-run at 60, where it returned 39 with `obligationsTruncated: false`. **No scored
run is truncated by either cap.**

---

## Pre-registered expectation, written before the cap was raised

Recorded before `build.mjs` was re-run and before any uncapped report was opened.

| # | prediction | outcome |
| --- | --- | --- |
| 1 | pre-written arm 280–420 obligations; post-hoc 75–110 | **469** and **89** — over on the pre-written arm |
| 2 | extraction breadth 80–110% by count | **153.3%** — over |
| 3 | end-to-end recall **62–78%**, explicitly not reaching 90% | **81.2%** — over the band, under 90% |
| 4 | reported-level recall flat or slightly down, 75–88% | **84.6%** (from 83.3%) — in band, flat |
| 5 | precision falls, 55–72% | **51.5%** — fell further than predicted |
| 6 | post-hoc arm still ~0 genuinely outstanding | **0** — correct |
| 7 | the cap recovers **10–25 points** of end-to-end recall, and extraction **remains** the bottleneck afterwards | recovered **27.6 points** — over; and extraction **is no longer the bottleneck** — the prediction's second half is **wrong** |
| 8 | cost $5.50–$7.00 | **$6.34** — in band |

Five of eight predictions landed outside their band, all in the same direction:
**the cap was doing more damage than expected.** Prediction 7's second clause is
the one that matters and it is refuted below.

---

## One correction to the fixed human enumeration, and it is the only one

The end-to-end denominator is the **human enumeration of leftovers established for
the capped round**, unchanged. Nothing was added to it because a bigger obligation
budget surfaced it — that would be mining the tool's output for the denominator of
its own recall. Only the obligation id that carries each item was re-mapped, because
ids are positional (`obl_3` in this round is a different statement from `obl_3` in
the capped round).

**One item was removed.** `pw05` listed *"the existing prompt genericity guard is
NOT extended to cover the new guarded-region section text"*. Re-reading the diff to
judge a newly-surfaced obligation shows that is factually wrong:
`guarded-region-context.test.ts:79` runs `findPromptGenericityViolations` over the
emitted `sectionText` and asserts no violation. The guard was applied from a new
test file rather than by editing the old one, so the demanded **state** holds. Under
this corpus's own truth rule the item is not a leftover.

The pre-written denominator is therefore **69, not 70, in both rounds**. Every
before/after figure below restates the capped baseline on 69 so the comparison is
single-variable. The capped end-to-end recall as published was 52.9% (37/70); on
the corrected denominator it is **53.6% (37/69)**.

---

## Results — primary reading (conditional decision rules `unclassifiable`)

### Pre-written arm — 21 cases

| metric | capped (8–12) | **uncapped (40)** |
| --- | ---: | ---: |
| reported obligations | 192 | **469** |
| **3. extraction fidelity** | 100.0% (192/192) | **100.0% (469/469)** |
| — breadth against 306 human obligations | 62.7% | **153.3%** *(a count ratio, not a matching)* |
| — unclassifiable, excluded | 22 | 33 |
| **1. outstanding recall, of what it proposed** | 83.3% (40/48) | **84.6% (88/104)** |
| **1b. outstanding recall, end-to-end** | 53.6% (37/69) | **81.2% (56/69)** |
| **2. outstanding precision** | 69.0% (40/58) | **51.5% (88/171)** |
| false-satisfied | 7.1% (8/112) | **6.0% (16/265)** |
| opportunities to be wrong about an unaddressed obligation | 48 | **104** |
| runs truncated by `maxObligations` or `maxChangeLines` | 0 | **0** |

### Post-hoc control arm — 7 cases, same diffs

| metric | capped | **uncapped** |
| --- | ---: | ---: |
| reported obligations | 60 | **89** |
| extraction fidelity | 100.0% (60/60) | **100.0% (89/89)** |
| — breadth against 68 human obligations | 88.2% | **130.9%** |
| outstanding recall | not measurable — denominator 0 | **not measurable — denominator 0** |
| outstanding precision | 0.0% (0/6) | **0.0% (0/7)** |
| false-satisfied | 0.0% (0/54) | **0.0% (0/82)** |
| **genuinely outstanding obligations** | **0** | **0** |

The control arm reproduces exactly. Tripling the extraction budget on a commit
message produces 29 more obligations and **still zero genuine leftovers** — the
baseline's structural claim about post-hoc intent survives a 1.5× larger sample.

## Both readings of the 22 (now 31) conditional decision rules

| | capped, conservative | capped, permissive | **uncapped, conservative** | **uncapped, permissive** |
| --- | ---: | ---: | ---: | ---: |
| opportunities | 48 | 69 | **104** | **135** |
| outstanding recall, reported | 83.3% (40/48) | 85.5% (59/69) | **84.6% (88/104)** | **83.0% (112/135)** |
| outstanding recall, end-to-end | 53.6% (37/69) | 60.2% (53/88) | **81.2% (56/69)** | **81.6% (80/98)** |
| outstanding precision | 69.0% (40/58) | 76.6% (59/77) | **51.5% (88/171)** | **57.4% (112/195)** |
| false-satisfied | 7.1% (8/112) | 8.8% (10/114) | **6.0% (16/265)** | **8.5% (23/272)** |

Both readings give the same answer and the same direction of every movement. The
permissive end-to-end denominator is built by a stated rule (each decision rule
contributes one item unless an existing human item already names it via
`coveredPermissive`); the capped round's permissive denominator was built by hand
and is quoted as published, so the two permissive end-to-end figures are
directionally comparable rather than identically constructed.

---

## The question this run exists for: how much of the 52.9% was the cap?

Decompose the 32 missed items in the capped round and the 13 in this one into the
two ways a leftover can be missed.

| | capped | **uncapped** |
| --- | ---: | ---: |
| human-enumerated leftovers | 69 | 69 |
| **recovered** | 37 | **56** |
| missed because the extractor **never proposed** an obligation for it | **24** | **4** |
| missed because it **was proposed and wrongly judged addressed** | 8 | **9** |

**The answer, in one line: the cap accounts for 27.6 of the 46.4-point shortfall —
about 60% of it — and it accounts for 20 of the 24 extraction misses.**

- End-to-end recall 53.6% → **81.2%**, a **+27.6-point** move, far outside the
  ±10% run-to-run extraction noise this capability has demonstrated.
- Extraction misses fell **24 → 4**, an 83% reduction. Judgement misses were
  **unchanged (8 → 9)**, which is exactly what a single-variable cap change should
  do to a stage the cap does not touch, and is corroborating evidence that the
  change is the cap rather than run-to-run drift.

### Is extraction still the bottleneck? No.

The baseline's headline diagnosis — *"its extraction is too narrow to be trusted as
a checklist; roughly half of what a human finds left undone never reaches the
list"* — **does not survive the cap being lifted.** After it:

- extraction accounts for **4 of 69 misses (5.8%)**;
- judgement accounts for **9 of 69 (13.0%)**;
- and the **binding constraint is now precision: 51.5%**, down from 69.0%.

Extraction is now the *smaller* of the two error sources. What is left of it is
genuine and small: the ±4.8pp not-a-result band in `pw06`, the lens's unmeasured
precision effect in `pw07`, the *"before any detector ships"* acceptance bar in
`pw10`, and the ship/disable/remove decision rule in `pw14`. Note that `pw10`'s was
proposed in the **capped** run and not in this one — extraction is non-deterministic
in both directions, and 4 misses at n=1 is at the resolution limit of this
instrument.

**The residual diagnosis is the false-satisfied route**, and it has the same named
shape the baseline recorded: *an obligation about a thing that does not exist is
credited to the nearest thing that does.* All 16 instances:

| case / obligation | obligation | why it is wrong |
| --- | --- | --- |
| `pw06`/`obl_2`,`obl_3`,`obl_4` | *"include arm 0 / arm A / arm B"* | no arm was ever run; the commit ships both arms off by default and unmeasured |
| `pw19`/`obl_1` | *"every producer assigns severity by this rubric"* | one producer of three was changed |
| `pw19`/`obl_6` | *"a missing defence-in-depth measure is silently wrong"* | the rule is in the spec and not in the prompt |
| `pw19`/`obl_9` | *"an error path counts as exactly one condition"* | the prompt never mentions error paths |
| `pw16`/`obl_1`,`obl_2`,`obl_6` | three requirements on an **evaluation** | credited to the capability's own implementation |
| `pw17`/`obl_6`,`obl_12` | two constraints on an **unbuilt model call** | credited to the deterministic code around where it would go |
| `pw09`/`obl_8` | *"labels applied to a held-out set"* | credited to the **dev** set |
| `pw10`/`obl_32` | *"improvement demonstrated under the anti-contamination policy"* | no such policy exists |
| `pw12`/`obl_38` | *"adding a platform is a new PlatformAdapter only"* | `PlatformAdapter` is a type with no provider behind it |
| `pw08`/`obl_26` | *"the reviewer's own prompt-injection resistance is a measured mechanism"* | `prompt-injection` in the fixture schema is a vulnerability class of reviewed code |
| `pw14`/`obl_10` | *"recall reported per reachability class"* | no recall is reported at all |

Six of the sixteen are the *non-existent-artefact-credited-to-the-nearest-existing-one*
shape the baseline named, and the rate itself is **flat** (7.1% → 6.0% conservative;
8.8% → 8.5% permissive). Lifting the cap neither caused nor cured it.

### The cost: precision fell 69.0% → 51.5%

This is the real price and it should not be softened. Roughly **half** the
outstanding list is now something already done. The dominant shape is unchanged
from the baseline and is mechanical: an obligation an **earlier** change satisfied,
which the diff under review therefore cannot evidence. `pw11` is the extreme case —
33 obligations, **18 flagged outstanding, 0 genuinely outstanding**, because it
judges spec 11's *summarization* commit against injection clauses that landed in the
*providers* commit one wave earlier. `pw10` contributes 14 and `pw05` 11 on the same
mechanism.

Under spec 23's stated economics this is the correct direction to err — a doubtful
item costs a reviewer ten seconds, a missed one costs the capability its purpose —
but a user should now expect roughly **one in two** outstanding entries to be
something already done elsewhere, not three in ten.

---

## Recommendation for the `maxObligations` default

**Raise it from 20 to 40.**

Grounds, all measured here:

1. **20 would still bind.** Eleven of the 28 cases returned ≥ 20 obligations
   (`pw03` 20, `pw14` 20, `ph06` 25, `pw08` 26, `pw17` 31, `pw20` 31, `pw10` 33,
   `pw11` 33, `pw09` 34, `pw05` 35, `pw12` 39). A default of 20 reproduces the
   defect this round measured on 39% of this corpus.
2. **40 is close to the natural ceiling for intent this dense.** `pw12` re-run at a
   cap of **60** returned **39**. The extractor stops on its own well before 60; the
   cap buys headroom rather than volume.
3. **The cap only costs money when the intent genuinely holds that many
   obligations.** Seventeen of 28 cases returned fewer than 20 and are unaffected by
   the change. A three-line pull-request description will never approach it.
4. **The measured price is linear and modest.** Cost per obligation is essentially
   flat across the two rounds — $0.0123 capped, **$0.0108** uncapped — because each
   obligation is one judgement call plus (on an `addressed` verdict) one aptness
   call. Per-run cost on this corpus ranged **$0.0093–$0.7591**, mean $0.2151,
   against $0.110 capped: roughly **2× on the cases where the cap was binding**, and
   **unchanged on the cases where it was not**. Raising the default from 20 to 40
   therefore costs at most ~2× on intent-dense inputs and nothing on ordinary ones.
5. **`obligationsTruncated` now tells the truth**, so a user who sets a lower cap for
   cost reasons can see when their checklist was cut short. That is what makes a
   generous default safe rather than a blank cheque.

What this recommendation does **not** rest on: any claim that 40 is optimal. The
evidence supports *"20 binds on this corpus and 40 does not"*, and nothing was
measured between 20 and 40 or above 60.

---

## Spend

| item | cost |
| --- | ---: |
| 28 scored runs | $6.0231 |
| superseded `pw12` run at cap 40 (hit the cap; re-run at 60) | $0.3200 |
| **total** | **$6.3431** of the $9.00 ceiling |

Per-case range $0.0093–$0.7591. The $8.00 abandon threshold was never approached
and no case was skipped. Against the capped round's $3.0906 for the same 28 cases,
the uncapped round cost **1.95×** for **2.21×** the obligations.

---

## What this measurement does NOT establish

1. **Any figure's stability.** One run per case, no variance band. Extraction on
   this capability is demonstrably non-deterministic; the 2026-07-31 round saw
   identical inputs yield 14/16/23/20/14 obligations. The +27.6-point end-to-end
   move is far outside that noise and the sub-figures are not.
2. **That the 4 remaining extraction misses are a stable count.** At n=1 and n=4
   this is at the resolution limit of the instrument. One of them (`pw10`) was
   proposed in the capped run and missed here, which is drift, not a trend.
3. **That precision really is 51.5%.** The truth rule — *"addressed" means the
   demanded state holds at head, whoever made it hold* — is what makes 83 entries
   false-outstanding. A reader who thinks `intent check` should only credit work in
   the diff under review would score precision far higher and should say so.
4. **That the end-to-end denominator is complete.** It is deliberately the same
   69-item enumeration the capped round used, so the comparison is clean — but this
   round surfaced **39 obligations judged genuinely outstanding that no item of that
   fixed list names**. The enumeration was made by one reader looking at an 8–12
   obligation view of each excerpt, and it is now demonstrably incomplete. Neither
   round's end-to-end figure is an absolute coverage rate; the *difference* between
   them is what this round establishes.
5. **That any of this transfers off spec sections.** A spec section is unusually
   well-formed intent: numbered requirements, MUST language, one obligation per
   bullet. 100% extraction fidelity and 22 obligations per case are an upper bound,
   not a forecast for a Jira ticket.
6. **Anything about the obligations the extractor still does not propose.** They
   were never judged.
7. **Anything outside this repository, TypeScript, one provider (`gpt-5.3-codex`),
   and 28 runs.**

## Also found, recorded not patched

**The context redactor mangles a backticked configuration constant.** `pw11`'s
intent line 33 reads ``(`task-context-change-intent`), byte counts, and a content
hash.`` in the source document; the tool received ``(`ta[REDACTED]`), byte counts,
and a content hash.`` and faithfully extracted *"Record a stable reason
ta[REDACTED]"*. A secret-pattern rule is firing on a hyphenated identifier inside
backticks. It cost nothing here — the obligation is still citable and correctly
judged — but a redactor that eats literal config keys out of a ticket will
eventually eat the thing the obligation is about. `src/` was not modified.

## What invalidates this entry

- Any re-run that changes an obligation set. The corpus is fixed; the extraction is
  not.
- The decision-clause rule. 31 obligations move between readings; both readings are
  published above so this cannot be settled silently.
- The `pw05` denominator correction. It moves the capped baseline from 52.9% to
  53.6% and is the only change made to a fixed human enumeration in this round. A
  reader who thinks *"the existing guard test MUST cover it"* demands editing that
  specific test file rather than applying the guard should restore the item, making
  the capped figure 52.9% (37/70) and this round's 80.0% (56/70).
- `pw11`'s 18 false-outstanding entries are one case judging one wave of a two-wave
  feature. It is 21% of the pre-written arm's false-outstanding total from a single
  case, and precision without it is 57.5% (88/153).

## Reproducing

```
node .codereviewer/eval/intent-corpus-realistic/build.mjs
.codereviewer/eval/intent-corpus-realistic/rerun-all.sh caselist.txt
node .codereviewer/eval/intent-corpus-realistic/score.mjs
node .codereviewer/eval/intent-corpus-realistic/score.mjs --permissive
```

Scored output: `score-2026-08-01-uncapped.txt` and
`score-2026-08-01-uncapped-permissive.txt`. The capped round is preserved intact —
runs, config, ground truth and scorer — under `runs-2026-08-01-capped/`, and
`node runs-2026-08-01-capped/score.mjs` still reproduces its published figures
exactly. Ground truth is hand-written in `ground-truth.mjs`; every label without a
`carried` field was established fresh from the intent slice and the diff, and every
label with one is a preserved hand judgement from the capped round re-attached to
the statement it belongs to.
