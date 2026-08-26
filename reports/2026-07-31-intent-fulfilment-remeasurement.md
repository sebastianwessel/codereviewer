# Intent-fulfilment review (spec 23): re-measurement after the removed-line amendment

Date: 2026-07-31
Capability: `intent check`, off by default, cannot gate.
Corpus: `.codereviewer/eval/intent-corpus/` — **34 cases** (12 real, 22 synthetic)
over 12 commits of this repository, extended today with deletion-heavy cases
carrying behavioural obligations. Provider `openai` / `gpt-5.3-codex`.
Spend: **$2.3277** of a $4.00 ceiling.

Trigger: spec 23 was amended in commit `52c2763` so an obligation judged
`addressed` may cite a line the change **REMOVED**, numbered on the pre-change
side. That closed a systematic false-*unaddressed* on deletions and invalidated
the false-satisfied figure in
`reports/2026-07-30-intent-fulfilment-measurement.md`, which was taken before the
change. The ledger recorded a suspicion that the amendment also opened a new route
to a false-*satisfied*. **It did. This measurement found it.**

---

## The decision rule, fixed before any result of this round was read

Everything in this section was written before the first re-run was started. It
carries forward the previous round's rule unchanged and adds two clauses for the
route this round exists to test.

1. **False-satisfied rate ≤ 5%** of obligations reported `addressed`, measured
   **on the real arm and on the synthetic arm separately, never pooled.**
2. Because a rate of zero over a small denominator is not evidence of a small
   rate, the **95% upper confidence bound must also be ≤ 10%**. With zero
   observed events that is the rule of three, `3/n`, so it needs **n ≥ 30**
   reported-addressed obligations in the arm being judged.
3. **The binding denominator is opportunities to false-satisfy** — obligations
   that are genuinely NOT addressed — not obligations reported addressed. An arm
   in which every obligation truly is addressed can neither fail nor pass. The
   same `n ≥ 30` / rule-of-three bound applies to that denominator.
4. **NEW — the deletion-citation sub-arm.** The specific question this round asks
   is narrower than the arm-level rate: *can the tool be made to say "done" for a
   behavioural obligation the change did not satisfy, by citing deleted lines?*
   That question has its own denominator: **opportunities to false-satisfy that
   are (a) behavioural — a requirement about how the system must behave, not
   about a file or symbol existing — and (b) sited in a deletion-heavy change,
   where removed lines are abundant and cheap to cite.** Call these **DHB
   opportunities**. To conclude "the deletion-citation route does not produce
   false-satisfied claims" requires **≥ 30 DHB opportunities taken zero times**.
   Below 30, the raw count is reported and **no verdict is issued on the route** —
   only "no instance observed in n tries", with n stated.
5. **NEW — citation aptness is a separate axis and does not gate.** For every
   `addressed` verdict, the cited lines are read against the diff and classed:
   - **apt** — the cited lines genuinely evidence the obligation;
   - **inapt** — the verdict is correct but the cited lines merely happen to be
     lines the change touched, and a reader checking them would not be shown the
     thing the obligation asks about;
   - **false-satisfied** — the verdict itself is wrong.
   An inapt citation is **not** counted as a false-satisfied; it is counted and
   reported on its own line. Pre-registered interpretation: an inapt rate above
   **20% of addressed verdicts** in the deletion-heavy behavioural sub-arm is
   recorded as a named risk against the amendment, but it does not by itself
   withhold the capability, because spec 23's ship rule is about the verdict.
6. **Unaddressed detection and obligation extraction are reported but do not
   gate.** A shortfall in either is a reason to improve the capability, never a
   reason to withhold it, and a strength in either never offsets (1)–(4).
7. **Ground truth is established by reading the intent and the diff by hand.**
   Nothing is taken from the engine's output except obligation ids, which are
   labels. Obligations whose truth is genuinely ambiguous are recorded
   `unclassifiable` and excluded from every rate rather than resolved in a
   convenient direction.

Ship = "safe to show a human as advisory output". Spec 23 forbids gating on this
capability regardless of any number below.

---

## What was measured

All 21 existing cases were **re-run against the amended build and re-scored**.
Extraction is non-deterministic, so most obligation sets differ from 2026-07-30
and ground truth was re-derived by hand rather than carried over. The previous
reports are preserved under `.codereviewer/eval/intent-corpus/runs-2026-07-30/`.

Thirteen new cases were added, all on **deletion-heavy commits** of this
repository, all carrying **behavioural obligations**:

| host commit | ins/del | cases added |
| --- | --- | --- |
| `52ff75d` revert of spec 25 | 38 / 910 | `s17`, `s24`, `s32` (planted), `s25` (scope-dropped) |
| `ee0589e` remove spec 25 Arm B | 152 / 241 | `r13` (real), `s21`, `s33` (planted), `s28` (scope-dropped) |
| `2882f4c` withdraw both extra passes | 44 / 557 | `r11` (real), `s20` (planted), `s30` (scope-dropped) |
| `a6e6c5c` remove the discovery posture | 217 / 556 | `r10` (real), `s18` (planted) |

Three larger deletion-heavy commits (`a75e429`, `4656955`, `fd31dc9`, each with
1000+ deletions and the same exit-code-2 sentence) were **dropped for budget**: at
~1300 citable lines they cost roughly $0.90 per run, and spending the ceiling on
three of them would have bought fewer opportunities than spending it on eight
smaller ones. That is a deliberate, recorded trade, not an oversight.

Synthetic mechanisms, both marked per spec 23 and recorded per case in
`ground-truth.mjs` under `alteration`:

- **A — the implementation is dropped from scope.** `paths.exclude` removes every
  carrier of a chosen behavioural obligation: the strict schema whose key went
  away, its generated JSON, **and every changed document that restates the
  behaviour in prose**. The prose exclusions matter — the previous measurement
  found five verdicts whose only evidence was a changed document asserting the
  work was done, so leaving one in scope would have made the obligation genuinely
  addressed and destroyed the opportunity.
- **B — a behavioural obligation the change does not satisfy is added to the
  intent**, immediately before the `Co-Authored-By` trailer so every earlier line
  number is unchanged and the real obligations keep their real ground truth. Every
  plant was checked against the tree at that commit first: none of the CLI flags,
  environment overrides, report-migration paths, migration commands or CI guards
  they describe exists anywhere in it.

Two truth rules were written down before scoring, because both are judgement calls
that could otherwise drift:

1. Mechanism A is judged against the **visible** change — the diff the tool was
   given. An obligation whose every carrier was excluded is `unaddressed`.
2. **Exception for a purely negative obligation** ("provide no compatibility
   shim", "do not rename the field"). Narrowing scope cannot make a shim appear,
   so a negative obligation is judged against the fact of the whole change. Without
   this rule mechanism A would manufacture false-satisfied verdicts out of a
   harness artefact.

---

## Results

Real and synthetic are reported separately throughout. **They are never pooled.**

### Real arm — 12 commits, 76 reported obligations

| metric | value |
| --- | --- |
| **1. Obligation extraction** — faithful obligations | **96.1%** (73/76) |
| — of which splits of one human obligation | 10 |
| — non-obligations extracted | 3.9% (3/76) |
| — human obligations the extractor covered | **92.6%** (63/68), 5 missed |
| **2. Unaddressed detection** | **not measurable — denominator 0** |
| — obligations genuinely not addressed in this arm | **0** |
| **3. False-satisfied rate** | **0.0% (0/73)** |
| — **opportunities to false-satisfy** | **0** |
| **4. Citation aptness** — verdict correct, evidence inapt | **4.1% (3/73)** |
| (context) reported `unaddressed` that were actually addressed | 2/2 |
| (context) reported `undetermined` | 0 |
| (context) recorded unclassifiable | 1 |

### Synthetic arm — 22 marked cases, 225 reported obligations

| metric | value |
| --- | --- |
| **1. Obligation extraction** — faithful obligations | **98.7%** (222/225) |
| — of which splits of one human obligation | 51 |
| — non-obligations extracted | 1.3% (3/225) |
| — human obligations the extractor covered | **93.8%** (180/192), 12 missed |
| **2. Unaddressed detection** | **90.0% (72/80)** |
| — missed as `undetermined` rather than `addressed` (safe direction) | 4 |
| **3. False-satisfied rate** | **2.8% (4/142)** reported-addressed |
| — **opportunities to false-satisfy** | **80** |
| — **opportunities TAKEN** | **4 → 5.0% per opportunity** |
| — one-sided 95% upper bound, per reported-addressed | 6.3% |
| — one-sided 95% upper bound, per opportunity | **11.1%** |
| **4. Citation aptness** — verdict correct, evidence inapt | **8.0% (11/138)** |
| (context) reported `unaddressed` that were actually addressed | 3/75 |
| (context) reported `undetermined` | 4 |
| (context) recorded unclassifiable | 4 |

### The deletion-heavy behavioural sub-arm — the route the amendment opened

| | |
| --- | --- |
| DHB opportunities to false-satisfy | **52** |
| **TAKEN** | **3** |
| correctly reported `unaddressed` | 46 |
| reported `undetermined` (safe miss) | 3 |
| point estimate | **5.8%** |
| one-sided 95% upper bound | 14.2% |
| **aptness on the same shape** (correct behavioural verdicts in deletion-heavy changes) | **33.3% inapt (4/12)** |

The 52 opportunities are not 52 independent trials: the extractor splits a planted
sentence into two or three obligations, so roughly 31 planted statements produced
them. Read the count as "52 rows a reviewer would see", not as 52 draws.

---

## The answer to the question this measurement was built to ask

**YES. The tool can be made to say "done" for a behavioural obligation the change
did not satisfy, and in one of the three cases the only evidence was two deleted
lines.**

### `s17-52ff75d-behaviour` / `obl_13` — the deleted-line route, unambiguously

Planted obligation, extracted verbatim as:

> *"Make runs that request the withdrawn guarded-region context kind by name fail
> intake with exit code 2 instead of assembling an empty section."*

Reported **`addressed`**. Two citations, **both removed lines**:

```
<removed> src/domains/review-workflow/pipeline/agent-contracts.ts:49  'guarded-region'
<removed> src/domains/review-workflow/run/context/context.ts:316      inputContext.kind === 'guarded-region'
```

The commit adds no intake check and no exit path. `kind` is an internal
agent-contract enum; there is no configuration key, CLI flag or any other way for
a run to "request a context kind by name" — verified in the tree at `52ff75d^`.
The obligation is unsatisfiable by this change and was certified anyway, on two
deletions that merely mention the same words.

This is the failure mode spec 23 calls the costly one, produced by exactly the
mechanism the ledger predicted: *"removed lines are abundant in a deletion-heavy
change, so a citation is now easy to satisfy."*

### `s33-ee0589e-behaviour2` / `obl_14` — topically adjacent prose

> *"Cause builds carrying the stale removed context kind to fail loudly."*

Reported **`addressed`**, cited to the **added** docs lines *"Because the schema is
strict, a config that still sets it — even to `false` — fails validation with exit
code 2"* plus the added `"signal"` schema keys. A strict **config** schema says
nothing about a **build** carrying a stale context kind. Not a deleted-line
citation, but the same substitution: an adjacent behavioural guarantee is accepted
in place of the one asked about.

### `s32-52ff75d-behaviour3` / `obl_20` — and one the amendment did NOT cause

> *"Make the declaration-analysis barrel refuse a stage-3 consumer at runtime."*

Reported **`addressed`** on a single **added** line of `import-boundary.test.ts` —
a test, which is precisely what the plant excluded ("not only in the boundary
test"; the extractor dropped that clause). This one would have happened before the
amendment too, and is separated from the deleted-line route for that reason.

### `s28-ee0589e-drop-config-validation` / `obl_7` — the fourth, non-behavioural

> *"Update the docs to record that retaining Arm A departs from the pre-registered
> rule."*

The docs page is excluded from scope in this case; the citation is the **spec**
file — the same two lines `obl_6` already cited for the spec half of the sentence.
A split obligation answered twice from one address.

### The near miss, recorded unclassifiable rather than scored

`s24-52ff75d-behaviour2` / `obl_20`: the plant was *"a smoke run over a fixture
that used to trigger the region produces a packet with no guarded-region section
and exits 0"*. The extractor split the smoke run (`obl_19`, correctly
`unaddressed`) from its expected outcome, and the outcome **read alone** is true of
the change — packets no longer carry the section. Reported `addressed` on 33
removed lines of `review-packet.ts`. Both readings are defensible, so it is
excluded from every rate. It is the same splitting route as the false-satisfied
above, and it is the third round in a row that this route has produced the closest
call in the corpus.

---

## Verdict against the pre-registered rule

| rule | arm | result |
| --- | --- | --- |
| 1. false-satisfied ≤ 5% of reported-addressed | real 0.0%, synthetic 2.8% | **pass** |
| 2. 95% upper bound ≤ 10%, n ≥ 30 reported-addressed | real n=73 → 4.0%; synthetic n=142 → 6.3% | **pass** |
| 3. same bound on **opportunities**, n ≥ 30 | real n=**0**; synthetic n=80, 4 taken → 5.0%, bound **11.1%** | **real: cannot be judged. synthetic: FAIL** |
| 4. DHB route: ≥30 opportunities taken **zero** times | 52 opportunities, **3 taken** | **FAIL — the route is demonstrated, not merely unexcluded** |
| 5. aptness > 20% inapt on the DHB shape → named risk | **33.3% (4/12)** | **risk recorded** |
| 6. extraction / detection reported, do not gate | 96.1% / 98.7% faithful; 90.0% detection | reported |

### Real arm: still **NO VERDICT**, for the same reason as last time

All 76 obligations extracted from twelve real commit messages were, on inspection,
genuinely addressed. Zero opportunities to false-satisfy. `addressed` was the
correct answer every time it was given, and a capability that answered `addressed`
unconditionally would score identically. Adding three more commits of this
repository did not change that and adding thirty more would not either — spec 23
predicted it: *"a pull request whose description genuinely disagrees with its
change is rare and is almost never labelled as such."*

### Synthetic arm: **FAILS rule 3, and rule 4 is decisively answered against the amendment**

The previous round declined a verdict because 21 clean opportunities could not
bound the rate. This round has 80 opportunities — enough — and the rate is not
zero. **4 of 80 opportunities were taken.** The pre-registered bound of 10% is
missed at 11.1%, and the point estimate of 5.0% exceeds the 5% threshold of rule 1
when measured on the denominator rule 3 says is binding.

More important than the marginal statistics: rule 4 asked a yes/no question with a
pre-registered evidentiary bar, and the answer is **yes, the route exists**. Three
behavioural obligations in deletion-heavy changes were wrongly certified, one of
them on nothing but deleted lines.

### Overall: **NO SHIP, and this time on evidence rather than on absence of it.**

The capability stays off by default. The difference from 2026-07-30 matters: that
report said *"no false-satisfied claim has been observed yet"*. This one says a
false-satisfied claim has now been observed, four times, and names the shape that
produces it.

---

## Before / after against the previous measurement

Only the 21 shared cases are comparable; the arms are otherwise different sizes.

| | 2026-07-30 | 2026-07-31 |
| --- | --- | --- |
| cases | 21 (9 real, 12 synthetic) | 34 (12 real, 22 synthetic) |
| real extraction faithful | 94.8% | 96.1% |
| synthetic extraction faithful | 98.7% | 98.7% |
| synthetic unaddressed detection | 95.2% (20/21) | 90.0% (72/80) |
| opportunities to false-satisfy (synthetic) | 21 | **80** |
| opportunities taken | **0** | **4** |
| citation aptness | not measured | 4.1% real / 8.0% synthetic inapt |
| spend | $0.7663 | $2.3277 |

### What the amendment demonstrably fixed

| case | before | after |
| --- | --- | --- |
| `r9-52ff75d` (910 deletions) | 5 addressed / **9 unaddressed**, all nine wrong | **14 addressed / 0 unaddressed**, all correct |
| `r7-e13a121` obl_2 "stop re-exporting" | evidenced only by a new code *comment* saying so | cites the 29 removed export lines themselves |
| `s7` obl_1 "move the primitives" | false `unaddressed` while the report listed the new file as extra scope | correctly `addressed` on the re-pointed imports |
| `s10` obl_6 (the previous round's near-miss) | `addressed` on a purpose clause — unclassifiable | correctly `unaddressed` |
| `r1` obl_7 "remove `--resume`" | addressed on the replacement line only | cites the removed invocation beside it |

The deletion blind spot is genuinely closed. Nine systematically wrong verdicts on
one revert became fourteen right ones.

### What it cost

The same amendment produced the three DHB false-satisfied verdicts above and a
**33.3% inapt-citation rate on behavioural obligations in deletion-heavy changes**
— the shape it made citable. The trade is real in both directions and neither half
should be quoted without the other.

### Aptness is not stable run to run

The same obligation, on the same commit, with the same build, was cited three
different ways across three cases:

| case | obligation | citation | aptness |
| --- | --- | --- | --- |
| `r9` obl_10 | *configs still setting the block fail validation with exit code 2* | removed schema keys | **inapt** |
| `s17` obl_9 | same sentence | removed schema keys | **inapt** |
| `s24` obl_9 | same sentence | leads with docs `review.md:55` *"now fails validation with **exit code 2**"* | **apt** |
| `s32` obl_9 | same sentence | removed schema keys | **inapt** |

The apt citation was in scope every time and was used once in four. Same again on
`ee0589e`: `r13`/`obl_3` and `s33`/`obl_3` cited the docs sentence (apt) while
`s21`/`obl_3` cited the required-key list (inapt). Aptness on this obligation shape
is a coin flip, not a property of the build.

### A second, unrelated finding: extraction can collapse

`r10-a6e6c5c` extracted **three** obligations from a message stating five, all
three from its last paragraph, and `s18` on the same commit extracted **one** real
obligation of five. The three real deletion-heavy commits added this round pushed
real-arm coverage from 98.1% to 92.6%. Whatever causes it, a message whose first
two thirds is measurement narrative appears to lose its obligations to that
narrative.

### Unchanged findings, reproduced

- **Non-scope disclaimers still become obligations.** `r4-4731580`'s two explicit
  *"Not changed, and deliberately"* paragraphs became obligations again and were
  again answered `unaddressed`, so a reader again sees two red rows asserting the
  change failed to do things the author said were out of scope. Both of the real
  arm's two false `unaddressed` verdicts are this.
- **The structural guards never fired and were never needed.**
  `unevidencedAddressedCount` and `uncitedObligationCount` were **0 across all 34
  runs**, and no run was truncated by `maxChangeLines`. Every citation in every
  false-satisfied above was a real line the change really touched. **The guard
  cannot catch this failure mode, because the failure is a real address attached to
  the wrong claim.**

---

## What this measurement does NOT establish

1. **That the false-satisfied rate on REAL changes is low, high, or anything.**
   Zero real opportunities, again. Every real-arm figure here is conditional on
   "stated intent = a commit message written after the work, describing what was
   in fact done".

2. **That the rate is 5.0%.** 4 of 80, bounded above at 11.1%, on synthetic
   mismatches in one repository. The true rate could be 2% or 11%.

3. **That the three DHB false-satisfied verdicts are representative in
   frequency.** They came from 52 opportunities that were *engineered to be
   tempting*: behavioural obligations dropped into changes that delete hundreds of
   lines on the same subject. That is the right way to look for a failure mode and
   the wrong way to estimate how often it occurs in the wild.

4. **That the plants are all equally fair.** Two were not, and both are recorded
   `unclassifiable` rather than scored: `s21`/`obl_8` (the removed **config key**
   is literally named `calleeRanking`, so "a run naming the removed callee-ranking
   context kind fails with exit code 2" has a defensible true reading) and
   `s21`/`obl_10` ("keep Arm B reports readable" is satisfied by not breaking
   them). Writing a behavioural obligation that is genuinely unsatisfied *and*
   sits next to a real satisfied behavioural claim is harder than it looks, and two
   of thirty-one attempts failed at it.

5. **Run-to-run stability of any figure.** One run per case, and extraction is
   visibly non-deterministic. Five cases share `52ff75d`'s commit message verbatim
   for its unplanted portion, and the number of REAL obligations extracted from it
   was **14, 12, 13, 13 and 15** (`r9`, `s17`, `s24`, `s32`, `s25`). No variance
   band exists for anything above. The aptness table in the previous section is the
   clearest demonstration and it is not a band — it is one anecdote observed four
   times.

6. **Anything about the three large deletion-heavy commits that were dropped for
   budget** (`a75e429`, `4656955`, `fd31dc9`), or about any change whose citable
   surface exceeds `maxChangeLines`. Every case here fit inside its bound uncut.

7. **Anything outside this repository, this language, or this model.** One
   codebase, TypeScript throughout, one provider, one day.

---

## What invalidates this entry

- Any repetition of a case that changes its obligation set — one run per case, no
  variance band, and extraction demonstrably varies.
- The four false-satisfied verdicts are four events. A rerun could produce two or
  six; the *existence* of the route is what is established, not its rate.
- Real-arm figures say nothing about pre-written tickets or PR descriptions.
- The DHB denominator counts extracted rows, not independent planted statements
  (52 rows from about 31 statements).
- Twelve commits of one TypeScript repository, one provider.

---

## Spend

**$2.3277** total over 34 runs, against a $4.00 ceiling. $1.0027 for the 21
re-runs, $1.3250 for the 13 new cases. Per run $0.0178–$0.1431; the driver is
(obligation count × citable surface lines), since judgement is one call per
obligation over the whole change surface.

## Reproducing

```
.codereviewer/eval/intent-corpus/run-case.sh <case-id> <sha>       # one run
.codereviewer/eval/intent-corpus/rerun-all.sh caselist.txt         # all 34
node .codereviewer/eval/intent-corpus/score.mjs                    # the four axes
node .codereviewer/eval/intent-corpus/show.mjs <case-id>           # one case, readable
node .codereviewer/eval/intent-corpus/build-manifest.mjs           # refresh the derived JSON
```

Ground truth is hand-written in `.codereviewer/eval/intent-corpus/ground-truth.mjs`
and is not derived from any engine output. The 2026-07-30 reports are preserved
under `runs-2026-07-30/` for the before/after comparison above.
