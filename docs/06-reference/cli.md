# CLI Reference

Binary: `codereviewer` (`package.json` `bin` → `dist/cli/main.js`).
From a source checkout: `npm run cli -- <command> [flags]`.

Every command is a fixed word pair or single word. There is no `--help` and no
`--version`. A flag and its value may be written either way: `--config path` and
`--config=path` are both accepted, everywhere.

Source of truth: [`src/cli/index.ts`](../../src/cli/index.ts) (command dispatch),
[`src/cli/commands/`](../../src/cli/commands/) (one module per command, each
declaring the flags it accepts) and [`src/cli/args.ts`](../../src/cli/args.ts)
(parsers). Only the flags listed below are parsed.

## Commands

| Command | Purpose | Exit codes |
| --- | --- | --- |
| `config validate` | Load, merge, and validate config; print the redacted normalized config. | `0`, `2` |
| `review` | Run a review, write run artifacts, evaluate the quality gate. | `0`, `1`, `2`, `3`, `4`, `5` |
| `baseline write` | Build `baseline.json` from a completed review report. | `0`, `2`, `3` |
| `eval run` | Run the evaluation harness over eval cases and apply the regression gate. | `0`, `1`, `2`, `3`, `5` |
| `eval compare` | Diff two eval arms (repeatable `--base` / `--head`). | `0`, `2` |
| `eval recall-report` | Render the recall report from one or more eval reports. | `0`, `2` |
| `eval slice-manifest` | Emit a manifest (with digest) for a benchmark slice directory. | `0`, `2`, `3` |
| `drift check` | Run the drift gate. | `0`, `1`, `2`, `3` |
| `impact check` | List where a change's symbols are referenced, and which dependents rely on what changed. | `0`, `2`, `3` |
| `intent check` | Map the change's stated intent onto the change, obligation by obligation. | `0`, `2`, `3`, `4` |

Anything else exits `2` with `{"code":"usage_error", ...}` on stderr and the
message `Expected command: config validate, review, baseline write, eval run,
eval compare, eval recall-report, eval slice-manifest, drift check, impact
check, or intent check`.

`review` is the only command that can fail a pipeline on what it found.
`impact check` and `intent check` are advisory: neither can exit non-zero on
what it reported. Run standalone, they are independent of each other and of
`review`, each with its own isolated run and context. But when
`changeImpact.enabled` / `intentFulfilment.enabled` are on, `review` also runs
both lanes itself, **in the same process, over the same run context it built
for the review**, wrapping each so a lane failure becomes a warning on the
review report rather than a failed pipeline — see
[`src/cli/advisory-lanes.ts`](../../src/cli/advisory-lanes.ts). Their output
in that case is written as `impact-report.json` / `intent-report.json` (JSON
only) into `review`'s own run directory, not a separate `impact-<uuid>` /
`intent-<uuid>` one. `intent check` does refuse to run on an input it cannot
see whole — three input limits fail the command with exit `4` rather than
judging a partial input, which is a different thing from a verdict. See [its
exit codes](#exit-codes-and-the-three-input-limits).

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
| `--file` | repository-relative path | yes | Adds one explicit file. Explicit-file runs bypass git diffing entirely (no `mergeBaseRef` in the run summary), so the change-impact and intent-fulfilment stages produce no report on such a run — each is defined over a base/head diff and says so in a run warning. Use `impact check` / `intent check` over refs instead. |
| `--files` | comma-separated paths | no (first wins) | Same as repeating `--file`; entries are trimmed and empties dropped. Combines with `--file`. |
| `--debug` | — | no | Sets `observability.logging.level` to `debug`. Takes precedence over `--log-level` when both are present. |
| `--log-level` | `trace`\|`debug`\|`info`\|`warn`\|`error`\|`fatal`\|`silent` | no | Sets `observability.logging.level` at CLI precedence (highest). |
| `--log-file` | repository-relative path | no | Appends JSONL logs to this file. The file is **never truncated**; each invocation appends a `{"event":"log-run-start", ...}` header line. Parent directories are created. |

There are no `--mode`, `--depth`, `--severity`, `--format`, or threshold flags on
`review`. Use the config file or the environment variables in
[environment.md](./environment.md).

Stdout on completion (gate passed or failed):

```json review-stdout
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

```json baseline-write-stdout
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
codereviewer eval compare [--base <path>]... [--head <path>]...
```

| Flag | Value | Repeatable | Required |
| --- | --- | --- | --- |
| `--base` | path to an eval report JSON | yes | yes |
| `--head` | path to an eval report JSON | yes | yes |

Each flag defines one ARM, and an arm may hold several runs. The paired recall
verdict pools every run of an arm into one observation per expectation.

Missing either flag → exit `2`, `eval compare requires --base and --head report
paths`. Unequal arm sizes → exit `2`, `eval compare requires the same number of
--base and --head reports`. Stdout is the rendered comparison; nothing is written
to disk. See [Comparing runs](../05-quality/comparing-runs.md) for the decision
procedure.

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
| `impact-report.md` | The rendered report — the dependents shown to rely on the change first, then one section per destination file with the ones using a symbol whose contract moved ahead of the rest, test files listed separately, then the symbol table and the scope of the search. |
| `impact-report.json` | The same report, byte-identical to what `--format json` prints. |

The directory is named `impact-<uuid>` and the path of the Markdown file is
printed to **stderr** so stdout stays exactly one JSON document. Impact runs are
**not** recorded in the run index: that index feeds baseline resolution, which
expects a review report. A **disabled** run writes nothing at all.

The report has two layers. The **reference lists** name the symbols the change
touched and every file that references them — bounded, deterministic, and
untriaged. **`impactFindings`** is the triaged subset: the dependents that were
checked against the part of the contract that changed, each with the line, the
contract element relied upon and the consequence. Everything outside
`impactFindings` is a file that *uses* a changed symbol, not one shown to rely on
what changed.

**The exit code is always `0`** when the command runs at all, whether or not
anything was found. Only a configuration or usage failure (`2`) or a repository
failure such as an unresolvable ref (`3`) changes it. Nothing carries a severity
and nothing can block a pipeline — a breaking change is frequently intentional,
and the command's job is to show you the dependents, not to decide whether
breaking them is acceptable.

The command is **enabled by default**, but its adjudication layer is a
**separate switch that stays off** — turning adjudication on is the one line
worth writing explicitly, since `changeImpact.enabled` itself no longer is:

```json
{ "changeImpact": { "adjudication": { "enabled": true } } }
```

With `changeImpact.enabled` set to `false` the command exits `0` and reports
`"status": "disabled"` rather than an empty result, so a disabled run can never be
mistaken for "nothing depends on your change".

With `changeImpact.adjudication.enabled` left at `false` — its default even when
the command is on — **no model provider call is made at all**: the run costs
nothing and its output is reproducible. See
[Adjudication](#adjudication-which-dependents-actually-rely-on-the-change).

### Adjudication: which dependents actually rely on the change

A reference list alone is mostly noise, and not by a small margin: published
measurement across 119,879 dependency upgrades and 293,817 clients finds that only
**7.9%** of clients are affected by a given breaking change. Adjudication is the
step that asks, per dependent, whether it relies on the part of the contract that
moved.

**Most of that needs no model.** A dependent of a **removed**, **relocated** or
**newly added** declaration is settled deterministically — the question is whether
the name still resolves, and the search already answered it. Only a dependent of a
symbol whose *behaviour* changed costs a model call, one per (dependent file,
changed symbol) pair, bounded by `changeImpact.adjudication.maxCalls`.

Findings carry a **compatibility class**, not a severity:

| Class | What it states |
| --- | --- |
| `breaks-on-build` | The declaration this file names is gone. How the file uses it does not matter — the reference cannot resolve. |
| `breaks-at-runtime` | The declaration still exists under the same name, so a build sees nothing. What moved is behaviour, and this file was shown to use the part that moved. |
| `may-break` | The mechanism is known and the outcome is not — the declaration moved, or it was removed and this run could not verify that no replacement was added. Someone has to look. |

There is no `no-impact` class in the output. A dependent found not to rely is
**counted, never listed** — reporting it would be manufacturing a finding.

`adjudicationStatus` says how much of the check ran, and you need it to read an
empty `impactFindings`:

| Value | What an empty finding list means |
| --- | --- |
| `disabled` | Nothing was checked. This is the default. |
| `no-model` | The dependents needing no model were checked; everything else was not. |
| `completed` | Both tiers were equipped to run, and nothing was shown to rely on what changed. This is an answer. |

**Absence from `impactFindings` is never a statement that a dependent is
unaffected.** `summary.unadjudicatedPairCount` counts every dependent no
adjudicator settled: no model available, a call that failed, an answer that could
not decide, or a pair past the call cap.

**`completed` does not mean the model ran.** Adjudication is two tiers, and the
summary keeps them apart rather than reporting one "not affected" total:

| Field | What it counts |
| --- | --- |
| `deterministicNoImpactPairCount` | Dependents settled in code, with no call: a symbol this change adds, or a symbol whose change nothing caller-observable was detected for. |
| `modelVerdictCounts` | What the model answered on the residue — `relies`, `does-not-rely` (the model tier's own not-affected count), `undetermined`. |
| `adjudicationCallCount` | Model calls spent, failures included. **Zero means the model was never asked**, and no number in the report is then a model's judgement. |
| `failedAdjudicationCallCount` | Of those calls, the ones that did not complete. |

A change whose symbols carry no detected contract change produces a `completed`
run with zero calls, and the report says so in words rather than printing a `0`
that reads like a verdict.

**This layer is unmeasured.** No accuracy figure for it exists, and none is quoted
here. It is designed to cut the reference list down to the dependents that are
exposed; whether it does, and how well, has not been measured. The comparable
published system for this task reaches 28% precision, so treat every finding as a
pointer to something worth opening rather than as a verdict.

A run that made a model call reports `usage` (tokens and cost). A run that made
none omits the field entirely, rather than reporting zeros.

### Report shape

The report has three parts. `impactFindings` is the triaged list. `impactedFiles`
is the untriaged reference list a reviewer works through — **one entry per
destination file**, with the changed symbols that reach it named on it and their
sites nested beneath. `changedSymbols` is the symbol-side table: what the change
altered about each symbol, and how far the search could see.

```json impact-report
{
  "schemaVersion": "1.0",
  "status": "completed",
  "adjudicationStatus": "completed",
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
    "impactedFileCount": 1,
    "impactedTestFileCount": 1,
    "referenceCount": 4,
    "testReferenceCount": 1,
    "nonSourceReferenceCount": 3,
    "impactFindingCount": 1,
    "reliedUponPairCount": 1,
    "deterministicNoImpactPairCount": 1,
    "unadjudicatedPairCount": 0,
    "adjudicationCallCount": 1,
    "failedAdjudicationCallCount": 0,
    "modelVerdictCounts": {
      "relies": 0,
      "does-not-rely": 1,
      "undetermined": 0
    },
    "adjudicationCallsTruncated": false,
    "rejectedFindingCount": 0
  },
  "impactFindings": [
    {
      "id": "impact_9f1c2ab3d4e5f6071829",
      "path": "src/caller.ts",
      "destination": "production",
      "compatibilityClass": "breaks-on-build",
      "reliances": [
        {
          "symbolName": "legacyApi",
          "definitionPath": "src/legacy.ts",
          "definitionLine": 1,
          "line": 2,
          "contractElement": "the declaration of legacyApi, which this change removes",
          "consequence": "this file references a name the change no longer declares, so the reference does not resolve",
          "adjudicatedBy": "deterministic"
        }
      ]
    }
  ],
  "changedSymbols": [
    {
      "name": "legacyApi",
      "kind": "export",
      "language": "typescript",
      "definitionPath": "src/legacy.ts",
      "definitionLine": 1,
      "changeKind": "deleted",
      "removalPairing": { "match": "none" },
      "contractChanges": [],
      "referencesInDefinitionFile": 0,
      "referencesInNonSourceFiles": 3,
      "referencesTruncated": false,
      "referenceSearchTruncated": false
    }
  ],
  "impactedFiles": [
    {
      "path": "src/caller.ts",
      "symbols": [
        {
          "name": "legacyApi",
          "definitionPath": "src/legacy.ts",
          "definitionLine": 1,
          "sites": [
            { "line": 2, "text": "import { legacyApi } from \"./legacy.js\"" },
            { "line": 4, "text": "export const c = legacyApi()" }
          ]
        }
      ]
    }
  ],
  "impactedTestFiles": [
    {
      "path": "src/caller.test.ts",
      "symbols": [
        {
          "name": "legacyApi",
          "definitionPath": "src/legacy.ts",
          "definitionLine": 1,
          "sites": [{ "line": 4, "text": "expect(legacyApi()).toBe(1)" }]
        }
      ]
    }
  ],
  "warnings": []
}
```

- `impactFindings` holds **one entry per dependent file**, never per site, with a
  `reliances` entry for each changed symbol that file was shown to rely on. Each
  reliance names the symbol, the line **in the dependent**, the contract element
  and the consequence — and whether it was settled `deterministic`ally or by the
  `model`. A finding without a named dependent, or pointing at a line the search
  did not locate, is rejected rather than reported; `summary.rejectedFindingCount`
  counts those.
- `impactedFiles` is reported **per destination file**, not per changed symbol.
  That is the unit a reviewer works in — you open a file, not a line number — and
  three sites in one file are one thing to look at rather than three. Files that
  this change **also touched** are listed first: both sides moved together, which
  is where a mismatch is most likely to have been introduced and least likely to
  have been noticed. Everything after that keeps search order.
- Each entry under a file's `symbols` identifies the changed symbol by the same
  `name` + `definitionPath` + `definitionLine` triple used in `changedSymbols`,
  so the two halves join without guessing. Two symbols that share a name stay
  distinct.
- `impactedTestFiles` holds test destinations, in the same shape and in a
  separate list. A test that calls a changed symbol genuinely is a dependent — it
  breaks — so it is listed in full; it sits apart because it breaks in CI rather
  than in production, and because on a large change test call sites can outnumber
  the production ones you are looking for. A site counts as test-side when its
  file follows the language's own test convention (`*.test.ts`, `*_test.go`,
  `test_*.py`, `*Test.java`, …) **or** when it sits inside a test tree — a `test`,
  `tests`, `spec`, `specs` or `__tests__` directory. The second half is what puts
  fixtures and shared harness helpers in this bucket: they hold no test case of
  their own, and nothing in production depends on them either.
- `changedSymbols` lists one entry per changed symbol, in path then line order,
  **including symbols nothing was found to use**. A symbol with no file entry
  means nothing outside its own file was found to refer to it, which is a real
  result and not an omission.
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
  It is always empty for a symbol that is new, removed or moved, because none of
  those has two comparable sides; `changeKind` is the statement there. And because
  this reads the changed TEXT rather than resolved types, it is a signal, never a
  proof.
- `changeKind` is `new`, `modified`, `deleted` or `moved`. It is a property of the
  **symbol**, not of the file: see [removals below](#removals-are-paired-before-they-are-reported).
- `referencesInDefinitionFile` counts sites inside the symbol's own file. They are
  counted rather than listed, because a file referring to its own symbol is not a
  dependent — and a symbol referenced only there is a real signal.
- `referencesInNonSourceFiles` counts matches in files no supported language
  covers — documentation, specification prose, fixture data, snapshots. Those are
  **counted but never listed**: a symbol name inside a JSON fixture or a prose
  paragraph is textual coincidence, not a dependency. The count is reported so the
  report cannot look cleaner than the search actually was. It is exact over every
  match the search collected, which is the whole search unless
  `referenceSearchTruncated` says otherwise.
- **Two bounds, and two different truncation flags.** The search collects up to
  `changeImpact.maxReferenceCandidatesPerSymbol` matches per symbol; the report
  then lists up to `changeImpact.maxReferencesPerSymbol` sites SELECTED from them,
  production sites before test sites and a file the change also touched before one
  it did not.
  - `referencesTruncated` is `true` when more dependent sites were found than the
    reporting cap lists. The listed ones are the ranked head of a set this run
    examined in full.
  - `referenceSearchTruncated` is `true` when the search stopped at its match
    bound before running out of matches, so matches exist that were never
    examined, ranked or counted anywhere. This is the stronger caveat of the two —
    "there are places I did not look", not "there is more of what you can see" —
    and it is reported separately so it cannot be discounted as the milder one.

  The same "reported, never hidden" rule applies to
  `summary.changedSymbolsTruncated` and `changeImpact.maxChangedSymbols`.
- `summary.referenceCount` counts production sites only; `testReferenceCount` and
  `nonSourceReferenceCount` are reported beside it rather than folded into it.
  `referencedSymbolCount` counts symbols with at least one **listed** reference.
- Reference matching is **identifier-bounded**, not substring: seeding from `get`
  does not match `forget` or `widget`. Matched line text is redacted with the
  same redactor the mediated file read uses, and capped at 300 characters — the
  text is there to recognise a reference, while the file path and `line` locate it.
- Reference sites obey [`paths.include` and
  `paths.exclude`](./configuration/review.md): the files searched for references
  are the same files `review` would review. Excluding a directory from review
  therefore also excludes it as a reference destination.
- Files in a language the deterministic signal extractors do not cover contribute
  no symbols and produce a warning rather than an error.

### Removals are paired before they are reported

A removed declaration is the most severe thing this report can say, and a naive
symbol diff says it about every **move**: rename a file, split a module, or lift a
function into a new one, and every symbol the old path declared looks deleted
while the symbol is present, under the same name, at a new address.

So before a removal is reported, it is paired against the declarations the same
change **adds**. `changedSymbols[].removalPairing` carries the outcome, and the
three outcomes are three different claims:

| `match` | What it means | `changeKind` |
| --- | --- | --- |
| `same-name` | The change adds a declaration of the same name, in the same language, elsewhere. `declaration` gives its `name`, `path` and `line`. Callers of the *name* still resolve; callers of the *path* do not. | `moved` |
| `none` | Every declaration this change adds, in every file the engine can read, was searched and none carries this name. | `deleted` |
| `inconclusive` | Some changed file could not be read, so the added declarations were **not all searched**. `reason` says what was missed. Reported as a removal — the safe direction — but it is not the same claim as `none`. | `deleted` |

The predicate is deliberately the smallest sound one: **same name, same language,
in a file this change adds or modifies**. Signature shape and body similarity are
not consulted, because a false pairing *downgrades a real deletion* — the one
error this must not make. What that does and does not catch is in the
[known-not-reported list](#what-impact-check-knowingly-does-not-report).

### What `impact check` knowingly does not report

A low-recall tool with no published limits reads as a broken one. Everything below
is a **deliberate, verified** gap, not a bug list. None of it produces an error;
it produces silence, so it is written down instead.

**Which changed symbols are found at all**

1. **Only languages the deterministic registry covers seed anything.** A changed
   file in any other language contributes no symbols, so nothing about it is
   reported. This produces a warning when *nothing* was seeded, and silence when
   only some files were unsupported.
2. **A declaration removed from a file that still exists is invisible.** Symbols
   are extracted from the head side, so deleting one function out of a file that
   survives leaves no trace of it: it is not listed, and no dependent of it is
   searched for. Only a removal that takes the **whole file** with it is reported.
3. **Constructs the extractor does not treat as declarations are not seeded.**
   Verified example: an ECMAScript method assigned onto a prototype
   (`Router.prototype.route = function route () {}`) and an export installed with
   `Object.defineProperty` yield no declaration, so a change to either seeds
   nothing.
4. **A change that touches no symbol's span seeds nothing.** Import blocks,
   top-level configuration and file headers above the first declaration are
   outside every span. A module whose whole content is imports or re-exports —
   a package index, for instance — declares nothing, so a change to it reports
   nothing and raises the "no changed symbols were seeded" warning.
5. **A symbol's span is the declaration's own range, and declarations nest.** The
   symbol reported is the most specific one whose *own* lines the change touched:
   a body line names the member, a class-body line between two members names the
   class, and one hunk covering both names both.
5a. **A declaration's modifiers count only where the grammar nests them.** Java
   annotations and Python decorators are part of their declaration. A Rust
   `#[attribute]` and a decorator on an exported ECMAScript class are separate
   nodes, so a change confined to one of those seeds nothing (entry 4).
6. **The seed cap silently bounds the population.** Past
   `changeImpact.maxChangedSymbols`, symbols are absent from the report entirely.
   `summary.changedSymbolsTruncated` is the only signal that happened.

**Which dependents are found**

7. **References are matched as text, not resolved as bindings.** A dependent that
   never spells the symbol's name is not found. Verified examples: an aliased
   import (`import { fetchUser as loadUser }` — the import line is listed, the
   `loadUser(...)` call sites are not) and a call through a variable (`const f =
   fetchUser; f(...)` — the assignment is listed, the `f(...)` call is not).
   Dynamic dispatch through a computed name is not found for the same reason.
8. **Only direct references are reported. There is no transitive closure.** A file
   that depends on a dependent is not listed, and no depth is configurable.
9. **Whole-line comments are dropped.** A commented-out call is correctly not a
   dependent; a reference on a line inside a block comment or a docstring is
   dropped with it.
10. **Non-source destinations are never listed**, only counted. If your dependency
    genuinely lives in a template, a configuration file or a data fixture, this
    report will not show you where.
11. **The SEARCH bound is spent in traversal order**, ahead of the destination
    split. The reporting cap is spent after it, so it now selects among matches
    that could actually be dependents — but a symbol whose first
    `maxReferenceCandidatesPerSymbol` matches are all prose still reports few
    dependents. `referenceSearchTruncated: true` is what says the search stopped
    early; nothing beyond that bound is counted anywhere.
12. **Excluded paths are invisible as destinations.** `paths.exclude` applies to
    reference search too, by design.

**What the report says about a change**

13. **The reference lists are not adjudicated.** A file in `impactedFiles` is a
    file that *uses* a changed symbol, not one shown to rely on the part that
    changed; published rates for this task put such a list near 90% irrelevant.
    Only `impactFindings` is triaged, and only when
    `changeImpact.adjudication.enabled` is set.
14. **The contract delta covers six text-visible dimensions only**: absence,
    failure, return shape, guard, mutation, concurrency. It reads the *code* lines
    of a change — whole-line comments are excluded from both sides, so neither
    editing a comment nor deleting a commented-out construct affects what is
    reported. Verified silent: a parameter-list or arity change, a type change, a
    default-value change, a visibility change (`export` removed), and a value
    carried inside a string such as a URI query parameter produce **no** contract
    statement. Ordering, resource ownership and serialised-value changes are
    likewise not covered.
14a. **A decorator or annotation on a declaration is silent too.** Adding
    `@keep_lazy(...)`, `@Deprecated` or `#[serde(...)]` replaces what every caller
    of that name receives, and it carries none of the six markers, so the symbol is
    listed with an empty contract delta and its dependents are settled as
    `no-impact` without a model call.
15. **A rename in place is reported as a removal plus an addition.** The pairing
    predicate is the name, and a rename changes it.
16. **A symbol moved into a file in a language the registry does not cover is
    reported as a removal** with `match: "none"` — there is no readable
    declaration to pair against. This is why that outcome is phrased as *"in any
    file this engine can read"*.
17. **No severity, no verdict, no gate.** Findings rate compatibility, and nothing
    can fail a build.
18. **Adjudication is unmeasured.** No accuracy figure for it exists. The
    comparable published system for this task reaches 28% precision; read a result
    against that, not against the diff reviewer.
19. **Absence from `impactFindings` never means a dependent is unaffected.** Four
    situations produce it — adjudication off, no model available, a call that
    failed or could not decide, and the call cap — and `adjudicationStatus`,
    `summary.adjudicationCallCount` and `summary.unadjudicatedPairCount` are what
    tell them apart.
20. **The reliance question is asked over the located sites only.** A dependent
    whose reliance is visible only in code the reference search did not match is
    not adjudicated as relying on anything.
21. **Adjudication is expected to lose recall relative to the reference list, on
    purpose.** It removes noise, and some signal goes with it. The reference lists
    are still there underneath for exactly that reason.


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

It is **enabled by default**, and so is `contextSources`, whose default
`providers` already include an `inbox` reading `.codereviewer/context`. With
`intentFulfilment.enabled` set to `false` the command exits `0` and reports
`"status": "disabled"` rather than an empty result. What actually needs
setting is a model provider — without one the command exits `0` and reports
`"status": "provider-unavailable"` instead:

```json
{ "provider": { "id": "openai", "model": "your-model" } }
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

```json intent-report
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
    "notContradictedCount": 0,
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
  commit already satisfied is correctly `not-evidenced` here. The words were renamed
  on 2026-08-01 for exactly this reason: 54 of the lane's 83 apparent false
  positives were readers taking `unaddressed` to mean "outstanding work".
  `summary.notEvidencedCount` is `not-evidenced` + `undetermined`.
- **An obligation that asks for something *not* to happen has its own status.**
  `not-contradicted` means the obligation rules something out and nothing among the
  changed lines does it. There is no `evidence` array, and there cannot be: keeping
  a prohibition looks like an absence in a diff. It is **not** a report that the
  obligation holds at head — code outside the change can break it — and it is not a
  report that this change established it, which would be `evidenced` with the line
  quoted. It is counted in `summary.notContradictedCount` and is **not** on
  `summary.notEvidencedCount`. Added 2026-08-06, after 33 of the lane's 83 false
  positives were found to be obligations of this shape, for which no available
  status could ever have been right. **No accuracy measurement exists after this
  change.**
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
  failed, and including a `not-contradicted` answer given over a change part of
  which could not be read. It asserts nothing about the change in either direction.
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
