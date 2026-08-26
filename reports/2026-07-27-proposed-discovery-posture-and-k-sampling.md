# Proposed: discovery posture, and independent sampling with union merge

Date: 2026-07-27
Status: **PROPOSAL — pre-approved in principle; spec text lands after the
un-anchored pass removal completes** (that work currently owns `specs/_registry.yaml`).

Two changes, deliberately separated because they are independent variables and
one of them is free.

---

## 0. The finding both rest on

Measured today (`2026-07-27-unanchored-pass-ab-result.md`):

| | base | under +56% candidates |
|---|---:|---:|
| Refutation kill rate | **1.3%** | **16.0%** |
| Adjusted precision | 0.804 | 0.792 |

**Our precision does not come from refutation. It comes from discovery being
conservative.** That couples precision and recall to one knob and explains why
every "find more" attempt has cost precision.

The gate has now been shown, under load, to absorb speculation without degrading.
That is the permission slip for widening discovery — which is what both proposals
below do, by different means and at very different prices.

---

## 1. Discovery posture (free)

### What

The discovery instructions currently ask for restraint. Invert them: instruct the
reviewer to investigate every suspicious pattern it notices and report what it
can support, leaving adjudication to the stage built for it.

No extra calls. No extra tokens beyond a slightly longer instruction. **This is a
prompt change.**

### Why it is worth trying before anything expensive

- **Cursor's documented v1 → agentic rewrite** inverted exactly this — from
  minimizing false positives to *"aggressive prompts that encouraged the agent to
  investigate every suspicious pattern"* — and resolution rate went 52% → 70%+.
  Their account attributes the change to posture as much as architecture.
- **Our own precedent is strong.** A single added instruction (the injection
  guard) moved recall 62.5% → 81.3%/87.5% at identical cost with 100% precision.
  Framing has outperformed every structural change we have attempted.
- **It is the cheapest way to consume the refutation headroom we just measured.**

### Why it is not one of the four failed prompt experiments

The failed in-prompt security lens added a **checklist** — it reallocated
attention across categories, trading authz recall for injection recall. The
enumeration sweep **re-asked** over the same artifact. This changes neither the
categories nor the number of calls; it changes how much evidence the reviewer
demands of itself before speaking, which is the one dial none of them touched.

### The risk, stated plainly

This is the dial that directly controls our precision. The measurement must
therefore treat precision as a **gate, not a trade**: adjusted precision and
genuine false positives may not degrade, whatever recall does. If refutation's
kill rate does not rise, the extra candidates are reaching reports rather than
being filtered, and the change fails regardless of recall.

### On making it a mode

A configurable posture is the right end state **only if both settings win
somewhere**. If aggressive wins outright it should become the default and no mode
should exist — permanent config surface for a strictly dominated option is
complexity we would be choosing to maintain.

Proposal: **measure first, decide the mode afterwards.** If the result is a
genuine trade (recall up, precision down), that is a real user choice — a
precision-first CI gate wants one setting, an exploratory review the other — and
a mode is justified. If one dominates, ship it as the default.

---

## 2. Independent sampling with union merge (paid)

### What

Run discovery k times **independently** on the same input, union the candidates,
and let the semantic merge collapse restatements before refutation and admission.

Merge by **union, never consensus.**

### Why now and not before

**It was blocked until today.** Union-merging k samples without semantic dedup
produces triplicated findings — exactly the traefik failure that made adjusted
precision meaningless. The semantic merge is the enabling piece, and it is now
measured under load at 19.3 collapses per run with no one-sided loss.

### Why it is not the enumeration sweep that failed

The sweep re-asked **within one conversation carrying the prior findings**, which
anchors the model on its own answer. Independent samples are mutually blind and
the merge happens afterward. Different mechanism.

### What our own data prices

Our measured **union ceiling is ~67% against ~46% single-run**. That ~20pp is
pure run-to-run variance, which is precisely what independent sampling harvests —
and it is also the variance that makes our results wobble 43.8–48.8% between
runs. **This is the only proposal that addresses stability as well as recall.**

Published support: SWRBench self-aggregation, recall **+118.8% at n=10**, plateau
at **n=5**, precision essentially flat; cheap-model×k beat expensive-model×1 at
lower cost.

### Consensus is forbidden, not merely discouraged

On Defects4J the union solved **205** problems against **112** for the best single
model, and **every consensus strategy underperformed a naive baseline** — the
popularity trap, where models converge on the same wrong answer. Cursor's v1
pipeline used majority voting across eight passes and they **removed it**.
Majority voting would delete precisely the rare findings we are trying to recover.

### Honest limits

- **Ceiling-approaching, not ceiling-breaking.** Capped at the union ceiling; it
  cannot touch the 4.7% later-in-file gap.
- **The 67% figure is not current.** It came from a different corpus and config
  and must be re-measured before being treated as the prize.
- **Cost +40–50%** per our cache probe, which found caching unreachable for this
  shape of repeat.

---

## 3. Order, and why

1. **Posture first.** Free, largest historical effect size for this codebase,
   and it consumes headroom we have already paid for.
2. **k-sampling second**, measured *on top of* whichever posture wins. The two
   compose: a wider posture gives independent samples more diversity to union,
   so measuring k-sampling against a restrained posture would understate it.

Each arm: 3 seeds, paired finding-level significance. Posture ≈ $12 (no cost
delta, just runs). k-sampling at k=3 ≈ $20–25.

Decision rule, fixed in advance for both, unchanged in shape from spec 19:

- **Ship** only if recall rises with paired significance clearing, **and**
  adjusted precision and genuine false positives do not degrade, **and**
  refutation's kill rate rises.
- **Keep, disabled** if recall rises without significance at n=3.
- **Remove** if recall does not rise.

Five structural interventions have failed under this rule. That is the rule
working, and it is why these two are worth running rather than assuming.
