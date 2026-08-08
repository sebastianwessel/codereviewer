# Pre-registration: reviewer model comparison, judge held fixed

**Written before any run of this comparison**, and before the candidate model's cost is
known.

## Why this is now possible

Until today the eval resolved both judges from the reviewer's own model alias, so a
model comparison moved the scorer with the subject and could not be interpreted
(`reports/eval-results-ledger.md`, 2026-08-08). `evaluation.judgeModel` now pins the
judges independently, and `eval compare` refuses arms scored by different judges.

**The judge is pinned to `gpt-5.3-codex` in BOTH arms.** That is the whole point: only
the reviewer varies.

## Arms

| arm | reviewer model | judge model |
| --- | --- | --- |
| control | `gpt-5.3-codex` (current default) | `gpt-5.3-codex` |
| treatment | `gpt-5.1-codex-max` | `gpt-5.3-codex` |

`gpt-5.1-codex-max` is the strongest code-oriented tier reachable on this key.
`gpt-5.3-codex` is already the newest codex model, so this is a **tier** comparison
across generations, not an upgrade — stated plainly because the confound is real: a
difference could be tier or generation, and this design cannot separate them.

## The cost gate, decided before seeing any result

Pro and max tiers can be several times the price of a codex tier, and that price is not
knowable from the API. So the study is **staged**:

1. **Probe: one treatment seed.** Record its measured spend.
2. **If that seed costs more than 5x a control seed (~$1.50), STOP.** Report the cost
   and the single-seed recall as an anecdote explicitly labelled as such, and do not
   run more. A model that costs 5x is not a shippable default at this project's
   measured effect sizes, so paying for statistical power on it would be spending to
   decorate a decision already made.
3. **Otherwise run 3 seeds per arm** and report the paired comparison.

Three seeds, not ten: this corpus resolves roughly 11pp at that depth, and a model-tier
difference large enough to matter should exceed it. If the result lands inside the band
it will be reported as unresolved, not as parity.

## Predictions

- **No prediction on direction.** A newer codex generation may beat an older max tier or
  may not. Recording "no prediction" is what makes the test two-sided and honest.
- **Cost: unknown, and that is the point of the gate.**
- Adjusted precision reported alongside; a recall gain bought with a precision loss is
  a trade to argue, not a win.

## Decision rule

**Recommend a default change** only if the paired per-expectation exact sign test is
two-sided **p < 0.05** in favour of the treatment AND adjusted precision does not fall
by more than the control's spread AND the treatment's measured cost per run is within
1.5x of control.

**Report as unresolved** if the difference sits inside the band.

**Report as rejected** if the treatment is worse, or if the cost gate stops the study.

Whatever happens, both model names and the judge model are published with every figure
— a rate is a property of a model, and now of two.
