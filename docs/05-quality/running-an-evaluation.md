# Running An Evaluation

How to hydrate a corpus, run `eval run`, and read what it produces — including
the one behaviour that surprises everybody: the gate is hard-coded to demand
perfection and will fail.

---

## Prerequisites

- **A configured provider.** Both judges are constructed from the resolved
  provider alias. Without a provider, a case that declares expected findings
  fails the run with `eval_semantic_judge_missing` — the matcher never falls back
  to a heuristic. Only fully negative case sets score offline.
- **`.env` is not loaded by the CLI.** `eval run` deliberately does not read the
  repository `.env`, so programmatic eval calls stay reproducible. The npm
  scripts opt in via Node's `--env-file-if-exists=.env`. If you invoke the CLI
  directly, export the provider credentials yourself.

---

## Hydration

Two corpora ship as metadata and must be materialized before they can be scored.
Neither hydration script makes a model call, so neither costs provider spend.

### Code Review Bench-style pack

```bash
npm run eval:hydrate
```

Directly, with all supported flags:

```bash
node --import tsx scripts/hydrate-code-review-benchmark.ts \
  --source-slice-root eval/benchmarks/code-review-bench-style \
  --output-slice-root .codereviewer/eval/benchmark-slices/code-review-bench-style \
  --case crb-grafana-02-authzservice-improve-authz-caching \
  --force --quiet
```

| Flag | Default | Effect |
| --- | --- | --- |
| `--source-slice-root` | `eval/benchmarks/code-review-bench-style` | Committed metadata pack to read |
| `--output-slice-root` | `.codereviewer/eval/benchmark-slices/code-review-bench-style` | Hydrated root to write |
| `--case` | all | Hydrate only this case id; repeatable |
| `--force` | off | Re-hydrate even when a cached case looks current |
| `--quiet` | off | Suppress progress and the JSON result on stdout |

It fetches the public PR/commit unified diffs and materializes head-side files
into the output root. **Network access required.**

### Real-repository cross-file corpus

No npm script; run the script directly:

```bash
node --import tsx scripts/hydrate-real-repo-corpus.ts
```

| Flag | Default | Effect |
| --- | --- | --- |
| `--manifest` | `eval/corpora/real-repo-cross-file/manifest.json` | Manifest to read |
| `--output-slice-root` | `.codereviewer/eval/corpus-slices/real-repo-cross-file` | Checkout root to write |
| `--case` | all | Hydrate only this case id; repeatable |
| `--force` | off | Rebuild even an integral checkout |
| `--quiet` | off | Suppress progress and the JSON result on stdout |

It performs **git fetches only**, depth-limited to each pinned commit. It reports
`hydrated / repaired / reused / pruned` counts. Pruning removes checkouts whose
case the manifest no longer defines — it is **skipped when `--case` filters are
in effect**, because unselected cases are legitimately absent from that run.

Hydration fails a case rather than proceeding when the manifest violates the
temporal cutoff, the license allowlist, or answer-key exclusion (including
answer-key wording found in the **generated diff**).

---

## `eval run`

```bash
codereviewer eval run [flags]
```

### Flags that are actually parsed

This is the complete list, from `runEval` in `src/cli/index.ts`.

| Flag | Value | Effect |
| --- | --- | --- |
| `--config <path>` | path | Load this config file instead of discovery |
| `--slice-root <path>` | repo-relative path | Load **only** slice cases from `<path>/<case-id>/slice.json` with sources under `<path>/<case-id>/repo/`. Omit for default discovery. |
| `--case <case-id>` | exact case id | Filter loaded cases. **Repeatable.** No match at all → usage error, exit `2` |
| `--review-mode <mode>` | `local` \| `ci` \| `pr` \| `full` | Override `review.mode` for this invocation only |
| `--review-depth <depth>` | `fast` \| `balanced` \| `thorough` | Override `review.depth` for this invocation only |
| `--max-concurrent-tasks <n>` | integer 1–32 | Override `review.maxConcurrentTasks` for this invocation only |
| `--log-level <level>` | log level | Override logging level |
| `--debug` | — | Shorthand for `--log-level debug` |
| `--log-file <path>` | path | Write logs to a file instead of the default sink |

The three review overrides merge **above** file and environment config, for this
invocation only. They exist so benchmark comparisons are reproducible — in
particular so the PR path can be forced to PR mode, thorough depth and serial
provider calls without editing repository config.

### Flags that do **not** exist

| Not a flag | Reality |
| --- | --- |
| Any threshold flag (`--min-recall`, `--max-false-positives`, …) | **Thresholds are hard-coded.** See below. |
| `--semantic-judge`, `--judge-findings` | Semantic scoring is not a mode. Both judges are constructed whenever a provider is configured. |
| A seed or temperature flag | Judge sampling pins temperature to `0` where the alias supports it; the review itself uses the configured alias defaults. |
| A model flag | The model comes from provider config. |

`--max-concurrent-tasks` bounds concurrency **within** one review, not across
cases: `eval run` starts every selected case concurrently. On a large corpus that
is a lot of simultaneous provider traffic; passing `--max-concurrent-tasks 1`
(as the benchmark scripts do) reduces transient timeout noise but does not
serialize the cases themselves.

### Order of operations

1. Parse flags, load config (never `.env`), build the logger.
2. Load cases — `sample-eval-cases.json` + `eval/fixtures/slices/` when no
   `--slice-root`, otherwise only the given slice root. Apply `--case` filters.
   Empty selection → usage error, exit `2`.
3. **Hydration guard.** Any positive slice still carrying the
   `Minimal source exists` placeholder aborts the run with
   *"Benchmark slices are not hydrated"*, rather than silently scoring 0% recall.
4. Resolve the provider alias; construct the semantic and plausibility judges.
5. Run every selected case (real reviews).
6. Score: deterministic gates → semantic judge → plausibility judge on unmatched
   findings.
7. Calibrate both judges against their committed sets.
8. Assemble the report, evaluate the gate, write artifacts, print the summary.

---

## The hard-coded gate

`eval run` builds its regression thresholds inline. They are **not configurable,
not read from config, and not settable by any flag**:

```ts
thresholds: {
  minParseValidity: 1,
  minRecall: 1,
  maxFalsePositiveCount: 0,
  failOnProviderError: true
}
```

Read literally: **100% recall on every expected finding, and zero raw false
positives.** Note that the false-positive threshold is checked against the *raw*
`falsePositiveCount`, so every real-but-unlisted defect the reviewer correctly
found counts against it too.

**Consequence:** essentially any provider-backed run against a corpus with
expected findings fails the gate and exits `1`. A recent 30-case
real-repository run failed with:

```
recall below threshold: 0.55 < 1
falsePositiveCount above threshold: 8 > 0
```

— on a run whose adjusted precision was 100% and whose genuine false positives
were zero.

> **Do not use `eval run`'s exit code as a quality signal.** Read the metrics in
> `eval-summary.md` / `eval-report.json`, and compare runs with
> [`eval compare`](comparing-runs.md). The gate is only meaningful on a fully
> negative fixture set, where it degenerates to "no findings, no provider errors".

The wider `EvalRegressionThresholds` contract supports many more keys
(`minPrecision`, `minProductRecall`, `maxCommentsPerKloc`, `maxCostUsd`, …) and
`runEvaluation` honours whatever it is given — but the CLI never passes them.
Programmatic callers of `runEvaluation` can set them; CLI users cannot.

---

## Artifacts

Written under `.codereviewer/eval/`:

| Artifact | Contents |
| --- | --- |
| `eval-report.json` | The structured source of truth: selection, scoring metadata, per-case results, aggregate metrics, metric groups, gate result |
| `eval-summary.md` | Human-readable gate status, headline metrics, per-case status, missed expected findings, false positives, warnings, cost, duration. Also printed to stdout |
| `eval-recall-report.md` | Per-expected-finding recall table for this run |

Every run writes the **same three artifacts twice**: once at the top level as a
latest-run convenience copy, and once under
`.codereviewer/eval/runs/<run-id>/`, so a later smoke run cannot overwrite the
only copy of an expensive benchmark report. The run id is
`YYYYMMDDTHHMMSS-<uuid>` in UTC.

Keep the archived path — [`eval compare`](comparing-runs.md) takes two report
paths, and the top-level copy is overwritten by the next run.

> **Gotcha: `generatedAt` is a constant.** The CLI passes a fixed
> `2026-06-20T00:00:02.000Z` into every report, so `generatedAt` cannot be used
> to order or identify runs. Use the run-archive directory name instead.

### Reading `eval-summary.md`

The `## Selection` table is the provenance block — check it first:

| Field | Why it matters |
| --- | --- |
| Fixture source / Slice root | Which corpus produced these numbers |
| Selected cases | The exact case set, in execution order |
| Judge agreement | Semantic-judge agreement and pairs scored |
| Judge trustworthy | `no` ⇒ the quality metrics are not evidence |
| Plausibility judge agreement | Plausibility agreement and pairs scored |
| Adjusted precision trustworthy | `no` ⇒ do not quote `adjustedPrecision` |

Then `## Headline`: product recall, all-tier recall, unlisted real findings,
adjusted precision, genuine false positives, duplicates, severity accuracy,
provider error rate, cost.

---

## Exit codes

| Code | When |
| --- | --- |
| `0` | Gate passed (in practice: a fully negative corpus with no provider errors) |
| `1` | Gate failed — **expected** on any corpus with expected findings |
| `2` | Usage/config error: unknown flag value, missing `--config` path, `eval run selected no cases` |
| `3` | Repository/filesystem error |

Un-hydrated slices surface as an internal error from `runEval`'s catch, with the
message naming the offending case ids and pointing at `npm run eval:hydrate`.

---

## Recipes

**Cheap smoke test — noise suppression only, no recall signal:**

```bash
codereviewer eval run
```

The default pack declares no expected findings, so no match judgment is made.
It still runs seven real reviews, and if a provider is configured it still
calibrates both judges (23 extra calls) — cheap, not free.

**Full benchmark, PR posture (hydrates first):**

```bash
npm run eval:benchmark
```

The real-repository corpus — the one the headline recall baseline is measured on
— has its own script:

```bash
npm run eval:corpus
```

Hydration alone costs no provider spend, so a corpus can be refreshed or repaired
without running a review:

```bash
npm run eval:corpus:hydrate
```

**Same, with a sanitized debug log:**

```bash
npm run eval:benchmark:debug
```

**Cross-file corpus, all 30 cases:**

```bash
node --import tsx scripts/hydrate-real-repo-corpus.ts --quiet
node --env-file-if-exists=.env --import tsx src/cli/main.ts eval run \
  --slice-root .codereviewer/eval/corpus-slices/real-repo-cross-file \
  --review-mode pr --review-depth thorough --max-concurrent-tasks 1
```

**One case, debugging:**

```bash
node --env-file-if-exists=.env --import tsx src/cli/main.ts eval run \
  --slice-root eval/fixtures/proof-quality-slices \
  --case semantic-authz-cross-file \
  --debug --log-file .codereviewer/eval/one-case.log
```

**Trustworthy recall, no hydration, no network:**

```bash
codereviewer eval run --slice-root eval/fixtures/proof-quality-slices
```

---

## Before you quote a number

- [ ] `scoring.judgeTrustworthy` is `true`
- [ ] `scoring.adjustedPrecisionTrustworthy` is `true` (if quoting adjusted precision)
- [ ] `providerErrorRate` is `0` and `providerIssueRate` is low
- [ ] `inconclusiveMatchCount` is `0` — otherwise fewer pairs were scored than the corpus declares
- [ ] The corpus can actually support the metric (see [Datasets](datasets.md))
- [ ] The figure is a **mean across seeds**, not one run
      ([why](comparing-runs.md#the-variance-band))

---

## See also

- [Comparing runs](comparing-runs.md) — `eval compare`, `eval recall-report`, `eval slice-manifest`.
- [Datasets](datasets.md) — what to point `--slice-root` at.
- [Metrics](metrics.md) — what the summary's numbers mean.
- [Reference: CLI](../06-reference/cli.md)
