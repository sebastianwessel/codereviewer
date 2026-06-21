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
| `eval-report.json` | Regression metrics and fixture results. |
| `eval-summary.md` | Human-readable gate result, metric table, case table, and failure details. |

Use evaluation before changing analyzer behavior, admission rules, reporting, or
provider prompts. Evaluation executes the product review runner for each case,
then checks missed expected findings and excessive false positives before a
change reaches CI.

The command prints the same summary to stdout. Use the Markdown summary for
human comparison between runs, and use `eval-report.json` for automation.

Compare two saved reports:

```bash
npx tsx src/cli/main.ts eval compare --base .review/eval/base-report.json --head .review/eval/head-report.json
```

The committed fixture pack covers TypeScript, JavaScript, Python, Go, Rust, and
Java with positive diagnostic cases and negative no-finding zones.

`eval run` does not load the repository root `.env` file. This keeps regression
results reproducible and prevents local provider settings from changing fixture
behavior. Use explicit process environment or a config file only when you
intentionally run provider-backed eval.

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

`slice.json` declares the case metadata, changed files, expected findings, and
no-finding zones. Paths in `changedFiles`, `expectedFindings`, and
`expectedNoFindingZones` are relative to the `repo/` directory.
