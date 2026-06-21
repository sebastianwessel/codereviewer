# CLI Reference

## Validate Config

```bash
npx tsx src/cli/main.ts config validate [--config path/to/config.json]
```

Prints a redacted normalized config summary.

## Review

```bash
npx tsx src/cli/main.ts review [--file path/to/file.ts] [--base-ref main --head-ref HEAD] [--debug]
```

Runs repository intake, language analyzers, admission, quality gates, and report
rendering. Use `--file` one or more times for focused local review. Without
explicit files, the command reviews the configured git diff.

Use `--debug` for no-content stage logs while the run is active. Use
`--log-level trace|debug|info|warn|error|fatal|silent` for explicit control.
Logs include stage names, counts, run IDs, provider/model IDs, token totals, and
redacted error codes. They do not include source snippets, prompts,
request/response bodies, provider headers, environment values, tokens, or
secrets.

Review runs are stateless and one-shot: nothing about a run is persisted to disk
beyond the redacted run artifacts. A failed run writes partial artifacts for
inspection; rerun the command to review again from scratch.

## Evaluation

```bash
npx tsx src/cli/main.ts eval run
npx tsx src/cli/main.ts eval run --slice-root eval/benchmarks/crb --case crb-sentry-1
npx tsx src/cli/main.ts eval run --slice-root eval/benchmarks/crb --semantic-judge
npx tsx src/cli/main.ts eval slice-manifest --slice-root eval/benchmarks/crb
```

Runs development evaluation cases through the same review runner used by
`review` and writes an evaluation report. Cases are loaded from
`eval/fixtures/sample-eval-cases.json` and
`eval/fixtures/slices/<case-id>/slice.json`.

Use `--slice-root <path>` to run only self-contained slice cases from a
repository-relative local benchmark directory. Use `--case <id>` one or more
times to filter loaded cases by exact case ID. The generated report records the
fixture source, slice root, filters, selected case IDs, scoring mode, and
grouped metrics so reports can be compared only after confirming they used the
same case set and semantic matcher.
Use `--semantic-judge` only for explicit provider-backed benchmark scoring; the
default matcher is deterministic and offline, and `eval run` does not load the
repository root `.env` file.
`eval slice-manifest` prints deterministic JSON for a local slice pack,
including case IDs, summary counts, and sha256 hashes without source text.

```bash
npx tsx src/cli/main.ts eval compare --base .review/eval/base-report.json --head .review/eval/head-report.json
npx tsx src/cli/main.ts eval recall-report --report .review/eval/base-report.json --report .review/eval/head-report.json
```

Compares two evaluation reports and prints gate status, selection status,
metric deltas, and case transitions. If selected case IDs differ, the command
prints a warning before metric deltas and lists base-only/head-only cases.
If semantic matcher modes differ, it prints a scoring-mode warning.
`eval recall-report` prints a per-expected-finding recall report from one or
more saved reports. Without `--report`, it reads `.review/eval/eval-report.json`.

## Drift Check

```bash
npx tsx src/cli/main.ts drift check
```

Runs deterministic local checks for docs/specs drift, generated schema drift,
security-sensitive stale paths, undocumented or unimplemented CLI commands
(implementation drift), and ambiguous requirements.

| Result | Exit |
| --- | --- |
| Warnings only | `0` |
| Hard drift category present | `1` |
| Config/path error | `2` |

Default hard categories are `generated-artifact-drift` and `security-drift`.
Ambiguity is a warning by default.
