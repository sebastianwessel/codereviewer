# Optional Capabilities

Every capability here is optional, and all but one are **off by default**. That
is not caution or incompleteness — most of them were built, measured, and left
off *because the measurement said so*. The exception is cross-file retrieval,
which was off on a verdict that turned out to be measuring a bug and is now on.
This page exists so you can decide in thirty seconds whether to turn one on.

The house rule, from [`specs/06-evaluation-and-quality-gates.md`](../../../specs/06-evaluation-and-quality-gates.md):
model-backed evaluation is non-deterministic, so a single run does not establish a
result. On the 16-case real-repository corpus, four seeds of one *identical*
configuration produced recall 81.3%, 87.5%, 81.3%, 75.0% — mean 81.3%, standard
deviation **4.4 percentage points**. A single-seed change must move recall by more
than roughly twice that before it can be distinguished from noise. A headline
figure is the mean across seeds, never the best observed run.

Every recall, precision and cost figure measured *here* — on this page and in the
capability pages it links to — came from `openai/gpt-5.3-codex`. A verdict below
is a verdict for that model; on another one the same capability may trade
differently, and none of these measurements would carry over. The 26–36% and
73–88% rates further down are the exception: they are from published research on
models judging requirement conformance, not from a run of this engine.

## Decision table

| Capability | Config key | Default | What it buys | Cost | Measured verdict |
| --- | --- | --- | --- | --- | --- |
| [Change-intent context](change-intent-context.md) | `contextSources.enabled` | `false` | Orientation: the reviewer learns *why* the change was made, which should reduce misunderstanding-driven false positives | One summarizer call per run (`model` mode); zero with `digest` | **Unmeasured.** No A/B exists. Rationale is design, not evidence. Enable if your pipeline already has PR/ticket text; do not expect a measured recall number |
| [Cross-file retrieval](cross-file-retrieval.md) | `review.crossFileRetrieval.enabled` | **`true`** | Lets discovery read other-file code on demand through mediated tools | Measured *lower* (−8%, −5%) in the two runs that reversed the verdict | **Verdict withdrawn.** The three losing arms were measuring a per-read cut the model was never told about. With the cut disclosed, two independent re-runs led on every measured dimension. No specific gain is claimed: the recall difference is inside noise |
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

**Refutation retrieval** — giving the refutation stage the same mediated repository
tools discovery holds — shipped disabled on 2026-08-06 and was removed the same day,
with its `review.refutationRetrieval` key, after the A/B fired the removal clause of
a rule written before the measurement: adjusted precision fell 96.1% → 92.9% with
more genuine false positives in every run, and recall did not move (p = 0.7744), for
+10% cost. See
[`review.refutationRetrieval` — removed](../../06-reference/configuration/review.md#reviewrefutationretrieval--removed),
including the honest limit that at n=3 that precision difference is not significant
on its own.

The **context scout** was removed too, and its `review.contextScout` key with it.
It is the one removal without a failed measurement behind it: its only A/B was run
against a non-conforming build and is **void**, so it went on mechanism instead —
see [context scout (removed)](context-scout.md).

**Change-impact review** (`changeImpact.enabled`) is also off by default, but it
does not belong in the table above: it is a separate command
([`impact check`](../../06-reference/cli.md#codereviewer-impact-check)), not a
capability inside `review`. It names the symbols a change touched and where they
are referenced — deliberately the floor a fuller capability would have to beat, so
it ships as a useful baseline rather than as a lever — and in that shape it makes
no model call at all, so it has no cost and no recall figure to report.

Its **adjudication layer** (`changeImpact.adjudication.enabled`) is a second
switch, also off by default, and is the only part of the command that can spend.
It decides, per dependent, whether that file relies on the part of the contract
that changed; most of that is settled in code, and only a symbol whose *behaviour*
moved costs a call. **It is unmeasured** — no accuracy figure for it exists, and
none may be quoted.

**Intent-fulfilment review** (`intentFulfilment.enabled`) is a separate command
too ([`intent check`](../../06-reference/cli.md#codereviewer-intent-check)), off
by default, with no recall figure yet. It reads the change's stated intent
through the same [change-intent ingestion](change-intent-context.md) `review`
uses, turns it into discrete obligations each citing the line of the ticket it
came from, and says for each one either which changed lines address it or that
nothing does. Unlike the two commands above it **does** spend: one extraction
call, one judgement call per obligation, one explanation call.

It can never gate, and that is a requirement rather than a default. Published
measurement of models judging requirement conformance reports spurious rejection
at **26–36%**, rising to **73–88%** when the same call is also asked to explain
its judgement — so the judgement call here returns a status and cited lines with
**no free-text field at all**, and the explanation is a separate call over an
already-frozen mapping. The one output it must never produce is a confident
"satisfied" that is not, because that stops a human looking; an `addressed`
verdict whose cited lines are not lines the change touched is downgraded and
counted.

**Review conversation** (`reviewConversation.enabled`) is not a capability
inside `review` either — it is read only by the
[GitHub integration](../../04-guides/github-integration.md)'s entry point, and
turns on a `pull_request_review_comment` trigger: a reply to one of the
engine's own finding comments re-runs the exact same `review` stage a push
already runs, unchanged, and reports whether the finding came back. See
[review-conversation.md](../../06-reference/configuration/review-conversation.md)
and [spec 30](../../../specs/30-review-conversation.md). **Ships disabled.**
The measurement spec 30 requires — that the hold rate under a
plausible-but-wrong pushback reply is indistinguishable from the no-reply
baseline — has not been run.

**Invariant-conformance review** was removed on 2026-08-02, and its
`invariantConformance` key with it. It reported where a changed declaration did
not hold a pattern a majority of its siblings hold, with the peers cited. Its own
step-1 measurement, run for the first time that day, put the firing rate at **7.0
reports per PR-sized range against a pre-registered kill criterion of ≈0.5** with
**zero true positives across roughly 300 hand-judged divergences from five
codebases**. See
[invariant-conformance review (removed)](invariant-conformance.md), including why
a previously published *0.000 per commit* figure on this page was withdrawn.

## How to read the verdicts

| Verdict | Means |
| --- | --- |
| **Net negative** | Measured, repeatedly, and it made the review worse. Re-enabling requires a changed mechanism *and* a multi-seed measurement — not a config change |
| **Verdict withdrawn** | A recorded verdict was found to be measuring something other than the capability, and no longer stands. What replaces it is stated on the capability's own page |
| **No measurable gain** | Measured against the run-to-run band and did not clear it. It costs money and buys nothing we can demonstrate |
| **Neutral** | Measured; it neither helped nor hurt. Safe, but pointless today |
| **Mixed** | One metric moved credibly, the metric it was built for did not |
| **Unproven** | Built, not yet measured, or measured at an n that cannot answer the question. **We do not know.** |
| **Unmeasured** | No A/B was ever run. The rationale is design reasoning only |

## If you only want one recommendation

Change nothing. The shipped defaults — discovery partitioned at two changed files
per call, holding the mediated repo tools, with batched refutation and
deterministic admission — are the configuration the project measures. The figures
below it earned, roughly 68% recall with 100% adjusted precision on the 16-case
real-repository corpus and 54.8% recall with 95.8% adjusted precision on the
harder 30-case / 42-finding corpus, were measured before partitioning and
cross-file retrieval became defaults and are not a reading of today's
configuration; the current one is on
[Current results](../../05-quality/current-results.md).

Turn something on when you have a specific reason and, ideally, when you are
willing to measure it on your own repositories.

## Enabling any of these

All keys live in `.codereviewer/config.json`. Invalid configuration fails
validation with exit code `2`. Every capability's disabled path is byte-for-byte
identical to a build without it, which is what makes the A/Bs above
single-variable. Every key below is shown at its default, so this block is a
no-op — flip the one you want:

```json
{
  "review": {
    "crossFileRetrieval": { "enabled": true }
  },
  "security": { "dedicatedPass": { "enabled": false } },
  "contextSources": { "enabled": false },
  "verification": { "enabled": false },
  "fix": { "enabled": false },
  "changeImpact": { "enabled": false }
}
```

## Related

- [The two flows](../two-flows.md) — where each capability sits
- [Trust model](../trust-model.md) — why none of these can move a finding
- [Review lifecycle](../review-lifecycle.md)
