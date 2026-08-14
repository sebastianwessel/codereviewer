# Controlling Cost

A review's bill is `(number of provider calls) × (bytes per call)`. Both are
things you configure. This guide shows how each knob moves them.

Input tokens dominate: every call carries the changed source, the diff and the
review context, while the response is a short JSON object.

The call arithmetic on this page is structural and holds for any model. The
dollar figures published elsewhere in these docs are not: they were measured on
`openai/gpt-5.3-codex`, and both the per-token price and the tokens a model
spends change with the model, so a per-run bill does not carry across a model
change even when the call count does.

---

## How many provider calls a run makes

The unit is the **discovery partition** — `aiReview.maxFilesPerDiscoveryCall`
changed files of one review task, default `2` — not the task, not the file and
not the finding. A task at or below that width is a single partition.

| Stage | Calls | Condition |
| --- | --- | --- |
| Holistic discovery | 1 per partition | Always (with a provider configured) |
| Dedicated security pass | 1 per partition | `security.dedicatedPass.enabled` |
| Semantic finding merge | 1 per file that has ≥ 2 candidates | Always — and today that is almost never, because discovery averages about one candidate per file |
| **Refutation** | **1 per partition** | Always, whenever the partition produced candidates |
| Change-intent summarizer | 1 per run, and **0 when the providers gathered nothing** | `contextSources.enabled` (on by default) and the summary mode resolves to `model` — which it does whenever a model `provider` is configured, since `contextSources.summary.mode` is unset by default |
| Verification lane | 1 bounded agent loop per claim (≤ `verification.maxToolCallsPerClaim` tool calls) | `verification.enabled` |
| Fix lane | 1 bounded agent loop per eligible admitted finding | `fix.enabled` |
| Change-impact lane (run in-process by `review`) | 0 | `changeImpact.enabled` — the lane's own core is deterministic and calls no provider; only its second switch, `changeImpact.adjudication.enabled` (default `false`), spends |
| Intent-fulfilment lane (run in-process by `review`) | 1 extraction call, 1 judgement call per obligation, 1 explanation call per run | `intentFulfilment.enabled` **and** a change-intent source resolved something (see the change-intent summarizer row above) |

### Two lanes now run inside every default `review`, and one of them is not free

Since 2026-08-11, `contextSources.enabled`, `changeImpact.enabled` and
`intentFulfilment.enabled` are all **on by default** — `review` runs the impact
and intent lanes itself, in the same process, over the context it already
assembled for the review, and writes their reports (`impact-report.json`,
`intent-report.json`) into the run directory without any config change.

`changeImpact` costs nothing in this shape: its default core is deterministic.
`intentFulfilment` is not free once it has something to work with. It needs a
change-intent source, and `contextSources`' own default providers — an `inbox`
directory and a `changed-files` provider matching `**/*.md` — mean an ordinary
pull request that touches a README or a doc file can now supply one without any
configuration at all. When that happens, the extraction/judgement/explanation
calls under "What is free" below stop being free, on a run where nothing was
explicitly turned on.

**There is no measured per-PR cost figure for this combined default
configuration.** The dollar figures elsewhere in these docs were measured before
this flip; do not extend them to cover it, and do not estimate a replacement
number — none has been produced.

### Refutation is batched — one call per partition, not per candidate

A single refutation call adjudicates **every candidate of a partition at once**
and returns one verdict per candidate. The review context — the changed file — is
therefore sent once, not once per candidate.

A batch that does not fit the provider input budget, even after the packet
sheds its optional context, is split in half and each half retried. Splitting
is bounded and rare: an oversized batch degrades into a few more calls rather
than losing its candidates. Budget for it as `1 + a small allowance` per
partition.

### The semantic merge only fires when it has something to merge

The merge asks which of a file's candidates describe the same defect, so a file
with fewer than two candidates issues no call at all. That is the common case
today, which makes the stage close to free; it starts costing real calls only
when discovery produces several candidates for one file.

So the baseline cost of the review itself — discovery and refutation, before
either advisory lane is counted — is:

```
partitions ≈ Σ ceil(changedFilesInTask / aiReview.maxFilesPerDiscoveryCall)
calls      ≈ 2 × partitions   (one discovery + one refutation each)
```

Each optional pass you enable adds `1 × partitions` to the discovery side. The
security pass is the only one that remains, and enabling it takes a partition
from 2 calls to 3. This formula does **not** include the change-intent
summarizer or the intent-fulfilment lane described above — both are on by
default now, and add calls on top of this baseline whenever they have
something to work with.

Partitioning is where the calls go, and it is deliberate — it is the only
measured lever on recall. A task of eight changed files is four partitions at the
default, so eight calls rather than two.

---

## How many tasks a run makes

Tasks come from planning over the changed files:

| `review.depth` | Planning |
| --- | --- |
| `fast` | One task per changed file |
| `balanced`, `thorough` | Files connected by imports are clustered into one task, at most 8 paths per task; unconnected files are packed together up to the same limit |

A 40-file change is therefore ~40 tasks at `fast` and typically far fewer at
`balanced`. `fast` is not the cheap setting by call count — it is the setting
with the least context per call.

The blunt lever on task count is scope:

```json
{
  "paths": {
    "include": ["src/**/*"],
    "exclude": [".git/**", "node_modules/**", "dist/**", "coverage/**", ".codereviewer/**", "**/*.min.js", "**/*.map", "**/*.snap", "**/package-lock.json", "generated/**"]
  },
  "review": { "maxFiles": 200 }
}
```

Excluding generated, vendored and data-only files is the highest-leverage cost
change available, because those files carry no reviewable logic and still cost
full input tokens.

---

## How many bytes each call carries

| Setting | Effect on packet size |
| --- | --- |
| `review.depth` | Sizes cross-file retrieval only. It no longer bounds the review packet: the change is sent whole and split only if the provider refuses it. |
| `review.contextMaxBytes` | Lowers the packet ceiling and the cross-file per-read cap. Leave unset so the provider decides packet size. |
| `review.maxFileBytes` | Files above this are skipped entirely (default 500 000). |
| `aiReview.deterministicSignalMode: "disabled"` | Stops injecting deterministic support facts into the packet. Planning still uses them. |
| `instructions.files` / `instructions.inline` | Added to **every** task packet, discovery and refutation alike. |
| `contextSources.summary.maxBytes` | Caps the change-intent brief (default 4 000 bytes). |
| `review.crossFileRetrieval.maxBytesPerRead` | **Unset by default — no proactive cut.** Setting it caps each retrieved file. It used to default to 24 000 bytes, which cut files mid-read without telling the model and caused three separate measurements to record cross-file retrieval as harmful when what they were measuring was the cap. Set it only as a deliberate operator choice; the cut is disclosed when it binds. |

A single model-input packet is hard-capped at 8 MB regardless of depth — a runaway
guard far beyond any current model, not a cost lever. Note the cost direction here:
proactive splitting used to charge an **extra** discovery-plus-refutation pair per
split, so sending the change whole is generally cheaper as well as better.

---

## Set a budget tripwire

```json
{ "review": { "maxCostUsd": 2.5 } }
```

This is checked **after** the review completes. Exceeding it fails the run with
`cost_budget_exceeded` (exit code `1`) and still writes the partial artifacts,
so you keep the evidence of what was spent. It does not stop a run in flight.

Wall-clock is deliberately **not** boundable. A whole-run deadline destroys work
already done, and it bounds the wrong thing: what costs money is calls, not
minutes. Use `review.maxFiles`, a narrower ref range, or a cheaper model. A single
network call is bounded by `provider.timeoutMs` so nothing hangs forever.

`review.maxConcurrentTasks` (default 4, range 1–32) changes throughput and peak
rate-limit pressure. It does not change the number of calls or the total cost.

---

## Make cost visible

Every run summary reports token counts and, when a price is known, a dollar
figure. The price is resolved in this order:

1. A cost reported by the provider response, if there is one.
2. `costs.inputPerMillion` / `costs.cachedInputPerMillion` /
   `costs.outputPerMillion` from your configuration (or the matching
   `CODEREVIEWER_COST_*` environment variables).
3. A built-in price snapshot, which currently covers OpenAI models only.

If none of these yields a price, the run emits a `cost-unavailable` warning
rather than reporting a fabricated zero.

```json
{
  "costs": {
    "inputPerMillion": 0.25,
    "cachedInputPerMillion": 0.025,
    "outputPerMillion": 2.0
  }
}
```

Cached input tokens are a **subset** of input tokens. When
`cachedInputPerMillion` is set, that subset is re-priced at the lower rate;
when it is not set, cached input falls back to the full input price so no
discount is invented.

Refresh the built-in snapshot:

```bash
npm run update:model-pricing
```

Write the refreshed prices into the snapshot file:

```bash
npm run update:model-pricing:write
```

---

## A cost-reduction checklist

1. **Exclude non-reviewable files.** Generated code, locale bundles, fixtures,
   vendored directories. Biggest win, no quality cost.
2. **Turn off passes you have not measured a benefit from.** Every optional
   discovery pass multiplies the discovery side of the bill.
3. **Do not reach for `review.depth`.** It no longer bounds the review packet at
   all — it sizes the cross-file retrieval budget, and at `fast` it switches
   planning to one task per file, which *raises* the call count. It is not a cost
   lever in either direction.
4. **Set `aiReview.deterministicSignalMode: "disabled"`** if support facts are
   not earning their bytes for your codebase.
5. **Trim instructions.** They ride along on every single call.
6. **Keep the scope to the branch's own work** — always pass `--base-ref` so
   the diff is against the merge base, not a stale branch point.
7. **Set `review.maxCostUsd`** so a runaway change fails loudly instead of
   quietly. It is also the only bound on the advisory stages below: they spend
   the headroom the review leaves, and a stage with none does not start.
8. **Turn off `intentFulfilment.enabled`** (on by default) if you do not read
   its output, since it is the one default-on capability that can add real
   provider spend — an extraction call, a judgement call per obligation, and an
   explanation call — whenever `contextSources` (also on by default) hands it a
   change-intent source to work with.

---

## What is free

These paths make no provider call at all:

- `config validate`
- `drift check` (also run as a preflight step inside `review`)
- `baseline write`
- `impact check`, and the equivalent lane `review` now runs in-process by
  default, while `changeImpact.adjudication.enabled` is false (the default), or
  when no provider resolves — it still reports every dependent it can settle
  deterministically, and counts the rest as unadjudicated
- `intent check`, and the equivalent lane `review` now runs in-process by
  default, while `intentFulfilment.enabled` is false, or when no change-intent
  source resolves — it reports the reason as a warning and still exits `0`
- `eval compare`, `eval recall-report`, `eval slice-manifest`
- Corpus and benchmark hydration (git fetches only)
- Any `review` run with no `provider` configured
- The change-intent summarizer in `digest` mode
- `npm test` — the default suite is hermetic and never calls a real provider

`intent check` — and, since `intentFulfilment.enabled` is on by default, the
same lane running in-process inside an ordinary `review` — spends real money once
a change-intent source resolves: one extraction call, one judgement call per
obligation, and one explanation call per run. The obligation count is set by the
stated intent rather than by a configured cap, so a small ticket cannot become
expensive by raising a limit.

`eval run` **is** costly: it runs a full review per case plus the semantic and
plausibility judge calls. See [adding-evaluation-cases.md](../09-contributing/adding-evaluation-cases.md).
