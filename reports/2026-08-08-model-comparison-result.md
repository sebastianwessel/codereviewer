# Result: `gpt-5-mini` matches on recall at half the cost, and is markedly less precise

Measured 2026-08-08 against `reports/2026-08-08-model-comparison-prereg.md`, committed
before the runs.

**Verdict: not recommended as the default. Recall is indistinguishable; precision is
clearly worse; cost is half.** The first non-null result of this investigation, and it
is a trade rather than an improvement.

## Provenance — and why this comparison is interpretable at all

Engine `10f08d4`, **3 seeds per arm**, alternating arm order, `dirty=0` on all six runs,
one dependency digest, **0 provider errors**. Corpus `security-advisory-2026`, 72 cases
/ 74 expectations.

**The judge was pinned to `gpt-5.3-codex` in BOTH arms**, verified in every report's
`provenance.judgeModelName`. Before today the judges resolved from the reviewer's own
model alias, so this comparison would have moved the scorer with the subject and could
not have been read at all.

| | control | treatment |
| --- | --- | --- |
| reviewer model | `gpt-5.3-codex` | `gpt-5-mini` |
| judge model | `gpt-5.3-codex` | `gpt-5.3-codex` |

## The numbers

| | control | treatment | delta |
| --- | --- | --- | --- |
| recall | 63.1% (sd 3.40pp) | 65.8% (sd 0.78pp) | +2.7pp |
| **adjusted precision** | **97.9%** (sd 2.04pp) | **91.9%** (sd 2.60pp) | **−6.0pp** |
| raw precision | 73.7% | **45.7%** | −28.0pp |
| **genuine false positives** | **3** | **13** | **4.3x** |
| raw findings | 260 | **506** | +95% |
| discovery calls | 219 | 219 | 1.00x |
| **spend** | **$2.38/run** | **$1.16/run** | **0.49x** |

Paired over all 74 expectations: **20 gained, 18 lost, 36 unchanged, two-sided exact
sign test p = 0.8714.**

## Decision under the pre-registered rule

1. **paired two-sided p < 0.05 in favour of the treatment** — **FAILS**, p = 0.8714.
2. adjusted precision must not fall by more than the control's own spread — **FAILS**,
   it fell **6.0pp** against a control spread of **2.04pp**.
3. measured cost within 1.5x of control — passes comfortably at **0.49x**.

**Not recommended as the default.** Two of three criteria fail, and the one that passes
is the one nobody was worried about.

## What is actually true here

**Recall is unresolved, not equal.** 20 gained against 18 lost is as close to a coin
flip as this corpus produces, and at 3 seeds the band is roughly 11pp — a real
difference smaller than that would be invisible. "`gpt-5-mini` matches `gpt-5.3-codex`
on recall" is a defensible reading; "`gpt-5-mini` is as good" is not, because recall is
not the only thing that matters and the other things moved.

**Precision is where the models genuinely differ, and it is not subtle.** `gpt-5-mini`
produced **95% more raw findings** and **4.3x the genuine false positives**, and raw
precision nearly halved. The refutation and admission stages absorbed much of that —
adjusted precision fell only 6.0pp against raw precision's 28.0pp — which is the gate
doing its job, but it did not absorb all of it.

**Cost halved, and only the pinned judge makes that number honest.** At 0.49x, a
`gpt-5-mini` reviewer is genuinely cheap. Note the direction is the opposite of the
single-seed probe, which showed $1.65 against $1.47: that probe ran against a cold cache
and one seed prices nothing. The 0.49x here is measured over three seeds per arm.

## The operating point this establishes

For a user who wants **cheap, high-recall, noisy** review — triage, a first pass, a
pre-commit sweep where a human filters — `gpt-5-mini` is a real option: same recall,
half the cost, four times the false alarms. For the shipped default, where this project
has spent a year defending precision, it is the wrong trade.

That is worth documenting as a **supported configuration**, not as a default change.

## What it says about the accuracy question

The corpus's 63–66% recall is **not** a property of the top-tier model. A model roughly
an order of magnitude cheaper reaches the same recall on the same corpus with the same
prompts and the same judge. Combined with the two closed families —
attention (four mechanisms) and prompt instruction (five clauses) — the picture is
consistent: **recall here is bounded by something neither model tier, nor attention, nor
wording moves.**

That is a stronger statement than any of the individual nulls, and it is the first time
model tier has been ruled out with the scorer held fixed.

## Caveats stated plainly

- **3 seeds, 74 expectations.** Recall differences below ~11pp are invisible.
- `gpt-5.1-codex-max` was the original candidate and is **unusable** on this key — listed
  by `/v1/models`, 404 on the chat-completions path. The stronger-tier question is
  therefore still unanswered; this study answers the cheaper-tier question.
- Position balance at 3 seeds is 2/1 rather than 5/5. Each arm occupied each position at
  least once, which is what alternation buys at odd seed counts, but it is weaker than
  the 10-seed studies.
- Total spend: **$10.62** including the failed `gpt-5.1-codex-max` probe at $0.00.
