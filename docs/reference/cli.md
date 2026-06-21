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
```

Runs development evaluation cases through the same review runner used by
`review` and writes an evaluation report. Cases are loaded from
`eval/fixtures/sample-eval-cases.json` and
`eval/fixtures/slices/<case-id>/slice.json`.

```bash
npx tsx src/cli/main.ts eval compare --base .review/eval/base-report.json --head .review/eval/head-report.json
```

Compares two evaluation reports and prints gate status, metric deltas, and case
transitions.

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
