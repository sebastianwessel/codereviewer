# Artifacts

Everything a run writes to disk, and where. All JSON artifacts are pretty-printed
with two-space indentation and a trailing newline. All paths are resolved
through the path service and must stay inside the repository root.

## Directory layout

The default artifact directory is **`.codereviewer/runs`**
([`paths.artifactDir`](./configuration/review.md#paths)), not `.codereviewer`.
Two important artifact groups live **outside** it:

```
.codereviewer/
├── config.json                 # user-owned config (input)
├── context/                    # contextSources inbox provider (input)
├── skills/                     # skills.directories default (input)
├── baseline.json               # baseline.path — OUTSIDE artifactDir
├── eval/                       # eval artifacts — OUTSIDE artifactDir
│   ├── eval-report.json
│   ├── eval-summary.md
│   ├── eval-recall-report.md
│   └── runs/<UTC-timestamp>-<uuid>/
│       ├── eval-report.json
│       ├── eval-summary.md
│       └── eval-recall-report.md
└── runs/                       # paths.artifactDir (default)
    ├── index.json
    ├── <runId>/
    │   ├── report.json
    │   ├── report.md
    │   ├── report.sarif
    │   ├── review-comments.json
    │   ├── review-comments.<platform>.json
    │   ├── run-summary.json
    │   ├── context-ledger.json
    │   ├── shared-context.json
    │   ├── observability.json
    │   ├── fix-report.json
    │   ├── verification-report.json
    │   └── error.json
    └── impact-<uuid>/          # one completed `impact check`
        ├── impact-report.md
        └── impact-report.json
```

`.codereviewer/**` is in the default [`paths.exclude`](./configuration/review.md#paths),
so artifacts are never fed back into a review.

## Per-run artifacts

| File | Written when | Contents |
| --- | --- | --- |
| `report.json` | always | The canonical machine-readable review report. Written even if `"json"` is absent from `reporting.formats`. |
| `report.md` | `reporting.formats` includes `markdown` | Human-readable report. |
| `report.sarif` | `reporting.formats` includes `sarif` | SARIF 2.1.0, shaped by `reporting.sarif.*`. |
| `review-comments.json` | `reporting.reviewComments.enabled` | Platform-neutral inline comment drafts — the source of truth. |
| `review-comments.<platform>.json` | `reporting.reviewComments.enabled` | Rendered for the resolved platform (`github`, `gitlab`, `bitbucket`, or `generic`). Detection reads CI env and the git `origin` remote only; no network. |
| `run-summary.json` | always | The `run` block on its own (see fields below). |
| `context-ledger.json` | always | Every context admission decision. |
| `shared-context.json` | always | Cross-task shared-context snapshot. |
| `observability.json` | always | No-content run events (`{ "events": [...] }`): step/task/error records with no source, prompt, or model output. |
| `fix-report.json` | `fix.enabled` **and** the lane produced a report | Advisory fix-lane outcomes. |
| `verification-report.json` | `verification.enabled` | Claim verdicts, observations, corroborations. |
| `error.json` | only on a failed run | `code`, `message`, `category`, `recoverable`. |

Artifacts listed in `report.json`'s `artifacts[]` array carry `format`, `path`,
`sha256`, and `containsSensitiveContent: false`. `report.json` itself is not
listed there (it is the document carrying the list).

### `report.json`

| Key | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `"1.0"` | Literal. |
| `run` | object | Same shape as `run-summary.json`. |
| `coverage` | object | `status` (`complete`\|`incomplete`), file/byte counts, `incompleteReasons`, per-file `files[]`. A completed report requires `status: "complete"`. |
| `admittedFindings` | array | Findings that passed refutation and the severity floor. |
| `rejectedFindings` | array | Rejected candidates with a reason (e.g. `below-threshold`, or `duplicate` for a candidate the semantic finding merge grouped into another) — kept for auditability. |
| `evidence` | array | Evidence records referenced by findings. |
| `skippedFiles` | array | `path` + reason: `deleted`, `binary`, `too-large`, `too-many-files`, `excluded`, `unsupported`, `error`. |
| `qualityGate` | object, optional | `passed`, `failingFindingIds`, `thresholds`, `baselineFilteringApplied`. |
| `refutationResults` | array | Per-candidate refutation verdicts. |
| `providerIssues` | array | `code`, `stage`, `recovered`, `message`. |
| `resolvedBaselineEntries` | array, optional | Present when `baseline.includeResolvedInReport` is enabled. |
| `artifacts` | array | The non-JSON artifacts written for this run. |

String values in `report.json` pass through redaction before writing.

### `run-summary.json`

| Field | Type | Notes |
| --- | --- | --- |
| `runId` | string | Also the run directory name. |
| `startedAt`, `completedAt` | ISO datetime | |
| `mode`, `depth` | enum | Effective values for the run. |
| `repositoryRootHash`, `configHash` | SHA-256 | The config is recorded as a hash plus a redacted summary — never raw. |
| `baseRef`, `headRef` | string, optional | |
| `mergeBaseRef` | string, optional | The commit the diff was actually taken against. **Absent for explicit-file runs**, which bypass git entirely. |
| `provider`, `model` | string, optional | |
| `durationMs` | integer | |
| `costUsd` | number, optional | Omitted when tokens or prices are unavailable (with the `cost-unavailable` warning). |
| `inputTokens`, `cachedInputTokens`, `outputTokens` | integer, optional | `cachedInputTokens` is a **subset** of `inputTokens`. |
| `warnings` | string[] | e.g. `config-file-missing`, `baseline-missing`, `cost-unavailable`, and claim-provider warnings. |

### `context-ledger.json`

Array of entries: `id`, `kind` (`file`, `diff`, `symbol`, `instruction`,
`skill`, `support-signal-output`, `tool-result`, `prior-artifact`), optional
`path` / `taskId` / `sourceLedgerEntryId` / `contentHash`, `decision`
(`included`, `skipped`, `truncated`, `summarized`), `reason`,
`bytesConsidered`, `bytesIncluded`.

### `shared-context.json`

`sharedEntries`, `supportSignalFacts`, `taskEvents`, `currentTasks`,
`contextLedgerEntries`, `evidenceRecords`, `candidateFindings`,
`admissionDecisions`, `admittedFindings`, `rejectedFindings`.

### `verification-report.json` and `fix-report.json`

Both use the same schema; each lane fills the parts it owns.

| Field | Type | Filled by |
| --- | --- | --- |
| `verdicts` | array | verification |
| `observations` | array | both — per-claim `toolCalls`, `bytesRead`, `durationMs`, optional `boundReason` |
| `warnings` | string[] | both — redacted, no content (e.g. a claim provider that failed) |
| `claimCount` | integer | both |
| `corroborations` | array | verification — `findingId`, `confidence: "corroborated"`, `matchKinds` (`fingerprint`\|`fuzzy`), `witnessClaimIds`. Confidence signal only; never a severity change. |
| `fixOutcomes` | array | fix — `findingId`, optional `findingJudgment`, `fixProduced`, `applyCheck` |
| `usage` | object, optional | both — `inputTokens`, `outputTokens`, optional `cachedInputTokens`, `reasoningTokens`, `costUsd`. Accounted in its own lane, not folded into the review's run cost. |

### `error.json` (failed runs)

When a run fails after tasks started, the CLI still writes `run-summary.json`,
`context-ledger.json`, `shared-context.json`, `observability.json`, and
`error.json` — but **no `report.json`**. Stderr additionally carries
`artifactDir` so CI can collect the partial set.

## Run index — `<artifactDir>/index.json`

Run directories are otherwise unenumerated, so the index is how tooling (and
`baseline write`) finds the newest report.

| Field | Type | Notes |
| --- | --- | --- |
| `runs[].runId` | string | |
| `runs[].startedAt` | string | |
| `runs[].completedAt` | string, optional | Absent for failed runs. |
| `runs[].status` | `"completed"` \| `"failed"` | |
| `runs[].reportPath` | string, optional | Present only for completed runs. |

Newest first, capped at **50** entries. Trimming only shortens the index — run
directories themselves are never deleted, so prune `<artifactDir>` yourself.
The index is best-effort bookkeeping: a failure to update it never fails a run
whose artifacts are already durable, and a corrupt index is replaced with an
empty one rather than surfaced as an error.

## Baseline — `.codereviewer/baseline.json`

Written by [`codereviewer baseline write`](./cli.md#codereviewer-baseline-write)
from an existing `report.json`; read by every run when `baseline.enabled`. It is
user-owned state, deliberately outside `artifactDir` so clearing run artifacts
does not reset the baseline. Path configurable via `baseline.path`.

## Eval artifacts — `.codereviewer/eval/`

`eval run` writes each artifact twice: once at the stable top-level path
(overwritten each run) and once into an immutable archive directory
`.codereviewer/eval/runs/<UTC-timestamp>-<uuid>/`.

| File | Contents |
| --- | --- |
| `eval-report.json` | Full eval report: per-case results, metrics, `scoring`, `regressionGate`. Default input for `eval recall-report` and `eval compare`. |
| `eval-summary.md` | The Markdown summary also printed to stdout. |
| `eval-recall-report.md` | Per-expected-finding recall breakdown. |

These are **outside `paths.artifactDir`** and are unaffected by
`CODEREVIEWER_ARTIFACT_DIR`. `eval compare`, `eval recall-report`, and
`eval slice-manifest` write nothing — they print to stdout only.

## `impact check` artifacts

A **completed** `impact check` writes its own run directory under
`paths.artifactDir`, named `impact-<uuid>`:

| File | Contents |
| --- | --- |
| `impact-report.md` | The rendered change-impact report. Changed symbols whose contract moved and that have dependents come first; dependents are grouped by file, tests are listed separately, and the bounds of the search (per-symbol cap, references in the defining file, matches withheld as non-source) are stated. |
| `impact-report.json` | The same report, identical to `--format json` on stdout. |

The path of the Markdown file is printed to stderr. A **disabled** run writes
nothing. These runs are deliberately **not** recorded in `index.json`: the index
feeds baseline resolution, which expects a review report.

## Log file

Only written when `--log-file <path>` is passed to `review` or `eval run`.
JSONL, **append-only**: each invocation appends a
`{"event":"log-run-start","at":"…"}` header line so earlier runs survive.
Missing parent directories are created recursively; an existing directory is not
an error.

## Related

- [configuration/review.md](./configuration/review.md#paths) — `paths.artifactDir`
- [configuration/reporting-and-observability.md](./configuration/reporting-and-observability.md) — formats and review comments
- [Exit codes and error codes](./exit-codes-and-error-codes.md) — `error.json` codes
