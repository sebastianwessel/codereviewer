# CLI Reference

## Validate Config

```bash
npx tsx src/cli/main.ts config validate [--config path/to/config.json]
```

Prints a redacted normalized config summary.

## Review

```bash
npx tsx src/cli/main.ts review [--file path/to/file.ts] [--base-ref main --head-ref HEAD] [--debug] [--log-file .codereviewer/review.log]
```

Runs repository intake, deterministic support signal extraction for context and
gating, LLM-backed proof/refutation when a provider is configured, admission,
quality gates, and report rendering. Use `--file` one or more times for focused local review. Without
explicit files, the command reviews the configured git diff.

Use `--debug` for no-content stage logs while the run is active. Use
`--log-level trace|debug|info|warn|error|fatal|silent` for explicit control.
Use `--log-file <path>` to write newline-delimited JSON logs to a
repository-relative file instead of the command log sink. The file is appended
to rather than truncated; each run begins with a `log-run-start` JSON header
line so individual runs remain identifiable within a shared log file. Logs include stage names, counts, run IDs,
provider/model IDs, token totals, and redacted error codes. They do not include
source snippets, prompts, request/response bodies, provider headers,
environment values, tokens, or secrets.

Review runs are stateless and one-shot: nothing about a run is persisted to disk
beyond the redacted run artifacts. A failed run writes partial artifacts for
inspection; rerun the command to review again from scratch.

## Evaluation

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
Use `--max-concurrent-tasks <1-32>` to override review task/provider-call
concurrency for eval runs without changing the repository config. This is useful
for focused provider-backed benchmark runs where serial execution avoids
transient provider timeout noise.
Use `--review-mode <local|ci|pr|full>`, `--review-depth
<fast|balanced|thorough>`, `--intent-planning
<auto|deterministic|model>`, and `--judge-findings` to force the review posture
for one eval run without editing `.codereviewer/config.json`. These overrides
are intended for apples-to-apples benchmark experiments, especially when
comparing the agentic PR-review path against the default local/balanced path.
Use `--semantic-judge` only for explicit provider-backed benchmark scoring. The
judge returns a boolean match decision plus rationale, and accepted matches are
scored deterministically instead of using provider-generated confidence. The
default matcher is deterministic and offline. Provider-backed npm helpers such
as `npm run eval:with-env`, `npm run eval:semantic`,
`npm run eval:cheap`, `npm run eval:benchmark`,
`npm run eval:benchmark:debug`,
`npm run eval:benchmark:baseline`, and `npm run cli -- ...` load `.env` with
Node's native `--env-file-if-exists=.env` flag. Plain `npm run eval` stays
deterministic and does not load `.env`. `eval:benchmark` and
`eval:benchmark:debug` force the agentic PR-review benchmark posture; use
`eval:benchmark:baseline` only when comparing against the older current-config
provider benchmark posture.
`eval slice-manifest` prints deterministic JSON for the committed slice fixtures
without source text. Use
`npm run cli -- eval slice-manifest --slice-root <path>` for another local slice
pack.

```bash
npm run cli -- eval compare --base .codereviewer/eval/base-report.json --head .codereviewer/eval/head-report.json
npm run cli -- eval recall-report --report .codereviewer/eval/base-report.json --report .codereviewer/eval/head-report.json
```

Compares two evaluation reports and prints gate status, selection status,
metric deltas, and case transitions. If selected case IDs differ, the command
prints a warning before metric deltas and lists base-only/head-only cases.
If semantic matcher modes differ, it prints a scoring-mode warning.
`eval recall-report` prints a per-expected-finding recall report from one or
more saved reports. Without `--report`, it reads `.codereviewer/eval/eval-report.json`.

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
