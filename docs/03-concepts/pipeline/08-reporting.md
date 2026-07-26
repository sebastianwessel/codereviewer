# 8 · Reporting

← [Baseline and quality gate](07-baseline-and-quality-gate.md) · back to [Review lifecycle](../review-lifecycle.md)

The final stage writes everything the run knows to disk. It renders; it never
publishes. The engine holds no network and no write permission outside the
artifact directory, so posting a comment or updating a PR is your pipeline's job.

## What it receives

The finished `ReviewReport` (run summary, coverage, admitted and rejected
findings, evidence, skipped files, quality gate, refutation results, provider
issues, resolved baseline entries), plus the context ledger, the shared-context
snapshot, and the observability snapshot.

Two optional lanes run *after* admission and *before* the reporters render, so
their output appears in every rendered artifact: the **fix lane** enriches
admitted findings with apply-checked fix proposals, and the **verification flow**
adds its warnings to the run summary. Neither can change a finding's category,
severity, admission, or the gate. See [Optional capabilities](../optional-capabilities/README.md).

## What it does

Artifacts are written into `<paths.artifactDir>/<runId>/` — by default
`.codereviewer/runs/<runId>/`.

| Artifact | Written when | Contents |
| --- | --- | --- |
| `report.json` | always | The full validated report, recursively redacted, including an `artifacts` list of the other rendered files |
| `report.md` | `reporting.formats` includes `markdown` | Human summary: run header, quality gate, coverage, actionable severity/category counts, actionable findings (with fix proposal and edits), an *Unresolved — Needs Human Decision* section for the artifact-only findings including why each stayed unresolved, and the rejected-candidate list |
| `report.sarif` | `reporting.formats` includes `sarif` | SARIF 2.1.0 for code-scanning ingestion |
| `review-comments.json` | `reporting.reviewComments.enabled` | Platform-neutral inline comment drafts |
| `review-comments.<platform>.json` | `reporting.reviewComments.enabled` | The same drafts rendered for the detected/pinned platform |
| `run-summary.json` | always | The run header alone, for cheap consumption |
| `context-ledger.json` | always | Every context item considered, with hashes and byte counts |
| `shared-context.json` | always | Facts, task events, evidence, candidates, decisions, findings |
| `observability.json` | always | Step timings and recorded events |

`<artifactDir>/index.json` is additionally updated with a `{runId, startedAt,
completedAt, status, reportPath}` entry (most recent first, capped at 50). The
index is best-effort bookkeeping: a failure to update it never fails a run whose
artifacts are already durable.

> `report.json` is written regardless of `reporting.formats`; the `json` entry in
> that list does not gate it. `formats` controls the Markdown and SARIF renders.

### SARIF

| Severity | SARIF level |
| --- | --- |
| `critical`, `high` | `error` |
| `medium`, `low` | `warning` |
| `info` | `note` |

Results carry `partialFingerprints` (from the finding fingerprints, disambiguated
when two share an algorithm so GitHub's de-duplication keys are not collapsed),
plus `category`, `baselineStatus`, and the fix proposal with apply-ready edits
when one exists. `reporting.sarif.maxResults` truncates the result list and
`reporting.sarif.target: 'github'` applies GitHub-specific rule handling. All
emitted text is redacted.

### Review comments

Comment drafts are produced only for findings whose `reporterEligibility` is
`inline` **and** whose location side is `new` — see the eligibility note in
[stage 6](06-admission-and-severity-floor.md). A draft carries the path, a target
line range, a redacted and Markdown-escaped body, and optionally a structured
suggestion. A suggestion is emitted only when the finding has exactly one
manual-review fix edit that maps exactly onto the comment range, the redacted
replacement contains no code fence, and the rendered result still fits the body
cap; otherwise the draft degrades to prose.

Platform resolution for `reporting.reviewComments.platform: 'auto'`:

1. CI environment signals (`GITHUB_ACTIONS`, `GITLAB_CI`, `BITBUCKET_*`)
2. The `origin` git remote host
3. `generic`

Detection reads the environment and the local git remote only — no network. A
repository without a remote resolving to `generic` is normal, not an error.

## Failed runs still report

When the run fails after it has produced state — coverage incomplete, cost budget
exceeded, provider task failure, run timeout — partial artifacts are written to
the same run directory: `run-summary.json`, `context-ledger.json`,
`shared-context.json`, `observability.json`, and `error.json` with the structured
error's code, message, category, and recoverability. The run index records the
run as `failed`. A failing review is still an auditable one.

## What it emits

Files on disk, plus the CLI's stdout summary (`runId`, `qualityGatePassed`,
`artifactDir`) and its exit code — `0` when the gate passed, `1` when it did not,
and the structured error's exit code on failure.

## What can go wrong

| Situation | Behaviour |
| --- | --- |
| Artifact directory not writable | The write throws a `report_error` structured error |
| Path escapes the repository root | Rejected by the path service before any write |
| No git remote and no CI signal | Review comments render as `generic` |
| Report fails its own schema validation | Rendering fails loudly rather than emitting a malformed artifact |
| Run index unreadable or unwritable | Silently skipped; the run's artifacts are unaffected |

## Configuration keys

| Key | Default | Effect |
| --- | --- | --- |
| `paths.artifactDir` | `.codereviewer/runs` | Root for run directories and `index.json` |
| `reporting.formats` | `["json","markdown","sarif"]` | Which renders to produce (Markdown/SARIF) |
| `reporting.sarif.target` | `generic` | `github` enables GitHub-specific rule handling |
| `reporting.sarif.category` | `codereviewer` | SARIF automation category |
| `reporting.sarif.maxResults` | `5000` | Truncates the SARIF result list |
| `reporting.reviewComments.enabled` | `false` | Emit inline comment drafts |
| `reporting.reviewComments.platform` | `auto` | Pin a renderer instead of detecting |

> There is no `reporting.sarif.redact` key. The SARIF renderer, like every other
> report renderer, redacts its text unconditionally, so a key to turn that off
> would have had nothing to switch.

See also: [Artifacts reference](../../06-reference/artifacts.md) ·
[CLI reference](../../06-reference/cli.md) ·
[Operations](../../08-operations/).
