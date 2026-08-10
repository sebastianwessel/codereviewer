# `reviewConversation`

Configuration for the GitHub-integration review-conversation lane
([spec 30](../../../specs/30-review-conversation.md)). It is not read by
`review`, `intent check`, or `impact check` — it is read only by
[`scripts/github/main.ts`](../../../scripts/github/main.ts), the entry point
the [GitHub integration](../../04-guides/github-integration.md) runs.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `reviewConversation.enabled` | boolean | `false` | Master switch. With `false`, a reply to a review comment does nothing: the workflow step still runs (see below) but exits immediately without spawning the CLI or writing to the pull request. |

```json
{
  "reviewConversation": { "enabled": true }
}
```

## What it turns on

A reply to one of this engine's own inline finding comments nominates that
finding for a second, independent look. The workflow gains a
`pull_request_review_comment` (`created`) trigger; on that event, once this key
is `true` and the reply is confirmed to target a finding this engine reported,
the entry point runs the **exact same** `review` stage a push already runs —
same command, same config, same prompt — against the current head. There is no
separate re-adjudication code path and no way to configure one: spec 30
requirement 2 forbids giving the re-check "a distinct prompt, a softer
threshold, or any knowledge that a human objected", so the only way to satisfy
that is to not build a second path at all.

The outcome is added to the same summary comment the push-triggered run
writes, under its own **Review conversation** section, naming each nominated
finding and stating plainly whether it held, is no longer reported, or is
still an open question refutation could not settle. It never says "fixed" or
"withdrawn" — this comparison cannot tell a genuine repair from a finding this
run simply did not reproduce, the same limit `noLongerReportedSection`
states elsewhere in the same comment.

## What crosses the boundary, and what does not

The reply's own text, its author, and its existence beyond the run are never
read, logged, or stored: what triggers the re-check is the numeric id of the
comment being replied to, and what nominates a finding is the fingerprint
marker already sitting on the engine's own EARLIER comment (`extractFindingMarkers`,
also used for inline-comment deduplication) — never anything the reply itself
says. See [the threat model](../../../specs/30-review-conversation.md#the-threat-model-which-is-the-whole-design)
for why a reply is treated as more dangerous than the pull-request description
change-intent brief already is.

## What it does not have

There is deliberately **no `blocking` key**, and there will not be one. Spec 30
requirement 6 states the lane "MUST be non-blocking and MUST NOT be
configurable to block": a review-conversation-triggered run always exits `0`,
whatever the re-checked finding's quality-gate status would otherwise be — the
finding did not fail the original push's gate either, since it is the exact
same evidence re-examined.

There is also no per-run reply cap. The bound spec 30 requirement 5 asks for is
the workflow's existing `concurrency` group with `cancel-in-progress: true`
(one run in flight per pull request, a later trigger cancels an earlier one) —
already in place for the push-triggered path, and it applies unchanged to a
burst of replies.

## Measurement

**Ships disabled.** Spec 30's "Measurement, before promotion" section requires
the hold rate under a plausible-but-wrong pushback reply to be indistinguishable
from the no-reply baseline, on the advisory corpus's proven-true findings,
before this may default on. No such measurement has been run yet.

## Related

- [Spec 30 — Review Conversation](../../../specs/30-review-conversation.md)
- [GitHub integration guide](../../04-guides/github-integration.md)
- [Change-impact review](./change-impact.md) and
  [Intent-fulfilment review](./intent-fulfilment.md) — the other two
  off-by-default, measurement-gated capabilities this key follows the shape of
