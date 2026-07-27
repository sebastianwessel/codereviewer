# Evaluation results ledger

Append-only record of every measurement, with what invalidates it. Newest first.

Corpus `real-repo-cross-file` unless stated: 36 cases, 80 expectations.
Raw artifacts under `.codereviewer/eval/runs/<timestamp>/eval-report.json`.

---

## 2026-07-27 — Baseline after harness-wide conversation-history suppression

**Status: CURRENT.** This is the reference baseline for all subsequent arms.

| metric | value | per seed |
|---|---:|---|
| Recall (blended) | **46.3%** | 48.8 / 43.8 / 46.3 |
| **Recall, in-diff** | **73.9%** (102/138) | |
| **Recall, out-of-diff** | **8.8%** (9/102) | |
| Adjusted precision | 0.831 | 0.813 / 0.875 / 0.804 |
| Raw precision | 0.666 | 0.639 / 0.673 / 0.685 |
| Genuine false positives | 7.7 / run | 9 / 5 / 9 |
| Refutation kill rate | **0.9%** | 0.0 / 1.4 / 1.4 |
| Cost | **$1.43** / run | 2.20 / 1.05 / 1.03 |

n=3 seeds. Config: defaults — posture `precise`, `discoverySampleCount` 1,
security pass off, cross-file retrieval off.

### What changed since the previous baseline, and what it did

Paired finding-level comparison against the six history-carrying runs
(same corpus, same answer key):

| | value |
|---|---|
| before / after recall | 46.25% / 46.25% |
| delta | **−0.00pp** |
| 95% CI | [−3.13, +2.71] |
| gained / lost | 7 / 5 |
| p | **0.56** |

**Conversation-history suppression changed nothing measurable in accuracy, and
cut cost by 26%** ($1.92 → $1.43).

**A hypothesis this refutes.** It was argued — by me, at some length — that
refutation was rubber-stamping because it opened each call holding discovery's
findings *attributed to itself*, and that self-consistency pressure would bias it
toward `proved`. If that were the dominant effect, removing the history should
have raised the kill rate. It did not: 1.3% → 0.9%, and adjusted precision moved
within noise. **The ~1% kill rate is a genuine property of the pipeline, not an
artefact of contaminated context.** Refutation rarely finds anything to kill
because discovery rarely proposes anything speculative.

The change is still correct — the stages are specified to judge independently and
now do — and the 26% cost reduction is real. But it must not be described as an
accuracy improvement.

---

## Pre-2026-07-27 measurements: VOID for accuracy comparison

Every earlier figure was produced with conversation history forwarded into every
agent call. The paired test above shows the effect on recall was nil, so those
numbers are not *wrong* — but they were measured on a different pipeline and are
superseded by the baseline above. Cost figures from that period are inflated by
roughly 26%.

Additionally, every adjusted-precision figure recorded before the restatement
collapse landed (`EVAL_METRICS_VERSION 2026-07-27.plausibility-restatement-collapse`)
counted a reviewer's restatements of one defect as separate real findings, and
therefore overstated adjusted precision. Reports across that boundary do not pool.

### Un-anchored discovery pass A/B — REMOVED

+0.83pp recall (CI [−3.13, +4.79], 10 gained / 9 lost, p=0.82) for +136% cost.
Failed its pre-committed rule; the pass was removed. Detail:
`2026-07-27-unanchored-pass-ab-result.md`.

What survives it: refutation absorbed a 56% candidate increase, kill rate rising
1.3% → 16.0%, with adjusted precision holding — so the gate has headroom. And the
semantic finding merge collapsed 19.3 restatements per run with no one-sided loss.

### Untrusted-input guard — re-priced

First reported as +18.8pp (62.5% → 81.3–87.5%) on a 16-finding corpus. On the
133-finding benchmark the archived paired arms `crbA-guard-on.json` /
`crbB-guard-off.json` give 48 matched against 43 — 36.1% vs 32.3%, **+3.8pp**.
The larger figure was mostly small-corpus noise. Plan against +3.8pp.

---

## Standing caveats for reading anything here

- **Variance.** sd ≈ 4.8pp on this corpus. An effect below roughly 10pp cannot be
  resolved at n=3. Several arms above are smaller than the instrument.
- **The blended recall figure is not interpretable on its own.** 42.5% of
  expectations lie in unchanged code; the blended number depends on that ratio
  rather than on reviewer quality. Read the in-diff and out-of-diff rows.
- **Adjusted precision is an estimate, permanently.** Under an incomplete answer
  key, precision is not identifiable — raw precision is the lower bound and
  adjusted the upper. Report the pair.
