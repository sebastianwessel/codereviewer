# First Review

Run the implemented local review path:

```bash
npx tsx src/cli/main.ts review --file src/app.ts
```

The command writes artifacts under:

```text
.codereviewer/runs/<run-id>/
```

| File | Purpose |
| --- | --- |
| `report.json` | Machine-readable review report. |
| `report.md` | Human-readable summary. |
| `report.sarif` | SARIF output for security/code scanning tools. |
| `github-review-comments.json` | Inline PR comment drafts (written when `github-review-comments` is in `reporting.formats`). |
| `run-summary.json` | Run metadata used by automation and status checks. |
| `context-ledger.json` | Redacted context budget and inclusion audit. |
| `shared-context.json` | Compact shared entries, task events, current task state, and admission trace. |
| `observability.json` | No-content pipeline step and task event trace. |

Exit code `0` means the quality gate passed. Exit code `1` means the review ran
successfully and the quality gate failed because at least one configured
threshold was exceeded.

For CI smoke checks, use:

```bash
npx tsx src/cli/main.ts review --base-ref origin/main --head-ref HEAD
```
