# 26: Reactive Task Splitting

Status: **Approved** (human, 2026-07-31)
Date: 2026-07-31

## Purpose

Stop guessing where the model's limit is. **Send the task whole, and split only when
the provider says it was too large.**

## Why

Stage 1 used to split a change when its bytes exceeded a configured budget
(60/120/240 KB by depth). That was wrong three ways at once:

- **The values were a guess**, sized against a cost fear rather than a constraint.
- **Bytes are a poor proxy for tokens**, so the guess erred by a content-dependent
  factor even where the value looked reasonable.
- **It fired constantly.** Over this repository's last 60 commits, changed bytes
  exceeded the default budget on **37%** of them — while 240 KB is roughly 60k
  tokens against context windows of 200k to over 1M.

And splitting is not free. This project measured whole-file holistic review as
**out-recalling** the chunked alternative, and every split costs an extra task — a
full discovery call plus its refutation. So the budget routinely bought a worse
review at a higher price.

## Design

1. Assemble the task **whole**; no byte-budget splitting.
2. Send it. If the provider accepts, the review is the whole-file one.
3. On an oversized-context failure, **halve the task and retry each half**,
   recursing until the pieces are accepted.
4. A unit that cannot be split further and is still refused **fails loudly**, in the
   same refusal shape `packet-budget.ts` uses — never truncated.

The provider's limit is the only authority. No value has to be chosen correctly.

## Detection Is The Harness's Normalised Reason

`@purista/harness` raises `ModelError` with a normalised `reason`, one value of
which is `context_length_exceeded`. That is a first-class part of its error contract,
not something this project infers.

**This MUST be the detection mechanism.** Splitting MUST NOT be triggered by provider
message text, status codes, or any provider-specific shape: those differ per vendor,
change without notice, and would reintroduce a guess in the one place this design
removes one. An adapter that fails to map its overflow onto `context_length_exceeded`
has a defect, and it MUST be fixed there rather than worked around here.

The failure then stays loud, specific, and attributable to that adapter — strictly
better than the alternative, which is a silently degraded review.

## Requirements

- Task assembly MUST NOT split on a byte budget. A change is one task unless the
  provider refuses it.
- An oversized-context failure MUST cause a split and retry, and MUST NOT fail the
  run while a split is still possible.
- Splitting MUST be bounded on recursion **depth**, never on a byte size. A unit that
  cannot be split further and is still refused MUST fail loudly and actionably.
- The split count MUST be reported, and MUST be distinguishable from transient retry:
  the two have different causes and different meanings.
- A half MUST be shown only the diff hunks that fall inside its own chunk. Selecting
  the diff by path alone gave every half the whole file's diff — the split then
  halved the source and not the diff, and each half was told about changes at lines
  it was not given, which invites a finding outside the chunk that admission rejects
  as out of range. A task that was not split spans its whole file and is unaffected.
  The rule binds on whichever form the change section takes: when no hunk falls
  inside a half's chunk the section falls back to the reviewed line ranges in prose,
  and those MUST be clipped by the same chunk bounds — a half told in prose about a
  change it cannot see is the same defect written a different way. Testable without a
  provider: build the packet for a half whose chunk holds no changed line and assert
  the change section names none.
- Split halves MUST keep their absolute line origins. A finding's reported line must
  be the file's real line — the fingerprint anchors on it, so a wrong line silently
  gives the finding a wrong identity. This was a fixed defect once already.
- The hard packet ceiling MUST remain a refusal, never a truncation, and MUST sit far
  beyond any model context (**8 MB**, roughly 2M tokens). It is a runaway guard
  against serializing a pathological packet, not a limit on how much review may be
  sent. Sized anywhere near a real context window it would refuse before the provider
  was ever asked, making a guessed local value the authority again.
- An explicitly configured `review.contextMaxBytes` MUST still bind — it is a
  deliberate operator choice — and MUST refuse loudly when it does.

## Cost

A refused oversized request is rejected before generation, so its waste is an
input-validation round trip rather than a completed call. Against that, every
unnecessary split today costs a whole extra task. Reactive splitting is therefore
expected to be **cheaper** on the 63% of changes that never needed splitting.
**Expected, not measured.**

## Measurement Plan

Paired, on the **21 crb-benchmark cases the change actually touches**, run against
**pinned engines** so the arms cannot differ by more than the arm.

The corpus choice is measured, not assumed. A free static precheck (recorded in the
results ledger) found that on the 37-case real-repository corpus the two arms are
byte-identical on **34 of 37 cases** — the old chunk threshold at `thorough` depth
was 108,000 B and almost nothing there reached it. An effect confined to 3 cases
cannot be resolved against a measured ±4.8pp band. On the crb benchmark 21 of 59
cases are affected, matching the 37% measured over this repository's own commits;
restricting the run to those 21 removes 38 cases that are identical between arms by
construction and can therefore only dilute a paired comparison while costing full
price.

| arm | |
|---|---|
| **0** | proactive byte-budget splitting |
| **1** | reactive splitting |

Pre-registered, before any run:

- Recall movement inside **±4.8pp** is not a result; the band is measured.
- **Adjusted precision MUST NOT fall.**
- Report **split count** and **cost** per arm. If cost rises materially, the trade
  must be argued, not assumed.
- A recall gain is the *expected* direction, because this replaces a worse review
  mode with a better one. That expectation is a prediction and MUST NOT be reported
  as a result.
