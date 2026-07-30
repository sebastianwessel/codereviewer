# 26: Reactive Task Splitting

Status: **Approved** (human, 2026-08-01)
Date: 2026-08-01

## Purpose

Stop guessing where the model's limit is. **Send the whole task, and split only when
the provider actually says it was too large.**

## The Problem With Guessing

Stage 1 currently splits a change across tasks when its bytes exceed a configured
budget. Three things are wrong with that, and they compound:

1. **The budget is a guess.** 60 KB / 120 KB / 240 KB by depth, with no measurement
   behind the values. Today's audit found the same pattern in four other limits, all
   sized against a cost fear rather than a constraint.
2. **Bytes are a poor proxy for tokens.** The ratio varies with language, comment
   density and identifier length, so the guess is wrong by a content-dependent
   factor even if the value were well chosen.
3. **It fires far more often than the real limit would.** Measured over this
   repository's last 60 commits, total changed bytes exceed the **default** budget
   on **37%** of them — while 240 KB is roughly 60k tokens against context windows
   of 200k to over 1M. The overwhelming majority of those splits were unnecessary.

And the split is not free: this project measured whole-file holistic review as
**out-recalling** the chunked alternative. So a guessed budget routinely substitutes
a measurably worse review for a better one.

## The Design

1. **Assemble the task whole.** No byte-budget splitting at assembly time.
2. **Send it.** If the provider accepts it, the review is the whole-file holistic
   one this project measured as better.
3. **On an oversized-context failure, split the task in half and retry each half.**
   Recurse until the pieces are accepted.
4. **A single indivisible unit that still overflows fails loudly**, with the same
   refusal shape `packet-budget.ts` already uses — not silently truncated.

The provider's own limit is the only authority. Nothing needs to know it in advance,
and no value has to be chosen correctly.

## Why This Is Available: The Harness Already Normalises It

The signal is **provider-agnostic and already exists**. `@purista/harness` raises
`ModelError` carrying a normalised reason, and one of its values is exactly this
case:

```
reason?: 'http_error' | 'network' | 'rate_limited' | 'provider_unavailable'
       | 'unstructured_response' | 'malformed_response'
       | 'context_length_exceeded' | ...
```

`context_length_exceeded` is the whole design's dependency, and it is a first-class
part of the harness's error contract rather than something this project would have
to infer.

**This MUST be the detection mechanism.** Splitting MUST NOT be triggered by
matching provider message text, status codes, or any provider-specific shape: those
differ per vendor, change without notice, and would reintroduce a guess in the one
place this design exists to remove one. If a provider adapter fails to map its
overflow error onto `context_length_exceeded`, the defect belongs in that adapter
and MUST be fixed there rather than worked around here.

The retry policy already classifies this reason as non-retryable — correctly, since
resending an identical packet fails identically. That classification is precisely
the signal this design needs: today it is used to give up, and would instead be used
to split.

## Requirements

- Task assembly MUST NOT split on a byte budget. A change is one task unless the
  provider refuses it.
- An oversized-context failure MUST cause a split and retry, and MUST NOT fail the
  run while a split is still possible.
- Splitting MUST be bounded, and the bound MUST be on recursion depth rather than a
  byte size. A unit that cannot be split further and is still refused MUST fail
  loudly with an actionable message.
- The number of splits performed MUST be reported. A run that split is doing
  something measurably different from one that did not, and today nothing says so.
- Retry on oversized context MUST be distinguishable from transient retry in
  observability: the two have different causes and different meanings.
- The existing hard packet ceiling MUST remain a refusal, never a truncation.

## What This Does Not Change

The chunk arithmetic itself. When a split does happen, chunks keep their absolute
line origins exactly as now — that property is what makes a finding's reported line
the file's real line, and it was a fixed defect once already.

## Cost

A refused oversized request is rejected before generation, so the wasted spend is an
input-validation round trip rather than a completed call. Against that: every
unnecessary split today costs a **whole extra task** — a full discovery call plus its
refutation — so reactive splitting is expected to be *cheaper* on the 63% of changes
that never needed splitting at all. **Expected, not measured**; the measurement plan
below settles it.

## Measurement Plan

Against the recorded baseline — 46.0% recall, 95.2% adjusted precision, ~$1.35 — on
the 37-case real-repository corpus, paired, using the existing harness.

| arm | |
|---|---|
| **0** | current proactive byte-budget splitting |
| **1** | reactive splitting |

Pre-registered, before any run:

- Recall movement inside **±4.8pp** is not a result; the band is measured.
- **Adjusted precision MUST NOT fall.**
- Report **split count** and **cost** per arm. Reactive splitting is expected to
  reduce both; if cost rises materially the trade must be argued, not assumed.
- A recall gain here is the *expected* direction, because it replaces a worse review
  mode with a better one on changes that never needed splitting. That expectation is
  a prediction and MUST NOT be reported as a result.

## Amendment: The Hard Packet Ceiling Had To Be Re-Sized

Implementation surfaced a conflict this spec did not anticipate. The requirement
"the existing hard packet ceiling MUST remain a refusal" was written about its
BEHAVIOUR, but the ceiling's VALUE (360 KB) was chosen back when assembly pre-split
everything below it. Once assembly stops splitting, a 360 KB local ceiling refuses
before the provider is ever asked — so a guessed local value would be the authority
again, which is precisely what this spec exists to remove.

The ceiling therefore keeps its behaviour and loses its ration. It is now
**8 MB** — roughly 2M tokens against context windows of 200k to over 1M — which
makes it a runaway guard on serializing a pathological packet into memory, not a
limit on how much review may be sent. It still REFUSES rather than truncates.

An explicitly configured `review.contextMaxBytes` still binds, because that is a
deliberate operator choice rather than a default nobody selected. When it binds, the
run stops loudly with an actionable message.

## Risk

An earlier draft named the main risk as a provider reporting overflow in a shape the
harness cannot classify. That risk is **much smaller than drafted**, because
`context_length_exceeded` is a normalised value in the harness's own error contract
rather than something inferred here — see above.

What remains is narrower: a provider ADAPTER that fails to map its overflow onto
that reason. The failure is then loud and specific (the run stops with a classified
model error) rather than silent, and the fix belongs in the adapter. That is
strictly better than today's failure mode, which is a silently degraded review, and
it is the trade this design makes deliberately.
