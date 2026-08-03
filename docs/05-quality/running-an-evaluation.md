# Running An Evaluation

How to hydrate a corpus, run `eval run`, and read what it produces — including
the gate, which is a selectable profile and whose default deliberately says
nothing about review quality.

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

Every flag `runEval` declares in `src/cli/index.ts`. Anything else is rejected
with exit `2` before the run starts.

| Flag | Value | Effect |
| --- | --- | --- |
| `--config <path>` | path | Load this config file instead of discovery |
| `--slice-root <path>` | repo-relative path | Load **only** slice cases from `<path>/<case-id>/slice.json` with sources under `<path>/<case-id>/repo/`. Omit for default discovery. |
| `--case <case-id>` | exact case id | Filter loaded cases. **Repeatable.** No match at all → usage error, exit `2` |
| `--review-mode <mode>` | `local` \| `ci` \| `pr` \| `full` | Override `review.mode` for this invocation only |
| `--review-depth <depth>` | `fast` \| `balanced` \| `thorough` | Override `review.depth` for this invocation only |
| `--max-concurrent-tasks <n>` | integer 1–32 | Override `review.maxConcurrentTasks` for this invocation only |
| `--gate-profile <profile>` | `stable` \| `strict` | Override `evaluation.regressionGate.profile` for this invocation only |
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
| A per-threshold flag (`--min-recall`, `--max-false-positives`, …) | `--gate-profile` selects a whole threshold set; individual values move through `evaluation.regressionGate.overrides` in config. See below. |
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

## The regression gate

The gate resolves in one place (`resolveEvalRegressionGateThresholds` in
`src/cli/index.ts`): a **profile**, then any **overrides** layered on top.

```
profile (stable | strict)  ←  --gate-profile, or evaluation.regressionGate.profile
        +
overrides                  ←  evaluation.regressionGate.overrides
```

| Threshold | `stable` (default) | `strict` |
| --- | --- | --- |
| `minParseValidity` | `1` | `1` |
| `failOnProviderError` | `true` | `true` |
| `minRecall` | *not gated* | `1` |
| `maxFalsePositiveCount` | *not gated* | `0` |

**`stable` gates only on what cannot vary between seeds.** Parse validity and
provider errors are mechanical: on a given run each is satisfied or it is not.
Recall is a mean over a model-backed run that this project has measured varying
by several percentage points seed-to-seed on its primary corpus, so a default
gate on it would fail depending on which side of the band a run landed — worse
than the old gate, which at least failed for the same reason every time. The raw
`falsePositiveCount` has the same problem from the other end: it counts every
unmatched admitted finding, including real defects the answer key never listed
(measured raw precision as low as 44% on a corpus later judged ~83% precise).
Gating on either by default made a non-zero exit the normal outcome, and a signal
that always fires carries no information.

**`strict` is the bar `stable` replaced** — perfect recall, zero tolerated false
positives — kept as a named opt-in for a maintainer cutting a release who has
verified it holds for their own fixture set:

```bash
codereviewer eval run --gate-profile strict
```

Under `strict`, a 30-case real-repository run on `openai/gpt-5.3-codex` failed
with:

```
recall below threshold: 0.55 < 1
falsePositiveCount above threshold: 8 > 0
```

— on a run whose adjusted precision was 100% and whose genuine false positives
were zero. That is the failure mode the default now avoids.

**Individual thresholds are configuration, not flags.** The
`EvalRegressionThresholds` contract carries more keys than either profile sets
(`minPrecision`, `minProductRecall`, `minSeverityWeightedF1`,
`maxCommentsPerKloc`, `maxCommentsPerDiffHunk`, `maxIncompleteCoverageRate`,
`maxContextMutationRate`, `maxCostUsd`, `maxDurationMs`), and every one of them
is settable through `evaluation.regressionGate.overrides`, which wins over the
resolved profile key by key:

```json
{
  "evaluation": {
    "regressionGate": {
      "profile": "stable",
      "overrides": { "minProductRecall": 0.4 }
    }
  }
}
```

> **A passing gate is still not a quality reading.** `stable` says the run
> executed cleanly, nothing more. Read the metrics in `eval-summary.md` /
> `eval-report.json`, and compare runs with
> [`eval compare`](comparing-runs.md).

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

`generatedAt` is the real wall clock of the run. It was once a committed literal,
which made every report claim the same instant; a test still pins it, so a
fixture report stays byte-reproducible while a production run stamps the time it
actually ran. The run-archive directory name (`YYYYMMDDTHHMMSS-<uuid>`, UTC) is
still the more reliable identifier, because it is unique.

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
| `0` | Gate passed. Under `stable` this is the ordinary outcome: it means every case parsed and no provider call errored |
| `1` | Gate failed. Under `stable` that is a parse failure or a provider error; under `strict`, **expected** on any corpus with expected findings |
| `2` | Usage/config error: unknown flag, unknown flag value, a `--config` path that does not exist, `eval run selected no cases` |
| `3` | Repository/filesystem error |
| `5` | Internal failure, including un-hydrated slices |

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

**Cross-file corpus, all 37 cases:**

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
