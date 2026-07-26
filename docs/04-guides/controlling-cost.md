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
| Context scout | 1 per task | `review.contextScout.enabled` |
| Enumeration sweep | up to `maxAdditionalRounds` per task | `review.discoverySweep.maxAdditionalRounds > 0`; rounds stop early once one adds nothing |
| Diverse-lens pass | 1 per task | `review.discoveryLensPass.enabled` |
| Dedicated security pass | 1 per task | `security.dedicatedPass.enabled` |
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

So the baseline cost of a default run is:

```
calls ≈ 2 × taskCount   (one discovery + one refutation per task)
```

Each optional pass you enable adds `1 × taskCount` (or `rounds × taskCount` for
the sweep) to the discovery side. Enabling the scout, the lens pass, one sweep
round and the security pass together takes a task from 2 calls to 6 — a 3×
increase before any change in packet size.

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
| `review.depth` | Per-task provider context cap: `fast` 60 000 bytes, `balanced` 120 000, `thorough` 240 000. Per-run context budget: 100 000 / 200 000 / 500 000 bytes. |
| `review.contextMaxBytes` | Overrides the per-run context budget; still clamped by the per-depth provider cap. |
| `review.maxFileBytes` | Files above this are skipped entirely (default 500 000). |
| `aiReview.deterministicSignalMode: "disabled"` | Stops injecting deterministic support facts into the packet. Planning still uses them. |
| `instructions.files` / `instructions.inline` | Added to **every** task packet, discovery and refutation alike. |
| `contextSources.summary.maxBytes` | Caps the change-intent brief (default 4 000 bytes). |
| `review.contextScout.maxBytesPerSymbol` | Caps each injected symbol body (default 4 000). |
| `review.crossFileRetrieval.maxBytesPerRead` | Caps each retrieved file (default 24 000). |

A single model-input packet is hard-capped at 360 000 bytes regardless of
depth.

---

## Set a budget tripwire

```json
{ "review": { "maxCostUsd": 2.5 } }
```

This is checked **after** the review completes. Exceeding it fails the run with
`cost_budget_exceeded` (exit code `1`) and still writes the partial artifacts,
so you keep the evidence of what was spent. It does not stop a run in flight.

To bound wall-clock instead:

```json
{ "review": { "runTimeoutMs": 900000 } }
```

A timeout aborts the run, writes partial artifacts and exits `4` with
`review_run_timeout`.

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
