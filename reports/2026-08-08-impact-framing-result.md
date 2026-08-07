# Result: the impact-framing clause is REJECTED

Measured 2026-08-08 against `reports/2026-08-08-impact-framing-prereg.md`, committed
before the runs.

**Verdict: rejected. 16 gained, 16 lost — the cleanest possible coin flip.**

## Provenance

Control `0dcfeb8` vs treatment `a9d24b3`, **10 seeds per arm**, alternating order,
**5/5 position balance in each arm**, `dirty=0` on all twenty runs, 0 provider errors.
Corpus `security-advisory-2026`, 71 cases / 73 expectations. Model
`openai/gpt-5.3-codex`.

## The numbers

| | control | treatment | delta |
| --- | --- | --- | --- |
| recall | 63.8% (sd 3.66pp) | 62.5% (sd 3.66pp) | −1.3pp |
| adjusted precision | 97.7% (sd 3.10pp) | 97.0% (sd 3.19pp) | −0.7pp |
| raw precision | 74.5% | 75.9% | +1.4pp |
| **genuine false positives** | **11** | **14** | **+3** |
| discovery calls | 720 | 720 | **1.00x** |
| raw findings | 893 | 844 | −49 |
| spend | $14.69 | $14.57 | 0.99x |

Paired over all 73 expectations, ten seeds each: **16 gained, 16 lost, 41 unchanged,
one-sided exact sign test p = 0.5700.**

## Decision under the pre-registered rule

Three criteria, all required:

1. **one-sided p < 0.05** — **FAILS**, p = 0.5700.
2. **adjusted precision does not fall by more than the control's own spread** — passes
   (fell 0.7pp against a 3.10pp spread), but irrelevant given (1).
3. **genuine false positives do not rise above the control arm's count** — **FAILS**,
   11 → 14.

**Rejected and reverted.** The pre-registration allowed no off-by-default option: a
prompt clause is either how the engine asks for findings or it is not.

## What it did instead of what it was designed to do

The clause **traded**, exactly as three earlier prompt clauses did. Sixteen
expectations gained, sixteen lost — the same shape as the authorization-scope clause's
7/8 and the intent-framing clause's 7/7. Per depth it is scattered in both directions
(`local` +5.6pp, `implementation` −5.0pp, `callee` −6.2pp) with no pattern matching the
mechanism it was built on.

It also produced **fewer** raw findings (893 → 844) and **more** genuine false
positives. The most defensible reading is that requiring an attacker-path statement
made the reviewer slightly more conservative about what it wrote and slightly more
willing to assert impact where none holds — neither of which is what the diagnosis
predicted.

**This is not the "suspect win" the pre-registration guarded against.** That failure
mode required recall to RISE alongside false positives; recall fell. The guard was
right to exist and simply did not fire.

## Why this result matters more than the six before it

Every earlier null could be explained away as aiming at the wrong thing. This one
cannot:

- The diagnosis behind it was **measured, specific and correct**: 61 of 103 same-file
  misses put a finding inside the expected range, categorised `bug` 78 times against
  `security` 15.
- The clause attached to **exactly that act** — writing a finding — rather than to
  searching, which is what distinguished it from the four prior security interventions.
- It cost **nothing**: 1.00x calls, 0.99x spend.

And it moved nothing. **Knowing precisely where the failure is did not make it fixable
by instruction.** The reviewer is not omitting the security framing for want of being
asked for it.

That closes a family, not just a hypothesis: **prompt-level instruction is not the
lever for this failure.** Five prompt interventions have now been measured against
pre-registered rules — weakness-class, precision-boundary, intent-framing, the
correctness-fix confirmation, and impact-framing — and the paired splits are 7/8, 7/8,
7/7, 12/12 and 16/16. That is five coin flips in a row from five different angles.

## What remains open

The diagnosis stands and is unexplained: the reviewer reads the vulnerable line and
describes a neighbouring correctness property. What is now also known is that **telling
it not to does not work.**

Anything further has to change what the model *is*, not what it is asked — a different
model, a fine-tune, or a deterministic stage that decides reachability rather than
requesting it. None of those is a prompt, and none is cheap. **No further prompt-level
A/B on this corpus should be run without evidence that overturns the five-in-a-row
table above.**

## Committed and honoured

Ten seeds per arm, analysed once, no further seeds. The clause is deleted with its
branch.
