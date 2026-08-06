# 5 · Refutation

← [Holistic discovery](04-holistic-discovery.md) · next → [Admission and severity floor](06-admission-and-severity-floor.md)

The precision mechanism. Discovery is allowed to be generous; refutation is the
independent pass that tries to *disprove* each candidate and refuses to let
anything through that the provided context does not actually support.

## What it receives

All candidates produced by discovery except the ones the [semantic finding
merge](04-holistic-discovery.md#semantic-finding-merge) already grouped away — a
candidate that is already terminal must not spend an adjudication slot — plus the
workflow input (review context, diff ranges, evidence, deterministic
support-signal candidates, instructions, skills metadata, shared digest,
provenance).

## What it does

### Only some candidates cost a call

A candidate is sent to the refuter only when it is **model-proposed**
(`proposedBy: 'review-agent'`) **and** inside the reviewed scope — that is, its
file has at least one reviewed diff range. Everything else is decided by
deterministic preflight rules and never reaches the model:

| Candidate | Outcome without a model call |
| --- | --- |
| Support-signal candidate (non-model origin) | Passed to admission; artifact-only unless it is a trusted deterministic rule |
| Model candidate in a file with no reviewed change | Rejected as `not-in-scope` (`needs-more-evidence`) |
| Non-representative member of a semantic merge group | Already rejected as `duplicate` by discovery |
| Any candidate, when no refuter is available | Passed to admission unrefuted (this only happens when the model stages are not running) |

### One batched call per discovery partition

The refutable candidates are grouped by the task id that raised them — and since
discovery partitions a task, each partition carries its own id, so a partitioned
task is adjudicated in one batch **per partition**. Every candidate in a group
shares one review context, so batching sends that context once instead of once
per candidate — the per-candidate packet re-sent the changed file for every
candidate and dominated the run's input tokens.

The refuter must return exactly one verdict entry per candidate, each carrying
the `candidateId` copied verbatim, and is told explicitly to judge each candidate
on its own merits: a weak candidate next to a strong one must still be refuted,
and the number of candidates says nothing about how many are real.

### The call carries no conversation

A refutation call sees its instructions and its own packet, and nothing else. It
does **not** see what discovery answered, what the semantic finding merge decided,
or the verdicts it returned for any other task — every one of those is a separate
call, and no output of one is forwarded into another.

This matters here more than anywhere else in the pipeline. The whole run shares a
single session, so before this was fixed a refutation call arrived carrying every
earlier call's output *as if the refuter itself had said it* — including the
discovery findings for the very candidates it was about to adjudicate, and its own
earlier verdicts. That is incompatible with judging each candidate on its own
merits.

> **Not a measured improvement.** Every recall and precision figure recorded for
> this engine was produced by history-carrying refutation, merge, and scout calls.
> Whether the forwarded conversation helped, hurt, or did nothing is **unknown and
> unmeasured**; it was removed because it contradicts what these stages are
> specified to do.

```mermaid
flowchart TD
  C["candidates"] --> F{"model-proposed AND in a changed file?"}
  F -- no --> P["deterministic preflight outcome"]
  F -- yes --> G["group by discovery partition"]
  G --> B["one batched refutation call per partition"]
  B --> V{"verdict per candidate"}
  V -- "proved" --> A["→ admission"]
  V -- "needs-more-evidence" --> N{"promotionPolicy.modelWeakOrRefuted"}
  V -- "refuted" --> R["rejected (reason: refuted)"]
  V -- "no entry returned" --> N
  N -- "artifact-only (default)" --> AO["→ admission, forced artifact-only"]
  N -- "rejected" --> WR["rejected (reason: weak-evidence)"]
```

### The verdicts

| Verdict | Meaning | Result |
| --- | --- | --- |
| `proved` | The provided context proves the finding *and its impact* | Proceeds to admission |
| `refuted` | The context contradicts the candidate | Rejected, reason `refuted` |
| `needs-more-evidence` | It might exist, but the context is not enough | Per `promotionPolicy.modelWeakOrRefuted` |
| *(missing)* | The model returned no entry for this candidate | Treated exactly like `needs-more-evidence` — never admitted as proved |

The prompt encodes several standing rules that shape precision. The load-bearing
one is the **static-type refutation rule**: a finding that can only occur by
violating a declared type, signature, schema, or documented contract is `refuted`
unless the provided context shows such a caller or input can actually happen.
Others push vague clarity/cleanup/style claims to `refuted`, and pre-existing
general concerns to `needs-more-evidence` unless the changed range itself creates
the concrete failure. Conversely the refuter is told *not* to demand proof of
concurrent requests when the context already shows a non-atomic read-modify-write
on shared mutable state.

Scope is stated the same way as in discovery: a real defect anywhere in a changed
file is in scope, whether introduced on the changed lines or exposed elsewhere in
that file. Only genuinely unrelated concerns in unchanged files are out of scope.

### It was given repository tools once, and they were taken away

Refutation is **tool-free**, beyond the bounded mounted-skill loop. It briefly could
hold the same mediated `repo_read` / `repo_list` / `repo_grep` tools discovery holds,
under `review.refutationRetrieval`, on the reasoning that a candidate whose truth
lives in a file the packet does not contain is unprovable by construction. That
shipped disabled on 2026-08-06, was measured the same day, and was removed: adjusted
precision fell 96.1% → 92.9% with genuine false positives up in every run, in-diff
recall did not move (66.1% against 65.0%, p = 0.7744), and it cost 10% more per run.
The record, the rule it failed and the limits of the measurement are in
[`review.refutationRetrieval` — removed](../../06-reference/configuration/review.md#reviewrefutationretrieval--removed).

### Evidence

Every adjudicated candidate produces a **refutation evidence record**: a
redacted, location-anchored `model-rationale` record holding the refuter's
`rationaleSummary`. For a candidate that proceeds to admission, that evidence id
is attached to the candidate — which is how a model-origin candidate comes to
satisfy admission's "at least one evidence record" rule. When the refuter
supplies a `fixSummary` or scoped `fixEdits`, they are redacted and become the
candidate's fix proposal (`safety: manual-review`).

### Budget handling

If a batch packet exceeds the provider input budget, the packet sheds context in
a fixed order — shared digest, then deterministic support signals, then the
review context — and if it still does not fit, the batch is **split in half and
each half retried**. An oversized task therefore degrades into more calls rather
than losing its candidates. A single candidate that still does not fit is a
genuine packet failure.

### Output-validation retry

A call that fails because the model's response did not validate — the harness's
own output-schema check rejected it, or the provider adapter could not parse a
structured object out of the response at all — gets **exactly one retry** over
the identical packet before the batch degrades. A hard provider failure (auth,
rate limiting, network, an unavailable provider) is *not* retried here, since
that already has its own retry policy at the provider layer; retrying it again
would just double an already-handled backoff. If the retry also fails, the batch
degrades exactly as an unretried failure would.

## What it emits

| Output | Consumed by |
| --- | --- |
| Admission candidates (proved, and weak ones under the default policy) | [Admission](06-admission-and-severity-floor.md) |
| Rejected findings with reason `refuted` / `weak-evidence` / `not-in-scope` | [Reporting](08-reporting.md) — rejections stay auditable |
| Refutation evidence records and `refutationResults` | Admission, report |
| Artifact-only candidate ids | Admission (forces `reporterEligibility: artifact-only`) |
| Provider issues | Report |

## What can go wrong

| Situation | Behaviour |
| --- | --- |
| Provider error during the call | Every candidate in that batch is recorded as `needs-more-evidence` with reason `provider-error`, plus an **unrecovered** provider issue (`recovered: false`) — the run continues rather than failing, but those candidates were never adjudicated, so the quality gate fails on the issue under the default `failOnProviderError` |
| Model's response fails output validation or cannot be parsed as a structured object | Retried once over the identical packet; only if the retry also fails does the batch degrade to the provider-error outcome above |
| Packet cannot be built even after shedding | Batch splits; a single unsplittable candidate becomes a `refutation-packet` provider error |
| Model omits a candidate from its verdict list | That candidate is `needs-more-evidence` — never silently admitted |
| Model invents a `candidateId` | Unmatched entries are discarded |
| Model tries to add findings of its own | The prompt forbids it; only listed candidates are adjudicated, and admission would reject anything without a candidate anyway |

## Configuration keys

| Key | Default | Effect |
| --- | --- | --- |
| `aiReview.requireRefutation` | `true` (literal — cannot be turned off) | Refutation is mandatory whenever the model stages run |
| `promotionPolicy.modelWeakOrRefuted` | `artifact-only` | Disposition of `needs-more-evidence`: keep it in the artifacts but out of the inline review, or drop it entirely (`rejected`) |
| `review.maxConcurrentTasks` | `4` | Refutation batches run with the same bounded concurrency as discovery |
| `provider.maxRetries`, `provider.timeoutMs` | `2`, `120000` | Transient-failure behaviour for the call |
