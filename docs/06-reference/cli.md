# CLI Reference

Binary: `codereviewer` (`package.json` `bin` → `dist/cli/main.js`).
From a source checkout: `npm run cli -- <command> [flags]`.

Every command is a fixed word pair or single word. There is no `--help` and no
`--version`. A flag and its value may be written either way: `--config path` and
`--config=path` are both accepted, everywhere.

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
| `intent check` | Map the change's stated intent onto the change, obligation by obligation. | `0`, `2`, `3`, `4` |

Anything else exits `2` with `{"code":"usage_error", ...}` on stderr and the
message `Expected command: config validate, review, baseline write, eval run,
eval compare, eval recall-report, eval slice-manifest, drift check, impact
check, or intent check`.

`review` is the only command that can fail a pipeline on what it found.
`impact check` and `intent check` are advisory: they run independently of each
other and of `review`, share none of each other's context or output, and neither
can exit non-zero on what it reported. `intent check` does refuse to run on an
input it cannot see whole — three input limits fail the command with exit `4`
rather than judging a partial input, which is a different thing from a verdict.
See [its exit codes](#exit-codes-and-the-three-input-limits).

See [exit-codes-and-error-codes.md](./exit-codes-and-error-codes.md) for the
full mapping.

## Argument-parsing rules (apply to every command)

| Rule | Detail |
| --- | --- |
| Unknown flags | **Rejected before the command does any work**, with exit `2` and `{"code":"usage_error"}` naming the flag. Every command declares its own option set; a flag one command accepts is still unknown to another. A parser that ignored a flag it does not implement would let a run proceed as though the flag had been honoured, which this project paid for twice. Only `--config` is global. `--debug` / `--log-level` / `--log-file` are declared by `review` and `eval run` alone — the five other commands reject them with exit `2`, because being told an option is unknown beats being silently ignored. |
| Flag/value form | `--flag value` and `--flag=value` are equivalent, for every flag on every command, including `--config` and `--file`. The joined form used to be accepted by the unknown-flag check and then dropped by the value parsers, so `--config=path` passed validation and the run proceeded on defaults at exit `0`; the parsers now read both spellings. |
| Missing value | Throws a usage/config error → exit `2` with `code: "config_error"` (the CLI classifies raw `TypeError` from parsing as a config error). An empty joined value (`--config=`) is a missing value, not an empty string. |
| Repeated flags | Only `--file`, `--case`, and `eval recall-report --report` accept repetition. For all others the **first** occurrence wins, and a joined occurrence wins over a space-separated one wherever both appear. |
| Leading-dash values | In the **space-separated** form, rejected for `--config`, `--log-level`, `--log-file`, `--case`, `eval recall-report --report`, `--review-mode`, `--review-depth`, `--max-concurrent-tasks`, `--gate-profile`; accepted (and passed through to validation) for `--base-ref`, `--head-ref`, `--file`, `--files`, `--slice-root`, `--base`, `--head`, `baseline write --report`. The check exists to stop the next flag being eaten as a value, which the joined form cannot do, so `--flag=-x` is generally passed through to the value's own validation instead. A git ref starting with `-` is rejected by the schema either way. |
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
config file at the **default** path is not an error — defaults validate on their
own, and the run records the `config-file-missing` warning. A file named
explicitly, by `--config` or `CODEREVIEWER_CONFIG_PATH`, that does not exist is a
`config_error` at exit `2`: continuing on defaults there would run with settings
nobody asked for and report success.

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

Exits `3` with `baseline_source_unavailable` when no report can be found or read,
and `3` with `baseline_source_invalid` when the file it did read is not a review
report. A source it cannot validate never yields an empty baseline and exit `0`.

## `codereviewer eval run`

```
codereviewer eval run [--config <path>] [--slice-root <dir>] [--case <id>]...
                      [--review-mode <mode>] [--review-depth <depth>]
                      [--max-concurrent-tasks <n>] [--gate-profile <profile>]
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
| `--gate-profile` | `stable`\|`strict` | no | CLI-precedence override of `evaluation.regressionGate.profile` for this run only. Any other value → exit `2`. |
| `--debug` / `--log-level` / `--log-file` | as for `review` | no | Same semantics. |

`eval run` **does not read the repository `.env` file** (`loadDotEnv: false`),
so programmatic eval stays hermetic. Provider-backed eval must get credentials
from the real process environment — the repo's npm scripts do this with Node's
`--env-file-if-exists=.env`.

### The regression gate has two profiles

`eval run` gates on a **profile**, selected by `--gate-profile` or
`evaluation.regressionGate.profile`, with per-threshold escape hatches in
`evaluation.regressionGate.overrides`.

| Threshold | `stable` (default) | `strict` |
| --- | --- | --- |
| `minParseValidity` | `1` (100 %) | `1` (100 %) |
| `failOnProviderError` | `true` | `true` |
| `minRecall` | *not gated* | `1` (100 %) |
| `maxFalsePositiveCount` | *not gated* | `0` |

**`stable` is the default and it deliberately does not gate on recall or false
positives.** Under an incomplete answer key an unmatched finding is frequently a
real defect the key never listed, so gating on the raw count made a non-zero exit
the normal outcome of every run — a signal that fires always carries no
information. `stable` therefore gates only on what is unambiguous: the model
returned parseable output, and no provider call failed.

**`strict` is the old all-or-nothing bar**, kept as a named opt-in for a
maintainer preparing a release cut who has verified perfect recall holds for their
own fixture set.

`evaluation.minJudgeAgreement` is separate from the gate: it flags metric
trustworthiness (`scoring.judgeTrustworthy`) rather than failing the run.

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
                          [--format json|markdown]
```

| Flag | Value | Notes |
| --- | --- | --- |
| `--config` | path | Config file path override. |
| `--base-ref` | git ref | Overrides `review.baseRef`. |
| `--head-ref` | git ref | Overrides `review.headRef`. |
| `--format` | `json` (default), `markdown` | What goes to stdout. The Markdown artifact is written either way. |

`impact` accepts no subcommand other than `check` (`Expected command: impact
check`, exit `2`). Stdout is the report JSON by default, so existing scripted use
is unchanged; `--format markdown` puts the rendered report there instead.

A completed run also writes a run directory under
[`paths.artifactDir`](./configuration/review.md#paths), the same place `review`
writes its artifacts:

| Artifact | Content |
| --- | --- |
| `impact-report.md` | The rendered report — changed symbols whose contract moved first, their dependents grouped by file, tests listed separately, and the scope of the search stated. |
| `impact-report.json` | The same report, byte-identical to what `--format json` prints. |

The directory is named `impact-<uuid>` and the path of the Markdown file is
printed to **stderr** so stdout stays exactly one JSON document. Impact runs are
**not** recorded in the run index: that index feeds baseline resolution, which
expects a review report. A **disabled** run writes nothing at all.

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
  "schemaVersion": "1.1",
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
    "referenceCount": 4,
    "testReferenceCount": 1,
    "nonSourceReferenceCount": 3
  },
  "symbols": [
    {
      "name": "legacyApi",
      "kind": "export",
      "language": "typescript",
      "definitionPath": "src/legacy.ts",
      "definitionLine": 1,
      "changeKind": "deleted",
      "contractChanges": [],
      "references": [
        {
          "path": "src/caller.ts",
          "line": 2,
          "text": "import { legacyApi } from \"./legacy.js\""
        }
      ],
      "testReferences": [
        {
          "path": "src/caller.test.ts",
          "line": 4,
          "text": "expect(legacyApi()).toBe(1)"
        }
      ],
      "referencesInDefinitionFile": 0,
      "referencesInNonSourceFiles": 3,
      "referencesTruncated": false
    }
  ],
  "warnings": []
}
```

- `symbols` lists one entry per changed symbol, in path then line order. A symbol
  with an empty `references` array means nothing outside its own file refers to
  it, which is a real result and not an omission.
- `contractChanges` says what changed about the symbol itself, in the terms a
  caller can observe: whether it can now be absent, now fail, return on a path it
  did not, gained or lost a condition, mutates state, became asynchronous. It is
  what makes the reference list mean something — *"may now yield an absent value"*
  tells you which of forty call sites to open, where *"was modified"* does not.
  Each entry is derived from the diff lines inside the symbol's own span, and only
  when the change is **asymmetric**: a function that already threw and still
  throws is not reported as newly failing.
  An **empty list is the common case and does not mean "safe"** — it means the
  change altered nothing this deterministic reading can show reaching a caller.
  It is always empty for a symbol in a new or deleted file, because neither has
  two sides to compare; `changeKind` is the statement there. And because this
  reads the changed TEXT rather than resolved types, it is a signal, never a
  proof.
- `references` lists production sites **outside** the defining file only. Sites
  inside it are counted in `referencesInDefinitionFile` rather than listed,
  because a symbol's own file is not a dependent.
- `testReferences` lists sites in test files, in the same shape. A test that
  calls a changed symbol genuinely is a dependent — it breaks — so it is listed
  in full; it sits in its own bucket because it breaks in CI rather than in
  production, and because on a large change test call sites can outnumber the
  production ones you are looking for. A site counts as test-side when its file
  follows the language's own test convention (`*.test.ts`, `*_test.go`,
  `test_*.py`, `*Test.java`, …) **or** when it sits inside a test tree — a `test`,
  `tests`, `spec`, `specs` or `__tests__` directory. The second half is what puts
  fixtures and shared harness helpers in this bucket: they hold no test case of
  their own, and nothing in production depends on them either.
- `referencesInNonSourceFiles` counts matches in files no supported language
  covers — documentation, specification prose, fixture data, snapshots. Those are
  **counted but never listed**: a symbol name inside a JSON fixture or a prose
  paragraph is textual coincidence, not a dependency. The count is reported so the
  report cannot look cleaner than the search actually was.
- `referencesTruncated` is `true` when `changeImpact.maxReferencesPerSymbol` cut
  the list short, so a bounded list is never mistaken for a complete one. The cap
  applies to the search, ahead of the split above, so a truncated result can be
  short in any bucket. The same applies to `summary.changedSymbolsTruncated` and
  `changeImpact.maxChangedSymbols`.
- `summary.referenceCount` counts production references only;
  `testReferenceCount` and `nonSourceReferenceCount` are reported beside it rather
  than folded into it. `referencedSymbolCount` counts symbols with at least one
  **listed** reference.
- `changeKind: "deleted"` means the symbol's whole file was removed. Every symbol
  a deleted file declared is reported, since none of them survive.
- Reference matching is **identifier-bounded**, not substring: seeding from `get`
  does not match `forget` or `widget`. Matched line text is redacted with the
  same redactor the mediated file read uses, and capped at 300 characters — the
  text is there to recognise a reference, while `path` and `line` locate it.
- Reference sites obey [`paths.include` and
  `paths.exclude`](./configuration/review.md): the files searched for references
  are the same files `review` would review. Excluding a directory from review
  therefore also excludes it as a reference destination.
- Files in a language the deterministic signal extractors do not cover contribute
  no symbols and produce a warning rather than an error.

## `codereviewer intent check`

```
codereviewer intent check [--config <path>] [--base-ref <ref>] [--head-ref <ref>]
                         [--format json|markdown]
```

| Flag | Value | Notes |
| --- | --- | --- |
| `--config` | path | Config file path override. |
| `--base-ref` | git ref | Overrides `review.baseRef`. |
| `--head-ref` | git ref | Overrides `review.headRef`. |
| `--format` | `json` (default), `markdown` | What goes to stdout. The Markdown artifact is written either way. |

`intent` accepts no subcommand other than `check` (`Expected command: intent
check`, exit `2`). Stdout is the report JSON by default, so existing scripted use
is unchanged; `--format markdown` puts the rendered mapping there instead.

A **completed** run also writes a run directory under
[`paths.artifactDir`](./configuration/review.md#paths), the same place `review`
writes its artifacts:

| Artifact | Content |
| --- | --- |
| `intent-report.md` | The rendered mapping — obligations the change does not evidence first, then the undecidable ones, then the evidenced ones with their citations, then changed files no obligation cites. |
| `intent-report.json` | The same report, byte-identical to what `--format json` prints. |

The directory is named `intent-<uuid>` and the path of the Markdown file is
printed to **stderr** so stdout stays exactly one JSON document. Intent runs are
**not** recorded in the run index: that index feeds baseline resolution, which
expects a review report. The four outcomes that map nothing — `disabled`,
`no-intent`, `unusable-intent`, `provider-unavailable` — write nothing at all.
`no-intent` is the ordinary outcome for a change with a thin description, and a
run directory per invocation for it would litter a repository that never asked
for the stage.

**This command reports a mapping, not a verdict.** It reads the change's stated
intent — the pull-request description, a linked ticket, a commit body, whatever
[`contextSources`](./configuration/context-and-evaluation.md#contextsources)
supplies — turns it into discrete obligations, and for each one says either
"these changed lines address it" or "nothing here does". It does **not** say
whether the change is complete, correct, or acceptable.

Because of that, **nothing it reports can set a non-zero exit code**. A run that
evidences no obligation at all exits `0`.

### Exit codes, and the three input limits

| Exit | When |
| --- | --- |
| `0` | The command ran and produced a report — any `status`, any mapping. |
| `2` | Configuration or usage failure. |
| `3` | Repository failure, such as an unresolvable ref. |
| `4` | An input limit bound. The command refused to judge an input it could not see whole. |

The three limits at exit `4` are not verdicts on the change — they are the
command declining to answer from a partial input:

| Code | When | Recovery |
| --- | --- | --- |
| `intent_change_too_large` | The change has more citable lines than `intentFulfilment.maxChangeLines` allows (default `5000`, which is also the ceiling). | Narrow the base/head range, or split the change. |
| `intent_text_too_large` | The stated intent exceeds `intentFulfilment.maxIntentBytes` (default `100000`, ceiling `200000`). | Raise the limit, or point `contextSources` at the section under review rather than the whole document. |
| `intent_too_many_obligations` | The intent yielded at least as many obligations as `intentFulfilment.maxObligations` allows (default `100`, which is also the ceiling). | Check the change against a smaller slice of the stated intent and run the rest separately. |

Each fails **before** any truncation: the message says what bound, what the
configured value is, and whether raising it is possible at all. The alternative —
truncating — produced a plausible-looking report from an input the command had
only partly seen, and reported obligations as not-evidenced whose evidence was
simply never shown.

One cut is **disclosed instead of refused**, because the cap belongs to the
ingestion providers rather than to this command: a `contextSources` provider that
trimmed a source at its own `maxFileBytes` (default `64000`, *below*
`maxIntentBytes`) lets the run complete with `scope.intentTruncated: true`, a
warning naming the cut sources, and a paragraph above the obligation lists in
`intent-report.md` saying they are a floor rather than a total. `intent_text_too_large`
also reports its measured intent size as *at least* N bytes when any source arrived
already cut, since the figure is summed over bodies that understate what they stand
for. See [`intentFulfilment`](./configuration/intent-fulfilment.md#when-the-intent-arrives-already-cut).

### Why this one can never gate

Advisory here is a **requirement**, not a default, and it is not configurable.

- **Product.** A pull request need not fully implement a ticket. Partial work,
  follow-ups, and deliberately deferred scope are normal, so a gate on ticket
  completeness would block correct work routinely.
- **Technical, and this is the binding reason.** Published measurement of models
  judging requirement conformance reports systematic over-rejection: spurious
  rejection at **26–36%**, rising to **73–88%** when the same call is also asked
  to explain its judgement or propose a fix. A hard gate built on that would be
  wrong most of the time it fired.

The second figure is also why the command issues **three different kinds of
call** rather than one. Obligations are extracted before any verdict exists;
each judgement is a call whose output schema has **no free-text field at all** —
a status and cited lines, nothing else — so a model cannot argue itself into a
rejection while reaching one; and the explanation is a separate call that reads
an already-frozen mapping and cannot change it.

### What it costs

One extraction call, one judgement call per obligation, and one explanation call
per run. Bound it with
[`intentFulfilment.maxObligations`](./configuration/intent-fulfilment.md).

It is **disabled by default**. With `intentFulfilment.enabled` left at `false`
the command exits `0` and reports `"status": "disabled"` rather than an empty
result. Enable it with:

```json
{
  "provider": { "id": "openai", "model": "your-model" },
  "intentFulfilment": { "enabled": true },
  "contextSources": {
    "enabled": true,
    "providers": [{ "type": "inbox", "dir": ".codereviewer/context" }]
  }
}
```

### When there is nothing to map

Four of the five statuses say so plainly rather than emitting an empty mapping,
and all of them exit `0`:

| `status` | Means |
| --- | --- |
| `disabled` | `intentFulfilment.enabled` is `false`. |
| `no-intent` | No change-intent source is configured, or the configured ones produced nothing. **Most changes have thin descriptions; this is the ordinary case.** |
| `unusable-intent` | Intent was gathered but no checkable obligation could be read from it. |
| `provider-unavailable` | Intent was gathered and no model was available to read it. |
| `completed` | A mapping was produced. |

### Report shape

```json
{
  "schemaVersion": "1.0",
  "status": "completed",
  "generatedAt": "2026-07-30T00:00:00.000Z",
  "scope": {
    "baseRef": "main",
    "headRef": "HEAD",
    "mergeBaseRef": "9f1c2ab...",
    "changedFileCount": 2,
    "changedLineCount": 2,
    "intentOrigins": ["inbox:tracker/A-1"],
    "intentTruncated": false
  },
  "summary": {
    "intentFragmentCount": 1,
    "obligationCount": 2,
    "evidencedCount": 1,
    "notEvidencedStatusCount": 1,
    "undeterminedCount": 0,
    "notEvidencedCount": 1,
    "obligationsTruncated": false,
    "uncitedObligationCount": 0,
    "unverifiedEvidenceClaimCount": 0,
    "extraScopeFileCount": 1
  },
  "obligations": [
    {
      "id": "obl_1",
      "source": {
        "origin": "inbox:tracker/A-1",
        "line": 1,
        "text": "Reject tokens older than five minutes."
      },
      "statement": "Reject old tokens.",
      "status": "evidenced",
      "evidence": [
        {
          "path": "src/token.ts",
          "line": 2,
          "text": "export const rejectExpired = (age) => age > 300"
        }
      ]
    },
    {
      "id": "obl_2",
      "source": {
        "origin": "inbox:tracker/A-1",
        "line": 2,
        "text": "Record every refusal in the audit log."
      },
      "statement": "Log every refusal.",
      "status": "not-evidenced"
    }
  ],
  "extraScope": [{ "path": "src/unrelated.ts", "changedLineCount": 1 }],
  "explanation": "The change rejects old tokens; nothing in it evidences the audit-log requirement.",
  "warnings": [],
  "usage": { "inputTokens": 1840, "outputTokens": 96, "costUsd": 0.0034 }
}
```

- **The status words say what was SHOWN, not what was done.** The judgement is
  given only the lines this change touched, so `evidenced` means "these changed
  lines show it" and `not-evidenced` means "nothing in these changed lines shows
  it" — which is **not** the same as "the work is undone". An obligation an earlier
  commit already satisfied, or one that asks for something *not* to happen, is
  correctly `not-evidenced` here. The words were renamed on 2026-08-01 for exactly
  this reason: 54 of the lane's 83 apparent false positives were readers taking
  `unaddressed` to mean "outstanding work". `summary.notEvidencedCount` is
  `not-evidenced` + `undetermined`.
- **`source` is on every obligation, including the ones with no evidence.** It is the
  origin and line of the stated intent the obligation was read out of, and the
  `text` is resolved from that line rather than repeated back by the model. An
  obligation whose citation does not resolve is **not reported at all**, and is
  counted in `summary.uncitedObligationCount`. An obligation nobody wrote is not
  an obligation.
- **`evidence` exists only on `evidenced`, and always holds at least one entry.**
  Every cited line is checked against the lines the diff actually touched; an
  `evidenced` verdict whose citations do not survive that check is reported as
  `undetermined` and counted in `summary.unverifiedEvidenceClaimCount`. A
  satisfaction claim with nothing behind it is the most harmful thing this
  command could print, because it tells you to stop looking.
- `undetermined` means the judgement could not be made — including when the call
  failed. It asserts nothing about the change in either direction.
- **`extraScope` is neutral.** It lists changed files no obligation's evidence
  cites. A change doing more than the ticket asked is normal and frequently
  desirable, so the entry carries a path and a line count and nothing else —
  there is no field in which a severity or a verdict could be recorded.
- `explanation` is written by a **separate** model call that reads the frozen
  mapping above. It is absent when that call did not run or returned nothing.
- `intentOrigins` are the change-intent source labels the obligations were read
  from, minted by the same ingestion `review` uses.
- Changed files obey [`paths.include` and
  `paths.exclude`](./configuration/review.md): a directory excluded from review
  can neither be judged against an obligation nor appear in `extraScope`.

## Related

- [Configuration reference](./configuration/README.md)
- [Environment variables](./environment.md)
- [Exit codes and error codes](./exit-codes-and-error-codes.md)
- [Artifacts](./artifacts.md)
