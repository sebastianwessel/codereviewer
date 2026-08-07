# Result: the authorization-scope clause is reverted

Measured 2026-08-07 against the rule pre-registered in
`reports/2026-08-07-authorization-scope-prereg.md`, which was committed before the
code change and is not edited by this document.

**Verdict: inconclusive. The clause is reverted.**

## What ran

Control `b7456ac` against treatment `b8ad0ec`, three seeds each, arms interleaved so
neither inherited the other's warm prompt cache. Provider `openai/gpt-5.3-codex`.
Corpus: the security corpus as it stood at **50 cases / 51 expectations** — the
devise open-redirect case was added afterwards and was deliberately not hydrated
into the slice root these runs read, so all six runs scored the same denominator.

All six arms share provenance: dependency digest `52d22c48`, dirty digest
`e3b0c442` (clean), differing only by engine SHA, which is the intervention.

**One arm was re-run to get there.** `treatment-1` originally recorded
`engineDirtyFileCount: 10` — an unrelated commit was in flight while it ran — which
would have put asymmetric contamination in the treatment arm alone. It was re-run
from a clean tree **before any metric was computed**, so the decision to discard it
could not be influenced by whether the result was liked. The discarded artefacts are
kept as `treatment-1-dirtytree*`.

## The numbers

| | control | treatment | delta |
| --- | --- | --- | --- |
| recall | 59.5% (sd 6.30pp) | 60.1% (sd 3.00pp) | **+0.65pp** |
| precision, raw | 69.4% (sd 2.38pp) | 74.2% (sd 0.34pp) | +4.79pp |
| precision, adjusted | 97.9% | 99.0% | +1.09pp |
| genuine false positives, 3 seeds | 2 | 1 | −1 |

| authorization | control | treatment |
| --- | --- | --- |
| dev | 3/3 | 3/3 |
| held-out | 3/15 | 4/15 |

## Why this is inconclusive and not a win

**The paired test settles it.** Adjudicated per expectation over all 51, pooling
three seeds per arm into one observation each: **7 gained, 8 lost, 36 unchanged,
exact two-sided sign test p = 1.0000.** That is as null as a result can be, and it
is the sharpest instrument available on this evidence.

Everything that looks like movement dissolves against it:

- Whole-corpus recall rose **0.65pp** against a corpus sd of 3.0–6.3pp and an
  instrument that resolves about 8 points. Noise.
- `authorization` on held-out rose from 3/15 to 4/15 — **one seed-observation**, and
  in the paired view a single expectation moving 0→1. The pre-registration said in
  advance that `authorization` at this denominator "resolves almost nothing and is
  reported as counts". It was right.
- The seven gains and eight losses are spread across mechanisms and depths with no
  pattern. The clause did not move the class it names; it reshuffled.

## A pre-registered criterion whose premise was wrong

Criterion 3 read: *"genuine false positives do not rise above 0 across three seeds,
and adjusted precision does not fall."* It was written against the 50-case
baseline, which recorded **0** genuine false positives.

In this A/B the **control arm produced 2**. So the absolute threshold disqualifies
the control as well as the treatment, and cannot discriminate between them. Read
literally, the treatment fails it (1 > 0). Read as intended — false positives must
not rise — the treatment passes decisively, since it *halved* them and adjusted
precision rose.

**Both readings are recorded and neither is used to rescue the result.** The
decision rests on the paired test, which is null, and would be the same under either
reading. The lesson for the next pre-registration is that an absolute threshold
copied from a prior baseline is fragile: state it as a *change* from the control arm
of the same A/B, which is the only baseline a paired design actually has.

## The observation I am deliberately not shipping on

Raw precision rose 69.4% → 74.2%, and the treatment arm's three seeds landed at
**sd 0.34pp** — an order of magnitude tighter than the control's 2.38pp. Genuine
false positives halved. That is the most consistent signal in the data.

It is **not** a reason to ship, and promoting it now would be exactly the failure
pre-registration exists to prevent: the rule was written about recall, and finding a
different metric that moved after seeing the results is how a null becomes a
"win". If a precision effect is worth pursuing it needs its own pre-registration,
its own hypothesis about mechanism, and its own arms.

## What the revert costs

Nothing measurable. A clause that changes nothing is prompt weight that invalidates
the prompt-cache prefix and buys no recall.

`authorization` remains the worst substantial mechanism at 7/18 on the standing
baseline, and this attempt did not move it. The hypothesis that the gap is a missing
weakness *class* in the prompt is now evidence-against rather than untested. The
next attempt should start somewhere else — most plausibly at selection rather than
enumeration, since the paired data shows the reviewer trading findings rather than
adding them.
