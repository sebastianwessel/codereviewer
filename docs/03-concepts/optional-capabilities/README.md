# Optional Capabilities

Every capability here is optional, and since 2026-08-11 the split is roughly even
rather than "most are off". **On by default:** cross-file retrieval, citations,
change-intent context, change-impact review, intent-fulfilment review, and inline
review comments. **Off by default:** the dedicated security pass, verification,
the fix lane, signal facts, impact adjudication, skills, analyzer signals, and the
review conversation.

**What a default means here is not one thing, and the difference matters more
than the flag.**

- Some are off *because a measurement said so* — signal facts, impact
  adjudication. Those do not move for product reasons.
- Some are off because they have **never been measured at all**: verification, the
  fix lane, skills, analyzer signals, and the review conversation. For those, off
  is containment of cost and non-determinism, and nothing has been established
  about what turning them on would do — in either direction.
- Four were turned **on** on 2026-08-11 as a **product decision, not an accuracy
  claim**: change-intent context, change-impact, intent-fulfilment, and review
  comments. They are what the reviewer is for — why the change was made, what it
  might break, whether it did what it set out to do, and a note on the line. None
  of the four was measured as a quality lever, and change-intent context in
  particular feeds discovery's packet, so it can move recall in either direction
  and **nobody has measured which**.

Two of those are worth naming, because the reason they are unmeasured is
structural rather than a missing decision. **Verification cannot be reached from
`eval run` at all** — it lives on the `review` command's lane, so no corpus can
score it as it stands. And **the review conversation's config key is consumed by
`scripts/github/`, not by the engine**, so it is outside the eval by construction.
The fix lane is the opposite case: its eval scoring is wired and deliberate, and
has simply never been switched on with a corpus behind it.

The Evidence column below says which row is which. Read it before you read the
flag.

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
| [Change-intent context](change-intent-context.md) | `contextSources.enabled` | **`true`** | Orientation: the reviewer learns *why* the change was made, which should reduce misunderstanding-driven false positives | One summarizer call per run (`model` mode); zero with `digest`, and zero when the default providers find nothing | **Unmeasured.** No A/B exists. Rationale is design, not evidence. **ON BY DEFAULT since 2026-08-11 as a product decision** — it is the input the intent lane and the reviewer's orientation both depend on — and that flip makes no recall claim whatsoever. It changes what discovery is shown, so it can move recall either way; the A/B that would settle it is owed. The separately measured intent-*framing* prompt clause was REJECTED, which is a reason for humility here rather than confidence |
| [Cross-file retrieval](cross-file-retrieval.md) | `review.crossFileRetrieval.enabled` | **`true`** | Lets discovery read other-file code on demand through mediated tools | Measured *lower* (−8%, −5%) in the two runs that reversed the verdict | **Verdict withdrawn.** The three losing arms were measuring a per-read cut the model was never told about. With the cut disclosed, two independent re-runs led on every measured dimension. No specific gain is claimed: the recall difference is inside noise |
| [Dedicated security pass](dedicated-security-pass.md) | `security.dedicatedPass.enabled` | `false` | A second, security-only discovery call per task (generic OWASP/CWE checklist), merged additively | +61% | **Mixed.** 2026-07-24, full benchmark, n=1: overall recall 24.8% → 29.3%, +22 unlisted-real findings (trustworthy, large denominator). But labeled security recall 14 → 12 and authorization 8 → 6. The **security-specific lift it was built for is unproven** |
| [Verification](verification-and-fix.md) | `verification.enabled` | `false` | Investigates external/prior claims against the real code and returns verdicts; corroborates findings | Bounded agent run per claim | **Never measured, and structurally unmeasurable as it stands.** `runVerificationForReview` lives on the `review` command's lane and `eval run` never calls it, so no corpus can score this today. It is a distinct product feature, not a recall knob; its outputs never touch the gate |
| [Fix lane](verification-and-fix.md#the-fix-lane) | `fix.enabled` | `false` | Real-file-grounded `real`/`false-positive` judgment plus an apply-checked fix per admitted finding | One bounded agent run per eligible finding | **Never measured on a real corpus**, though the eval DOES wire it (`eval-case-runner.ts` runs it per case, gated on this flag). The only outcomes on disk are two 2026-07-23 smoke runs of one judged finding each — one agreeing with ground truth, one disagreeing — against fixtures that no longer exist. Advisory: it enriches `fixProposal`, never admission, severity, or the gate |
| Signal facts context | `review.signalFacts.enabled` | `false` | Shows discovery the deterministic signal facts already extracted every run — previously rendered only into refutation's context, never discovery's | +10.1% input tokens, +34% cost | **No measurable gain.** Measured 2026-08-10 on the security-advisory corpus (72 cases, not comparable to the real-repository figures elsewhere on this site): recall 64.9% → 61.7%, pooled sign test 3 gained / 3 lost, p = 1.0000. Adjusted precision rose (96.7% → 100.0%) but that alone does not clear the promotion bar. Not promoted, stays disabled. See `reports/2026-08-10-signal-facts-result.md` |
| Citations | `review.citations.enabled` | **`true`** | Asks discovery to cite the source line grounding each finding; a citation is deterministically verified before being added as evidence, and a bad one costs nothing | No extra call — folded into the existing discovery response | **Neutral.** Measured 2026-08-10 on the security-advisory corpus (72 cases, not comparable to the real-repository figures elsewhere on this site): recall 63.1% → 62.2%, pooled sign test 3 gained / 7 lost, p = 0.3438; adjusted precision rose 98.6% → 99.3%. Neither move clears the promotion bar. **The mechanism did engage** — findings carrying evidence went 0% → 90%, from a channel that had been structurally empty — but that engagement did not move recall or precision far enough to promote. Not promoted ON ACCURACY, and it is nonetheless ON BY DEFAULT since 2026-08-11 — a separate product judgement about comment quality, made as one: a reader gets the source line a finding rests on instead of the verifier's prose, at +5.6% input tokens and no measured precision harm. The accuracy verdict above is unchanged and no recall claim is made from it. See `reports/2026-08-10-citations-result.md` |

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

**Change-impact review** (`changeImpact.enabled`) is **on by default since
2026-08-11**, but it does not belong in the table above: it is its own lane with
its own report, reachable both as
[`impact check`](../../06-reference/cli.md#codereviewer-impact-check) and as a
stage `review` runs in-process. It names the symbols a change touched and where
they are referenced — deliberately the floor a fuller capability would have to
beat, so it ships as a useful baseline rather than as a lever — and in that shape
it makes no model call at all, so it has no cost and no recall figure to report.
Being deterministic and free is why defaulting it on needed no measurement: there
is no accuracy claim to make about it, and its output is a separate deliverable
rather than an input to the review.

Its **adjudication layer** (`changeImpact.adjudication.enabled`) is a second
switch, and it stays **off** — the parent flipping on did not carry it — because
it is the only part of the lane that can spend.
It decides, per dependent, whether that file relies on the part of the contract
that changed; most of that is settled in code, and only a symbol whose *behaviour*
moved costs a call. **It is unmeasured** — no accuracy figure for it exists, and
none may be quoted.

**Intent-fulfilment review** (`intentFulfilment.enabled`) is its own lane too
([`intent check`](../../06-reference/cli.md#codereviewer-intent-check), and a
stage `review` runs in-process), **on by default since 2026-08-11**, with no
recall figure — and none is owed, because it answers a different question from
the review and is scored separately. It reads the change's stated intent
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

**Inline review comments** (`reporting.reviewComments.enabled`) are **on by
default since 2026-08-11**, and they are a renderer rather than a lever: they
write `review-comments.json` and its per-platform rendering into the run
directory, publish nothing, and cannot change a finding, a severity or the gate.
There is no accuracy claim attached and none is possible.

One thing about them did change behaviour, and it is worth thirty seconds. A
` ```suggestion ` block carries a one-click **Apply**, and its edits come from the
refuter. Since 2026-08-11 the engine re-applies those edits to the file's current
bytes before offering the block, and drops the suggestion — keeping the prose —
when they no longer fit. The check is deterministic and model-free, so it costs a
file read; it may mean you see fewer suggestions than before, which is the point.
The [fix lane](verification-and-fix.md#the-fix-lane) is now a quality upgrade on
top of that, not a prerequisite for the suggestion being safe to click.

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

The 2026-08-11 flips sharpen that caveat rather than softening it: **no published
figure on this site was measured with change-intent context on**, and that flip
is the one of the four that can move a recall number. Read every rate here as a
rate for the configuration it names.

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
    "crossFileRetrieval": { "enabled": true },
    "citations": { "enabled": true },
    "signalFacts": { "enabled": false }
  },
  "security": { "dedicatedPass": { "enabled": false } },
  "contextSources": { "enabled": true },
  "verification": { "enabled": false },
  "fix": { "enabled": false },
  "changeImpact": { "enabled": true, "adjudication": { "enabled": false } },
  "intentFulfilment": { "enabled": true },
  "reporting": { "reviewComments": { "enabled": true } },
  "reviewConversation": { "enabled": false }
}
```

## Related

- [The two flows](../two-flows.md) — where each capability sits
- [Trust model](../trust-model.md) — why none of these can move a finding
- [Review lifecycle](../review-lifecycle.md)
