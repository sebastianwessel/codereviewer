# Result: the citation spine WORKS and changes nothing — not promoted

Ran 2026-08-10 against `reports/2026-08-10-citations-prereg.md`. Engine `e61bfdb`
for all six runs, `engineDirtyFileCount` 0 throughout, corpus
`security-advisory-2026` (72 cases), `openai/gpt-5.3-codex`, judge pinned. Arm
order alternated: control 1/2/1, treatment 2/1/2.

**Cost as measured: $4.47 control + $4.69 treatment = $9.16, plus $6.34 lost to an
aborted first sweep = $15.50.**

**Verdict: KEEP, DISABLED** — the third cell of the pre-registered table
(recall flat-or-worse, not significant).

## The mechanism engaged. That is the part worth having.

| | control | treatment |
| --- | --- | --- |
| findings carrying **>1** evidence record | **0 of 231 (0%)** | **191 of 212 (90%)** |
| evidence-count distribution | `{1: 231}` | `{1:21, 2:26, 3:59, 4:51, 5:46, 6:9}` |

Before this change, `evidenceCount` was 1 for every finding the engine has ever
produced, and that 1 was the refuter's own rationale written after the fact. In
the treatment arm 90% of findings carry two to six records — verified quotes of
the actual source lines, checked deterministically against the file before being
minted. **The structurally-empty channel is no longer empty, at scale, in a real
run.** That is not an inference from unit tests; it is the distribution the eval
recorded.

## And it moved nothing it was supposed to move

| | control | treatment |
| --- | ---: | ---: |
| in-diff recall (per seed) | 60.8 / 60.8 / 67.6 → **63.1%** | 60.8 / 64.9 / 60.8 → **62.2%** |
| adjusted precision | 98.6% | 99.3% |
| refutation `proved` | 77% | 73% |
| refutation `needs-more-evidence` | 18% | **20%** |
| refutation `refuted` | 5% | 7% |
| reviews posting nothing | 27% | **30%** |
| artifact-only findings | 44 | 44 |

Pooled per-expectation paired sign test over the 73 expectations on the 71 cases
that ran in all six runs: **3 gained / 7 lost, p = 0.3438** counting an
expectation found in any seed; **4 gained / 3 lost, p = 1.0000** counting one
found in at least two of three. Neither is significant, and the two thresholds
disagree in direction — which is itself a statement about how little separates the
arms.

**The hypothesis was that "could not prove it" outran "disproved" 5:1 because the
refuter held nothing. It now holds verified citations on 90% of findings, and the
ratio did not improve — it went from 18%/5% to 20%/7%, and silence rose from 27%
to 30%.** Giving the verifier evidence did not make it more decisive.

## The precision signal, and why it is not claimed

Raw precision moved 75.7% → 83.5%, and that number **must not be cited**. This
harness has a measured arm-order artifact — the arm running SECOND shows raw
precision +5–6pp, replicated across two unrelated interventions — and with three
seeds the treatment arm ran second twice while control ran second once. The
artifact is visible again here: position 1 averaged 76.5%, position 2 averaged
82.6%.

Within matched positions the treatment still leads (position 1: 80.0 vs control's
74.8 mean; position 2: 85.2 mean vs control's 77.6), so the effect is not *only*
order. But that comparison rests on one run per cell, and adjusted precision — the
metric that survives the plausibility judge — moved 98.6% → 99.3%, which is inside
noise. **Nothing about precision is established here.** A balanced-order study
with an even seed count is what would settle it, and this pre-registration did not
buy one.

## Against the pre-registered rule

The rule enumerated all four recall × significance cells in advance, precisely
because the previous pre-registration failed to.

- Recall **flat or worse** (−0.9pp, far inside the ~11pp three-seed resolution
  band), **not significant** → **KEEP, DISABLED**. The mechanism is sound and
  cheap; a null inside the resolution band is not evidence of harm.
- Overriding kill rule (inherited verbatim from spec 05's withdrawn refutation
  retrieval): remove if adjusted precision falls or genuine false positives rise.
  Adjusted precision **rose**, 98.6% → 99.3%. **Does not fire.**

No cell required interpretation after the fact. That is the one process thing this
study got right that the last one did not.

## What this establishes, and what it does not

**Establishes:** the refuter's empty-evidence channel was real, is now fillable,
and filling it at 90% coverage does not change the refuter's decisions. Six prior
nulls said what discovery is SHOWN is not the constraint; this one says what the
REFUTER HOLDS is not the constraint either — and unlike the previous six, the
mechanism is verified to have engaged rather than merely shipped.

**Does not establish:** that citations are useless. They cost +5.6% input tokens
and produce a report where a human reading a finding can see the exact line it
rests on, which is a product property this study did not measure and did not try
to. The `Rests on:` section of every comment now names real code instead of only
the refuter's prose.

**Does not establish anything about precision**, for the reason above.

## The run that was thrown away, recorded rather than buried

The first sweep aborted after four of six runs. One provider error in run four
failed the eval's own regression gate, `eval run` exits non-zero on a failed gate,
and `set -e` in `ab-run.sh` killed the sweep — discarding two paid runs and never
starting two more. **$6.34.** The harness now records each run's status, keeps its
report either way, and lets scoring decide what is poolable; the earlier
signal-facts sweep never provoked this because it had zero provider errors in all
six runs.

The partial data was deleted unread. One seed per arm is not the study, and
looking at it before deciding whether to continue is exactly what the
no-optional-stopping commitment forbids.

The completed sweep carried one provider error of its own, in treatment seed 3, on
`validator-fields-interpolated-unescaped-into-generated-decorator`. That case
scores as a total miss, which **depresses the treatment arm**, so the paired test
above excludes that case from all six runs symmetrically rather than excluding the
run. The exclusion is favourable to the treatment arm and it still lost 3–7.
