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
| `intent check` | Map the change's stated intent onto the change, obligation by obligation. | `0`, `2`, `3` |
| `conformance check` | List where a changed declaration differs from a pattern its peers share. | `0`, `2`, `3` |

Anything else exits `2` with `{"code":"usage_error", ...}` on stderr and the
message `Expected command: config validate, review, baseline write, eval run,
eval compare, eval recall-report, eval slice-manifest, drift check, impact
check, intent check, or conformance check`.

`review` is the only command that can fail a pipeline on what it found.
`impact check`, `intent check` and `conformance check` are advisory: they run
independently of each other and of `review`, share none of each other's context
or output, and always exit `0` when they run at all.

See [exit-codes-and-error-codes.md](./exit-codes-and-error-codes.md) for the
full mapping.

## Argument-parsing rules (apply to every command)

| Rule | Detail |
| --- | --- |
| Unknown flags | **Rejected before the command does any work**, with exit `2` and `{"code":"usage_error"}` naming the flag. Every command declares its own option set; a flag one command accepts is still unknown to another. A parser that ignored a flag it does not implement would let a run proceed as though the flag had been honoured, which this project paid for twice. |
| Flag/value form | `--flag value`. `--flag=value` is not supported; it is checked on the flag name alone, so a known flag in the joined form is rejected by name rather than mistaken for an unknown one. |
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
  production ones you are looking for. Test files are recognised by each
  language's own convention (`*.test.ts`, `*_test.go`, `test_*.py`, `*Test.java`,
  …).
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
```

| Flag | Value | Notes |
| --- | --- | --- |
| `--config` | path | Config file path override. |
| `--base-ref` | git ref | Overrides `review.baseRef`. |
| `--head-ref` | git ref | Overrides `review.headRef`. |

`intent` accepts no subcommand other than `check` (`Expected command: intent
check`, exit `2`). Stdout is the report JSON; nothing is written to disk.

**This command reports a mapping, not a verdict.** It reads the change's stated
intent — the pull-request description, a linked ticket, a commit body, whatever
[`contextSources`](./configuration/context-and-evaluation.md#contextsources)
supplies — turns it into discrete obligations, and for each one says either
"these changed lines address it" or "nothing here does". It does **not** say
whether the change is complete, correct, or acceptable.

Because of that, **the exit code is always `0`** when the command runs at all,
including when no obligation is evidenced. Only a configuration or usage
failure (`2`) or a repository failure such as an unresolvable ref (`3`) changes
it.

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
    "changedLinesTruncated": false,
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

## `codereviewer conformance check`

```
codereviewer conformance check [--config <path>] [--base-ref <ref>] [--head-ref <ref>]
```

| Flag | Value | Notes |
| --- | --- | --- |
| `--config` | path | Config file path override. |
| `--base-ref` | git ref | Overrides `review.baseRef`. |
| `--head-ref` | git ref | Overrides `review.headRef`. |

`conformance` accepts no subcommand other than `check` (`Expected command:
conformance check`, exit `2`). Stdout is the report JSON; nothing is written to
disk.

**This command reports divergences, not defects.** A divergence is one sentence:
*"thirteen of fifteen sibling declarations call `requireAuth`; this one does
not."* That is a fact about your codebase, with the peers listed by path and line
so you can check it yourself. It is **not** a claim that the code is wrong,
insecure, or exploitable — deviating from a convention is frequently deliberate,
and the command has no way to know which case yours is. Nothing here carries a
severity, nothing is admitted, and nothing can block a pipeline.

Because of that, **the exit code is always `0`** when the command runs at all,
whether or not anything is found. Only a configuration or usage failure (`2`) or
a repository failure such as an unresolvable ref (`3`) changes it.

By default the command makes **no model provider call**: it costs nothing to run
and its output is reproducible. One optional step
([adjudication](#adjudication-is-the-shared-pattern-a-convention), off by
default) issues one bounded model call per divergence.

It is **disabled by default**. With `invariantConformance.enabled` left at
`false` the command exits `0` and reports `"status": "disabled"` rather than an
empty result, so a disabled run can never be mistaken for "no divergences".
Enable it with:

```json
{ "invariantConformance": { "enabled": true } }
```

### How a divergence is found

Every step is deterministic and none of it involves a model.

1. **Seed.** The declarations whose body the diff touched, from the same
   deterministic signal extractors `review` uses. **Test files are skipped**, as
   a seed and as a peer: a test's siblings are other tests, and the pattern they
   share is the vocabulary of the test harness rather than a convention of the
   system under review.
2. **Peer set.** Sibling declarations of the same kind, in the same language, at
   the same nesting depth, in the changed declaration's own file and its own
   directory. Nothing wider is searched.
3. **Pattern.** For each peer set, the traits a **strict majority** of the peers
   share. A trait is a called symbol, a symbol called inside a conditional, or
   the first argument of a call — together with **where in the declaration it
   sits**, so the same symbol used in two structurally different places is two
   traits. See [Trait position](#trait-position) below.
4. **Divergence.** A majority pattern one member does not hold — reported only if
   **at least three peers** hold it. Below three there is no pattern, only a
   coincidence, and nothing is reported.

### Trait position

A trait carries a coarse structural position, read from indentation alone. There is
no parser and no per-language rule.

| dimension | values |
|---|---|
| depth | `surface` — the declaration's header line and the two indentation levels under it. `nested` — three levels or deeper. |
| terminality | `exit` — nothing materially shallower follows inside the declaration. `interior` — the declaration carries on at a shallower level afterwards. |

The bands are wide on purpose. Indentation cannot tell a nested block from a
wrapped expression, so a chained call split across lines, or a call written on the
declaration's own line rather than the next one, is the **same** position — otherwise
reformatting a file would produce divergences.

A divergence therefore reads one of two ways:

- the declaration never uses the symbol —
  *"3 of 3 sibling declarations call `requireAuth`; `ExportUsers` does not."*
- the declaration uses it somewhere structurally different —
  *"7 of 12 sibling declarations call `string` on the declaration's exit path;
  `ReviewReportSchema` does so inside a nested block."*

One divergence is reported per symbol, so a pattern held at two positions at once
is never reported twice.

**What this does not do.** It compares whole declarations, positioned. It does not
segment a declaration into branches, so a declaration that upholds a pattern in three
branches of a switch and abandons it in a fourth still holds the trait — unless the
fourth sits at a materially different depth.

### Adjudication: is the shared pattern a convention?

The steps above can prove that a majority of the peers do something this
declaration does not. They cannot tell whether that something is a **practice the
peers keep** or an **incidental resemblance**. On a schema-heavy module the shared
trait is a library builder call; on a package of request handlers it is an
authorization check. Both look identical to a lexical extractor.

Adjudication asks a model that one question, per divergence, and is **off by
default**:

```json
{
  "invariantConformance": {
    "enabled": true,
    "adjudication": { "enabled": true, "maxAdjudications": 25 }
  }
}
```

It requires a configured [`provider`](./configuration/provider.md). With
adjudication enabled and no usable provider the command still exits `0`, reports
the divergences unjudged, and says so in `warnings`.

What the model is asked, and what it is not:

- It is asked **whether the named peers share a deliberate practice**. It is never
  asked whether the code is vulnerable, exploitable or insecure — that question
  produces an answer whether or not there is anything to find.
- It gets **no tools and no repository access**. One divergence, its peers, the
  trait, and what else the peers have in common. It cannot search.
- It may answer `convention`, `incidental`, or `undetermined`.

Only `convention` is reported. `incidental` and `undetermined` remove the
divergence from the report and appear only as counts in `summary.adjudication`, so
a short report is always explainable:

| Count | Meaning |
| --- | --- |
| `requestedCount` | Divergences submitted for adjudication. |
| `conventionCount` | Judged a convention, and therefore reported. |
| `incidentalCount` | Judged an incidental resemblance, and not reported. |
| `undeterminedCount` | The model could not decide. Not reported. |
| `failedCount` | The call did not complete. Not reported. |
| `unadjudicatedCount` | Beyond `maxAdjudications`, so never judged. Not reported. |

`requestedCount` equals the four verdict counts added together, and
`requestedCount + unadjudicatedCount` is every divergence the deterministic steps
produced. `mode` is `deterministic` when no call was made and `model` when calls
were.

Everything unclear resolves towards **silence**: a malformed answer, a verdict the
model did not state plainly, a convention asserted with no reason, a failed call
and an exhausted bound all drop the divergence rather than report it. The change is
therefore that adjudication can only ever make the report **shorter** — it can
remove a divergence and attach a reason, never add or alter one.

### Report shape

```json
{
  "schemaVersion": "1.0",
  "status": "completed",
  "generatedAt": "2026-07-29T00:00:00.000Z",
  "scope": {
    "baseRef": "main",
    "headRef": "HEAD",
    "mergeBaseRef": "9f1c2ab...",
    "changedFileCount": 1,
    "peerFileCount": 2,
    "peerFilesTruncated": false
  },
  "summary": {
    "changedDeclarationCount": 1,
    "changedDeclarationsTruncated": false,
    "peerSetCount": 1,
    "changeAttributedDivergenceCount": 1,
    "preExistingDivergenceCount": 0,
    "changeAttributedDivergencesTruncated": false,
    "preExistingDivergencesTruncated": false,
    "adjudication": {
      "mode": "model",
      "requestedCount": 2,
      "conventionCount": 1,
      "incidentalCount": 1,
      "undeterminedCount": 0,
      "failedCount": 0,
      "unadjudicatedCount": 0
    }
  },
  "changeAttributedDivergences": [
    {
      "id": "conf_1b2c3d...",
      "attribution": "change-attributed",
      "declaration": {
        "path": "src/handlers/remove.ts",
        "line": 1,
        "endLine": 3,
        "name": "removeOne",
        "kind": "export",
        "language": "typescript"
      },
      "pattern": { "kind": "call", "symbol": "requireAuth" },
      "peerScope": "directory",
      "peerCount": 3,
      "citedPeerCount": 3,
      "citedPeers": [
        { "path": "src/handlers/read.ts", "line": 1, "name": "readOne" },
        { "path": "src/handlers/read.ts", "line": 7, "name": "readAll" },
        { "path": "src/handlers/write.ts", "line": 1, "name": "writeOne" }
      ],
      "peersTruncated": false,
      "statement": "3 of 3 sibling declarations call requireAuth; removeOne does not.",
      "question": "Is calling requireAuth a convention removeOne should follow, or do those peers merely resemble each other?",
      "adjudication": {
        "verdict": "convention",
        "reason": "The siblings all authorize the request before loading it."
      }
    }
  ],
  "preExistingDivergences": [],
  "warnings": [],
  "usage": { "inputTokens": 812, "outputTokens": 46, "costUsd": 0.0021 }
}
```

- `statement` and `question` are the whole output contract: a substantiated fact,
  and a question for you. There is no field in which a verdict on the CODE could be
  recorded.
- `adjudication` is present only when adjudication ran and answered `convention`.
  Its `verdict` can hold no other value: `incidental` and `undetermined` are not
  representable in a divergence entry, so neither can be misread as something
  found. Divergences from a run with adjudication off carry no `adjudication` at
  all, and `summary.adjudication.mode` is what says which arm ran.
- `usage` is present only when adjudication issued a call. Nothing else in this
  command spends anything.
- `citedPeers` is the evidence, and it always holds at least three entries. If
  the statement looks wrong, open those three lines — that is what they are for.
- `preExistingDivergences` holds divergences **the change did not cause**: a peer
  set where the odd one out is untouched code. They are reported because "this
  handler is the only one without an auth check" is worth knowing, and they are a
  **separate array with its own count** so they can never inflate the
  change-attributed number. Set `invariantConformance.maxPreExistingDivergences`
  to `0` to suppress them.
- `pattern.kind` is `call` (the peers call a symbol), `guard` (the peers call it
  inside a conditional, and this declaration calls it outside one), or
  `call-argument` (the peers call it with a particular first argument, and this
  declaration passes something else). A declaration that omits a call entirely
  reports one `call` divergence rather than restating it as all three.
- `peerScope` says whether the peers came from the declaration's own file or its
  directory. `peersTruncated` is `true` when
  `invariantConformance.maxPeersPerDeclaration` bounded the comparison, so a
  bounded majority is never mistaken for a complete one.
- Peer files obey [`paths.include` and
  `paths.exclude`](./configuration/review.md): a directory excluded from review
  cannot supply a peer.
- Files in a language the deterministic signal extractors do not cover contribute
  no declarations and produce a warning rather than an error. For TypeScript and
  JavaScript only **exported** declarations are visible, because that is what the
  extractor reports; for Java only types are, not methods.
- A changed declaration with no sibling in its file or directory produces no peer
  set at all, and the run says so in `warnings` rather than reporting nothing.

## Related

- [Configuration reference](./configuration/README.md)
- [Environment variables](./environment.md)
- [Exit codes and error codes](./exit-codes-and-error-codes.md)
- [Artifacts](./artifacts.md)
