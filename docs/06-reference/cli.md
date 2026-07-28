# CLI Reference

Binary: `codereviewer` (`package.json` `bin` → `dist/cli/main.js`).
From a source checkout: `npm run cli -- <command> [flags]`.

Every command is a fixed word pair or single word. There is no `--help`, no
`--version`, and no abbreviated/`=`-joined flag form: a flag and its value are
two separate argv tokens (`--config path`, never `--config=path`).

Source of truth: [`src/cli/index.ts`](../../src/cli/index.ts) (command dispatch)
and [`src/cli/args.ts`](../../src/cli/args.ts) (parsers). Only the flags listed
below are parsed.

## Commands

| Command | Purpose | Exit codes |
| --- | --- | --- |
| `config validate` | Load, merge, and validate config; print the redacted normalized config. | `0`, `2` |
| `review` | Run a review, write run artifacts, evaluate the quality gate. | `0`, `1`, `2`, `3`, `4`, `5` |
| `baseline write` | Build `baseline.json` from a completed review report. | `0`, `2`, `3` |
| `eval run` | Run the evaluation harness over eval cases and apply the regression gate. | `0`, `1`, `2`, `3`, `5` |
| `eval compare` | Diff two eval reports. | `0`, `2` |
| `eval recall-report` | Render the recall report from one or more eval reports. | `0`, `2` |
| `eval slice-manifest` | Emit a manifest (with digest) for a benchmark slice directory. | `0`, `2`, `3` |
| `drift check` | Run the drift gate. | `0`, `1`, `2`, `3` |
| `impact check` | List the symbols a change touched and where they are referenced. | `0`, `2`, `3` |

Anything else exits `2` with `{"code":"usage_error", ...}` on stderr and the
message `Expected command: config validate, review, baseline write, eval run,
eval compare, eval recall-report, eval slice-manifest, drift check, or impact
check`.

See [exit-codes-and-error-codes.md](./exit-codes-and-error-codes.md) for the
full mapping.

## Argument-parsing rules (apply to every command)

| Rule | Detail |
| --- | --- |
| Unknown flags | **Silently ignored.** No command rejects an unrecognized flag, so a typo (`--base_ref`) is not an error — it is simply not applied. |
| Flag/value form | `--flag value`. `--flag=value` is not supported (the whole token is treated as an unknown flag). |
| Missing value | Throws a usage/config error → exit `2` with `code: "config_error"` (the CLI classifies raw `TypeError` from parsing as a config error). |
| Repeated flags | Only `--file`, `--case`, and `eval recall-report --report` accept repetition. For all others the **first** occurrence wins (`indexOf`). |
| Leading-dash values | Rejected for `--config`, `--log-level`, `--log-file`, `--case`, `eval recall-report --report`, `--review-mode`, `--review-depth`, `--max-concurrent-tasks`. Accepted (and passed through to validation) for `--base-ref`, `--head-ref`, `--file`, `--files`, `--slice-root`, `--base`, `--head`, `baseline write --report`. A git ref starting with `-` is later rejected by the schema. |
| Output | Success payloads go to **stdout**; errors go to **stderr** as a single JSON object `{ "code": ..., "message": ... }`. |

## `codereviewer config validate`

```
codereviewer config validate [--config <path>]
```

| Flag | Value | Notes |
| --- | --- | --- |
| `--config` | repository-relative path | Overrides the default `.codereviewer/config.json` and `CODEREVIEWER_CONFIG_PATH`. |

Stdout: the fully merged, defaulted, **redacted** config as pretty JSON
(secrets masked, `baseUrl`/`endpoint` reduced to `scheme://host`). A missing
config file is not an error — defaults validate on their own.

Any failure exits `2` with `{"code":"config_error"}` unless the underlying error
already carries its own structured exit code.

## `codereviewer review`

```
codereviewer review [--config <path>] [--base-ref <ref>] [--head-ref <ref>]
                    [--file <path>]... [--files <a,b,c>]
                    [--debug | --log-level <level>] [--log-file <path>]
```

| Flag | Value | Repeatable | Effect |
| --- | --- | --- | --- |
| `--config` | path | no | Config file path override. |
| `--base-ref` | git ref | no | Overrides `review.baseRef` for this run only (not written into config). |
| `--head-ref` | git ref | no | Overrides `review.headRef` for this run only. |
| `--file` | repository-relative path | yes | Adds one explicit file. Explicit-file runs bypass git diffing entirely (no `mergeBaseRef` in the run summary). |
| `--files` | comma-separated paths | no (first wins) | Same as repeating `--file`; entries are trimmed and empties dropped. Combines with `--file`. |
| `--debug` | — | no | Sets `observability.logging.level` to `debug`. Takes precedence over `--log-level` when both are present. |
| `--log-level` | `trace`\|`debug`\|`info`\|`warn`\|`error`\|`fatal`\|`silent` | no | Sets `observability.logging.level` at CLI precedence (highest). |
| `--log-file` | repository-relative path | no | Appends JSONL logs to this file. The file is **never truncated**; each invocation appends a `{"event":"log-run-start", ...}` header line. Parent directories are created. |

There are no `--mode`, `--depth`, `--severity`, `--format`, or threshold flags on
`review`. Use the config file or the environment variables in
[environment.md](./environment.md).

Stdout on completion (gate passed or failed):

```json
{
  "runId": "…",
  "qualityGatePassed": true,
  "artifactDir": ".codereviewer/runs/<runId>"
}
```

Exit `1` when `qualityGate.passed === false`. When the run itself fails after
tasks started, partial artifacts (including `error.json`) are still written and
stderr additionally carries `artifactDir`. See
[artifacts.md](./artifacts.md).

## `codereviewer baseline write`

```
codereviewer baseline write [--config <path>] [--report <path>]
```

| Flag | Value | Notes |
| --- | --- | --- |
| `--config` | path | Config file path override. |
| `--report` | repository-relative path to a `report.json` | When omitted, the newest run in `<artifactDir>/index.json` that has a `reportPath` is used. |

Writes to `baseline.path` (default `.codereviewer/baseline.json`), creating
parent directories. Stdout:

```json
{ "baselinePath": "…", "sourceReportPath": "…", "entryCount": 0 }
```

Exits `3` with `baseline_source_unavailable` when no report can be found or read.

## `codereviewer eval run`

```
codereviewer eval run [--config <path>] [--slice-root <dir>] [--case <id>]...
                      [--review-mode <mode>] [--review-depth <depth>]
                      [--max-concurrent-tasks <n>]
                      [--debug | --log-level <level>] [--log-file <path>]
```

| Flag | Value | Repeatable | Effect |
| --- | --- | --- | --- |
| `--config` | path | no | Config file path override. |
| `--slice-root` | repository-relative directory | no | Load eval cases from a benchmark slice directory instead of the bundled fixtures. |
| `--case` | eval case id | yes | Restrict the run to the listed case ids. No match → exit `2`, `usage_error: eval run selected no cases`. |
| `--review-mode` | `local`\|`ci`\|`pr`\|`full` | no | CLI-precedence override of `review.mode`. |
| `--review-depth` | `fast`\|`balanced`\|`thorough` | no | CLI-precedence override of `review.depth`. |
| `--max-concurrent-tasks` | integer 1–32 | no | CLI-precedence override of `review.maxConcurrentTasks`. Out of range → exit `2`. |
| `--debug` / `--log-level` / `--log-file` | as for `review` | no | Same semantics. |

`eval run` **does not read the repository `.env` file** (`loadDotEnv: false`),
so programmatic eval stays hermetic. Provider-backed eval must get credentials
from the real process environment — the repo's npm scripts do this with Node's
`--env-file-if-exists=.env`.

### The regression gate is hard-coded

`eval run` accepts **no threshold flags and reads no threshold config.** The
regression thresholds are literals in `src/cli/index.ts`:

| Threshold | Value |
| --- | --- |
| `minParseValidity` | `1` (100 %) |
| `minRecall` | `1` (100 %) |
| `maxFalsePositiveCount` | `0` |
| `failOnProviderError` | `true` |

Consequence, stated plainly: any provider-backed benchmark run that misses a
single expected finding, produces a single unmatched finding, or hits one
provider error **exits `1`**. Exit `1` from `eval run` is therefore the normal
outcome of a real measurement run and does not mean the run was invalid — read
`eval-summary.md` / `eval-report.json` for the metrics. Only `evaluation.
minJudgeAgreement` is configurable, and it flags metric trustworthiness rather
than failing the gate.

Stdout is the rendered `eval-summary.md`. Artifacts are written to
`.codereviewer/eval/` and a timestamped archive under
`.codereviewer/eval/runs/<UTC-timestamp>-<uuid>/` — outside `paths.artifactDir`.

## `codereviewer eval compare`

```
codereviewer eval compare --base <path> --head <path>
```

| Flag | Value | Required |
| --- | --- | --- |
| `--base` | path to an eval report JSON | yes |
| `--head` | path to an eval report JSON | yes |

Missing either flag → exit `2`, `eval compare requires --base and --head report
paths`. Stdout is the rendered comparison; nothing is written to disk.

## `codereviewer eval recall-report`

```
codereviewer eval recall-report [--report <path>]...
```

| Flag | Value | Repeatable | Default |
| --- | --- | --- | --- |
| `--report` | path to an eval report JSON | yes | `.codereviewer/eval/eval-report.json` |

Unreadable/missing reports → exit `2` with a `usage_error` listing the paths.
Stdout only; nothing is written to disk.

## `codereviewer eval slice-manifest`

```
codereviewer eval slice-manifest --slice-root <dir>
```

| Flag | Value | Required |
| --- | --- | --- |
| `--slice-root` | repository-relative directory | yes (exit `2` when absent) |

Each immediate subdirectory becomes one manifest case, sorted by name.
Duplicate case ids fail the command. Stdout is the manifest JSON including its
digest; nothing is written to disk.

## `codereviewer drift check`

```
codereviewer drift check [--config <path>]
```

| Flag | Value | Notes |
| --- | --- | --- |
| `--config` | path | Config file path override. |

`drift` accepts no subcommand other than `check` (`Expected command: drift
check`, exit `2`). Stdout is the drift result JSON. Exit `1` when the drift gate
fails — that is, when findings exist in a category listed in
[`drift.failOn`](./configuration/quality-gate-and-baseline.md#drift).

## `codereviewer impact check`

```
codereviewer impact check [--config <path>] [--base-ref <ref>] [--head-ref <ref>]
```

| Flag | Value | Notes |
| --- | --- | --- |
| `--config` | path | Config file path override. |
| `--base-ref` | git ref | Overrides `review.baseRef`. |
| `--head-ref` | git ref | Overrides `review.headRef`. |

`impact` accepts no subcommand other than `check` (`Expected command: impact
check`, exit `2`). Stdout is the report JSON; nothing is written to disk.

**This command currently reports references, not impact findings.** It names the
symbols the change touched and every place in the repository they are referenced.
It does **not** say whether a reference actually relies on the part of the
contract that changed, or what breaks if it does — deciding that is your job, and
the report exists to put the call sites in front of you.

Because of that, **the exit code is always `0`** when the command runs at all,
whether or not anything was found. Only a configuration or usage failure (`2`) or
a repository failure such as an unresolvable ref (`3`) changes it. Nothing here
is a finding, nothing carries a severity, and nothing can block a pipeline.

The command makes **no model provider call**. It costs nothing to run and its
output is reproducible.

It is **disabled by default**. With `changeImpact.enabled` left at `false` the
command exits `0` and reports `"status": "disabled"` rather than an empty result,
so a disabled run can never be mistaken for "nothing depends on your change".
Enable it with:

```json
{ "changeImpact": { "enabled": true } }
```

### Report shape

```json
{
  "schemaVersion": "1.0",
  "status": "completed",
  "generatedAt": "2026-07-28T00:00:00.000Z",
  "scope": {
    "baseRef": "main",
    "headRef": "HEAD",
    "mergeBaseRef": "9f1c2ab...",
    "changedFileCount": 1,
    "deletedFileCount": 1
  },
  "summary": {
    "changedSymbolCount": 2,
    "changedSymbolsTruncated": false,
    "referencedSymbolCount": 2,
    "referenceCount": 4
  },
  "symbols": [
    {
      "name": "legacyApi",
      "kind": "export",
      "language": "typescript",
      "definitionPath": "src/legacy.ts",
      "definitionLine": 1,
      "changeKind": "deleted",
      "references": [
        {
          "path": "src/caller.ts",
          "line": 2,
          "text": "import { legacyApi } from \"./legacy.js\""
        }
      ],
      "referencesInDefinitionFile": 0,
      "referencesTruncated": false
    }
  ],
  "warnings": []
}
```

- `symbols` lists one entry per changed symbol, in path then line order. A symbol
  with an empty `references` array means nothing outside its own file refers to
  it, which is a real result and not an omission.
- `references` lists sites **outside** the defining file only. Sites inside it
  are counted in `referencesInDefinitionFile` rather than listed, because a
  symbol's own file is not a dependent.
- `referencesTruncated` is `true` when `changeImpact.maxReferencesPerSymbol` cut
  the list short, so a bounded list is never mistaken for a complete one. The
  same applies to `summary.changedSymbolsTruncated` and
  `changeImpact.maxChangedSymbols`.
- `changeKind: "deleted"` means the symbol's whole file was removed. Every symbol
  a deleted file declared is reported, since none of them survive.
- Reference matching is **identifier-bounded**, not substring: seeding from `get`
  does not match `forget` or `widget`. Matched line text is redacted with the
  same redactor the mediated file read uses, and capped at 300 characters — the
  text is there to recognise a reference, while `path` and `line` locate it.
- Files in a language the deterministic signal extractors do not cover contribute
  no symbols and produce a warning rather than an error.

## Related

- [Configuration reference](./configuration/README.md)
- [Environment variables](./environment.md)
- [Exit codes and error codes](./exit-codes-and-error-codes.md)
- [Artifacts](./artifacts.md)
