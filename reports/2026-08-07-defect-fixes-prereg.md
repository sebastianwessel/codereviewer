# Pre-registration: do the correctness fixes move recall?

**Written before the run.** Fourth and final measurement of the day.

## Why this is not a fourth guess

The three interventions measured today were hypotheses about prompt wording, and all
three were rejected. This is a different question with a different subject: three
**defects** were found and fixed, each shipped on a failing-first test rather than on
an expected effect. The question here is whether fixing them changed what the
reviewer finds.

That question has to be asked. This project's own rule is that the engine is
re-baselined after it changes; the fixes are in the engine; a figure measured before
them describes a different engine.

## Arms

- **Control** `f2a6ee8` — after the corpus reached 51 cases, before the defect fixes.
- **Treatment** `0504e49` — the three fixes and nothing else. No prompt text differs
  between the arms; that was a constraint on the work, and it is what makes this
  comparison interpretable.

**Six seeds per arm**, `ab-run.sh`, alternating order — three runs in each position
per arm, exactly balanced. This is the first measurement to use the seed count the
variance analysis said was necessary rather than the three that were affordable.

## What each fix could plausibly do here, stated before the result

Honesty about the expected size matters more than usual, because a null is the likely
outcome and I do not want to explain that away afterwards:

- **D1** (C-quoted filenames dropped from the diff section) — probably **zero** effect
  on this corpus. It needs a changed file whose name git C-quotes; a quick check of
  the 51 cases suggests none qualify.
- **D2** (config `paths` not binding on the retriever) — probably **zero**. The eval
  configures no narrowed `include`, so the gate it restores was not being exercised.
- **D3** (ranged `repo_read` numbered from 1) — **the only one likely to bite.** Any
  case where the reviewer used a ranged read got line numbers contradicting the
  summary above them, and the read's evidence pointed at content it never returned.

So the honest prior is a **small positive or nothing**, driven by D3 alone. A large
movement would be more surprising than a null and would need explaining, not
celebrating.

## Decision rule

This is a re-baseline, not a promotion gate — the fixes are already shipped on
correctness and are **not** reverted if recall does not move. What the rule governs
is what may be *said*:

- **"The fixes improved recall"** may be claimed only if the paired per-expectation
  test over six seeds reaches **p < 0.05** in favour of the treatment. Nothing weaker
  is a claim.
- **"No detectable change"** is the outcome for anything else, and it is stated as
  *undetectable at this power*, never as *no effect* — the same distinction applied to
  today's three nulls.
- **If recall falls** by more than the control arm's own spread, that is a regression
  the fixes caused and it must be investigated before the day's work is called done.

No precision delta between arms will be cited: one balanced A/B does not clear a
metric that was confounded in two.

## Also recorded in advance

Six seeds per arm halves the standard error of each arm's mean relative to three, and
gives each expectation a 0–6 count instead of 0–3, which is what separates a real
per-expectation shift from seed noise. It does not make a 2-point effect visible. If
the result is null, the correct conclusion remains the one already reached: this
corpus cannot measure improvements of the size prompt-level and defect-level changes
actually produce.
