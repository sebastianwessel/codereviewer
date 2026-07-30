# Optional Capabilities

Every capability here is **off by default**. That is not caution or
incompleteness — most of them were built, measured, and left off *because the
measurement said so*. This page exists so you can decide in thirty seconds
whether to turn one on.

The house rule, from [`specs/06-evaluation-and-quality-gates.md`](../../../specs/06-evaluation-and-quality-gates.md):
model-backed evaluation is non-deterministic, so a single run does not establish a
result. On the 16-case real-repository corpus, four seeds of one *identical*
configuration produced recall 81.3%, 87.5%, 81.3%, 75.0% — mean 81.3%, standard
deviation **4.4 percentage points**. A single-seed change must move recall by more
than roughly twice that before it can be distinguished from noise. A headline
figure is the mean across seeds, never the best observed run.

## Decision table

| Capability | Config key | Default | What it buys | Cost | Measured verdict |
| --- | --- | --- | --- | --- | --- |
| [Change-intent context](change-intent-context.md) | `contextSources.enabled` | `false` | Orientation: the reviewer learns *why* the change was made, which should reduce misunderstanding-driven false positives | One summarizer call per run (`model` mode); zero with `digest` | **Unmeasured.** No A/B exists. Rationale is design, not evidence. Enable if your pipeline already has PR/ticket text; do not expect a measured recall number |
| [Cross-file retrieval](cross-file-retrieval.md) | `review.crossFileRetrieval.enabled` | `false` | Lets discovery read other-file code on demand through mediated tools | +71% … 2.5× | **Net negative — do not enable.** Three measurements on the corpus built to favour it: flat at 4 cases (2.5× cost), 66.7% → 44.4% at 9, 68.8% → 56.3% at 16. Precision stayed 100% throughout, so the loss is recall, not noise |
| [Dedicated security pass](dedicated-security-pass.md) | `security.dedicatedPass.enabled` | `false` | A second, security-only discovery call per task (generic OWASP/CWE checklist), merged additively | +61% | **Mixed.** 2026-07-24, full benchmark, n=1: overall recall 24.8% → 29.3%, +22 unlisted-real findings (trustworthy, large denominator). But labeled security recall 14 → 12 and authorization 8 → 6. The **security-specific lift it was built for is unproven** |
| [Verification](verification-and-fix.md) | `verification.enabled` | `false` | Investigates external/prior claims against the real code and returns verdicts; corroborates findings | Bounded agent run per claim | **Unmeasured as a quality lever.** It is a distinct product feature, not a recall knob; its outputs never touch the gate |
| [Fix lane](verification-and-fix.md#the-fix-lane) | `fix.enabled` | `false` | Real-file-grounded `real`/`false-positive` judgment plus an apply-checked fix per admitted finding | One bounded agent run per eligible finding | **Unmeasured as a quality lever.** Advisory: it enriches `fixProposal`, never admission, severity, or the gate |

Two further discovery passes — an enumeration sweep and a diverse-lens pass — were
built, measured, and **removed**; their configuration keys no longer exist. See
[extra discovery passes (removed)](extra-discovery-passes.md) for what they were
and what the measurement did and did not establish.

The **discovery posture** was removed as well, and its `review.discoveryPosture`
key with it, after an A/B at 4 seeds per arm failed the rule fixed in advance —
and, notably, moved candidate count the wrong way. See
[discovery posture (removed)](discovery-posture.md), which also records why that
result is **not** a verdict on the idea the posture came from.

**Independent discovery sampling** went the same day, with
`review.discoverySampleCount`. At *k* = 3 recall did not rise significantly while
adjusted precision fell 0.819 → 0.628 at +67% cost — and the run falsified the
premise the feature was built on, measuring the union ceiling at ~4pp rather than
the assumed ~20pp. See [independent sampling (removed)](independent-sampling.md),
including why that ceiling bounds identical-input resampling only.

The **context scout** was removed too, and its `review.contextScout` key with it.
It is the one removal without a failed measurement behind it: its only A/B was run
against a non-conforming build and is **void**, so it went on mechanism instead —
see [context scout (removed)](context-scout.md).

**Change-impact review** (`changeImpact.enabled`) is also off by default, but it
does not belong in the table above: it is a separate command
([`impact check`](../../06-reference/cli.md#codereviewer-impact-check)), not a
capability inside `review`, and it makes no model call at all, so it has no cost
and no recall figure to report. Today it names the symbols a change touched and
where they are referenced. That is deliberately the floor a fuller capability
would have to beat, so it ships as a useful baseline rather than as a lever.

**Invariant-conformance review** (`invariantConformance.enabled`) is the same
kind of thing: a separate command
([`conformance check`](../../06-reference/cli.md#codereviewer-conformance-check)),
off by default, and with no recall figure yet. It reports where a changed
declaration does not hold a pattern a majority of its siblings hold — *"thirteen of
fifteen call `requireAuth`; this one does not"* — with the peers cited by path and
line. A pattern includes **where in a declaration it sits**, so a symbol used on the
way out of one sibling and deep inside a loop in another is not the same thing
twice. That is a **divergence, not a defect**: deviating from a convention is
frequently deliberate, so the command states the fact, asks the question, and
stops.

**A previously published firing rate on this page was wrong and has been
withdrawn.** It read *"0.70 divergences per commit, concentrated in two
schema-heavy modules"*. That number was measured against a span reconstruction
that truncated any declaration with a multi-line signature to its parameter list;
such declarations extracted no traits and were dropped before the detector saw
them. On this repository's own `src/cli/args.ts`, nine of ten exported
declarations were invisible. The concentration in schema-heavy modules was a
symptom: a single-line builder chain was one of the few shapes that survived.

Re-measured on 2026-07-30 after the fix, over 20 consecutive commits of this
repository: **79 changed declarations seen (3.95 per commit) and 0.000 divergences
per commit**, change-attributed and pre-existing alike.

Read that as *"the noise objection was a bug"*, **not** as *"it works"*. The
detector now sees four times as many declarations and reports nothing at all,
which is equally consistent with the gates correctly rejecting mere resemblance
and with the gates being too strict to ever fire. Twenty commits of one repository
cannot separate those, and this repository's style is unusually uniform. It has
still never produced a positive on real code; the open question is now recall
rather than noise.

Its deterministic form makes no model call and costs nothing, and it is the floor
the model layer has to beat. That model layer now exists as a second, separately
disabled switch (`invariantConformance.adjudication.enabled`): one call per
divergence, asking only whether the peers share a deliberate practice, and
reporting only the divergences it answers `convention` for. It can make the report
shorter and never longer, and it has **no measurement yet** — the two arms are
built so they can be compared, not because one has been shown to win.

## How to read the verdicts

| Verdict | Means |
| --- | --- |
| **Net negative** | Measured, repeatedly, and it made the review worse. Re-enabling requires a changed mechanism *and* a multi-seed measurement — not a config change |
| **No measurable gain** | Measured against the run-to-run band and did not clear it. It costs money and buys nothing we can demonstrate |
| **Neutral** | Measured; it neither helped nor hurt. Safe, but pointless today |
| **Mixed** | One metric moved credibly, the metric it was built for did not |
| **Unproven** | Built, not yet measured, or measured at an n that cannot answer the question. **We do not know.** |
| **Unmeasured** | No A/B was ever run. The rationale is design reasoning only |

## If you only want one recommendation

Leave them all off. The default configuration — single-shot, tool-free discovery
with batched refutation and deterministic admission — is the configuration the
project measures best, at roughly 68% recall with 100% adjusted precision on the
16-case real-repository corpus and 54.8% recall with 95.8% adjusted precision on
the harder 30-case / 42-finding corpus.

Turn something on when you have a specific reason and, ideally, when you are
willing to measure it on your own repositories.

## Enabling any of these

All keys live in `.codereviewer/config.json`. Invalid configuration fails
validation with exit code `2`. Every capability's disabled path is byte-for-byte
identical to a build without it, which is what makes the A/Bs above single-variable.

```json
{
  "review": {
    "crossFileRetrieval": { "enabled": false }
  },
  "security": { "dedicatedPass": { "enabled": false } },
  "contextSources": { "enabled": false },
  "verification": { "enabled": false },
  "fix": { "enabled": false },
  "changeImpact": { "enabled": false },
  "invariantConformance": {
    "enabled": false,
    "adjudication": { "enabled": false }
  }
}
```

## Related

- [The two flows](../two-flows.md) — where each capability sits
- [Trust model](../trust-model.md) — why none of these can move a finding
- [Review lifecycle](../review-lifecycle.md)
