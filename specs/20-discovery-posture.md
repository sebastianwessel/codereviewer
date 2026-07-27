# 20: Discovery Posture

Status: Approved
Date: 2026-07-27

## Purpose

Control how much evidence the discovery reviewer demands of itself before it
raises a candidate, and measure whether relaxing that demand raises recall
without costing precision.

## The Finding This Rests On

Measured 2026-07-27 (`reports/2026-07-27-unanchored-pass-ab-result.md`):

| | base | under +56% candidates |
|---|---:|---:|
| Refutation kill rate | **1.3%** | **16.0%** |
| Adjusted precision | 0.804 | 0.792 |

**This engine's precision does not come from refutation. It comes from discovery
being conservative.** That couples precision and recall to a single dial and
explains why every attempt to raise recall so far has cost precision.

Both columns were measured before the harness-wide suppression of conversation
history (see *Conversation History* in `21-independent-sampling.md`), so neither is
a current figure. They are quoted for the *relationship* they establish — the gate
absorbs speculation — and the measurement below must re-baseline rather than reuse
them as an arm.

The gate has now been shown, under load, to absorb a large increase in
speculative candidates without adjusted precision degrading. Widening discovery
is therefore a change the pipeline can afford, and the posture is the cheapest
way to do it: it adds no calls and no meaningful tokens.

## Design

Discovery instructions carry one of two postures.

- **`precise`** — the current behaviour. The reviewer raises a candidate only
  when it can support the claim from the code in front of it.
- **`investigative`** — the reviewer additionally pursues patterns it finds
  suspicious and reports what it can support, leaving adjudication to refutation
  and admission, which exist for that purpose.

## Requirements

- The posture MUST change only how much self-evidence the reviewer demands. It
  MUST NOT introduce defect categories, checklists, examples, or any hint about
  what to look for. A checklist reallocates attention across categories, which
  was measured to trade authorization recall for injection recall; that is a
  different and already-rejected change.
- Both postures MUST remain generic and language-neutral. The Non-Negotiable in
  spec 15 applies unchanged.
- The posture MUST NOT alter the number of model calls, the packet shape, or the
  order of fields in the packet. Prompt-cache prefix stability is a measured
  property and must not regress.
- The default is `precise` until measurement selects otherwise.
- Refutation, the semantic finding merge, and admission are unchanged. The
  posture widens what reaches them; it never widens what leaves them.

## Why This Is Not One Of The Rejected Prompt Changes

The in-prompt security lens added a **checklist** of mechanisms and reallocated
attention across categories. The withdrawn enumeration sweep **re-asked** over
the same artifact within one conversation, anchoring the reviewer on its own
prior answer.

This change touches neither the categories nor the number of calls. It changes
the evidentiary bar the reviewer applies to itself, which is the one dial none of
the withdrawn experiments moved.

Precedent for the size of prompt effects in this engine, stated at its corrected
size: adding a single instruction — the untrusted-input guard — was first reported
as +18.8pp (62.5% → 81.3–87.5%), but that was measured on a 16-finding corpus.
Re-measured on 133 findings the same change is worth **+3.8pp** — 48 matched of
133 with the guard on against 43 without it, 36.1% versus 32.3%, from the archived
paired arms `crbA-guard-on.json` and `crbB-guard-off.json`. The larger
figure was mostly that small corpus's own noise, and the smaller one is the number
to plan against.

That correction cuts both ways, and both directions matter here. It removes the
claim that a prompt change once moved recall by twenty points, so this proposal
must not be justified by that figure. What survives is the narrower and still
useful observation: prompt changes in this engine have produced **positive**
effects at **no additional cost**, while five structural interventions produced
none at costs from +27% to +136%. A +3.8pp-sized effect is below what three seeds
can resolve against a ~4.8pp variance band, so this measurement should expect to
need more seeds, or to report an honest "cannot distinguish from noise" rather
than a win.

## Measurement

Arms: `precise` against `investigative`, three seeds each, real-repository
corpus, paired finding-level significance.

Precision is a **gate, not a trade**. The decision rule, fixed before the run:

- **Adopt** only if recall rises with the paired test clearing significance,
  **and** `adjustedPrecision` and `genuineFalsePositiveCount` do not degrade,
  **and** refutation's kill rate rises.
- **Retain as configuration** if the result is a genuine trade — recall up,
  precision down — because that is a real choice between a precision-first gate
  and an exploratory review.
- **Remove** if recall does not rise.

The kill-rate condition is not decoration. If discovery raises more candidates
and refutation's kill rate does not move, the additional candidates are reaching
reports rather than being filtered, and the change has bought noise.

## On Whether This Should Remain A Mode

A configurable posture is justified **only if both settings win somewhere**. If
one dominates, it becomes the default and the other is removed: permanent
configuration surface for a strictly dominated option is complexity chosen for no
benefit, which the repository's conventions forbid.

This spec therefore introduces the posture as a measured variant. Whether it
survives as configuration is decided by the measurement above, not in advance.

## Verification Matrix

| Requirement | Test |
| --- | --- |
| Default posture is `precise` | config schema test |
| Both postures stay generic and language-neutral | prompt genericity guard |
| Posture introduces no categories, checklists, or examples | instruction unit test |
| Call count and packet field order are identical across postures | discovery unit test |
