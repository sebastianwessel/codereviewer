# Evaluation

The evaluation runner checks review behavior against deterministic development
fixtures stored under root `eval/fixtures/`.

Run evaluation:

```bash
npx tsx src/cli/main.ts eval run
```

Artifacts are written under:

```text
.review/eval/
```

| File | Purpose |
| --- | --- |
| `eval-report.json` | Regression metrics, selected fixture metadata, grouped metrics, and fixture results. |
| `eval-summary.md` | Human-readable selection, gate result, metric tables, case table, and failure details. |
| `eval-recall-report.md` | Human-readable per-expected-finding recall report for the current run. |

Use evaluation before changing analyzer behavior, admission rules, reporting, or
provider prompts. Evaluation executes the product review runner for each case,
then checks missed expected findings and excessive false positives before a
change reaches CI.

The command prints the same summary to stdout. Use the Markdown summary for
human comparison between runs, and use `eval-report.json` for automation.
The JSON report includes `selection.fixtureSource`, optional
`selection.sliceRoot`, `selection.caseFilters`, and
`selection.selectedCaseIds` so two reports can prove they used the same fixture
set before their numbers are compared.

The JSON report also includes `scoring.semanticMatcher`. The default is
`deterministic`, which uses offline token matching. Runs started with
`--semantic-judge` are marked as `semantic-judge` so benchmark metrics are not
silently compared with deterministic runs.

The JSON report also includes `metricGroups` for `sourceProfile`, `language`,
and `tag`. The Markdown summary renders source-profile and language groups so
recall and noise changes are visible without opening raw JSON.

Each case result in `eval-report.json` includes sanitized expected-finding
metadata: expected index, category, severity, optional path/line range, match
mode, and summary. This keeps saved reports useful for later recall analysis
without reloading fixture files.

Case results also include `inlineFindingCount`. The Markdown summary renders
this as the `Inline` column so PR-comment anchoring changes are visible without
opening raw JSON.

Compare two saved reports:

```bash
npx tsx src/cli/main.ts eval compare --base .review/eval/base-report.json --head .review/eval/head-report.json
```

The comparison output includes a selection section before metric deltas. If the
selected case IDs differ, it prints a warning and lists base-only and head-only
cases so aggregate deltas are not mistaken for same-dataset results.
If semantic matcher modes differ, it prints a separate warning because the runs
used different scoring modes.

Create a per-expected recall report from saved reports:

```bash
npx tsx src/cli/main.ts eval recall-report --report .review/eval/base-report.json --report .review/eval/head-report.json
```

Without `--report`, the command reads `.review/eval/eval-report.json`. The
output shows whether selected case sets are identical, then lists expected
findings with detection rates and run marks.

The committed fixture pack covers TypeScript, JavaScript, Python, Go, Rust, and
Java with positive diagnostic cases and negative no-finding zones.

`eval run` does not load the repository root `.env` file. This keeps regression
results reproducible and prevents local provider settings from changing fixture
behavior. Use explicit process environment or a config file only when you
intentionally run provider-backed eval.

For benchmark packs that use semantic golden comments without reliable line
anchors, enable provider-backed semantic matching explicitly:

```bash
npx tsx src/cli/main.ts eval run --slice-root eval/benchmarks/crb --semantic-judge
```

`--semantic-judge` requires provider configuration and credentials from the
process environment or config file. The judge receives only the expected
semantic summary and admitted finding title/description. Source snippets,
unified diffs, prompts, secrets, tool output, and repository files are not sent
as judge input by this scoring step.

For deeper quality comparison, add self-contained benchmark-style fixture
slices: a metadata file with expected findings plus a minimal repository tree
that contains only the files needed to reproduce the review decision. This keeps
cases reviewable by humans while still exercising the normal review runner.

Slice layout:

```text
eval/fixtures/slices/<case-id>/
  slice.json
  repo/
    <repository files>
```

Run an untracked local benchmark slice pack by pointing the CLI at the slice
root:

```bash
npx tsx src/cli/main.ts eval run --slice-root eval/benchmarks/crb --case crb-sentry-1
```

`--slice-root` expects a repository-relative directory containing
`<case-id>/slice.json` and `<case-id>/repo/`. `--case` may be repeated to run a
small subset while tuning prompts or provider settings. These values are
persisted in `eval-report.json` for reproducible same-dataset comparison.

Fingerprint a local slice pack before or after a run:

```bash
npx tsx src/cli/main.ts eval slice-manifest --slice-root eval/benchmarks/crb
```

The command prints JSON with case IDs, normalized counts, and sha256 hashes for
each `slice.json` and repository tree. Store this output in CI logs or beside
saved reports when comparing local packs across machines. The digest excludes
the generation timestamp, so the same unchanged pack produces the same digest
on repeated runs. Manifest output does not include source text, prompts,
provider payloads, secrets, or environment values.

`slice.json` declares the case metadata, changed files, expected findings, and
no-finding zones. Paths in `changedFiles`, `expectedFindings`, and
`expectedNoFindingZones` are relative to the `repo/` directory.

Benchmark-compatible slices may use `expected[]` entries with `description`,
`severity`, optional `type` or `category`, and optional `file`/`path` plus
`line`/`lineEnd`. Entries without file and line data are treated as
semantic-only expectations: they contribute to recall and precision, but not to
line-accuracy or PR-comment placement gates.

When `slice.json` includes a unified `diff`, evaluation derives changed-line
and diff-hunk counts from that diff for noise metrics and passes the parsed diff
map into review execution for inline PR-comment eligibility. Without `diff`, it
falls back to reviewed fixture file lines, changed-file count, and normal
repository-intake diff behavior.
