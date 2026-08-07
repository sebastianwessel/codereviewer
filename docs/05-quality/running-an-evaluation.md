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

Four corpora ship as metadata and must be materialized before they can be scored.
No hydration script makes a model call, so none of them costs provider spend.

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

### Security-advisory corpus

The same script and the same manifest shape as the cross-file corpus above,
pointed at different metadata:

```bash
node --import tsx scripts/hydrate-real-repo-corpus.ts \
  --manifest eval/corpora/security-advisory-2026/manifest.json \
  --output-slice-root .codereviewer/eval/security-cases/security-advisory-2026
```

25 cases, each a security defect confirmed by a reviewed GitHub Security Advisory
published after the training cutoff, covering all ten security mechanisms and all
seven supported languages. Score it with `eval run --slice-root` exactly like the
cross-file corpus — it is the same command, because it is the same kind of
question asked about different material.

**Its output root is deliberately not a sibling of the cross-file corpus's.** The
two answer different questions and must never be pooled; a shared parent directory
is one `--slice-root` typo away from doing exactly that.

It is the only corpus here with a **verified chronological split** — every fix is
post-cutoff, dev is every fix before 2026-06-01 and held-out every fix on or after.
Once an A/B has been decided on the dev half, only the held-out half may back an
acceptance claim. Its per-mechanism denominators are one to four findings each, so
a per-mechanism rate from it is a direction and not a number: publish it with its
counts or not at all.

### Change-impact dependents corpus

```bash
npm run eval:impact-corpus:hydrate
```

Git fetches only — no model call, no spend. It checks out each case at the commit
that **introduced** the breakage and verifies, against the real checkout, that the
declared parent is the upstream parent, that the diff touches nothing undeclared,
and that every expected dependent exists with the lines the answer key points at.

There is deliberately **no combined hydrate-and-run npm script** for this corpus.
Its scorer is a separate command with a separate option set, because the diff
reviewer's corpus and this one answer different questions and must never be
pooled.

---

## `eval impact`

Scores the change-impact dependents corpus (`specs/22` §Evaluation). It is a
**different command from `eval run` on purpose**: it does not accept
`--slice-root`, its cases are `case.json` under a `--case-root`, and its artefact
carries a `reportKind` no eval report can parse as. A `--slice-root` typo exits `2`
rather than silently pooling two corpora.

```bash
codereviewer eval impact [flags]
```

| Flag | Default | Effect |
| --- | --- | --- |
| `--config <path>` | discovery | Load this config file instead of discovery |
| `--manifest <path>` | `eval/corpora/change-impact-dependents/manifest.json` | Answer key to score against |
| `--case-root <path>` | `.codereviewer/eval/change-impact-cases/change-impact-dependents` | Hydrated checkouts to run over |
| `--case <case-id>` | all | Filter cases. **Repeatable.** An unknown id fails the run |
| `--adjudication <on\|off>` | `on` | `off` scores the deterministic reference arm alone: no provider call, no spend |
| `--max-adjudication-calls <n>` | `changeImpact.adjudication.maxCalls` (40) | Model-call cap **per case**. See below — when it binds, arm 2 becomes partly unreadable |
| `--log-level`, `--debug`, `--log-file` | — | As `eval run` |

Both change-impact switches are forced on for the run. The capability is disabled
by default until measured, and a run with either off would score an engine that
analysed nothing — which the scorer would then have to render as unmeasured, so the
run would cost time and tell you nothing.

### What it reports

Three arms, always together:

1. **Reference** — every destination file dependent discovery enumerates. This is
   the baseline `specs/22`'s removal criterion is stated against ("Remove if it
   cannot beat naming the changed symbols and letting the human grep").
2. **Adjudicated** — the files adjudication actually reports. `specs/22` expects
   this arm to *lose* recall against arm 1; a run that loses none has almost
   certainly adjudicated nothing.
3. **The difference, split by tier** — what adjudication removed, how many of
   those removals dropped a proven dependent (provably wrong), and how many are of
   unknown correctness. There is no "correct removals" count and there cannot be
   one.

Recall is reported **per reachability class and per contamination split, never
pooled**, and there is deliberately no blended recall figure to quote. Precision is
a bracket whose upper bound is permanently *not measurable on this corpus*.

### Did the judge actually run?

Adjudication is two tiers — a deterministic one that settles structural cases in
code, and a model called only on the residue — so "adjudication removed this file"
is ambiguous until you know which tier removed it. The report answers that
directly:

| Field | What it tells you |
| --- | --- |
| `coverage.adjudicationCallCount` | Model calls the whole run spent |
| `coverage.noAdjudicationCallCaseCount` | Adjudicated cases in which the model was **never called** |
| `coverage.modelVerdictCounts` | `relies` / `does-not-rely` / `undetermined`, as the model returned them |
| `coverage.deterministicNoImpactPairCount` | Dependents settled in code, with no call |
| per case, `adjudicationCallCount` | The same question for one case; the per-case table prints *none — judge never ran* rather than `0` |

**Arm 3 is split on that count and publishes no combined total.** Cases that spent
no model call are reported as `deterministicTierOnly` and cases that spent at least
one as `modelInvolved`; when the second group is empty the document says outright
that nothing in the arm is evidence about the model. A degenerate verdict
distribution — everything `does-not-rely`, or no verdicts at all — is the cheapest
bug signature this capability has, which is why it is on the page.

### Absence is never zero

Five situations render as *not measured* rather than as a score:

| Situation | Reported as |
| --- | --- |
| No hydrated checkout under `--case-root` | `not-hydrated` |
| The checkout's commits or answer key disagree with the manifest | `stale-checkout` |
| The engine threw on a case | `engine-error` |
| The engine reported `status: "disabled"` | `capability-disabled` |
| Adjudication was requested but no model lane resolved | arm 2 not measured; arm 1 still measured |

A `0.0%` cell in this report means the engine looked and missed, and only that.

### The adjudication call cap, and why it can make arm 2 unreadable

`changeImpact.adjudication.maxCalls` bounds **model** calls **per case** (default
40). When it binds — or when a call fails, or the model cannot decide — the run
leaves pairs unadjudicated, and `specs/22` is explicit that *absence from
`impactFindings` is not a statement that a dependent is unaffected*.

So the scorer treats a partially adjudicated case asymmetrically:

- a dependent that **is** reported counts as found — a hit is never ambiguous;
- a dependent that is **not** reported is **undetermined**, not a miss;
- the case contributes nothing to arm 3, because "removed" cannot be told from
  "never checked".

`coverage.unadjudicatedPairCount` and `adjudicationCallsTruncatedCaseCount` are
reported for exactly this reason. If they are non-zero, raise
`--max-adjudication-calls` and re-run rather than reading arm 2 as a low number.

The opposite reading matters just as much: a case can be *fully* adjudicated and
still have spent **zero** calls, because the deterministic tier settled every
dependent on its own. Check `noAdjudicationCallCaseCount` before reading arm 3 as
anything the model did.

### Artefacts and exit codes

Written under `.codereviewer/eval/change-impact/`, and again under
`.codereviewer/eval/change-impact/runs/<run-id>/`:

| Artefact | Contents |
| --- | --- |
| `change-impact-eval-report.json` | Structured source of truth: coverage, the three arms, the decision-rule denominator, per-case results, provenance |
| `change-impact-eval-summary.md` | The rendered document; also printed to stdout |

Provenance names the **engine commit, whether its working tree was clean, and the
provider and model** — a rate is a property of a build and a model, not of a
corpus.

| Code | When |
| --- | --- |
| `0` | At least one case scored |
| `1` | Nothing could be scored — an un-hydrated corpus must never look like a completed measurement |
| `2` | Usage/config error, including `--slice-root` and an unknown `--case` id |

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

— on a run whose precision bracket topped out at 100% and whose genuine false
positives were zero. That is the failure mode the default now avoids.

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

### When the gate cannot decide

`regressionGate.outcome` is `passed`, `failed`, or `not-evaluable` — not a
boolean. The third value exists for one situation, and only `maxCostUsd` and
`maxDurationMs` can produce it.

Both thresholds are compared against totals that sum **only the cases whose
cost/duration was actually measured**. A case whose provider call failed
contributes nothing, so with any such case the total is a *floor*. A floor at or
below the threshold does not show the run stayed under budget — the true total
could be on either side. The gate says so instead of guessing:

```
Gate: NOT EVALUABLE

## Gate Thresholds Not Evaluable

- costUsd not evaluable against threshold 5: 0.1 is a known-only total,
  unmeasured for 1 case(s), so the run's true total may be on either side
  of the threshold
```

Exit code `4` — the same code the CLI uses elsewhere for refusing to judge an
input it could not see whole. Not `1`, because a provider outage is an
infrastructure problem and must not be reported as a quality failure.

A floor that is **already over** the threshold still fails normally: unknown
spend can only add to a total, so that breach is decided. And any other failing
threshold still reports `failed`; an unevaluable threshold is recorded beside it
but never softens the verdict.

You will not see this unless you set `maxCostUsd` or `maxDurationMs` through
`evaluation.regressionGate.overrides` — neither is part of `stable` or `strict`.

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
| Adjusted precision trustworthy | `no` ⇒ the precision bracket's upper bound is not reliable |
| Plausibility judged | `no` ⇒ the bracket's upper bound reads *not measured*, not a number |

Then `## Headline`: product recall, all-tier recall, unlisted real findings, the
**precision bracket** (raw lower bound to adjusted upper bound — never one bound
alone), genuine false positives, duplicates, severity accuracy, provider error
rate, cost.

---

## Exit codes

| Code | When |
| --- | --- |
| `0` | Gate passed. Under `stable` this is the ordinary outcome: it means every case parsed and no provider call errored |
| `1` | Gate failed. Under `stable` that is a parse failure or a provider error; under `strict`, **expected** on any corpus with expected findings |
| `4` | Gate **not evaluable** — see below. Unreachable under both built-in profiles |
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
- [ ] Precision is quoted as its **bracket**, never as one bound alone — and
      `scoring.adjustedPrecisionTrustworthy` is `true` if the upper bound is used
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
