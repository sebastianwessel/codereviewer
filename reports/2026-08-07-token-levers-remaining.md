# Token and latency levers that are measured but not taken

Recorded 2026-08-07, after shipping the output-neutral half of the same audit.

Fourteen findings were provably output-neutral — not one byte the model receives
changes, and no model call observes mutable state in a different order — and
shipped without measurement. The ten below are not. Each changes what the model
sees, or where it sees it, and this project has already measured that prompt
changes move recall unpredictably. They are recorded here with their magnitudes so
the next person does not re-derive them, and so nobody ships one on the strength of
the number alone.

Every byte figure was measured by driving the engine's own assembly path offline
over real files. None is an estimate. Token figures marked *est.* are bytes/4 —
no tokenizer is installed, and three of the decisions below turn on the 1024-token
cache-eligibility floor, so installing one is a prerequisite for those three.

## The resolution limit that governs all of them

The two instruments available are the cross-file corpus at **sd ≈ 4.8pp** and the
security-advisory corpus at **sd 7.69pp over three seeds**. Neither can resolve a
difference below roughly **10 and 16 percentage points** respectively.

(An earlier draft of this report quoted the security corpus at sd 3.85pp. That
figure came from a seed later re-run for provenance reasons, and the clean re-run
doubled the measured variance. The correction makes the argument below stronger, not
weaker.)

That matters more for these than for a recall lever. A token reduction's *benefit*
is certain and measurable to the byte; its *cost* is a possible quality regression
that the instrument can only bound at 10-16 points. So an A/B here does not clear a
change — it rules out a large harm and leaves a small one unmeasurable. Whether
that trade is acceptable is a product decision, not a measurement one, and it
should be made deliberately rather than inherited from a green run.

## The levers

| # | Lever | Measured magnitude | What it would take to decide |
| --- | --- | --- | --- |
| §15 | The deterministic-facts blob is **20.1–20.8% of every refutation packet** and reaches no other stage. `buildContextSections` has no branch for `support-signal-output`; the refutation packet forwards everything except `change-intent`. Two independent filters disagreeing — this repo's "silent optimism" shape. | 20% of every refutation packet | The largest single win available. Refutation runs on every candidate, so this is the one worth the A/B. Measure adjusted precision, not recall: removing evidence from a refuter shows up as things it can no longer disprove. |
| §16 | The eval plausibility judge puts up to **64 KB of file body last**, behind per-finding fields and a list that mutates between calls, so it almost certainly caches nothing and re-sends the file once per finding. | a large share of the ~22% judge spend | **Do not treat as a free reorder.** This judge is the measurement instrument behind every recall number here. Changing its prompt changes the instrument, so it must be re-validated against hand-adjudicated cases before, not after. |
| §17 | The security pass sends **35,337 B of byte-identical context twice** (+109%) and ~786 est. tokens of static text that can never enter a cached prefix. | +109% on that pass | Only active with `security.dedicatedPass` on, which is off by default and measured net-negative. Low value until that changes. |
| §18 | Refutation's `reviewContext` is not filtered by candidate path, while its own no-task branch does filter. | task-shape dependent | Same caution as §15: it removes evidence the refuter may use. |
| §19 | Change-impact pair order is file-major, defeating the symbol-first cache prefix its own module comment documents. | ~8 shared tokens today | Documented and worth fixing for honesty, but the lane is ~556 est. tokens — below the 1024-token floor, so it currently buys nothing. Reordering is also output-affecting because the 40-call budget truncates. Fix the comment or the code, but do not claim a saving. |
| §20 | Intent judgement re-sends the whole change surface per obligation. | ~38 B/line scaffolding × up to 100 calls | |
| §21 | A full line-number gutter on every `repo_read`, re-sent every agent step. | ~1.9k est. tok/read × up to 12 steps | Riskiest on the list: citing correct line numbers is exactly what this gutter buys, and line placement is a published figure. |
| §22 | Verification claims are investigated strictly sequentially, ~13 round-trips each. | largest single latency item found | Latency only; no byte changes. Parallelising changes provider-call order and therefore cache-warm order. |
| §23 | A 4 MB default read budget permits up to four complete paid agent runs per claim. | worst case 4× per claim | Changes how much of a file the model reads. |
| §24 | Eval scoring is fully serial while eval review is unbounded-parallel. | 37 serial chains vs 37 parallel | Output-neutral *in principle*, but a judge call is a model call and the order changes. Affects measurement cost, not product cost. |

## Two things the audit ruled out, recorded so they are not re-investigated

- **No pretty-printed JSON reaches any prompt**, and JSON escape inflation is only
  **+2.3%** measured.
- **No UUID, timestamp or run id reaches any packet anywhere.** The 2026 `runId`
  regression that silently disabled prompt caching has not crept back.

## One refused fix, since resolved and worse than reported

The packet budget measured `serializedBytes` over the whole `TaskReviewInput` while
discovery sends only a subset. The audit reported it 19.5% over. Driving the real
assembly path offline put the ratio between **0.71x and 3.08x** — it also
*under*-measured, so a runaway guard could admit the packet it exists to refuse.

Fixed 2026-08-07: `holisticReviewInputFor` defines the sent shape once and both the
call and the guard use it. The shed-the-shared-digest step is gone, because a
sentinel digest appeared in 0 of 21 discovery packets — it was correcting arithmetic,
not a packet. Specs 04 and 05 were corrected with it.
