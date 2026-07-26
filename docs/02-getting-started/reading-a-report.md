# Reading A Report

A walk through `report.md` — every section it emits, in the order it emits them,
and what each one is telling you.

`report.md` is written to `.codereviewer/runs/<run-id>/report.md` whenever
`markdown` is in `reporting.formats` (it is by default). It is rendered from the
same validated report object as `report.json`, so anything here can be traced
into the JSON.

---

## At a glance

| Section | Always present? | What it answers |
| --- | --- | --- |
| Header | yes | Which run, what posture, how long. |
| Quality Gate | only when a gate was evaluated | Pass/fail, and how many findings caused a failure. |
| Coverage | yes | Was the declared scope actually reviewed? |
| Actionable Severity Counts | yes | Shape of the actionable set. |
| Actionable Category Counts | yes | Shape of the actionable set. |
| Actionable Findings | yes | **The findings you are meant to act on.** |
| Unresolved - Needs Human Decision | only when non-empty | Suspicions the engine could not settle. |
| Rejected Candidates | yes | What was proposed and thrown out, with the reason. |
| Refutation Results | yes | The verdict and rationale behind every candidate. |
| Provider Issues | yes | Model/provider trouble during the run. |
| Skipped Files | yes | What was never reviewed, and why. |
| Cost And Timing | yes | Duration, and cost when the provider reported it. |

Sections after *Actionable Findings* are the audit trail. They are rendered so a
human can check the engine's work without opening JSON.

---

## Header

```text
# Review Report

Run: run-3f2c…
Mode: ci
Depth: balanced
Duration: 48213 ms
```

`Mode` (`local` / `ci` / `pr` / `full`) and `Depth` (`fast` / `balanced` /
`thorough`) record the posture the run actually used, after config, environment,
and defaults were merged. Depth is what determines how files were clustered into
review tasks.

---

## Quality Gate

```text
## Quality Gate

Passed: yes
Failing findings: 0
```

Rendered only when a quality gate was evaluated. `Failing findings` is the count
of admitted findings that caused the failure; their IDs are in `report.json`.
A failed gate is exit code `1`.

Artifact-only ("Unresolved") findings never contribute to the gate.

---

## Coverage

```text
## Coverage

Status: complete
Files: 12/12
Bytes: 184320/184320
```

This is the coverage certificate: proof of what was actually reviewed.

- `Status: complete` means every reviewable file was fully covered — the sum of
  included source-chunk bytes equals each file's reviewable byte length.
- `Status: incomplete` is followed by a bullet list of `incompleteReasons`. A
  *completed* review is not supposed to reach this state; the engine fails closed
  on incomplete coverage rather than reporting success over source it never read.

If `Files` is lower than you expect, read **Skipped Files** at the bottom.

---

## Actionable Severity / Category Counts

```text
## Actionable Severity Counts

- high: 2
- medium: 5
```

Both counts are computed over **actionable findings only** — anything marked
`artifact-only` is excluded. Categories come from a fixed set: `bug`, `security`,
`performance`, `maintainability`, `compatibility`, `policy`, `test`.

---

## Actionable Findings

The section that matters. Findings are sorted by severity (`critical` → `high` →
`medium` → `low` → `info`), then path, then start line, then title.

```text
### HIGH: Refund path skips the idempotency guard

- ID: find_…
- Category: bug
- Location: src/payments/refund.ts:142
- Baseline: new
- Suggested fix: Re-check the idempotency key before issuing the credit.
- Fix evidence: ev_…, ev_…
- Fix edits:
  - src/payments/refund.ts:142-146: <replacement text> - <description>

<description of the defect>
```

| Field | Meaning |
| --- | --- |
| Heading | Severity in caps, then the title. |
| `ID` | Stable finding ID. Use it to find the full record — evidence, refutation link, fingerprints, reporter eligibility — in `report.json`. |
| `Category` | One of the seven categories above. |
| `Location` | Repository-relative path and start line. Locations are validated against the reviewed head-file content; a candidate whose location does not resolve is rejected, not guessed. |
| `Baseline` | `new`, `existing`, `resolved`, or `unknown`. With `failOnNewOnly` (default true), only `new` can fail the gate. |
| `Suggested fix` / `Fix evidence` / `Fix edits` | Present only when a fix proposal exists. Every proposal is tied to at least one evidence record. **Nothing is ever applied to your files** — these are proposals for a human. |

Each of these findings passed the whole chain: refutation returned `proved`, the
admission gate accepted it, and it met the severity floor
(`aiReview.actionableSeverityThreshold`, default `medium`).

> Text is redacted and Markdown-escaped before rendering, so descriptions may
> contain backslash escapes in front of characters like `*`, `[`, `#`, or `|`.
> That is the sanitizer, not the model.

---

## Unresolved - Needs Human Decision

Present only when the run produced artifact-only findings.

```text
## Unresolved - Needs Human Decision

These candidates were neither proved nor disproved from the available context.
They do not affect the quality gate. Confirm or dismiss each one.

### MEDIUM: Cache key may collide across tenants

- ID: find_…
- Category: bug
- Location: src/cache/key.ts:31
- Proposed by: review-agent
- Why unresolved: needs-more-evidence - the tenant scoping is set by a caller outside the reviewed files

<description of the suspicion>
```

These are real suspicions that the refuter could neither prove nor disprove —
most often because the deciding evidence sits outside the context it could reach.
They are deliberately kept out of the quality gate, out of inline comments, and
out of SARIF results, so surfacing them cannot block a build or add review noise.

`Why unresolved` carries the refutation verdict and its rationale, so you can
judge whether the missing evidence is something you already know.

This section is the compensating half of a precision-first design. Skipping it
means taking the strictness without the recovery. See
[Why precision first](../01-overview/why-precision-first.md).

---

## Rejected Candidates

```text
## Rejected Candidates

- cand_…: refuted (rejected)
- cand_…: below-threshold (rejected)
```

Every candidate the gate threw out, with a stable reason. The reasons are a
closed set:

| Reason | Meaning |
| --- | --- |
| `refuted` | Refutation disproved it. |
| `below-threshold` | Below the actionable severity floor. |
| `location-invalid` | Line range did not resolve in the reviewed head file. |
| `not-in-scope` | Not in a changed file. |
| `insufficient-evidence` / `weak-evidence` | No adequate redacted evidence record. |
| `duplicate` | Already admitted elsewhere. |
| `deterministic-contradiction` | A deterministic check contradicted it. |
| `static-analysis-duplicate` | Restates what an external analyzer already reports. |
| `schema-invalid` | Model output failed contract validation. |
| `unsafe-content` | Failed a content safety check. |
| `provider-error` | A provider failure prevented adjudication. |

If the report feels too quiet, this section tells you exactly where the volume
went.

---

## Refutation Results

```text
## Refutation Results

- refute_…: proved for cand_… - the guard is bypassed on the early-return path
  - Refutation evidence: ev_…, ev_…
  - Refutation check contradiction: passed - no deterministic contradiction found evidence: none cited
```

One entry per adjudicated candidate: the verdict, the candidate it belongs to,
the rationale, cited evidence IDs, and each individual check (`passed` /
`failed` / `unknown`). Verdicts are `proved`, `refuted`, `needs-more-evidence`,
or `provider-error`. `none cited` means exactly that — no evidence was attached
to that item, and it is shown rather than hidden.

This section exists so refutation can be audited without opening JSON.

---

## Provider Issues

```text
## Provider Issues

- provider_timeout at refutation-check recovered: yes - request exceeded the configured timeout
```

Normalized, redacted provider trouble: a stable `code`, the `stage` it happened
in, and whether it was recovered. Recovered issues stay visible — a run that
retried its way to success still says so. Unrecovered issues can fail the gate
via `qualityGate.failOnProviderError` (default `true`).

Provider issues are also written into SARIF as run metadata rather than as
diagnostic results, so they cannot become spurious code-scanning alerts.

---

## Skipped Files

```text
## Skipped Files

- assets/logo.png: binary
- src/generated/schema.ts: excluded
- docs/legacy.md: deleted
```

Files that were part of the change set but never reviewed. Reasons include
`deleted`, `binary`, `too-large` (over `review.maxFileBytes`, default 500000
bytes), and `excluded` (matched `paths.exclude` — lock files, minified bundles,
source maps, and snapshots are excluded by default).

Check this whenever a review looks thinner than the change was.

---

## Cost And Timing

```text
## Cost And Timing

- Duration: 48213 ms
- Cost: 0.184
```

`Cost` (USD) appears only when token usage and pricing data were available.
Missing pricing is reported as absent — never as a free run. You can supply
pricing overrides with the `CODEREVIEWER_COST_*` environment variables.

---

## Auditing a finding end to end

1. Take the finding `ID` from **Actionable Findings**.
2. Open `report.json` and find it in `admittedFindings` — it carries
   `evidenceIds`, `refutationId`, `fingerprints`, `reporterEligibility`, and the
   full location.
3. Follow `refutationId` into `refutationResults` for the verdict, rationale, and
   checks.
4. Follow `evidenceIds` into the report's evidence records for the diff ranges,
   symbol facts, and rationale summaries the decision rested on.
5. If you want to know *why the model saw what it saw*, read
   `context-ledger.json`: every context item considered, with its decision
   (`included` / `skipped` / `truncated` / `summarized`), byte counts, and a
   content hash — never the content itself.

---

## Other report formats

| Format | Notes |
| --- | --- |
| `report.json` | Canonical. Everything above, plus candidates, evidence, admission decisions, and coverage detail. |
| `report.sarif` | SARIF 2.1.0. **Excludes artifact-only findings** so unresolved suspicions cannot become code-scanning alerts. Provider issues appear as run metadata. |
| `review-comments*.json` | Inline comment drafts, gated by `review.inlineSeverityThreshold` (default `high`) and by overlap with a changed diff hunk. Written only when `reporting.reviewComments.enabled` is true. The engine never publishes them. |

See [Reference](../06-reference/) for the full artifact and schema contracts.

---

## Next

- [Why precision first](../01-overview/why-precision-first.md) — why the audit sections exist.
- [Glossary](../01-overview/glossary.md) — `artifact-only`, `reporter eligibility`, `baseline status`.
- [Concepts: review lifecycle](../03-concepts/review-lifecycle.md)
- [Guides](../04-guides/) — tuning thresholds and report formats.
