# Controlling Cost

A review's bill is `(number of provider calls) × (bytes per call)`. Both are
things you configure. This guide shows how each knob moves them.

Input tokens dominate: every call carries the changed source, the diff and the
review context, while the response is a short JSON object.

---

## How many provider calls a run makes

The unit is the **review task**, not the file and not the finding.

| Stage | Calls | Condition |
| --- | --- | --- |
| Holistic discovery | 1 per task | Always (with a provider configured) |
| Dedicated security pass | 1 per task | `security.dedicatedPass.enabled` |
| Semantic finding merge | 1 per file that has ≥ 2 candidates | Always — and today that is almost never, because discovery averages about one candidate per file |
| **Refutation** | **1 per task** | Always, whenever the task produced candidates |
| Change-intent summarizer | 1 per run | `contextSources.enabled` and the summary mode resolves to `model` |
| Verification lane | 1 bounded agent loop per claim (≤ `verification.maxToolCallsPerClaim` tool calls) | `verification.enabled` |
| Fix lane | 1 bounded agent loop per eligible admitted finding | `fix.enabled` |

### Refutation is batched — one call per task, not per candidate

A single refutation call adjudicates **every candidate of a task at once** and
returns one verdict per candidate. The task's review context — the changed
file — is therefore sent once, not once per candidate.

A batch that does not fit the provider input budget, even after the packet
sheds its optional context, is split in half and each half retried. Splitting
is bounded and rare: an oversized task degrades into a few more calls rather
than losing its candidates. Budget for it as `1 + a small allowance` per task.

### The semantic merge only fires when it has something to merge

The merge asks which of a file's candidates describe the same defect, so a file
with fewer than two candidates issues no call at all. That is the common case
today, which makes the stage close to free; it starts costing real calls only
when discovery produces several candidates for one file.

So the baseline cost of a default run is:

```
calls ≈ 2 × taskCount   (one discovery + one refutation per task)
```

Each optional pass you enable adds `1 × taskCount` to the discovery side. The
security pass is the only one that remains, and enabling it takes a task from 2
calls to 3.

The larger multiplier is `aiReview.maxFilesPerDiscoveryCall` (default 2): a task
covering more files than that is split across several calls, each with its own
refutation. That is deliberate — it is the only measured lever on recall — but it
is also where the calls go.

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
| `review.crossFileRetrieval.maxBytesPerRead` | Caps each retrieved file (default 24 000). |

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
3. **Drop `review.depth` to `balanced`** if you are on `thorough`. Halves the
   per-task context cap.
4. **Set `aiReview.deterministicSignalMode: "disabled"`** if support facts are
   not earning their bytes for your codebase.
5. **Trim instructions.** They ride along on every single call.
6. **Keep the scope to the branch's own work** — always pass `--base-ref` so
   the diff is against the merge base, not a stale branch point.
7. **Set `review.maxCostUsd`** so a runaway change fails loudly instead of
   quietly.

---

## What is free

These paths make no provider call at all:

- `config validate`
- `drift check` (also run as a preflight step inside `review`)
- `baseline write`
- `eval compare`, `eval recall-report`, `eval slice-manifest`
- Corpus and benchmark hydration (git fetches only)
- Any `review` run with no `provider` configured
- The change-intent summarizer in `digest` mode
- `npm test` — the default suite is hermetic and never calls a real provider

`eval run` **is** costly: it runs a full review per case plus the semantic and
plausibility judge calls. See [adding-evaluation-cases.md](../09-contributing/adding-evaluation-cases.md).
