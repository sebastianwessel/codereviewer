# Result: the boundary fix is reverted — and the harness has an arm-order artifact

Measured 2026-08-07 against `reports/2026-08-07-stale-precision-boundary-prereg.md`,
committed before the code change and not edited by this document.

**Verdict: rejected. The change is reverted.**

The second finding below is larger than the first, and it was only visible because
two A/Bs ran the same day.

## The verdict

Control `15b4781` vs treatment `41157ab`, three seeds each, 51-case corpus. All six
arms clean: dirty digest `e3b0c442`, deps `52d22c48`, differing only by engine SHA.
No arm needed re-running.

**Primary endpoint — the empty-return rate — did not fall.**

| | control | treatment |
| --- | --- | --- |
| empty returns | 14/153 = **9.15%** | 15/153 = **9.80%** |
| per seed | 4, 6, 4 | 5, 4, 6 |

It rose by 0.65pp, inside a control arm whose own seed spread is 2 runs. The
pre-registered rule rejects on exactly this: *"Is rejected if … the empty-return rate
does not fall."*

Guards, for the record: recall −0.64pp (59.9% sd 2.22 vs 60.3% sd 4.00), adjusted
precision +0.03pp, genuine false positives 1 in both arms.

By depth, the intended target did move — `callee` empties fell 27.8% → 16.7% — but
`implementation` rose 13.9% → 25.0%, on 18 and 36 observations. Net wash, and at
those denominators neither half is worth a claim.

**The hypothesis is not thereby disproved; it is unsupported.** The clause
contradiction is real and dated (`ac4451a` 2026-06-24 against `46077ec` 2026-07-31).
Resolving it did not reduce silence. Either silence has a different cause, or the
wording chosen was not the one that resolves it. What is settled is that this fix
does not pay for its cache invalidation.

## The larger finding: the arm that runs second wins on precision

Both A/Bs today ran `for each seed: control, then treatment` — so **the treatment arm
always ran second**. Raw precision:

| A/B | arm | position | seeds | mean | sd |
| --- | --- | --- | --- | --- | --- |
| authorization | control | 1st | .6667 .7083 .7073 | .6941 | .0238 |
| authorization | treatment | 2nd | .7381 .7436 .7442 | **.7420** | **.0034** |
| boundary | control | 1st | .6739 .6739 .6346 | .6608 | .0227 |
| boundary | treatment | 2nd | .7273 .7174 .7250 | **.7232** | **.0052** |

**Two completely different interventions produced the same +5–6pp shift with an
order-of-magnitude tighter standard deviation, always in the arm that ran second.**
A treatment effect does not replicate across unrelated treatments. Position does.

The cause is not established and is not guessed at here. What follows regardless:

- **Raw precision differences between arms in this harness are not trustworthy**
  until the cause is found. Neither A/B's precision delta may be cited.
- **Recall appears unaffected** — the deltas do not share a direction (authorization
  +0.65pp, boundary −0.64pp) and the arms' sds overlap. That is weak evidence, not a
  clearance.
- **Interleaving was not enough.** It was chosen to stop the second arm inheriting a
  warm cost profile, and it does that. It does not randomise *position*, which is a
  separate confound this design left fixed.

**Both verdicts stand and are strengthened, not weakened, by this.** The artifact
inflates the treatment arm's precision, so it could only ever have pushed toward
shipping. Both A/Bs rejected anyway, and in the first one the precision signal was
explicitly refused as a ship criterion — for the different and also correct reason
that the rule was written about recall. Had it been shipped on, it would have been
shipped on an artifact.

## What changes for the next A/B

Arm order must be randomised or alternated per seed, and the arm-position column must
be recorded in the provenance sidecar so the artifact is checkable rather than
inferable only when two A/Bs happen to run on the same day.

Until then, an A/B in this harness can report **recall** and **the empty-return
rate**, and must not report a precision delta between arms.
