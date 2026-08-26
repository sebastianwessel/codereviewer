# Result: signal-facts context is NOT promoted — the sixth null on this stage

Ran 2026-08-10 against `reports/2026-08-10-signal-facts-prereg.md`. Engine
`0da877a` for all six runs, `engineDirtyFileCount` 0 throughout, corpus
`security-advisory-2026` (72 cases), `openai/gpt-5.3-codex`, judge pinned to the
same model. Zero provider errors in either arm. **Cost as measured: $4.43 control
+ $5.94 treatment = $10.37**, plus $0.15 for the two smokes.

Arm order alternated: control ran position 1 / 2 / 1, treatment 2 / 1 / 2.

**Verdict: not promoted. Stays shipped and disabled.**

## The numbers

| | control | treatment (`review.signalFacts.enabled`) |
| --- | ---: | ---: |
| in-diff recall, per seed | 64.9 / 64.9 / 64.9 | 66.2 / 62.2 / 56.8 |
| recall mean | **64.9%** | **61.7%** |
| recall sd | 0.00pp | 4.75pp |
| adjusted precision | 96.7% | 100.0% |
| raw precision | 75.8% | 74.0% |
| artifact-only recall | 7.7% | 9.9% |
| input tokens | 6,901,000 | 7,598,206 (**+10.1%**) |
| cost | $4.43 | $5.94 (**+34%**) |
| provider errors | 0 | 0 |

Pooled per-expectation paired sign test over all 74 expectations:
**3 gained, 3 lost, 68 unchanged, exact two-sided p = 1.0000.** Scoring an
expectation as found only when it appeared in at least two of three seeds gives
3 gained, 2 lost, p = 1.0000.

## Against the pre-registered rule

- **Promote** required recall to improve by more than the run-to-run band. Recall
  went the other way, −3.2pp. **Fails.**
- **Remove** required adjusted precision to fall, or budget failures or provider
  errors to rise. Adjusted precision *rose* (96.7% → 100.0%), errors stayed at
  zero in both arms. **Does not fire.**

**The rule under-specified this cell, and that is worth recording rather than
patching quietly.** Its middle clause — "keep shipped, disabled" — was written for
a favourable-but-not-significant result, and what arrived was unfavourable and not
significant. The removal clause's stated *rationale* ("a capability that costs
prompt on every call and cannot show a gain does not get to stay") describes this
run exactly, while its literal *trigger* does not. I am not resolving that by
picking whichever reading the data now favours: the literal triggers decide, so
the capability stays shipped and disabled. The next pre-registration on this stage
should enumerate all four recall × significance cells before the run.

## What the run establishes beyond the verdict

**Control recall was identical in all three seeds — and that is real, not a
harness artifact.** Raw discovery findings varied (93 / 86 / 84), so the engine is
non-deterministic; the count that MATCHED an expectation landed on 48 every time.
The stable expectations are found on every seed and the marginal ones on none, so
the aggregate is far steadier than the finding stream underneath it. The treatment
arm broke that stability (49 / 46 / 42), which is the more interesting half of
this result: adding the section made the reviewer *less consistent*, not more.

**The section is not a caching problem.** Treatment seed 1 cached only 46.7% of
its input, which looked at first like prompt instability from a non-deterministic
facts serialization. It is not: seeds 2 and 3 cached 87.0% and 85.7%, so the
treatment prompts are stable and cache normally once seen. Seed 1 was simply the
first exposure to a new prompt shape. The +34% cost is the cold first run plus the
+10.1% tokens the section genuinely costs.

## What this closes

This is the **sixth** measured null on discovery framing: five pre-registered
prompt clauses (splits 7/8, 7/8, 7/7, 12/12, 16/16) and four attention
mechanisms, and now a change that shipped real DATA through a channel that had
been structurally empty since inception rather than new wording. The
pre-registration argued that data-through-a-dead-channel was a different
mechanism no prior null covered. It was different, and it landed in the same
place.

The honest reading is not "the facts are useless" — they are correct, and
refutation has always had them. It is that **what discovery is SHOWN is not the
binding constraint on what it finds.** Six interventions on that surface have now
said so, at a total measured cost this ledger records.

## The bound, stated as pre-registered

Three seeds resolve roughly 11pp on this corpus. A real effect smaller than that
reads as null here. This run does not establish that the section is harmful — the
−3.2pp sits inside that band, and the sign test is 3-vs-3. It establishes that no
effect large enough to matter was found, at a cost of +10.1% input tokens on every
discovery call.
