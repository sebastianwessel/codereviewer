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
| `report.md` | `reporting.formats` includes `markdown` | The human document. Sections in order below |
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

### What `report.md` contains, in order

| Block | Always? | What it is for |
| --- | --- | --- |
| Title, then **what this document is** | yes | Stated before anything else, because the most consequential thing a reader can get wrong is what the report's *silence* means. It says plainly that this is a diff-scoped search of what one run could prove, and that an absent finding is not an absent defect. |
| **Measured reliability**, with the model it was measured on | yes | The error rates printed where the reader is, rather than left in an evaluation report nobody opens: in-diff recall, out-of-diff recall, adjusted precision, and the fact that two runs over one commit do not produce the same report. Rounding a rate to "usually" lets a reader supply their own optimistic number. |
| `## Scope of this search` | yes | Run id, mode and depth, a `- Model:` line naming provider and model (or *not recorded* — never omitted, since every rate and price quoted here belongs to one model), base/head/merge-base, and coverage read as *bytes that reached a model*, not as defects found. |
| `## Summary` | yes | Actionable count by severity and category, the gate line, the unresolved count, the rejected-candidate count. |
| `## Bounds that bound` | only when there are any | Incomplete-coverage reasons and every `run.warnings` entry. These used to appear only in the JSON, so a stale baseline or a degraded stage was invisible in the document people are told to read. |
| `## Actionable Findings (n)` | yes | The reason to open the file. Empty renders an explicit *this run proved no defect it could act on* — a statement about the search, never about the change. |
| `## Unresolved - Needs Human Decision (n)` | only when there are any | The artifact-only findings, each with why it stayed unresolved. |
| `## Rejected Candidates (n)`, `## Refutation Results (n)` | yes | The audit trail: what was proposed and thrown out, and on what verdict. |
| `## Provider Issues (n)`, `## Skipped Files (n)` | only when there are any | What the run could not do, and what it never read. |
| `## Cost And Timing` | yes | Duration, tokens, and cost — or an explicit *unavailable*, never a silent omission that would read as free. |

### SARIF

| Severity | SARIF level |
| --- | --- |
| `critical`, `high` | `error` |
| `medium`, `low` | `warning` |
| `info` | `note` |

Results carry `partialFingerprints` (from the finding fingerprints, disambiguated
when two share an algorithm so GitHub's de-duplication keys are not collapsed),
plus `category`, `baselineStatus`, and the fix proposal with apply-ready edits
when one exists. The region carries `endLine` whenever the finding has one, so a
multi-line defect highlights its whole span rather than its first line.
`reporting.sarif.maxResults` truncates the result list and
`reporting.sarif.target: 'github'` applies GitHub-specific rule handling. All
emitted text is redacted.

A finding that carries security classification — `cwe`, `securitySeverity`, or
`helpUri` — has it emitted twice, for two different readers. The exact values stay
on the result (`properties.cwe`, `properties.securitySeverity`), and a
GitHub-shaped projection goes on the rule: `helpUri`, `properties.tags`
(`security` plus one `external/cwe/cwe-<id>` entry per CWE) and
`properties['security-severity']`, the string score GitHub bands into
critical/high/medium/low and honours only for rules tagged `security`. Because a
rule can gather several findings, the rule-level score is the highest any of them
carries and the tags are the union of their CWEs; the per-result values are the
lossless ones. No score is derived from `severity` — a CVSS-like number nobody
measured would be invented, and a rule without one falls back to the result
`level` in the table above. These fields are absent from today's reports:
nothing in the engine populates them yet (see
[spec 15](../../../specs/15-security-focused-review.md), *Mechanism 2*), so this
is the reporter holding up its end of the contract, not a feature of the current
review.

### Review comments

Comment drafts are produced only for findings whose `reporterEligibility` is
`inline` — the decision is admission's, because that is the stage holding the
reviewed diff ranges; see the eligibility note in
[stage 6](06-admission-and-severity-floor.md). The comment layer only drops
old-side locations, which name a line that no longer exists on the new side. A
draft carries the path, a target line range, a redacted and Markdown-escaped
body, and optionally a structured suggestion. A suggestion is emitted only when
the finding has exactly one manual-review fix edit that maps exactly onto the
comment range, the redacted replacement contains no code fence, and the rendered
result still fits the body cap; otherwise the draft degrades to prose.

The body is arranged so the comment can be checked rather than believed: the
severity, category and title, then the description, then the **proof** — what
refutation returned against this finding, in the refuter's own words, and the
evidence addresses it rests on (at most three; the rest are in the report) —
then the fix summary and the finding id. A finding with no recorded refutation
verdict says so out loud instead of dropping the line, so a comment that survived
adjudication and one that was never adjudicated cannot read the same. The
measured reliability rates are deliberately not repeated on each comment; they
are stated once, in the pull-request summary comment.

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
