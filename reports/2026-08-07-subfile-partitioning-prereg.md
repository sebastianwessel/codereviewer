# Pre-registration: sub-file discovery partitioning

**Written before any run of this intervention.** The mechanism is implemented and off
by default; no provider call has been made with it on.

## Prior art, searched first

The rule learned earlier today — *search the ledger before pre-registering* — applied
here before a word of this was written. What the ledger holds:

| prior result | bearing on this |
| --- | --- |
| file partitioning 2 files/call: **+11.3pp, p = 0.033**, +63% cost | the only measured win; this extends its mechanism |
| file partitioning 1 file/call: 46.5% → **46.5%**, +36% cost | file granularity is exhausted at 2 |
| un-anchored second pass: **+0.83pp, p = 0.82**, +136% cost, removed | a second look at the *same* material fails |
| spec 26 reactive context splitting: **−8.5pp** | splitting a task's context can cost real recall |
| four prompt clauses | all null |

Sub-file partitioning is unmeasured — spec 27 has named it "the untested lever" since
2026-08-01, and nothing in the ledger tests it.

## The hypothesis

`maxFilesPerDiscoveryCall` multiplies calls by splitting the **file set**. On a
single-file change there is one partition and one call, so the one mechanism measured
as working **cannot engage**. Most of this corpus is single-file.

Partitioning works because a call is **shown less** (per-file attention decays as
`shown^-0.30`), not because it is told to focus. So the intervention narrows the
reviewed file body itself: declaration anchors from the AST, grouped into contiguous
runs overlapping by one declaration.

## Predictions, fixed in advance

**This is predicted to be a TRADE, not a gain, and the aggregate is the least
informative endpoint.**

- `local` and `implementation` recall **up** — the defect sits inside one group and
  that group is most of what the call sees.
- `cross-function` recall **down** — 16 of 17 cross-function expectations are in cases
  this knob splits, and a defect whose halves land in non-adjacent groups is lost. The
  one-declaration overlap saves only adjacent pairs.
- `cross-file` roughly **flat** — retrieval and referenced definitions are unchanged
  and attach to every group.
- **Aggregate recall: no prediction.** I do not know the sign. A null in the aggregate
  is the single most likely outcome and would be **uninformative on its own**, because
  a real gain and a real loss cancelling looks identical to no effect.
- Raw precision **down**, adjusted precision **flat** — more calls, more real findings
  the incomplete key does not name.
- Cost **+80% in discovery calls**, measured, at the registered operating point.

## Design

- Arms: control (`maxDeclarationsPerDiscoveryCall` unset — proven byte-identical to
  today by test) vs treatment (**16 declarations per group, capped at 3 groups per
  file**).
- That operating point is chosen on the **$0 measurability precheck**, not by feel:
  35 of 70 cases split, 1.8x calls, worst case 3 calls for any one file. Uncapped
  settings reach 11.6x and are refused on cost alone — the un-anchored pass was
  removed at +136%.
- **Ten seeds per arm**, `ab-run.sh`, alternating order, five runs per position.
- Primary endpoint: **paired per-expectation exact sign test, two-sided** — two-sided
  because the direction is genuinely not predicted.
- **Mandatory secondary: recall per context depth**, reported whatever the aggregate
  does. Registering this in advance is what stops a cancelling trade being written up
  as "no effect".

## Decision rule

**Promote to default** only if all three hold:
1. paired two-sided **p < 0.05** in favour of the treatment;
2. adjusted precision does not fall by more than the control arm's own spread;
3. `cross-function` recall does not fall by more than its own control spread — a
   change that buys local recall by blinding the reviewer to cross-function defects is
   not an improvement, whatever the aggregate says.

**Keep as an off-by-default knob** if the aggregate is null but the per-depth split
shows the predicted trade cleanly — that is a real finding about what the reviewer's
attention is spent on, and the knob then has a legitimate use on changes whose defects
are known to be local. It must be described as **unproven**, never as available
improvement.

**Remove the code** if adjusted precision falls, or if both the aggregate and every
depth move against the treatment. A knob nobody should turn on is not worth its
maintenance.

## Committed in advance

Ten seeds per arm, analysed once, no further seeds on this question whatever the
result. The measured cost multiple will be published alongside the recall figure
whether or not the recall result is favourable.

## The honest prior

Five pre-registered interventions today, five negatives, one of which survived looking
like a five-point win at six seeds. The base rate for "this one works" here is poor,
and the closest precedent to this change — splitting a task's context — cost 8.5
points. This one is worth running because it is the last mechanism the measured
attention curve points at, not because I expect it to win.
