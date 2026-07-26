# 1 · Configuration and Intake

← [Review lifecycle](../review-lifecycle.md) · next → [Deterministic support signals](02-deterministic-support-signals.md)

Everything downstream depends on two things being settled first: *what the rules
are* (one validated configuration) and *what is being reviewed* (an explicit set
of changed files, diff ranges, and raw diff text). This stage produces both, and
it is entirely deterministic — no provider is contacted here.

## What it receives

- The repository root and the CLI invocation (`--base-ref`, `--head-ref`,
  `--files`, config path overrides).
- The process environment, plus `.env` in the repository root when present.
- `.codereviewer/config.json` (or the path in `CODEREVIEWER_CONFIG_PATH`).

## What it does

### Configuration resolution

Sources are merged lowest-to-highest precedence and then validated as a whole:

1. Schema defaults (`CodeReviewerConfigSchema`)
2. `.codereviewer/config.json`
3. Environment variables (`CODEREVIEWER_*`, including values loaded from `.env`)
4. CLI-supplied overrides

The merged object is parsed with a strict Zod schema, so an unknown key is an
error rather than a silently ignored typo. A missing config file is not an error
— it produces the run warning `config-file-missing`. The validated config is
hashed into `configHash`, which is recorded in the run summary and attached to
every finding's provenance, so a report can always be tied back to the settings
that produced it.

> Secrets are never copied into the normalized config or into logs. See
> [Security](../../07-security/).

### Preflight

Before any source is read:

- **Drift check** (`drift.*`, enabled by default) inspects documentation, spec,
  implementation, and generated-artifact drift. Categories listed in
  `drift.failOn` (default: `generated-artifact-drift`, `security-drift`) abort
  the run; the rest become run warnings. This runs *before* any provider call, so
  a drifted repository fails fast and cheaply.
- **OpenTelemetry setup** when `observability.openTelemetry.enabled` is true.
- A run-level abort signal is armed from `review.runTimeoutMs` when configured.

### Repository intake

Intake resolves `baseRef`/`headRef` (CLI flags win over `review.baseRef` /
`review.headRef`), lists the changed paths, and filters them:

| Filter | Source | Effect |
| --- | --- | --- |
| Include globs | `paths.include` (default `**/*`) | Only matching paths are reviewed |
| Exclude globs | `paths.exclude` | Drops VCS/build dirs and non-reviewable generated data (lock files, `*.min.js`, `*.map`, `*.snap`, …) |
| File count cap | `review.maxFiles` (default 500) | Excess files are skipped, not silently dropped |
| File size cap | `review.maxFileBytes` (default 500000) | Oversized (and binary) files are skipped |

`--files` supplies an explicit file set instead of a diff-derived one.

The intake then reads the **full current content** of every changed file — the
reviewer sees whole files, not just hunks — and derives:

- `reviewedDiffRanges`: per-path new-side line ranges with a `changeKind`
  (`new` / `modified` / `deleted`), built from the diff hunks. These define both
  admission scope and inline-comment eligibility later.
- `reviewedDiffText`: the raw unified diff blob, later split per task.
- `reviewedLineRanges`: line 1..N of each file's current content.
- `skippedFiles`: what was excluded and why, carried into the report.

## What it emits

| Output | Consumed by |
| --- | --- |
| Validated config + `configHash` | Every stage; provenance on findings |
| Changed source files (path + content) | [Signals](02-deterministic-support-signals.md), [context assembly](03-task-clustering-and-context-assembly.md) |
| `reviewedDiffRanges`, `reviewedDiffText` | [Discovery](04-holistic-discovery.md), [refutation](05-refutation.md), [admission](06-admission-and-severity-floor.md) |
| `reviewedLineRanges` | [Admission](06-admission-and-severity-floor.md) location validity |
| `skippedFiles`, drift warnings | [Reporting](08-reporting.md) |

## What can go wrong

| Situation | Behaviour |
| --- | --- |
| No config file | Run continues on defaults; warning `config-file-missing` |
| Unknown or invalid config key | Validation error, run fails before intake (config exit code) |
| Drift category in `drift.failOn` triggered | Run aborts in preflight, before any provider call |
| No changed files | Zero tasks; the run completes with an empty finding set |
| File too large / binary / excluded | Recorded in `skippedFiles`; it is *not* reviewed and not counted against coverage |
| `review.runTimeoutMs` exceeded | Run fails with a timeout error and writes partial artifacts |

## Configuration keys

| Key | Default | Effect here |
| --- | --- | --- |
| `review.baseRef` / `review.headRef` | `main` / `HEAD` | Diff endpoints (CLI flags override) |
| `review.maxFiles` | `500` | Cap on reviewed files |
| `review.maxFileBytes` | `500000` | Per-file size cap |
| `review.runTimeoutMs` | unset | Whole-run abort deadline |
| `paths.include` / `paths.exclude` | `**/*` / built-in exclude list | File selection |
| `paths.artifactDir` | `.codereviewer/runs` | Where the run writes its artifacts |
| `drift.enabled` / `drift.failOn` / `drift.include*` | `true` / `["generated-artifact-drift","security-drift"]` / `true` | Preflight gate |
| `observability.logging.level` | `silent` | Log verbosity |
| `observability.openTelemetry.*` | disabled | Telemetry export |
| `review.depth` | `balanced` | Clustering strategy and every byte budget (see [stage 3](03-task-clustering-and-context-assembly.md)) |
| `review.mode` | `local` | **Metadata only** — see below |

### `review.mode` is metadata

`review.mode` (`local` / `ci` / `pr` / `full`) is written into the report's
`run.mode` field and into observability attributes. Nothing in the pipeline
branches on it: it does not change file selection, context budgets, clustering,
the number of model calls, admission, or the gate. If you want a bigger or
smaller review, change `review.depth` (and, if you need to, `review.contextMaxBytes`).

Full key reference: [Configuration reference](../../06-reference/configuration/README.md).
