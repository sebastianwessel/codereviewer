# CLI Reference

Complete reference for every command exposed by the CodeReviewer CLI. Each
command is stateless and one-shot: nothing is persisted beyond the redacted
run artifacts in `paths.artifactDir`.

> **Note:** All commands below use `npx tsx src/cli/main.ts …` for the
> development entry-point. Replace with your installed binary or
> `npm run cli --` as appropriate.

---

## `config validate`

Validates and prints the effective configuration for the current repository.

### Synopsis

```bash
npx tsx src/cli/main.ts config validate [--config path/to/config.json]
```

### Flags

| Flag | Description |
| --- | --- |
| `--config <path>` | Path to an explicit config file (overrides default `.codereviewer/config.json` lookup). |

### What it does

Merges all configuration layers (built-in defaults → `.codereviewer/config.json`
→ process env → `.env` → CLI flags), validates the result with Zod, and
prints a **redacted** normalized config summary. Secrets are never printed.

### Example

```bash
npx tsx src/cli/main.ts config validate --config .codereviewer/config.json
```

---

## `review`

Runs a full review pipeline: repository intake, deterministic support-signal
extraction, LLM-backed proof/refutation (when a provider is configured),
admission, quality gates, and report rendering.

### Synopsis

```bash
npx tsx src/cli/main.ts review \
  [--file path/to/file.ts] \
  [--base-ref main --head-ref HEAD] \
  [--debug] \
  [--log-level trace|debug|info|warn|error|fatal|silent] \
  [--log-file .codereviewer/review.log]
```

### Flags

| Flag | Description |
| --- | --- |
| `--file <path>` | Review this file instead of the git diff. Repeat for multiple files. |
| `--base-ref <ref>` | Base git ref for the diff (default from config). |
| `--head-ref <ref>` | Head git ref for the diff (default from config). |
| `--debug` | Emit no-content stage logs to the console while the run is active. |
| `--log-level <level>` | Explicit log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`. |
| `--log-file <path>` | Write newline-delimited JSON logs to a repository-relative file (appended, not truncated). |

### Behavior notes

- Use `--file` one or more times for a focused local review. Without explicit
  files the command reviews the configured git diff.
- `--log-file` appends to the file; each run begins with a `log-run-start`
  JSON header line so individual runs remain identifiable within a shared log.
- Logs include stage names, counts, run IDs, provider/model IDs, token totals,
  and redacted error codes. They **never** include source snippets, prompts,
  request/response bodies, provider headers, environment values, tokens, or
  secrets.
- Review runs are stateless and one-shot. A failed run writes partial artifacts
  for inspection; rerun the command to review again from scratch.

### Example

```bash
# Review the diff between main and HEAD
npx tsx src/cli/main.ts review --base-ref main --head-ref HEAD

# Review two specific files with debug output
npx tsx src/cli/main.ts review \
  --file src/auth/login.ts \
  --file src/auth/session.ts \
  --debug
```

See [Artifacts Reference](artifacts.md) for the output files written to
`paths.artifactDir`, and [Exit Codes](exit-codes.md) for how to interpret the
command's exit status.

---

## `eval`

Runs development evaluation cases through the same review runner used by
`review` and writes an evaluation report.

> **Note:** Cases are loaded from `eval/fixtures/sample-eval-cases.json` and
> `eval/fixtures/slices/<case-id>/slice.json`.

### Synopsis — run

```bash
npm run eval
npm run eval:cheap
npm run eval -- --slice-root eval/benchmarks/crb --case crb-sentry-1
npm run eval:semantic -- --slice-root eval/benchmarks/crb
npm run cli -- eval run --slice-root eval/benchmarks/crb --max-concurrent-tasks 1
npm run cli -- eval run --review-mode pr --review-depth thorough --intent-planning model --judge-findings
npm run cli -- eval run --debug --log-file .codereviewer/eval/log.log
npm run eval:slice-manifest
```

### Flags — `eval run`

| Flag | Description |
| --- | --- |
| `--slice-root <path>` | Run only self-contained slice cases from a repository-relative local benchmark directory. |
| `--case <id>` | Filter loaded cases by exact case ID. Repeat for multiple IDs. |
| `--max-concurrent-tasks <1-32>` | Override review task/provider-call concurrency for this eval run without changing repository config. |
| `--review-mode <local\|ci\|pr\|full>` | Force the review mode for this run without editing config. |
| `--review-depth <fast\|balanced\|thorough>` | Force the review depth for this run without editing config. |
| `--intent-planning <auto\|deterministic\|model>` | Force intent-planning mode for this run. |
| `--judge-findings` | Enable the optional judge critic for this run. |
| `--semantic-judge` | Use provider-backed semantic matching (for explicit benchmark scoring only; the default matcher is deterministic and offline). |
| `--debug` | Emit no-content stage logs. |
| `--log-file <path>` | Write newline-delimited JSON logs to a repository-relative file. |

### `npm run` helpers

| Helper | Behavior |
| --- | --- |
| `npm run eval` | Deterministic, does **not** load `.env`. |
| `npm run eval:with-env` | Loads `.env` via `--env-file-if-exists=.env`. |
| `npm run eval:semantic` | Loads `.env`; uses provider-backed semantic judge. |
| `npm run eval:cheap` | Loads `.env`; lower-cost model settings. |
| `npm run eval:benchmark` | Loads `.env`; forces agentic PR-review posture. |
| `npm run eval:benchmark:debug` | Same as `eval:benchmark` with debug logging. |
| `npm run eval:benchmark:baseline` | Loads `.env`; preserves older current-config benchmark posture for comparison. |
| `npm run eval:slice-manifest` | Prints deterministic JSON for committed slice fixtures (no source text). |

The generated report records the fixture source, slice root, filters, selected
case IDs, scoring mode, and grouped metrics so reports can be compared only
after confirming they used the same case set and semantic matcher.

`--max-concurrent-tasks` is useful for focused provider-backed benchmark runs
where serial execution avoids transient provider timeout noise. The
`--review-mode`, `--review-depth`, `--intent-planning`, and `--judge-findings`
flags are intended for apples-to-apples benchmark experiments, especially when
comparing the agentic PR-review path against the default local/balanced path.

### Synopsis — compare

```bash
npm run cli -- eval compare \
  --base .codereviewer/eval/base-report.json \
  --head .codereviewer/eval/head-report.json

npm run cli -- eval recall-report \
  --report .codereviewer/eval/base-report.json \
  --report .codereviewer/eval/head-report.json
```

### Flags — `eval compare` / `eval recall-report`

| Flag | Description |
| --- | --- |
| `--base <path>` | Base evaluation report JSON for comparison. |
| `--head <path>` | Head evaluation report JSON for comparison. |
| `--report <path>` | Report file(s) for `recall-report`. Without `--report`, reads `.codereviewer/eval/eval-report.json`. Repeat for multiple reports. |

`eval compare` prints gate status, selection status, metric deltas, and case
transitions. If selected case IDs differ it prints a warning; if semantic
matcher modes differ it prints a scoring-mode warning.

`eval recall-report` prints a per-expected-finding recall report from one or
more saved reports.

---

## `drift check`

Runs deterministic local consistency checks across the repository.

### Synopsis

```bash
npx tsx src/cli/main.ts drift check
```

### What it checks

- Docs/specs drift
- Generated schema drift
- Security-sensitive stale paths
- Undocumented or unimplemented CLI commands (implementation drift)
- Ambiguous requirements

### Exit behavior

| Result | Exit code |
| --- | --- |
| Warnings only | `0` |
| Hard drift category present | `1` |
| Config/path error | `2` |

Default hard categories are `generated-artifact-drift` and `security-drift`.
Ambiguity is a warning by default; it can be promoted to a hard category via
`drift.failOn` in [Configuration Reference](configuration.md#drift).

### Example

```bash
npx tsx src/cli/main.ts drift check
```
