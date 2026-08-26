# Pre-registration: confirmation study for the correctness fixes

**Written before this study's runs.** This is a **new experiment**, not a
continuation of the one in `2026-08-07-defect-fixes-result.md`.

## Why this is a confirmation and not optional stopping

The distinction is the whole justification for spending again, so it is stated
plainly.

**Optional stopping** would be: keep adding seeds to the existing twelve runs until
the p-value drops below 0.05. That is invalid, because the stopping decision depends
on the result, and it inflates the false-positive rate arbitrarily. I refused it and
still refuse it.

**A confirmation study** is: the prior experiment was *exploratory* — it produced a
direction and an effect size. Those are now the hypothesis, fixed in advance, and a
fresh sample tests them. The prior data is not reused, not pooled, and not
reanalysed. This study stands or falls on its own runs.

That distinction is what makes the prior study's p = 0.1153 irrelevant here: it is
the reason for asking the question, not evidence toward the answer.

## The hypothesis, specified in advance

From the exploratory study, stated before any run of this one:

- **Direction:** treatment (with the three correctness fixes) exceeds control.
- **Expected magnitude:** roughly +5 percentage points of recall, and a paired split
  around 14 gained to 6 lost.
- **Mechanism:** D3 — the ranged `repo_read` that numbered from 1 while its own
  summary said otherwise. D1 (C-quoted filenames) and D2 (config `paths` binding) were
  predicted in advance to contribute nothing on this corpus, and nothing observed has
  changed that.

Because the direction is now predicted rather than discovered, the test is
**one-sided**. That is legitimate here precisely and only because the prediction is
recorded before the data exist.

## Design

- Arms: control `f2a6ee8`, treatment `0504e49`. Identical to the exploratory study;
  no prompt text differs between them.
- **Ten seeds per arm**, `ab-run.sh`, alternating order — five runs in each position
  per arm.
- Ten rather than six because the exploratory effect sat right at the edge: 14–6 over
  twenty discordant pairs is one-sided p ≈ 0.058. A confirmation powered no better
  than the study it confirms answers nothing, and repeating six seeds would most
  likely reproduce the same ambiguity and tempt the same bad fix.
- Analysed **alone**. The twelve exploratory runs are not pooled in.

## Decision rule

**"The correctness fixes improve recall" may be claimed** if and only if the paired
per-expectation exact sign test over this study's ten seeds is **one-sided p < 0.05
in favour of the treatment**.

**"Not confirmed"** otherwise — and stated as *the effect was not reproduced at
adequate power*, which is a materially stronger negative than the exploratory study's
"undetectable", because this design is powered for the effect it is looking for.

**A reversal** — treatment below control — is reported as such and would retire the
hypothesis rather than leave it open.

The fixes stay either way. They shipped on correctness with failing-first tests and
their retention has never been contingent on a recall measurement.

## Committed in advance

No further seeds will be run on this question after these twenty, whatever the
result. If a third study is ever justified it will be for a different question, not
for a better p-value on this one. Recording that here is what makes the commitment
checkable.
