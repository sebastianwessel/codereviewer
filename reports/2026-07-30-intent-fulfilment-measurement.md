# Intent-fulfilment review (spec 23): first measurement

Date: 2026-07-30
Capability: `intent check`, implemented 2026-07-30 in commit `411c438`, off by
default, cannot gate.
Corpus: `.codereviewer/eval/intent-corpus/` — 21 cases over 9 commits of this
repository. Provider `openai` / `gpt-5.3-codex`.

---

## The decision rule, fixed before any result was read

Spec 23: *"ship only if the false-satisfied rate is low. A capability that misses
unaddressed obligations is merely incomplete; one that wrongly certifies them is
harmful, and no amount of recall compensates."*

The exact thresholds this measurement is judged by, written down before the
results below:

1. **False-satisfied rate ≤ 5%** of obligations reported `addressed`, measured
   **on the real arm and on the synthetic arm separately, never pooled.**
2. Because a rate of zero over a small denominator is not evidence of a small
   rate, the **95% upper confidence bound must also be ≤ 10%**. With zero
   observed events that is the rule of three: `3/n`, so it needs **n ≥ 30**
   reported-addressed obligations in the arm being judged.
3. **A rate is only meaningful if the capability was actually given the chance to
   be wrong.** The binding denominator is therefore not "obligations reported
   addressed" but **opportunities to false-satisfy: obligations that are
   genuinely NOT addressed.** An arm in which every obligation truly is addressed
   cannot fail this test and cannot pass it either. The same `n ≥ 30` /
   rule-of-three bound applies to that denominator.
4. Unaddressed detection and obligation extraction are reported but **do not
   gate**. A shortfall in either is a reason to improve the capability, never a
   reason to withhold it, and a strength in either never offsets (1)–(3).

Ship = "safe to show a human as advisory output". Spec 23 forbids gating on this
capability regardless of any number below.

---

## Results

Real and synthetic are reported separately throughout. **They are never pooled.**
A synthetic mismatch is easier than a real one and pooling would overstate the
capability.

### Real arm — 9 commits, 58 reported obligations

| metric | value |
| --- | --- |
| **1. Obligation extraction** — faithful obligations | **94.8%** (55/58) |
| — of which splits of one human obligation into two | 4 |
| — non-obligations extracted (see below) | 5.2% (3/58) |
| — human obligations the extractor covered | 98.1% (51/52), 1 missed |
| **2. Unaddressed detection** | **not measurable — denominator 0** |
| — obligations genuinely not addressed in this arm | **0** |
| **3. False-satisfied rate** | **0.0% (0/47)** |
| — obligations reported `addressed` | 47 |
| — of those, not actually addressed | **0** |
| — **opportunities to false-satisfy** | **0** |
| (context) reported `unaddressed` that were actually addressed | 10/10 |
| (context) reported `undetermined` | 0 |
| (context) recorded unclassifiable | 1 |

### Synthetic arm — 12 cases, 79 reported obligations

| metric | value |
| --- | --- |
| **1. Obligation extraction** — faithful obligations | **98.7%** (78/79) |
| — of which splits of one human obligation into two | 9 |
| — non-obligations extracted | 1.3% (1/79) |
| — human obligations the extractor covered | 97.3% (71/73), 2 missed |
| **2. Unaddressed detection** | **95.2% (20/21)** |
| — the one miss | reported `undetermined`, not `addressed` |
| **3. False-satisfied rate** | **0.0% (0/56)** |
| — obligations reported `addressed` | 56 |
| — of those, not actually addressed | **0** |
| — **opportunities to false-satisfy** | **21** |
| — **opportunities taken** | **0** |
| (context) reported `unaddressed` that were actually addressed | 1/21 |
| (context) recorded unclassifiable | 1 |

---

## Verdict against the pre-registered rule

### Real arm: **NO VERDICT. The metric could not be exercised.**

Every one of the 58 obligations extracted from nine real commit messages was, on
inspection of the diff, genuinely addressed by that commit. The false-satisfied
rate is 0/47 — and that number carries **almost no information**, because there
were **zero opportunities to false-satisfy**. Saying "addressed" was the correct
answer every time it was said. A capability that answered `addressed`
unconditionally would score identically on this arm.

Rule (3) is not met and cannot be met by adding more commits of this kind. This
is not a defect of the sample size; it is spec 23's own prediction: *"a pull
request whose description genuinely disagrees with its change is rare and is
almost never labelled as such."* Nine detailed, self-reviewed commits of a
project that writes its commit messages after the fact produced no genuine
mismatch at all.

**Unaddressed detection on real data is likewise unmeasured**, denominator 0.

### Synthetic arm: **passes rules (1) and (2), FAILS rule (3).**

- Rate 0.0%, ≤ 5% ✓
- n = 56 reported-addressed ≥ 30, so the 95% upper bound on the rate is
  3/56 = **5.4%** ✓
- Opportunities to false-satisfy: **21**, below the required 30. The 95% upper
  bound on the per-opportunity false-satisfied rate is 3/21 = **14.3%** ✗

So: in 21 chances to wrongly certify an obligation the change did not fulfil, it
took **none**. That is a genuinely good result and it is the strongest evidence
here. It is also not enough to bound the rate below 10%: a true
false-satisfied rate of 12% would produce 21 clean trials about 7% of the time.

### Overall: **NO SHIP VERDICT. The sample is too small to support one.**

Nothing in this measurement argues against the capability. Every directional
signal is favourable and several are strong. But the metric spec 23 says decides
the question was exercised 21 times, all synthetic, and zero times on real data.
That does not license "the false-satisfied rate is low"; it licenses "no
false-satisfied claim has been observed yet".

The capability stays **off by default**, as it already is.

---

## What is genuinely established

**The unevidenced-satisfaction guard held in every run.** `unevidencedAddressedCount`
was **0 across all 21 runs**: the model never once returned an `addressed` verdict
whose cited lines were not lines the change touched, so the downgrade path was
never needed. `uncitedObligationCount` was likewise 0 — every extracted obligation
resolved to a real line of the stated intent. The structural defences spec 23
requires are not merely present, they were never load-bearing, because the model
did not attempt what they exist to catch.

**Extraction is faithful and reads prose well.** 94.8% / 98.7% of extracted
obligations are real, checkable obligations traceable to the intent line cited.
It correctly ignored rationale ("This project has paid for that twice"),
measurement narrative ("Ten same-file multi-defect cases, three arms"), and
accepted-cost paragraphs. On `r9` it decomposed a 14-item revert description into
exactly the 14 obligations a human reads.

**Unaddressed detection worked on every synthetic mechanism.** 20 of 21 planted
gaps reported, including the harder mechanism where a real obligation's
implementation is removed from scope while its implemented siblings remain
(`s3` caught 4 of 4, `s1`/`s2`/`s7` caught their targets). The single miss was
reported `undetermined` rather than `addressed` — the safe direction.

---

## What this measurement does NOT establish

**1. That the false-satisfied rate is low on real changes.** Zero real
opportunities. This is the headline limitation and it is not fixable by running
more of this repository's commits.

**2. That the rate is low at all, in the statistical sense.** 21 clean
opportunities bound it below ~14%, not below 10%, and not below 5%.

**3. Anything about intent written *before* the change.** Every stated intent
here is a commit message written *after* the work, describing what was in fact
done. A pull-request description or ticket written beforehand — vaguer,
aspirational, partly superseded — is a different and probably harder input, and
none is in this corpus.

**4. Anything about a change whose prose overclaims relative to its code.** In 5
of the 103 reported-addressed obligations the only evidence was **text asserting
the work had been done** — a spec paragraph saying "the config block is removed"
(`r9`), a code comment saying "NOT re-exported here" (`r7`, `s7`, `s10`). Those
verdicts were all correct, because in this repository the prose was truthful. The
guard requires evidence to be a line the change *touched*; a line of a changed
document claiming a thing was done satisfies that. **A change that documents more
than it implements is the untested case, and it is precisely the shape that
produces a false satisfied.**

**5. Run-to-run stability.** One run per case. Extraction is visibly
non-deterministic: `4731580` yielded 5 obligations as `r4` and 4 as `s5`, and
`9b47b5a` yielded 7 as `r6` and 6 as `s8`, from near-identical intents. No case
was repeated, so no variance band exists for any figure above.

**6. Anything outside this repository, this language, or this model.** One
codebase, TypeScript throughout, one provider.

---

## The important negative result: deletions are invisible

`r9-52ff75d` is a revert — 38 insertions against 910 deletions. Of its 14
obligations, 13 are classifiable and **all 13 were carried out by the commit**.
The tool reported **9 of them `unaddressed`**.

| obligation | truth | reported |
| --- | --- | --- |
| remove the guarded-region trigger and its tests | done | unaddressed |
| remove the context collector and its tests | done | unaddressed |
| remove the packet section and its tests | done | unaddressed |
| remove the `reviewedDiffRanges` threading | done | unaddressed |
| remove `isConditionalLine` | done | unaddressed |
| remove `callNamesIn` | done | unaddressed |
| a config still setting the block fails validation with exit 2 | done | unaddressed |
| mark spec 25 Withdrawn with the result table | done | unaddressed |

The mechanism is structural, not a model failure. Spec 23 requires an addressed
obligation to cite "the change that addresses it — **path and line**", and
`verifyJudgement` enforces that the cited lines are lines the change touched. A
deletion leaves **no head-side line to cite**. An obligation to remove something
is therefore unevidenceable by construction, and the only verdict the guard
permits is `unaddressed`.

Two of the nine are not even structural: `Status: **Withdrawn 2026-07-30**` is an
*added* line in `specs/25-guarded-region-context.md` and was available to cite;
the model missed it.

Related: `s7` reported "move the shared primitives into a leaf domain"
`unaddressed` while listing the new `declaration-shape.ts` (38 changed lines) as
*extra scope* on the same page — the evidence was in front of it, in the report.

This errs in the direction spec 23 calls the cheaper one, so it is not a safety
problem. It is a **usability** problem, and a large one: on a revert this
capability tells a reviewer that most of the work was not done. Worth a decision
before anyone sees this output; it is recorded here rather than patched.

## Second finding: non-scope disclaimers become obligations

`r4-4731580`'s message ends with two explicit non-scope paragraphs — *"The field
name is left alone deliberately"* and *"Not changed, and deliberately: the
matcher's zero line tolerance and the plausibility judge's restatement question"*.
The extractor turned all three statements into obligations, then answered them
**inconsistently**: the first `addressed`, the other two `unaddressed`. A reader
sees two red rows asserting the change failed to do things the author explicitly
said were out of scope.

This is 3 of the real arm's 58 obligations and the source of 2 of its 10 false
`unaddressed` verdicts.

## Third finding, the closest call in the corpus

`s10` planted *"The moved modules also gain a deprecation re-export shim in
review-workflow for one release, **so downstream callers are not broken by the
move**."* The extractor split the sentence: the shim (`unaddressed`, correct) and
its purpose clause — *"Ensure downstream callers are not broken by the module
move"* — reported **`addressed`**, cited to the consumer imports the commit
re-pointed.

Both readings are defensible (every in-repo caller was updated; but the barrel
stopped re-exporting and there is no shim), so it is recorded **unclassifiable**
and excluded from every rate above rather than scored either way. It is worth
stating plainly: the one time an unimplemented obligation came close to being
certified, the route was **splitting an obligation from its purpose clause and
crediting the purpose clause**.

---

## Spend

**$0.7663** total, 21 runs, against a $3.00 ceiling. Per run $0.0157–$0.0623;
the driver is obligation count, since judgement is one call per obligation over
the changed-line surface.

## What invalidates this entry

- Any repetition of a case that changes its obligation set — one run per case,
  no variance band.
- Real-arm figures are conditional on "stated intent = a commit message written
  after the work". They say nothing about pre-written tickets.
- The false-satisfied rate is bounded only to ~14% by 21 synthetic opportunities.
  Anyone quoting "0%" without the denominator is quoting nothing.
- Nine commits of one TypeScript repository, one provider, one day.

## Reproducing

```
.codereviewer/eval/intent-corpus/run-case.sh <case-id> <sha>   # one run
node .codereviewer/eval/intent-corpus/score.mjs                # the three metrics
```

Ground truth is hand-written in `.codereviewer/eval/intent-corpus/ground-truth.mjs`
and is not derived from any engine output.
