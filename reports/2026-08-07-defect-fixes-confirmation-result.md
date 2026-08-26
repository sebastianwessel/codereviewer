# Confirmation result: the effect did not reproduce

Measured 2026-08-07 against `reports/2026-08-07-defect-fixes-confirmation-prereg.md`,
committed before these runs.

**Verdict: not reproduced at adequate power.** The exploratory +5.13pp was noise.

## The numbers

Control `f2a6ee8` vs treatment `0504e49`, **ten seeds per arm**, alternating order.
Provenance exact: 20 runs, **5/5 position balance in each arm**, one dependency
digest, one dirty digest, no contaminated run.

| | control | treatment | delta |
| --- | --- | --- | --- |
| recall | 60.6% (sd 4.28pp) | 61.4% (sd 3.68pp) | **+0.77pp** |
| adjusted precision | 98.5% | 97.6% | −0.84pp |
| empty returns | 44 | 48 | +4 |
| genuine false positives | 5 | 8 | +3 |

Paired over all 51 expectations, ten seeds each: **12 gained, 12 lost, 28 unchanged.
One-sided exact sign test p = 0.5806.**

Twelve against twelve. There is no cleaner null available.

## Set against the exploratory study

| | exploratory (6 seeds) | confirmation (10 seeds) |
| --- | --- | --- |
| recall delta | **+5.13pp** | **+0.77pp** |
| paired split | 14 gained / 6 lost | **12 / 12** |
| empty returns | 30 → 28 | 44 → 48 |
| genuine false positives | 5 → 3 | 5 → 8 |

Every secondary measure that moved favourably the first time moved the other way the
second. The direction, the magnitude and the mechanism were all specified in advance,
and none of them appeared.

## Why this is the most valuable result of the day

The exploratory study looked like a five-point win. Recall up, precision up, silence
down, false positives down, fourteen expectations gained against six — every number
telling the same story, at p = 0.1153.

**It was noise, and a properly powered fresh sample says so.**

Two things follow, and the second matters more than the first:

- **The pre-registered bar was right to hold.** Claiming that result would have put a
  false five-point improvement into this project's published figures, where it would
  have become the baseline every later change was measured against.
- **Refusing optional stopping was right, and this is the proof.** The tempting move
  was to add seeds to the original twelve until p crossed 0.05. Given a true effect
  of roughly zero and a starting point of 14–6, that walk would have crossed the
  threshold on some draw and stopped there — manufacturing exactly the false positive
  this study just prevented. The confirmation was affordable and it was the honest
  route; the shortcut was neither.

## What stands

- **The fixes stay.** They shipped on correctness with failing-first tests: a budget
  guard measuring the wrong object, config exclusions not binding on the reviewer's
  own read tool, whole diff hunks vanishing for C-quoted filenames, ranged reads
  numbered from the wrong origin. Each was wrong on its own terms and their retention
  was never contingent on a recall measurement. **They are correct and they do not
  measurably improve recall — both of those are true at once.**
- **The hypothesis is retired.** D3 was named in advance as the likely mechanism and
  it did not carry. This is no longer an open question awaiting a better measurement.
- **No further seeds will be run on this question**, as committed in the
  pre-registration, whatever anyone thinks of the answer.

## The day's measurement record, complete

| change | design | paired result |
| --- | --- | --- |
| authorization-scope clause | 3 seeds/arm | 7 gained / 8 lost, p = 1.0000 |
| stale precision boundary | 3 seeds/arm | 7 / 8, p = 1.0000 |
| intent-framing clause | 3 seeds/arm | 7 / 7, p = 1.0000 |
| correctness fixes (exploratory) | 6 seeds/arm | 14 / 6, p = 0.1153 |
| **correctness fixes (confirmation)** | **10 seeds/arm** | **12 / 12, p = 0.5806** |

Five pre-registered measurements, five honest negatives, one of which had to survive
looking like a win first.

**No accuracy improvement was demonstrated today, and that conclusion now rests on a
properly powered study rather than on an underpowered one.** That is a materially
better position than where the day started, when the same statement would have been
an admission of ignorance rather than a finding.
