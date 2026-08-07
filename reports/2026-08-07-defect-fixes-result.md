# Result: the correctness fixes, measured — favourable, not established

Measured 2026-08-07 against `reports/2026-08-07-defect-fixes-prereg.md`, committed
before the run.

**Verdict under the pre-registered rule: no detectable change — meaning
undetectable at this power, not no effect.** Every direction is favourable and none
of it reaches the threshold I set in advance.

## The numbers

Control `f2a6ee8` (before the fixes) vs treatment `0504e49` (the three fixes, no
prompt text differing). **Six seeds per arm**, alternating order, three runs in each
position per arm. All twelve share dependency digest and dirty digest and differ only
by engine SHA.

| | control | treatment | delta |
| --- | --- | --- | --- |
| recall | **58.0%** (sd 3.31pp) | **63.1%** (sd 5.22pp) | **+5.13pp** |
| adjusted precision | 97.3% | 98.6% | +1.26pp |
| empty returns | 30 | 28 | −2 |
| genuine false positives | 5 | 3 | −2 |

Paired over all 51 expectations, six seeds each: **14 gained, 6 lost, 32 unchanged,
exact two-sided sign test p = 0.1153.**

## Why this is not a win, and why that matters

The rule said: *"The fixes improved recall" may be claimed only if the paired test
reaches p < 0.05 in favour of the treatment. Nothing weaker is a claim.*

**p = 0.1153.** So it is not claimed.

This is the moment the pre-registration was written for. Recall up five points,
fourteen expectations gained against six lost, precision up, false positives down,
silence down — every single number pointing the same way. Without a threshold fixed
in advance I would be writing "the correctness fixes improved recall by 5 points"
right now, and it would be an overclaim resting on p = 0.12.

**One additional net gain would have crossed it.** At twenty discordant pairs, 14–6
gives p = 0.115 and 15–5 gives p = 0.041. That cuts both ways: it shows how close
this is, and it shows why a threshold that can be crossed by a single expectation is
not a formality to be waved through.

## What I am not doing, and it is the point

The obvious move is to run six more seeds per arm and see if p drops below 0.05. That
would be **optional stopping** — adding data because I saw the result and want a
different one — and it invalidates the test it appears to strengthen. The
pre-registration specified six seeds. Six seeds ran.

If this is worth settling, the honest route is a **fresh, independently
pre-registered confirmation** treating today's result as the hypothesis rather than
as a partial answer. That is a different experiment, and it should be run as one.

## What can be said

- **The fixes stay.** They were shipped on correctness with failing-first tests, and
  the rule explicitly did not make their retention contingent on this measurement.
- **No regression.** The pre-registered failure condition — recall falling by more
  than the control's own spread (9.62pp) — did not occur; recall rose.
- **This is the strongest directional signal any change produced today.** The three
  prompt interventions gave 7–8, 7–7 and 7–7 paired splits, all indistinguishable
  from a coin. 14–6 is genuinely lopsided. It is consistent with a real, small
  improvement, most plausibly from D3 — the only fix the pre-registration expected to
  bite on this corpus.
- **It is consistent with chance too**, at roughly one time in nine.

## The honest summary of the day's measurement

Four changes were measured against pre-registered rules. Three were prompt
hypotheses and all three were null. One was a set of correctness fixes, and it
produced a favourable result that does not clear its own bar.

That is not a disappointing outcome; it is a calibrated one. The corpus resolves
about eleven points at three seeds and rather better at six, and the effects that
real changes produce here are smaller than that. Knowing the size of what can be seen
is what makes the difference between "we improved it" and "we cannot yet tell" — and
this project can now tell which of those it is in.
